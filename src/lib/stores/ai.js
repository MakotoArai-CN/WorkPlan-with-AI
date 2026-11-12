import { writable, get, derived } from 'svelte/store';
import { pruneProviderConfigs, migrateRemovedProvider } from '../utils/ai-config.js';
import { resolveRequestHeaders } from '../utils/ai-request-fingerprint.js';
import { searchLocalFilesDetailed, readLocalFile, writeLocalFile, deleteLocalFile, pickLocalTextFiles, readSelectedTextFiles, readPastedFilesAsAttachments, isContentUri, pickMediaFiles, readSelectedMediaFiles, getMediaType, getFileExtension, isPathCoveredByContentTree, resolveLocalPath, syncTrustedDirectories } from '../utils/local-file-tools.js';
import { searchWeb, fetchWebContent } from '../utils/web-search.js';

import { settingsStore } from './settings.js';
import { notesStore } from './notes.js';
import { packLocalJson, unpackLocalJson } from '../utils/local-compress.js';
import { TASK_STATUSES, TASK_PRIORITIES, resolveStatus, resolvePriority, normalizeStatus, normalizePriority } from '../utils/task-vocabulary.js';
import { formatLocalDateTime } from '../utils/datetime.js';
import { AI_TRUST_RULES, isExplicitWebFetchTarget, untrustedAiContext, validateNativeToolCall } from '../utils/ai-tool-policy.js';
import { isSensitiveAiPath, redactAiSecrets } from '../utils/ai-file-security.js';
import { assertChatAttachments } from '../utils/ai-attachment-policy.js';
import { runOnDemandAssistant } from '../utils/ai-on-demand.js';
import { describeOperation } from '../utils/ai-operation-policy.js';
import { READ_APP_DATA_TOOL, queryApplicationData } from '../utils/ai-app-query.js';
import { fitFileSearchReport } from '../utils/file-search-report.js';

const STORAGE_KEY = 'workplan_ai_config';
const AI_CHAT_HISTORY_KEY = 'workplan_ai_chat_history';
const AI_CHAT_SESSIONS_KEY = 'workplan_ai_chat_sessions';
const PROVIDER_CONFIG_FIELDS = ['apiKey', 'secretKey', 'model', 'customModel', 'customEndpoint', 'accountId'];
const OPTIONAL_API_KEY_PROVIDERS = new Set(['ollama', 'lmstudio', 'custom']);
const USER_CHAT_AVATARS = [
    '/avatars/user-orbit-1.svg',
    '/avatars/user-orbit-2.svg',
    '/avatars/user-orbit-3.svg',
    '/avatars/user-orbit-4.svg'
];
const ASSISTANT_CHAT_AVATARS = [
    '/avatars/assistant-orbit-1.svg',
    '/avatars/assistant-orbit-2.svg',
    '/avatars/assistant-orbit-3.svg',
    '/avatars/assistant-orbit-4.svg'
];

function getChatAvatarVariant(index = 0) {
    const safeIndex = Math.abs(Number(index) || 0);
    return {
        avatarIndex: safeIndex,
        userAvatar: USER_CHAT_AVATARS[safeIndex % USER_CHAT_AVATARS.length],
        assistantAvatar: ASSISTANT_CHAT_AVATARS[safeIndex % ASSISTANT_CHAT_AVATARS.length]
    };
}

// Chat session / profile ids end up being compared for identity and persisted, so
// they are generated from the platform CSPRNG rather than Math.random(): the latter
// is both predictable and prone to collisions when several ids are created in the
// same millisecond.
function createId(prefix = 'id') {
    const words = new Uint32Array(2);
    crypto.getRandomValues(words);
    const random = `${words[0].toString(36)}${words[1].toString(36)}`.slice(0, 12);
    return `${prefix}_${Date.now()}_${random}`;
}

function getDefaultProviderConfig() {
    return {
        apiKey: '',
        secretKey: '',
        model: '',
        customModel: '',
        customEndpoint: '',
        accountId: ''
    };
}

function getDefaultConnectionProfile(name = '默认连接') {
    return {
        id: createId('profile'),
        name,
        provider: 'openai',
        apiKey: '',
        secretKey: '',
        model: 'auto',
        customModel: '',
        customEndpoint: '',
        accountId: '',
        providerConfigs: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

function getDefaultAiConfigState() {
    const defaultProfile = getDefaultConnectionProfile();
    return {
        provider: defaultProfile.provider,
        apiKey: '',
        secretKey: '',
        model: 'auto',
        customModel: '',
        customEndpoint: '',
        accountId: '',
        temperature: 0.7,
        maxTokens: 4096,
        customHeaders: {},
        requestFingerprint: 'default',
        dailyReportPrompt: '',
        weeklyReportPrompt: '',
        providerConfigs: {},
        connectionProfiles: [defaultProfile],
        activeProfileId: defaultProfile.id,
        activeProfileName: defaultProfile.name
    };
}

function getDefaultAiPanelContext() {
    return {
        scope: 'dashboard',
        mode: 'task',
        title: 'AI 助手',
        description: '',
        entityLabel: '任务',
        source: 'tasks',
        draft: '',
        activeNoteId: null,
        noteTitle: '',
        noteCategory: '',
        noteContent: ''
    };
}

function providerNeedsApiKey(providerId) {
    return !OPTIONAL_API_KEY_PROVIDERS.has(providerId);
}

/** Public wrapper so components do not reimplement the provider matrix. */
export function providerRequiresApiKey(providerId) {
    return providerNeedsApiKey(providerId);
}

export const aiConfig = writable(getDefaultAiConfigState());

export const chatHistory = writable([]);
export const aiChatHistory = writable([]);
export const aiChatSessions = writable([]);
export const activeAiChatSessionId = writable(null);
export const aiChatDraft = writable('');
export const aiChatComposerAttachments = writable([]);
export const aiChatContext = writable(null);
export const aiPanelContext = writable(getDefaultAiPanelContext());
export const isAiLoading = writable(false);
export const showAiPanel = writable(false);
export const showAiSettings = writable(false);
export const providerModels = writable({});
export const modelsLoading = writable(false);
export const lastFailedMessage = writable(null);
export const streamingContent = writable('');
let activeModelLoadCount = 0;
const activeModelLoadPromises = new Map();
let _streamAbortController = null;
let aiOperationGeneration = 0;

export function captureAiOperationGuard(signal = null, requireTools = true) {
    const generation = aiOperationGeneration;
    const sessionId = get(activeAiChatSessionId);
    const accessKey = typeof localStorage === 'undefined' ? null : localStorage.getItem('workplan_access_key');
    return () => !signal?.aborted && generation === aiOperationGeneration
        && sessionId === get(activeAiChatSessionId)
        && accessKey === (typeof localStorage === 'undefined' ? null : localStorage.getItem('workplan_access_key'))
        && (!requireTools || get(settingsStore).enableAiChatTools !== false);
}

export function stopStreaming() {
    aiOperationGeneration++;
    if (_streamAbortController) {
        _streamAbortController.abort();
        _streamAbortController = null;
    }
    isAiLoading.set(false);
    streamingContent.set('');
    const stopMessages = history => history.map(message => {
        if (['loading', 'tool_progress', 'streaming'].includes(message.type)) {
            return { role: 'assistant', type: 'text', content: message.content || '请求已停止。', isStreaming: false };
        }
        if (message.type === 'ai_execution_plan' && message.isExecuting) {
            return { ...message, isExecuting: false, plan: { ...message.plan, status: 'cancelled' } };
        }
        return message;
    });
    chatHistory.update(stopMessages);
    aiChatHistory.update(stopMessages);
}
export const pendingTaskOperation = writable(null);
function getDefaultAiChatRuntimeCapabilities() {
    return {
        probed: false,
        probing: false,
        probedAt: 0,
        localFilesRuntimeAvailable: null,
        webSearchRuntimeAvailable: null,
        toolCallRuntimeAvailable: null,
        nativeToolCallRuntimeAvailable: null,
        // Per-check diagnostics. Linux builds reported a bare red badge with no
        // reason, which made Arch-only failures impossible to triage.
        details: {}
    };
}

export const aiChatRuntimeCapabilities = writable(getDefaultAiChatRuntimeCapabilities());

function resetAiChatRuntimeCapabilities() {
    aiChatRuntimeCapabilities.set(getDefaultAiChatRuntimeCapabilities());
}
export const aiChatCapabilities = derived(
    [settingsStore, aiConfig, aiChatRuntimeCapabilities],
    ([$settings, $config, $runtime]) => {
        const needsApiKey = providerNeedsApiKey($config.provider);
        const toolRouterEnabled = $settings.enableAiChatTools ?? true;
        const localFileEnabled = $settings.localFileConfig?.enabled ?? false;

        const localFilesSettingAvailable = toolRouterEnabled && localFileEnabled;
        const localFilesAvailable = $runtime.probed
            ? localFilesSettingAvailable && ($runtime.localFilesRuntimeAvailable !== false)
            : localFilesSettingAvailable;
        const webSearchAvailable = $runtime.probed
            ? toolRouterEnabled && ($runtime.webSearchRuntimeAvailable !== false)
            : toolRouterEnabled;
        const toolCallAvailable = $runtime.probed
            ? ($runtime.toolCallRuntimeAvailable !== false)
            : true;
        const nativeToolCallAvailable = $runtime.nativeToolCallRuntimeAvailable === true
            ? true
            : ($runtime.probed ? false : null);

        return {
            mode: toolRouterEnabled ? 'internal_router' : 'chat_only',
            connectionReady: !needsApiKey || Boolean($config.apiKey),
            toolRouterEnabled,
            projectToolsAvailable: toolRouterEnabled && toolCallAvailable,
            nativeToolCallAvailable: toolRouterEnabled && nativeToolCallAvailable === true,
            localFilesAvailable,
            localFilesRequireConfirmation: localFilesAvailable &&
                ($settings.localFileConfig?.requireConfirmation ?? true),
            webSearchAvailable,
            toolCallRuntimeAvailable: toolCallAvailable,
            nativeToolCallRuntimeAvailable: nativeToolCallAvailable,
            workspaceRoot: $settings.workspaceRoot || '',
            probed: $runtime.probed,
            probing: $runtime.probing
        };
    }
);

export async function probeAiCapabilities() {
    const runtime = get(aiChatRuntimeCapabilities);
    if (runtime.probing) return;

    aiChatRuntimeCapabilities.update(r => ({ ...r, probing: true }));

    let localFilesOk = null;
    let webSearchOk = null;
    let toolCallOk = null;
    let nativeToolCallOk = null;
    const details = {};

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('get_workspace_root');
        localFilesOk = true;
        details.localFiles = { ok: true, kind: 'ok', message: '' };
    } catch (error) {
        localFilesOk = false;
        details.localFiles = { ok: false, ...describeToolFailure(error) };
    }

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('search_web', { query: 'test', maxResults: 1 });
        webSearchOk = true;
    } catch (e) {
        const errMsg = String(e?.message || e || '').toLowerCase();
        const failure = describeToolFailure(e);
        details.webSearch = { ok: failure.kind !== 'unsupported', ...failure };
        if (errMsg.includes('not found') || errMsg.includes('not implemented') ||
            errMsg.includes('no such') || errMsg.includes('plugin')) {
            webSearchOk = false;
        } else {
            webSearchOk = true;
        }
    }

    try {
        const config = getEffectiveConfig();
        const needsApiKey = providerNeedsApiKey(config.provider);
        if (needsApiKey && !config.apiKey) {
            toolCallOk = false;
            nativeToolCallOk = false;
        } else {
            const { callAI } = await import('../utils/ai-providers.js');
            const probe = await callAI(config, 'respond with only the word OK', 'You are a test probe. Respond with only the word OK.');
            toolCallOk = typeof probe === 'string' && probe.length > 0;
            details.toolCall = { ok: toolCallOk, kind: toolCallOk ? 'ok' : 'error', message: toolCallOk ? '' : '模型未返回文本' };
        }
    } catch (e) {
        console.warn('[Probe] tool call probe failed:', e?.message || e);
        toolCallOk = false;
        details.toolCall = { ok: false, ...describeToolFailure(e) };
    }

    if (toolCallOk) {
        try {
            const config = getEffectiveConfig();
            const { canProviderUseNativeTools, callAIWithMessagesAndTools } = await import('../utils/ai-providers.js');
            if (!canProviderUseNativeTools(config.provider, config)) {
                nativeToolCallOk = false;
                details.nativeToolCall = { ok: false, kind: 'unsupported', message: '当前服务商不支持原生工具调用' };
            } else {
                const probeTools = [{
                    type: 'function',
                    function: {
                        name: 'workplan_probe_tool',
                        description: '用于检测当前模型是否支持原生 function/tool calling。',
                        parameters: {
                            type: 'object',
                            properties: {
                                value: {
                                    type: 'string',
                                    description: '固定返回 ok'
                                }
                            },
                            required: ['value'],
                            additionalProperties: false
                        }
                    }
                }];
                const probe = await callAIWithMessagesAndTools(
                    config,
                    [
                        {
                            role: 'system',
                            content: '你是能力检测助手。必须调用指定工具，不要直接回答文本。'
                        },
                        {
                            role: 'user',
                            content: '请调用 workplan_probe_tool，参数 value 设置为 ok。'
                        }
                    ],
                    probeTools,
                    {
                        maxTokens: 256,
                        toolChoice: { type: 'function', function: { name: 'workplan_probe_tool' } }
                    }
                );
                nativeToolCallOk = (probe.toolCalls || []).some(call => call.name === 'workplan_probe_tool');
                details.nativeToolCall = {
                    ok: nativeToolCallOk,
                    kind: nativeToolCallOk ? 'ok' : 'error',
                    message: nativeToolCallOk ? '' : '模型没有按 tool_choice 返回工具调用'
                };
            }
        } catch (e) {
            console.warn('[Probe] native tool call probe failed:', e?.message || e);
            nativeToolCallOk = false;
            details.nativeToolCall = { ok: false, ...describeToolFailure(e) };
        }
    } else if (nativeToolCallOk === null) {
        nativeToolCallOk = false;
    }

    aiChatRuntimeCapabilities.set({
        probed: true,
        probing: false,
        probedAt: Date.now(),
        localFilesRuntimeAvailable: localFilesOk,
        webSearchRuntimeAvailable: webSearchOk,
        toolCallRuntimeAvailable: toolCallOk,
        nativeToolCallRuntimeAvailable: nativeToolCallOk,
        details
    });

    return {
        localFilesRuntimeAvailable: localFilesOk,
        webSearchRuntimeAvailable: webSearchOk,
        toolCallRuntimeAvailable: toolCallOk,
        nativeToolCallRuntimeAvailable: nativeToolCallOk
    };
}

const WEEKDAY_MAP = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function extractProviderConfigFromAiConfig(config) {
    const result = {};
    for (const field of PROVIDER_CONFIG_FIELDS) {
        result[field] = config[field] || '';
    }
    return result;
}

function extractProviderConfigFromProfile(profile) {
    const result = {};
    for (const field of PROVIDER_CONFIG_FIELDS) {
        if (field === 'model') {
            result[field] = profile?.[field] || 'auto';
        } else {
            result[field] = profile?.[field] || '';
        }
    }
    return result;
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function connectionProfileComparable(profile = {}) {
    return {
        id: profile.id || '',
        name: profile.name || '',
        provider: profile.provider || '',
        apiKey: profile.apiKey || '',
        secretKey: profile.secretKey || '',
        model: profile.model || '',
        customModel: profile.customModel || '',
        customEndpoint: profile.customEndpoint || '',
        accountId: profile.accountId || '',
        providerConfigs: profile.providerConfigs || {},
        createdAt: profile.createdAt || '',
        updatedAt: profile.updatedAt || ''
    };
}

function connectionProfileContentChanged(previous = {}, next = {}) {
    const comparableFields = [
        'name',
        'provider',
        'apiKey',
        'secretKey',
        'model',
        'customModel',
        'customEndpoint',
        'accountId'
    ];
    if (comparableFields.some(field => (previous[field] || '') !== (next[field] || ''))) {
        return true;
    }
    return stableStringify(previous.providerConfigs || {}) !== stableStringify(next.providerConfigs || {});
}

function aiConfigComparable(state = {}) {
    return {
        provider: state.provider || '',
        apiKey: state.apiKey || '',
        secretKey: state.secretKey || '',
        model: state.model || '',
        customModel: state.customModel || '',
        customEndpoint: state.customEndpoint || '',
        accountId: state.accountId || '',
        temperature: state.temperature ?? '',
        maxTokens: state.maxTokens ?? '',
        customHeaders: state.customHeaders || {},
        requestFingerprint: state.requestFingerprint || 'default',
        dailyReportPrompt: state.dailyReportPrompt || '',
        weeklyReportPrompt: state.weeklyReportPrompt || '',
        providerConfigs: state.providerConfigs || {},
        activeProfileId: state.activeProfileId || '',
        activeProfileName: state.activeProfileName || '',
        connectionProfiles: (state.connectionProfiles || []).map(connectionProfileComparable)
    };
}

function aiConfigStatesEqual(a, b) {
    return stableStringify(aiConfigComparable(a)) === stableStringify(aiConfigComparable(b));
}

function setAiConfigIfChanged(nextState) {
    if (!aiConfigStatesEqual(get(aiConfig), nextState)) {
        aiConfig.set(nextState);
    }
}

function updateAiConfigIfChanged(createNextState) {
    const current = get(aiConfig);
    const nextState = createNextState(current);
    setAiConfigIfChanged(nextState);
}

function mergeProviderConfigs(providerConfigs, providerId, config) {
    return {
        ...(providerConfigs || {}),
        [providerId]: extractProviderConfigFromAiConfig(config)
    };
}

function normalizeConnectionProfile(profile, index = 0) {
    const normalized = {
        ...getDefaultConnectionProfile(`连接 ${index + 1}`),
        ...(profile || {})
    };

    // 兼容旧存档：OpenClaw/Webhook provider 已移除，把 localStorage 里残留的
    // 配置迁移到普通 OpenAI 兼容自定义接口。
    if (normalized.provider === 'openclaw' || normalized.provider === 'webhook') {
        // Webhook/WebSocket support was removed; keep old setups usable as a
        // plain OpenAI-compatible custom endpoint.
        normalized.provider = 'custom';
    }
    if (normalized.providerConfigs?.openclaw && !normalized.providerConfigs.custom) {
        normalized.providerConfigs = {
            ...normalized.providerConfigs,
            custom: normalized.providerConfigs.openclaw
        };
    }

    Object.assign(normalized, migrateRemovedProvider(normalized));

    normalized.id = normalized.id || createId('profile');
    normalized.name = normalized.name || `连接 ${index + 1}`;
    normalized.provider = normalized.provider || 'openai';
    normalized.model = normalized.model || 'auto';
    normalized.providerConfigs = normalized.providerConfigs || {};
    normalized.createdAt = normalized.createdAt || new Date().toISOString();
    normalized.updatedAt = normalized.updatedAt || normalized.createdAt;
    return normalized;
}

function createConnectionProfileFromState(state, overrides = {}) {
    const profile = normalizeConnectionProfile({
        ...extractProviderConfigFromAiConfig(state),
        provider: state.provider || 'openai',
        providerConfigs: state.providerConfigs || {},
        ...overrides
    });
    return {
        ...profile,
        updatedAt: new Date().toISOString()
    };
}

function ensureConnectionProfiles(state) {
    const profiles = Array.isArray(state.connectionProfiles) && state.connectionProfiles.length > 0
        ? state.connectionProfiles.map((profile, index) => normalizeConnectionProfile(profile, index))
        : [createConnectionProfileFromState(state)];
    const activeProfileId = profiles.some(profile => profile.id === state.activeProfileId)
        ? state.activeProfileId
        : profiles[0].id;

    return {
        profiles,
        activeProfileId
    };
}

function applyProfileToState(state, profileId = null) {
    const { profiles, activeProfileId } = ensureConnectionProfiles(state);
    const resolvedProfileId = profileId && profiles.some(profile => profile.id === profileId)
        ? profileId
        : activeProfileId;
    const profile = profiles.find(item => item.id === resolvedProfileId) || profiles[0];
    const providerId = profile.provider || 'openai';
    const providerConfigs = profile.providerConfigs || {};
    const cached = providerConfigs[providerId] || extractProviderConfigFromProfile(profile);
    const merged = { ...getDefaultProviderConfig(), ...cached };

    return {
        ...state,
        connectionProfiles: profiles,
        activeProfileId: profile.id,
        activeProfileName: profile.name,
        provider: providerId,
        apiKey: merged.apiKey || profile.apiKey || '',
        secretKey: merged.secretKey || profile.secretKey || '',
        model: merged.model || profile.model || 'auto',
        customModel: merged.customModel || profile.customModel || '',
        customEndpoint: merged.customEndpoint || profile.customEndpoint || '',
        accountId: merged.accountId || profile.accountId || '',
        providerConfigs
    };
}

function syncActiveProfile(state, overrides = {}) {
    const nextState = { ...state, ...overrides };
    const { profiles, activeProfileId } = ensureConnectionProfiles(nextState);
    const profileIndex = profiles.findIndex(profile => profile.id === activeProfileId);
    const activeProfile = profileIndex >= 0 ? profiles[profileIndex] : profiles[0];
    const providerId = nextState.provider || activeProfile.provider || 'openai';
    const providerConfigs = mergeProviderConfigs(
        nextState.providerConfigs || activeProfile.providerConfigs || {},
        providerId,
        nextState
    );
    const syncedProfile = {
        ...activeProfile,
        name: nextState.activeProfileName || activeProfile.name || '默认连接',
        provider: providerId,
        apiKey: nextState.apiKey || '',
        secretKey: nextState.secretKey || '',
        model: nextState.model || 'auto',
        customModel: nextState.customModel || '',
        customEndpoint: nextState.customEndpoint || '',
        accountId: nextState.accountId || '',
        providerConfigs
    };
    const nextProfile = connectionProfileContentChanged(activeProfile, syncedProfile)
        ? { ...syncedProfile, updatedAt: new Date().toISOString() }
        : { ...syncedProfile, updatedAt: activeProfile.updatedAt };

    profiles[profileIndex >= 0 ? profileIndex : 0] = nextProfile;

    return {
        connectionProfiles: profiles,
        activeProfileId: activeProfileId || profiles[0].id,
        activeProfileName: profiles[profileIndex >= 0 ? profileIndex : 0].name,
        providerConfigs
    };
}

function inferChatSessionTitle(history = []) {
    const firstUserMessage = history.find(message => message.role === 'user' && message.type === 'text' && message.content);
    if (!firstUserMessage) return '新对话';
    if (firstUserMessage.attachments?.length && firstUserMessage.content === '请阅读并分析这些附件。') {
        const firstAttachment = firstUserMessage.attachments[0];
        if (firstAttachment?.name) {
            return firstAttachment.name.length > 24
                ? `${firstAttachment.name.slice(0, 24)}...`
                : firstAttachment.name;
        }
    }
    const normalized = firstUserMessage.content.replace(/\s+/g, ' ').trim();
    return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
}

function createChatSession(title = '新对话', history = [], avatarIndex = 0) {
    const timestamp = new Date().toISOString();
    return {
        id: createId('chat'),
        title,
        history,
        ...getChatAvatarVariant(avatarIndex),
        createdAt: timestamp,
        updatedAt: timestamp
    };
}

function normalizeChatSessions(rawSessions = [], legacyHistory = []) {
    const normalized = Array.isArray(rawSessions)
        ? rawSessions
            .map((session, index) => ({
                ...createChatSession(`对话 ${index + 1}`, [], session?.avatarIndex ?? index),
                ...(session || {}),
                history: Array.isArray(session?.history) ? session.history : [],
                title: session?.title || inferChatSessionTitle(session?.history || []) || `对话 ${index + 1}`,
                ...getChatAvatarVariant(session?.avatarIndex ?? index)
            }))
        : [];

    if (normalized.length > 0) {
        return normalized;
    }

    if (Array.isArray(legacyHistory) && legacyHistory.length > 0) {
        return [createChatSession(inferChatSessionTitle(legacyHistory), legacyHistory, 0)];
    }

    return [createChatSession('新对话', [], 0)];
}

async function getProviderInfoCached(providerId) {
    const { getProviderInfo } = await import('../utils/ai-providers.js');
    return getProviderInfo(providerId);
}

async function normalizeProviderModel(providerId, providerInfo, providerConfig) {
    if (providerId === 'custom') {
        return providerConfig.customModel || providerConfig.model || 'auto';
    }
    const defaultModel = providerInfo?.defaultModel || 'auto';
    const model = providerConfig.model || defaultModel;
    return model || defaultModel || 'auto';
}

export function hydrateCurrentProviderConfig() {
    const current = get(aiConfig);
    const providerId = current.provider || 'openai';
    const providerConfigs = current.providerConfigs || {};
    const cached = providerConfigs[providerId] || null;
    const merged = cached ? { ...getDefaultProviderConfig(), ...cached } : getDefaultProviderConfig();

    const nextState = {
        ...current,
        apiKey: merged.apiKey || '',
        secretKey: merged.secretKey || '',
        model: merged.model || (current.model || 'auto'),
        customModel: merged.customModel || '',
        customEndpoint: merged.customEndpoint || '',
        accountId: merged.accountId || ''
    };
    setAiConfigIfChanged({ ...nextState, ...syncActiveProfile(nextState) });
}

export async function hydrateCurrentProviderConfigWithDefaults() {
    const current = get(aiConfig);
    const providerId = current.provider || 'openai';
    const providerInfo = await getProviderInfoCached(providerId);
    const latest = get(aiConfig);
    if ((latest.provider || 'openai') !== providerId) return;

    const providerConfigs = latest.providerConfigs || {};
    const cached = providerConfigs[providerId] || null;
    const merged = cached ? { ...getDefaultProviderConfig(), ...cached } : getDefaultProviderConfig();

    const normalizedModel = await normalizeProviderModel(providerId, providerInfo, merged);

    const nextState = {
        ...latest,
        apiKey: merged.apiKey || '',
        secretKey: merged.secretKey || '',
        model: providerId === 'custom' ? (merged.model || 'auto') : normalizedModel,
        customModel: merged.customModel || '',
        customEndpoint: merged.customEndpoint || '',
        accountId: merged.accountId || ''
    };
    setAiConfigIfChanged({ ...nextState, ...syncActiveProfile(nextState) });
}

export async function switchProvider(newProviderId) {
    const current = get(aiConfig);
    const prevProviderId = current.provider || 'openai';
    if (prevProviderId === newProviderId) return;
    resetAiChatRuntimeCapabilities();

    const providerConfigsUpdated = mergeProviderConfigs(current.providerConfigs, prevProviderId, current);

    const newProviderInfo = await getProviderInfoCached(newProviderId);
    const cached = providerConfigsUpdated[newProviderId] || null;
    const merged = cached ? { ...getDefaultProviderConfig(), ...cached } : getDefaultProviderConfig();

    const normalizedModel = await normalizeProviderModel(newProviderId, newProviderInfo, merged);

    const latest = get(aiConfig);
    if ((latest.provider || 'openai') !== prevProviderId) return;
    const nextState = {
        ...latest,
        provider: newProviderId,
        apiKey: merged.apiKey || '',
        secretKey: merged.secretKey || '',
        model: newProviderId === 'custom' ? (merged.model || 'auto') : normalizedModel,
        customModel: merged.customModel || '',
        customEndpoint: merged.customEndpoint || '',
        accountId: merged.accountId || '',
        providerConfigs: providerConfigsUpdated
    };
    setAiConfigIfChanged({ ...nextState, ...syncActiveProfile(nextState) });
}

export function loadAiConfig() {
    if (typeof window === 'undefined') return;

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            const baseState = {
                ...getDefaultAiConfigState(),
                temperature: parsed.temperature ?? 0.7,
                maxTokens: parsed.maxTokens ?? 4096,
                customHeaders: parsed.customHeaders || {},
                requestFingerprint: parsed.requestFingerprint || 'default',
                dailyReportPrompt: parsed.dailyReportPrompt || '',
                weeklyReportPrompt: parsed.weeklyReportPrompt || ''
            };

            let nextState;
            if (Array.isArray(parsed.connectionProfiles) && parsed.connectionProfiles.length > 0) {
                nextState = applyProfileToState({
                    ...baseState,
                    connectionProfiles: parsed.connectionProfiles.map((profile, index) => normalizeConnectionProfile(profile, index)),
                    activeProfileId: parsed.activeProfileId
                });
            } else {
                const legacyProviderConfigs = parsed.providerConfigs || {};
                const legacyProfile = normalizeConnectionProfile({
                    name: parsed.activeProfileName || '默认连接',
                    provider: parsed.provider || 'openai',
                    model: parsed.model || 'auto',
                    providerConfigs: legacyProviderConfigs
                });
                nextState = applyProfileToState({
                    ...baseState,
                    connectionProfiles: [legacyProfile],
                    activeProfileId: legacyProfile.id
                });
            }

            setAiConfigIfChanged(nextState);
        } catch (e) {
            console.error('Failed to load AI config:', e);
        }
    }

    let legacyChatHistory = [];
    const savedChatHistory = localStorage.getItem(AI_CHAT_HISTORY_KEY);
    if (savedChatHistory) {
        try {
            legacyChatHistory = JSON.parse(savedChatHistory);
        } catch (e) {
            console.error('Failed to load AI chat history:', e);
        }
    }

    const savedSessions = localStorage.getItem(AI_CHAT_SESSIONS_KEY);
    let sessions = normalizeChatSessions([], legacyChatHistory);
    let activeSessionId = sessions[0].id;

    if (savedSessions) {
        try {
            const parsedSessions = unpackLocalJson(savedSessions) || {};
            sessions = normalizeChatSessions(parsedSessions.sessions || [], legacyChatHistory);
            activeSessionId = sessions.some(session => session.id === parsedSessions.activeSessionId)
                ? parsedSessions.activeSessionId
                : sessions[0].id;
        } catch (e) {
            console.error('Failed to load AI chat sessions:', e);
        }
    }

    aiChatSessions.set(sessions);
    activeAiChatSessionId.set(activeSessionId);
    aiChatHistory.set((sessions.find(session => session.id === activeSessionId) || sessions[0]).history || []);
}

export function saveAiConfig() {
    if (typeof window === 'undefined') return;
    const current = get(aiConfig);
    const synced = syncActiveProfile(current);
    const nextState = { ...current, ...synced };

    const toSave = {
        activeProfileId: nextState.activeProfileId,
        activeProfileName: nextState.activeProfileName,
        temperature: nextState.temperature,
        maxTokens: nextState.maxTokens,
        customHeaders: nextState.customHeaders,
        requestFingerprint: nextState.requestFingerprint || 'default',
        dailyReportPrompt: nextState.dailyReportPrompt,
        weeklyReportPrompt: nextState.weeklyReportPrompt,
        connectionProfiles: nextState.connectionProfiles
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    setAiConfigIfChanged(nextState);
}

export function addConnectionProfile(name = '') {
    updateAiConfigIfChanged(current => {
        const newProfile = createConnectionProfileFromState(current, {
            id: createId('profile'),
            name: name || `连接 ${((current.connectionProfiles || []).length || 0) + 1}`
        });
        const nextState = applyProfileToState({
            ...current,
            connectionProfiles: [...(current.connectionProfiles || []), newProfile],
            activeProfileId: newProfile.id
        }, newProfile.id);
        return nextState;
    });
}

export function selectConnectionProfile(profileId) {
    const current = get(aiConfig);
    if (!profileId || profileId === current.activeProfileId) return;
    resetAiChatRuntimeCapabilities();
    setAiConfigIfChanged(applyProfileToState(current, profileId));
}

export function updateConnectionProfileName(name) {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    updateAiConfigIfChanged(current => {
        if (trimmedName === current.activeProfileName) return current;
        const profiles = (current.connectionProfiles || []).map(profile =>
            profile.id === current.activeProfileId
                ? { ...profile, name: trimmedName, updatedAt: new Date().toISOString() }
                : profile
        );
        return {
            ...current,
            connectionProfiles: profiles,
            activeProfileName: trimmedName
        };
    });
}

export function deleteConnectionProfile(profileId) {
    updateAiConfigIfChanged(current => {
        if (!profileId) return current;
        const profiles = (current.connectionProfiles || []).filter(profile => profile.id !== profileId);
        if (profiles.length === (current.connectionProfiles || []).length || profiles.length === 0) {
            return current;
        }
        const nextActiveId = current.activeProfileId === profileId ? profiles[0].id : current.activeProfileId;
        // Provider configs are a shared cache keyed by provider. Drop entries that
        // no remaining connection uses so a deleted custom endpoint cannot leave
        // its API key behind.
        const providerConfigs = pruneProviderConfigs(current.providerConfigs, profiles);
        return applyProfileToState({
            ...current,
            providerConfigs,
            connectionProfiles: profiles,
            activeProfileId: nextActiveId
        }, nextActiveId);
    });
}

function syncAiChatSessionHistory(history = null) {
    const currentHistory = Array.isArray(history) ? history : get(aiChatHistory);
    const trimmedHistory = currentHistory.slice(-100);
    let sessions = get(aiChatSessions);
    let activeSessionId = get(activeAiChatSessionId);

    if (!Array.isArray(sessions) || sessions.length === 0) {
        const newSession = createChatSession(inferChatSessionTitle(trimmedHistory), trimmedHistory);
        sessions = [newSession];
        activeSessionId = newSession.id;
    }

    if (!activeSessionId || !sessions.some(session => session.id === activeSessionId)) {
        activeSessionId = sessions[0].id;
    }

    const inferredTitle = inferChatSessionTitle(trimmedHistory);
    const updatedSessions = sessions.map(session => {
        if (session.id !== activeSessionId) {
            return session;
        }

        const keepTitle = session.title && session.title !== '新对话';
        return {
            ...session,
            title: keepTitle ? session.title : inferredTitle,
            history: trimmedHistory,
            updatedAt: new Date().toISOString()
        };
    }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    aiChatSessions.set(updatedSessions);
    activeAiChatSessionId.set(activeSessionId);
    return updatedSessions;
}

/**
 * Media attachments are kept in memory for the live request, but persisting
 * their base64 payloads exhausts the ~5 MB localStorage quota (and makes the
 * next send fail while saving history). Strip them on the way to disk.
 */
function stripMediaForStorage(message) {
    if (!message || typeof message !== 'object') return message;
    const copy = { ...message };
    if (Array.isArray(copy.attachments)) {
        copy.attachments = copy.attachments.map((attachment) => {
            if (!attachment || typeof attachment !== 'object') return attachment;
            const { base64Data, thumbnailUrl, ...rest } = attachment;
            return rest;
        });
    }
    if (typeof copy.base64Data === 'string' && copy.base64Data) {
        delete copy.base64Data;
        copy.mediaUnavailable = true;
    }
    if (typeof copy.thumbnailUrl === 'string' && copy.thumbnailUrl) {
        delete copy.thumbnailUrl;
    }
    return copy;
}

function persistAiChatHistory(history, sessions, activeSessionId, { maxMessages = 100, maxSessions = 30 } = {}) {
    const safeHistory = history.slice(-maxMessages).map(stripMediaForStorage);
    const safeSessions = sessions.slice(0, maxSessions).map(session => ({
        ...session,
        history: Array.isArray(session.history)
            ? session.history.slice(-maxMessages).map(stripMediaForStorage)
            : []
    }));
    localStorage.setItem(AI_CHAT_HISTORY_KEY, JSON.stringify(safeHistory));
    localStorage.setItem(AI_CHAT_SESSIONS_KEY, packLocalJson({
        activeSessionId,
        sessions: safeSessions
    }));
}

export function saveAiChatHistory() {
    if (typeof window === 'undefined') return;
    const history = get(aiChatHistory);
    const sessions = syncAiChatSessionHistory(history);
    const activeSessionId = get(activeAiChatSessionId);
    try {
        persistAiChatHistory(history, sessions, activeSessionId);
    } catch (error) {
        console.warn('Failed to persist AI chat history, retrying with a smaller window:', error);
        try {
            persistAiChatHistory(history, sessions, activeSessionId, { maxMessages: 20, maxSessions: 10 });
        } catch (retryError) {
            // Never let a storage quota failure break the chat request itself.
            console.warn('AI chat history could not be persisted:', retryError);
        }
    }
}

export async function attachFilesToAiChatComposer() {
    const selectedPaths = await pickLocalTextFiles();
    if (!selectedPaths.length) {
        return [];
    }

    const files = normalizeChatAttachments(await readSelectedTextFiles({
        paths: selectedPaths,
        maxBytes: 96000,
        trustedDirectories: get(settingsStore).localFileConfig?.trustedDirectories || []
    }));
    assertChatAttachments(getEffectiveConfig(), [...get(aiChatComposerAttachments), ...files]);

    aiChatComposerAttachments.update((current) => {
        const merged = normalizeChatAttachments([...(current || []), ...files]);
        return merged.slice(0, 8);
    });

    return files;
}

export async function attachMediaToAiChatComposer() {
    const selectedPaths = await pickMediaFiles();
    if (!selectedPaths.length) {
        return [];
    }

    const mediaFiles = await readSelectedMediaFiles({
        paths: selectedPaths,
        maxBytes: 5_000_000,
        trustedDirectories: get(settingsStore).localFileConfig?.trustedDirectories || []
    });

    const files = normalizeChatAttachments(
        mediaFiles.map((file) => {
            const ext = getFileExtension(file.name || file.path);
            const mediaType = getMediaType(ext);
            let thumbnailUrl = '';
            if (mediaType === 'image' && file.base64Data) {
                thumbnailUrl = `data:${file.mimeType};base64,${file.base64Data}`;
            }
            return {
                path: file.path,
                name: file.name,
                size: file.size,
                content: '',
                truncated: false,
                mediaType,
                mimeType: file.mimeType,
                base64Data: file.base64Data,
                thumbnailUrl
            };
        })
    );
    assertChatAttachments(getEffectiveConfig(), [...get(aiChatComposerAttachments), ...files]);

    aiChatComposerAttachments.update((current) => {
        const merged = normalizeChatAttachments([...(current || []), ...files]);
        return merged.slice(0, 8);
    });

    return files;
}

export async function attachPastedFilesToAiChatComposer(fileList) {
    const files = normalizeChatAttachments(await readPastedFilesAsAttachments(fileList, {
        textMaxBytes: 96000,
        mediaMaxBytes: 5_000_000
    }));
    if (!files.length) {
        return [];
    }
    assertChatAttachments(getEffectiveConfig(), [...get(aiChatComposerAttachments), ...files]);

    aiChatComposerAttachments.update((current) => {
        const merged = normalizeChatAttachments([...(current || []), ...files]);
        return merged.slice(0, 8);
    });

    return files;
}

export function removeAiChatComposerAttachment(path) {
    const target = String(path || '');
    aiChatComposerAttachments.update((current) =>
        normalizeChatAttachments(current).filter((item) => item.path !== target)
    );
}

export function clearAiChatComposerAttachments() {
    aiChatComposerAttachments.set([]);
}

export function clearAiChatDraft() {
    aiChatDraft.set('');
    aiChatContext.set(null);
    clearAiChatComposerAttachments();
}

export function resetAiPanelContext() {
    if (get(isAiLoading)) stopStreaming();
    aiPanelContext.set(getDefaultAiPanelContext());
}

export function configureAiPanel(context = {}, clearHistory = false) {
    if (get(isAiLoading)) stopStreaming();
    const nextContext = {
        ...getDefaultAiPanelContext(),
        ...(context || {})
    };
    aiPanelContext.set(nextContext);
    if (clearHistory) {
        chatHistory.set([]);
    }
}

export function setAiChatDraft(draft = '', context = null) {
    aiChatDraft.set(draft);
    aiChatContext.set(context);
}

export function createAiChatSession(title = '新对话') {
    stopStreaming();
    const currentSessions = get(aiChatSessions);
    const newSession = createChatSession(title, [], currentSessions.length);
    aiChatSessions.set([newSession, ...(currentSessions || [])]);
    activeAiChatSessionId.set(newSession.id);
    aiChatHistory.set([]);
    clearAiChatDraft();
    saveAiChatHistory();
}

export function selectAiChatSession(sessionId) {
    const sessions = get(aiChatSessions);
    const targetSession = sessions.find(session => session.id === sessionId);
    if (!targetSession) return;
    stopStreaming();
    activeAiChatSessionId.set(targetSession.id);
    aiChatHistory.set(targetSession.history || []);
    clearAiChatDraft();
    saveAiChatHistory();
}

export function renameAiChatSession(sessionId, title) {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    aiChatSessions.update(sessions =>
        (sessions || []).map(session =>
            session.id === sessionId
                ? { ...session, title: trimmedTitle, updatedAt: new Date().toISOString() }
                : session
        )
    );
    saveAiChatHistory();
}

export function deleteAiChatSession(sessionId) {
    stopStreaming();
    const currentActiveSessionId = get(activeAiChatSessionId);
    let sessions = (get(aiChatSessions) || []).filter(session => session.id !== sessionId);
    if (sessions.length === 0) {
        sessions = [createChatSession()];
    }
    aiChatSessions.set(sessions);
    const nextActiveSessionId = currentActiveSessionId === sessionId
        ? sessions[0].id
        : (sessions.find(session => session.id === currentActiveSessionId)?.id || sessions[0].id);
    activeAiChatSessionId.set(nextActiveSessionId);
    aiChatHistory.set((sessions.find(session => session.id === nextActiveSessionId) || sessions[0]).history || []);
    clearAiChatDraft();
    saveAiChatHistory();
}

export function openAiChatWorkspace({
    title = '新对话',
    draft = '',
    context = null,
    createSession = true
} = {}) {
    if (createSession) {
        createAiChatSession(title);
    }
    setAiChatDraft(draft, context);
}

export function updateAiConfig(updates) {
    const capabilityKeys = ['provider', 'apiKey', 'secretKey', 'model', 'customModel', 'customEndpoint', 'accountId'];
    const current = get(aiConfig);
    if (capabilityKeys.some(key => Object.prototype.hasOwnProperty.call(updates, key) && current[key] !== updates[key])) {
        resetAiChatRuntimeCapabilities();
    }
    const nextState = { ...current, ...updates };
    setAiConfigIfChanged({ ...nextState, ...syncActiveProfile(nextState) });
}

export async function getAiProviders() {
    const { getProviderList } = await import('../utils/ai-providers.js');
    return await getProviderList();
}

export async function getAiProviderInfo(providerId) {
    const { getProviderInfo } = await import('../utils/ai-providers.js');
    return getProviderInfo(providerId);
}

export async function loadModelsForProvider(providerId, apiKey = '', customEndpoint = '') {
    const loadKey = `${providerId || ''}\u0000${apiKey || ''}\u0000${customEndpoint || ''}`;
    const activeLoad = activeModelLoadPromises.get(loadKey);
    if (activeLoad) return activeLoad;

    activeModelLoadCount += 1;
    modelsLoading.set(true);
    const loadPromise = (async () => {
        try {
            const { fetchProviderModels } = await import('../utils/ai-providers.js');
            const models = await fetchProviderModels(providerId, apiKey, customEndpoint, resolveRequestHeaders(get(aiConfig)));
            providerModels.update(cache => ({
                ...cache,
                [providerId]: models
            }));
            return models;
        } catch (e) {
            console.error(`Failed to load models for ${providerId}:`, e);
            const { getProviderInfo } = await import('../utils/ai-providers.js');
            const provider = getProviderInfo(providerId);
            return provider?.defaultModels || [];
        } finally {
            activeModelLoadPromises.delete(loadKey);
            activeModelLoadCount = Math.max(0, activeModelLoadCount - 1);
            modelsLoading.set(activeModelLoadCount > 0);
        }
    })();
    activeModelLoadPromises.set(loadKey, loadPromise);
    return loadPromise;
}

export function getModelsForProvider(providerId) {
    const cache = get(providerModels);
    return cache[providerId] || [];
}

export function getEffectiveConfig() {
    const config = get(aiConfig);
    const isCustom = config.provider === 'custom';
    return {
        provider: config.provider,
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        model: isCustom ? (config.customModel || config.model || 'auto') : (config.model || 'auto'),
        customModel: config.customModel,
        customEndpoint: config.customEndpoint,
        accountId: config.accountId,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        customHeaders: config.customHeaders,
        requestFingerprint: config.requestFingerprint || 'default',
        dailyReportPrompt: config.dailyReportPrompt,
        weeklyReportPrompt: config.weeklyReportPrompt
    };
}

function getFormattedDateTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const weekday = WEEKDAY_MAP[now.getDay()];
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}/${month}/${day} 星期${weekday} ${hours}:${minutes}:${seconds}`;
}

function getDateInfo() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = now.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const lastMonday = new Date(monday);
    lastMonday.setDate(monday.getDate() - 7);
    const lastSunday = new Date(monday);
    lastSunday.setDate(monday.getDate() - 1);
    const nextMonday = new Date(monday);
    nextMonday.setDate(monday.getDate() + 7);
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const firstDayOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const lastDayOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    return {
        now,
        today,
        tomorrow: new Date(today.getTime() + 86400000),
        dayAfterTomorrow: new Date(today.getTime() + 86400000 * 2),
        yesterday: new Date(today.getTime() - 86400000),
        dayBeforeYesterday: new Date(today.getTime() - 86400000 * 2),
        thisWeek: { start: monday, end: sunday },
        lastWeek: { start: lastMonday, end: lastSunday },
        nextWeek: { start: nextMonday, end: nextSunday },
        thisMonth: { start: firstDayOfMonth, end: lastDayOfMonth },
        lastMonth: { start: firstDayOfLastMonth, end: lastDayOfLastMonth },
        nextMonth: { start: firstDayOfNextMonth, end: lastDayOfNextMonth },
        dayOfWeek,
        weekdayName: WEEKDAY_NAMES[dayOfWeek]
    };
}

function formatDateForAI(date) {
    if (!date) return '';
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDateOnlyToLocal(value = '') {
    const match = String(value || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
}

function getTaskDateOnly(task = {}) {
    const rawDate = String(task?.date || '').split('T')[0];
    return parseDateOnlyToLocal(rawDate);
}

function normalizeRepeatDays(values = []) {
    return [...new Set(
        (Array.isArray(values) ? values : [])
            .map(value => Number(value))
            .map(value => value === 7 ? 0 : value)
            .filter(value => Number.isInteger(value) && value >= 0 && value <= 6)
    )];
}

function normalizeTemplateEntity(template, index = 0) {
    return {
        id: template.id || `${Date.now() + index}_${Math.random().toString(36).slice(2, 6)}`,
        title: template.title || '未命名模板',
        status: normalizeStatus(template.status),
        priority: normalizePriority(template.priority),
        date: '',
        deadline: '',
        note: template.note || '',
        subtasks: (template.subtasks || []).map(item => ({
            title: typeof item === 'string' ? item : (item.title || ''),
            status: item.status || 'todo'
        }))
    };
}

function isActiveTask(task = {}) {
    return !task.status || task.status === 'todo' || task.status === 'doing';
}

export function filterTasksByTimeScope(tasks, timeScope, options = {}) {
    if (!tasks || tasks.length === 0) return [];
    return tasks.filter(task => {
        const taskDate = getTaskDateOnly(task);
        if (!taskDate) {
            if (!timeScope.explicit) return true;
            // A dateless backlog item is still actionable today.
            return options.includeOverdueActive === true && isActiveTask(task);
        }
        if (timeScope.startDate && timeScope.endDate) {
            if (taskDate >= timeScope.startDate && taskDate <= timeScope.endDate) return true;
        } else {
            return true;
        }
        // "今天的任务" means today's work plus unfinished older work and
        // anything currently in progress. It must not hide overdue tasks just
        // because they were created in a previous month.
        if (options.includeOverdueActive && isActiveTask(task) && taskDate < timeScope.startDate) {
            return true;
        }
        return false;
    });
}

function normalizeAssistantPayload(payload = []) {
    if (Array.isArray(payload)) {
        return {
            ...getDefaultAiPanelContext(),
            items: payload
        };
    }
    return {
        ...getDefaultAiPanelContext(),
        ...(payload || {}),
        items: Array.isArray(payload?.items) ? payload.items : []
    };
}

function normalizeChatAttachment(attachment = {}) {
    return {
        path: String(attachment.path || ''),
        name: String(attachment.name || attachment.path || '未命名附件'),
        content: String(attachment.content || ''),
        size: Number(attachment.size || 0),
        truncated: Boolean(attachment.truncated),
        mediaType: attachment.mediaType || null,
        mimeType: String(attachment.mimeType || ''),
        base64Data: String(attachment.base64Data || ''),
        thumbnailUrl: String(attachment.thumbnailUrl || '')
    };
}

function normalizeChatAttachments(attachments = []) {
    if (!Array.isArray(attachments)) {
        return [];
    }
    const seen = new Set();
    return attachments
        .map(normalizeChatAttachment)
        .filter((item) => {
            const key = item.path || item.name;
            if (!key || seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
}

function formatFileSize(size = 0) {
    const value = Number(size || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function buildAttachmentContext(attachments = []) {
    const items = normalizeChatAttachments(attachments);
    const textItems = items.filter((item) =>
        !item.mediaType ||
        item.mediaType === 'text' ||
        item.mediaType === 'file' ||
        (item.truncated && item.content)
    );
    if (textItems.length === 0) {
        return '';
    }
    return [
        '【用户附加文件】',
        ...textItems.map((item, index) => [
            `附件 ${index + 1}: ${item.name}`,
            `大小: ${formatFileSize(item.size)}`,
            item.truncated ? '说明: 文件内容已截断' : '',
            '内容：',
            item.content || '（空文件）'
        ].filter(Boolean).join('\n'))
    ].join('\n\n');
}

function buildUserMessageContentForAI(message = {}, bodyFormat = 'openai') {
    const baseContent = String(message?.content || '').trim();
    const attachments = normalizeChatAttachments(message?.attachments || []);
    const textContext = buildAttachmentContext(attachments);
    const mediaItems = attachments.filter(
        (item) => item.mediaType && item.mediaType !== 'text' && item.base64Data
    );

    if (mediaItems.length === 0) {
        if (!textContext) return baseContent;
        return [baseContent || '请结合以下附件继续处理。', textContext].filter(Boolean).join('\n\n');
    }

    const textPart = [baseContent, textContext].filter(Boolean).join('\n\n') || '请分析以下内容。';

    if (bodyFormat === 'anthropic') {
        const parts = [{ type: 'text', text: textPart }];
        for (const item of mediaItems) {
            if (item.mediaType === 'image') {
                parts.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: item.mimeType,
                        data: item.base64Data
                    }
                });
            }
        }
        return parts;
    }

    if (bodyFormat === 'google') {
        const parts = [{ text: textPart }];
        for (const item of mediaItems) {
            parts.push({
                inlineData: {
                    mimeType: item.mimeType,
                    data: item.base64Data
                }
            });
        }
        return parts;
    }

    const parts = [{ type: 'text', text: textPart }];
    for (const item of mediaItems) {
        if (item.mediaType === 'image') {
            parts.push({
                type: 'image_url',
                image_url: {
                    url: `data:${item.mimeType};base64,${item.base64Data}`
                }
            });
        }
    }
    return parts;
}

function normalizeComparablePath(path = '') {
    const raw = String(path || '').trim();
    if (!raw) return '';
    if (isContentUri(raw)) {
        return raw;
    }
    return raw
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
        .toLowerCase();
}

function looksLikeExplicitPath(value = '') {
    const text = String(value || '').trim();
    if (!text) return false;
    return isContentUri(text) ||
        /^[a-z]:[\\/]/i.test(text) ||
        /^\.{1,2}[\\/]/.test(text) ||
        /^\/[^/\s]/.test(text) ||
        /[\\/]/.test(text);
}

function getDirectoryFromPath(path = '') {
    const value = String(path || '').trim();
    if (!value) return '';
    if (isContentUri(value)) {
        return value;
    }
    const normalized = value.replace(/[\\/]+$/, '');
    const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
    if (index <= 0) {
        return normalized;
    }
    return normalized.slice(0, index);
}

function isPathInside(candidate = '', root = '') {
    const normalizedCandidate = normalizeComparablePath(candidate);
    const normalizedRoot = normalizeComparablePath(root);
    if (!normalizedCandidate || !normalizedRoot) {
        return false;
    }
    if (normalizedCandidate === normalizedRoot) {
        return true;
    }
    if (isContentUri(normalizedCandidate) || isContentUri(normalizedRoot)) {
        return normalizedCandidate.startsWith(`${normalizedRoot}/`) ||
            normalizedCandidate.startsWith(`${normalizedRoot}%2F`) ||
            normalizedCandidate.startsWith(`${normalizedRoot}%2f`);
    }
    return normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

function getPlanAuthorizationDirectory(plan = {}) {
    const operation = String(plan.operation || '').toLowerCase();
    const candidates = [];
    if ((operation === 'search' || operation === 'read') && looksLikeExplicitPath(plan.root)) {
        candidates.push(plan.root);
    }
    if (looksLikeExplicitPath(plan.path)) {
        candidates.push(operation === 'search' ? plan.path : getDirectoryFromPath(plan.path));
    }
    return candidates.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function resolveUnauthorizedDirectory(plan = {}, settings = get(settingsStore)) {
    const requestedDirectory = getPlanAuthorizationDirectory(plan);
    if (!requestedDirectory) {
        return '';
    }

    const workspaceRoot = settings.workspaceRoot || '';
    const trustedDirectories = settings.localFileConfig?.trustedDirectories || [];
    if (
        trustedDirectories.some(isContentUri) &&
        !isContentUri(requestedDirectory) &&
        !/^[a-z]:[\\/]/i.test(requestedDirectory) &&
        !/^\/[^/\s]/.test(requestedDirectory)
    ) {
        return '';
    }

    const authorizedRoots = [workspaceRoot, ...trustedDirectories].filter(Boolean);
    const isAuthorized = authorizedRoots.some((root) => (
        isPathInside(requestedDirectory, root) ||
        isPathCoveredByContentTree(requestedDirectory, root)
    ));
    return isAuthorized ? '' : requestedDirectory;
}

function formatLocalFileSearchResult(entries = []) {
    if (!entries.length) {
        return '未找到匹配的本地文件或目录。';
    }
    return [
        '已找到以下本地文件/目录：',
        ...entries.map((entry) => `- ${entry.kind === 'directory' ? '[目录]' : '[文件]'} ${entry.path}`)
    ].join('\n');
}

function formatWebSearchResult(entries = []) {
    if (!entries.length) {
        return '未找到可用的网页搜索结果。';
    }

    return [
        '已找到以下网页结果：',
        ...entries.map((entry, index) => {
            const lines = [
                `${index + 1}. ${entry.title}`,
                `   ${entry.url}`
            ];
            if (entry.snippet) {
                lines.push(`   ${entry.snippet}`);
            }
            return lines.join('\n');
        })
    ].join('\n');
}

async function finalizeToolAnswer(userText, plan, toolResult, config) {
    if (!plan?.response_goal) {
        return null;
    }

    const { callAIWithMessages } = await import('../utils/ai-providers.js');
    const messages = [
        {
            role: 'system',
            content: `你正在根据工具执行结果回复用户。只能依据提供的结果作答，不能捏造不存在的事实、文件内容或网页信息。${AI_TRUST_RULES}`
        },
        {
            role: 'user',
            content: `用户请求：${userText}

操作：${plan.operation}
目标：${plan.response_goal}
结果：
${untrustedAiContext('TOOL_RESULT', toolResult)}`
        }
    ];

    const result = await callAIWithMessages(config, messages);
    return result || null;
}

async function runLocalFilePlan(plan, userText, config, requireConfirmation = true) {
    if (config.isCurrent && !config.isCurrent()) throw new DOMException('操作已取消或上下文已改变', 'AbortError');
    const settings = get(settingsStore);
    if (!settings.localFileConfig?.enabled || settings.enableAiChatTools === false) {
        return { role: 'assistant', type: 'text', content: '本地文件工具已关闭，未执行任何操作。' };
    }
    const trustedDirectories = settings.localFileConfig?.trustedDirectories || [];
    const operation = String(plan.operation || '').toLowerCase();
    if (!['search', 'read', 'write', 'delete'].includes(operation)
        || (['read', 'write', 'delete'].includes(operation) && (typeof plan.path !== 'string' || !plan.path.trim()))) {
        return { role: 'assistant', type: 'text', content: '本地文件工具参数无效，未执行任何操作。' };
    }
    if ([plan.path, plan.root].some(isSensitiveAiPath)) {
        return { role: 'assistant', type: 'text', content: '拒绝自动访问应用数据库、凭据或密钥文件。请选择不包含敏感信息的文件。' };
    }
    // Resolve before authorization: approval must name the real OS directory,
    // not a model-generated ~ or environment-variable string beneath workspace.
    let resolved;
    const target = operation === 'search' ? plan.root || settings.workspaceRoot : plan.path;
    if (target && !isContentUri(target)) {
        resolved = await resolveLocalPath(target);
        if (config.isCurrent && !config.isCurrent()) throw new DOMException('操作已取消', 'AbortError');
        if ((operation === 'search' || operation === 'read' || operation === 'delete') && !resolved.exists) {
            return { role: 'assistant', type: 'text', content: `目标路径不存在：${resolved.path}。没有执行操作。` };
        }
        if (operation === 'search' && !resolved.isDirectory) return { role: 'assistant', type: 'text', content: `搜索目标不是目录：${resolved.path}` };
        plan = operation === 'search' ? { ...plan, root: resolved.path, requestedRoot: plan.requestedRoot || target } : { ...plan, path: resolved.path };
    }
    if ([plan.path, plan.root].some(isSensitiveAiPath)) return { role: 'assistant', type: 'text', content: '拒绝自动访问应用数据库、凭据或密钥文件。' };
    const authorizationDirectory = resolved?.authorized ? '' : resolveUnauthorizedDirectory(plan, settings);

    if (authorizationDirectory) {
        return {
            role: 'assistant',
            type: 'file_confirm',
            operation: {
                ...plan,
                originalUserText: userText,
                trustedDirectories,
                authorizationDirectory
            },
            message: `需要先授权目录后才能继续此操作：${authorizationDirectory}`
        };
    }

    if (operation === 'write' || operation === 'delete') {
        if (requireConfirmation) {
            return {
                role: 'assistant',
                type: 'file_confirm',
                operation: {
                    ...plan,
                    originalUserText: userText,
                    trustedDirectories
                },
                message: plan.message || '请确认本地文件操作。'
            };
        }

        if (operation === 'write') {
            const result = await writeLocalFile({
                path: plan.path,
                content: plan.content || '',
                trustedDirectories
            });
            return {
                role: 'assistant',
                type: 'text',
                applied: true,
                content: `已写入本地文件：${result.path}`
            };
        }

        const result = await deleteLocalFile({
            path: plan.path,
            trustedDirectories
        });
        return {
            role: 'assistant',
            type: 'text',
            applied: true,
            content: `已删除本地文件：${result.path}`
        };
    }

    if (operation === 'read') {
        const result = await readLocalFile({
            path: plan.path,
            maxBytes: plan.maxBytes ?? 120000,
            trustedDirectories
        });
        if (config.rawToolResults) return { role: 'assistant', type: 'text', content: `已读取文件：${result.path || plan.path}`, toolData: {
            operation: 'read', path: result.path || plan.path, size: result.size,
            truncated: !!result.truncated, content: redactAiSecrets(result.content || '')
        } };
        const fallback = [
            `已读取文件：${result.path}`,
            '',
            '```',
            redactAiSecrets(result.content || ''),
            '```'
        ].join('\n');
        const summarized = await finalizeToolAnswer(
            userText,
            plan,
            `文件路径：${result.path}\n文件大小：${result.size}\n是否截断：${result.truncated}\n文件内容：\n${redactAiSecrets(result.content)}`,
            config
        );
        return {
            role: 'assistant',
            type: 'text',
            content: summarized || fallback
        };
    }

    const report = fitFileSearchReport(await searchLocalFilesDetailed({
        root: plan.root || '',
        query: plan.query || plan.path || '',
        maxResults: plan.maxResults ?? 200,
        offset: plan.offset ?? 0, kind: plan.kind, extensions: plan.extensions,
        recursive: plan.recursive ?? true, maxDepth: plan.maxDepth,
        summaryOnly: plan.summaryOnly ?? false, includeGenerated: plan.includeGenerated ?? false,
        trustedDirectories
    }));
    const results = report.entries.filter(entry => !isSensitiveAiPath(entry.path));
    if (config.rawToolResults) return { role: 'assistant', type: 'text', content: `检索完成：${report.root || plan.root}，返回${results.length}项。`, toolData: {
        operation: 'search', ...report, entries: results,
        note: '统计与清单分页相互独立：countComplete为true时totalMatched及counts覆盖本次筛选范围，hasMore仅表示清单还有下一页，可用nextOffset继续。countComplete为false时数字只是已扫描部分的下限。以filters、recursive、excludedDirectories为准；统计不等于读取或验证文件内容。'
    } };
    const fallback = formatLocalFileSearchResult(results.filter(entry => !isSensitiveAiPath(entry.path)));
    const summarized = await finalizeToolAnswer(
        userText,
        plan,
        fallback,
        config
    );
    return {
        role: 'assistant',
        type: 'text',
        content: summarized || fallback
    };
}

async function runWebSearchPlan(plan, userText, config, onProgress = null) {
    const explicitUrl = String(plan?.url || '').trim();
    if (explicitUrl) {
        if (!isExplicitWebFetchTarget(userText, explicitUrl)) {
            return { role: 'assistant', type: 'text', content: '未访问用户未明确提供的网页地址。请提供完整网址，或改用网页搜索。' };
        }
        if (onProgress) onProgress('fetching');
        const pageContent = await fetchWebContent(explicitUrl, 5000);
        if (onProgress) onProgress('generating');
        const summarized = await finalizeToolAnswer(
            userText,
            {
                operation: 'web_fetch',
                response_goal: plan.response_goal || '根据网页内容直接回答用户，并明确引用访问的网址。'
            },
            `网页地址：${explicitUrl}\n网页内容：\n${pageContent}`,
            config
        );
        return {
            role: 'assistant',
            type: 'web_search_result',
            query: plan.query || explicitUrl,
            summary: summarized || `已访问网页：${explicitUrl}`,
            entries: [{ title: explicitUrl, url: explicitUrl, snippet: '', source: 'Direct URL' }],
            message: plan.message || '已完成网页访问。'
        };
    }

    const results = await searchWeb({
        query: plan.query || userText,
        maxResults: plan.maxResults || 6
    });

    // Fetch page content for top results to give AI richer context
    let pageContents = '';
    if (results.length > 0) {
        if (onProgress) onProgress('fetching');
        const fetches = await Promise.allSettled(
            results.slice(0, 3).map(r => fetchWebContent(r.url, 3000))
        );
        const contents = fetches
            .map((r, i) => r.status === 'fulfilled' && r.value ? `[${results[i].title}]\n${r.value}` : null)
            .filter(Boolean);
        if (contents.length > 0) {
            pageContents = '\n\n网页正文摘录:\n' + contents.join('\n\n---\n\n');
        }
    }

    if (onProgress) onProgress('generating');
    const fallback = formatWebSearchResult(results);
    const summarized = await finalizeToolAnswer(
        userText,
        {
            operation: 'web_search',
            response_goal: plan.response_goal || '根据网页搜索结果直接回答用户，并保留关键链接。'
        },
        fallback + pageContents,
        config
    );
    return {
        role: 'assistant',
        type: 'web_search_result',
        query: plan.query || userText,
        summary: summarized || `已找到 ${results.length} 条网页结果。`,
        entries: results,
        message: plan.message || '已完成网页搜索。'
    };
}

function isNativeToolUnsupportedError(error) {
    if (error?.nativeToolUnsupported) return true;
    return /(?:tools?|function(?:_calling)?|tool_choice).{0,80}(?:unsupported|not supported|not support|不支持)|(?:unsupported|not supported|不支持).{0,80}(?:tools?|function|tool_choice)/i.test(String(error?.message || error || ''));
}

// `updates` was declared as a bare `type: 'object'`, so the model got no field
// names or enums and guessed — which is where the off-vocabulary priority and
// status values came from. Declared once and reused by both `updates` and the
// per-item `operations[].updates`.
const NATIVE_UPDATE_FIELDS_SCHEMA = {
    type: 'object',
    description: '要修改的字段，只填需要变更的项。',
    properties: {
        title: { type: 'string' },
        date: { type: 'string', description: '格式 YYYY-MM-DDTHH:mm。' },
        deadline: { type: 'string', description: '格式 YYYY-MM-DDTHH:mm。' },
        priority: { type: 'string', enum: TASK_PRIORITIES },
        status: { type: 'string', enum: TASK_STATUSES },
        note: { type: 'string' },
        repeatDays: {
            type: 'array',
            description: '定时任务重复星期，周日为 0，周一到周六为 1-6。',
            items: { type: 'integer', minimum: 0, maximum: 6 }
        },
        enabled: { type: 'boolean' },
        subtasks: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    status: { type: 'string', enum: ['todo', 'done'] }
                }
            }
        }
    }
};

function buildNativeToolDefinitions(allowLocalFiles = true, allowApplicationData = true) {
    const settings = get(settingsStore);
    if (settings.enableAiChatTools === false) return [];
    const tools = [
        {
            type: 'function',
            function: {
                name: 'workplan_project_action',
                description: '创建、查询、修改或删除 WorkPlan 中的任务、任务模板或定时任务。需要确认的修改/删除会由应用弹出确认卡片。',
                parameters: {
                    type: 'object',
                    properties: {
                        source: {
                            type: 'string',
                            enum: ['tasks', 'templates', 'scheduled'],
                            description: '要操作的数据类型。普通任务用 tasks，任务模板用 templates，定时/周期任务用 scheduled。'
                        },
                        operation: {
                            type: 'string',
                            enum: ['create', 'query', 'update', 'delete', 'mixed', 'subtask'],
                            description: '要执行的项目操作。'
                        },
                        tasks: {
                            type: 'array',
                            description: 'create 时要新增的任务列表。',
                            items: {
                                type: 'object',
                                properties: {
                                    title: { type: 'string' },
                                    date: { type: 'string', description: '普通任务时间，格式 YYYY-MM-DDTHH:mm。模板通常留空。' },
                                    deadline: { type: 'string', description: '截止时间，格式 YYYY-MM-DDTHH:mm。' },
                                    priority: { type: 'string', enum: TASK_PRIORITIES },
                                    status: { type: 'string', enum: TASK_STATUSES },
                                    note: { type: 'string' },
                                    repeatDays: {
                                        type: 'array',
                                        description: '定时任务重复星期，周日为 0，周一到周六为 1-6。',
                                        items: { type: 'integer', minimum: 0, maximum: 6 }
                                    },
                                    enabled: { type: 'boolean' },
                                    subtasks: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                title: { type: 'string' },
                                                status: { type: 'string', enum: ['todo', 'done'] }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        title: {
                            type: 'string',
                            description: 'create 单个任务时的标题简写，等价于 tasks 里只有一项。'
                        },
                        task_id: { type: 'string', description: '单个目标 ID。' },
                        task_ids: {
                            type: 'array',
                            description: 'query/delete 时匹配到的完整 ID 列表。',
                            items: { type: 'string' }
                        },
                        matched_task_ids: {
                            type: 'array',
                            description: 'query 时匹配到的完整 ID 列表，与 task_ids 等价。',
                            items: { type: 'string' }
                        },
                        delete_task_ids: {
                            type: 'array',
                            description: 'delete/mixed 时要删除的完整 ID 列表。',
                            items: { type: 'string' }
                        },
                        updates: NATIVE_UPDATE_FIELDS_SCHEMA,
                        operations: {
                            type: 'array',
                            description: '批量 update 的操作列表。',
                            items: {
                                type: 'object',
                                properties: {
                                    task_id: { type: 'string' },
                                    updates: NATIVE_UPDATE_FIELDS_SCHEMA
                                }
                            }
                        },
                        subtask_changes: {
                            type: 'array',
                            description: 'subtask 操作的子任务变更列表。',
                            items: {
                                type: 'object',
                                properties: {
                                    action: { type: 'string', enum: ['add', 'delete', 'update', 'toggle'] },
                                    index: { type: 'integer' },
                                    old_title: { type: 'string' },
                                    new_title: { type: 'string' },
                                    status: { type: 'string', enum: ['todo', 'done'] }
                                }
                            }
                        },
                        message: { type: 'string' },
                        summary: { type: 'string' },
                        reason: { type: 'string' },
                        filter_description: { type: 'string' }
                    },
                    required: ['source', 'operation']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'workplan_worklog_action',
                description: '查询、新增、修改或删除 WorkPlan 的加班/请假记录。任何新增/修改/删除都会由应用弹出确认，用户拒绝时不会执行。',
                parameters: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['list', 'create_overtime', 'create_leave', 'update', 'delete']
                        },
                        kind: { type: 'string', enum: ['overtime', 'leave'] },
                        id: { type: 'string', description: 'update/delete 的目标记录 ID。' },
                        date: { type: 'string', description: '加班日期 YYYY-MM-DD。' },
                        start: { type: 'string', description: '加班开始时间 HH:mm。' },
                        end: { type: 'string', description: '加班结束时间 HH:mm。' },
                        type: { type: 'string', enum: ['weekday', 'weekend', 'holiday'], description: '加班类型。' },
                        compensation: { type: 'string', enum: ['pay', 'time_off', 'none'], description: '补偿方式。' },
                        start_date: { type: 'string', description: '请假开始日期 YYYY-MM-DD。' },
                        end_date: { type: 'string', description: '请假结束日期 YYYY-MM-DD。' },
                        unit: { type: 'string', enum: ['day', 'hour'], description: '请假单位。' },
                        duration: { type: 'number', description: '请假时长；不填时按日期自动计算。' },
                        leave_type: { type: 'string', enum: ['annual', 'sick', 'personal', 'compensatory', 'maternity', 'marriage', 'bereavement', 'other'] },
                        paid: { type: 'boolean', description: '请假是否带薪。' },
                        note: { type: 'string' },
                        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'list 返回的最大条数。' }
                    },
                    required: ['action']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'workplan_notes_action',
                description: '查询、新建、修改或删除工作笔记。锁定笔记不会提供给 AI；新建/修改/删除都会由应用弹出确认。',
                parameters: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['list', 'create', 'update', 'delete'] },
                        id: { type: 'string', description: 'update/delete 的目标笔记 ID。' },
                        title: { type: 'string' },
                        content: { type: 'string', description: 'Markdown 内容。' },
                        category: { type: 'string' },
                        limit: { type: 'integer', minimum: 1, maximum: 50 }
                    },
                    required: ['action']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'workplan_web_search',
                description: '搜索网页或访问用户给出的 URL，用于实时信息、官网资料、在线搜索和网页内容总结。',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: '搜索关键词。访问 URL 时也要给一个简短主题。' },
                        url: { type: 'string', description: '用户明确给出的 URL，可选。' },
                        maxResults: { type: 'integer', minimum: 1, maximum: 8 },
                        response_goal: { type: 'string', description: '搜索后应该如何回答用户。' },
                        message: { type: 'string' }
                    },
                    required: ['query']
                }
            }
        }
    ];

    if (allowLocalFiles && settings.localFileConfig?.enabled) {
        tools.push({
            type: 'function',
            function: {
                name: 'workplan_local_file',
                description: '搜索、读取、写入或删除本地文件。写入和删除可能需要用户确认，未授权目录会触发授权确认。',
                parameters: {
                    type: 'object',
                    properties: {
                        operation: {
                            type: 'string',
                            enum: ['search', 'read', 'write', 'delete']
                        },
                        path: { type: 'string', description: '目标文件路径。read/write/delete 使用。' },
                        root: { type: 'string', description: '搜索根目录。桌面可用 Desktop 或 ~/Desktop，由原生端解析真实系统桌面（含OneDrive重定向）。不要猜测用户目录，不要拼接工作目录与~。读取仅在用户授权后执行。' },
                        query: { type: 'string', description: '搜索关键词。' },
                        maxResults: { type: 'integer', minimum: 1, maximum: 5000, description: '清单每页条数，不影响完整范围的统计。默认200。' },
                        maxBytes: { type: 'integer', minimum: 512, maximum: 256000, description: '读取文本的字节容量，默认120000。仅read使用。' },
                        offset: { type: 'integer', minimum: 0, maximum: 1000000, description: '清单分页起点，使用上次nextOffset。' },
                        kind: { type: 'string', enum: ['file', 'directory'], description: '仅文件或仅目录；不填查询两者。' },
                        extensions: { type: 'array', items: { type: 'string' }, description: '可选扩展名筛选，如md、pdf、docx；不填包含所有文件类型。' },
                        recursive: { type: 'boolean', description: '默认递归；false仅查询根目录的直接子项。' },
                        maxDepth: { type: 'integer', minimum: 1, maximum: 256 },
                        summaryOnly: { type: 'boolean', description: '统计数量时设为true：扫描完整筛选范围，仅返回总数、文件/目录数及扩展名分布，不返回文件清单。不要根据清单页长度估算总数。' },
                        includeGenerated: { type: 'boolean', description: '默认跳过依赖、缓存和测试产物目录；需要包含这些目录的统计时设为true，敏感目录始终排除。' },
                        content: { type: 'string', description: 'write 时写入的完整内容。' },
                        response_goal: { type: 'string' },
                        message: { type: 'string' }
                    },
                    required: ['operation']
                }
            }
        });
    }

    return tools.filter(tool => (tool.function.name !== 'workplan_worklog_action' || settings.enableOvertime === true)
        && (allowApplicationData || !['workplan_project_action', 'workplan_notes_action', 'workplan_worklog_action'].includes(tool.function.name)));
}

function normalizeNativeProjectSource(source = '', fallback = 'tasks') {
    const value = String(source || fallback || 'tasks').toLowerCase();
    if (value === 'template' || value === 'templates') return 'templates';
    if (value === 'scheduled' || value === 'schedule' || value === 'recurring') return 'scheduled';
    return 'tasks';
}

function normalizeNativeSubtasks(subtasks = []) {
    if (!Array.isArray(subtasks)) return [];
    return subtasks
        .map(item => ({
            title: typeof item === 'string' ? item : String(item?.title || '').trim(),
            status: normalizeStatus(typeof item === 'string' ? 'todo' : (item?.status || 'todo')) === 'done' ? 'done' : 'todo'
        }))
        .filter(item => item.title);
}

function normalizeScheduledEntity(task = {}, index = 0) {
    return {
        id: task.id || `${Date.now() + index}_${Math.random().toString(36).slice(2, 6)}`,
        title: task.title || '未命名定时任务',
        status: normalizeStatus(task.status || 'todo'),
        priority: normalizePriority(task.priority || 'normal'),
        date: task.date || '',
        deadline: task.deadline || '',
        note: task.note || '',
        repeatDays: normalizeRepeatDays(task.repeatDays || []),
        enabled: task.enabled !== false,
        subtasks: normalizeNativeSubtasks(task.subtasks || [])
    };
}

function cleanNativeUpdates(updates = {}, source = 'tasks', task = {}) {
    const cleanUpdates = {};
    if (typeof updates.title === 'string' && updates.title.trim()) cleanUpdates.title = updates.title.trim();
    if (updates.note !== undefined) cleanUpdates.note = String(updates.note || '');

    // These are *partial* updates, so an unrecognized value must be dropped
    // rather than normalized. normalizePriority/normalizeStatus fall back to
    // 'normal'/'todo', which would silently reset a field the model only
    // misspelled — e.g. status:"blocked" would mark a done task as todo.
    const priority = resolvePriority(updates.priority);
    if (priority) {
        cleanUpdates.priority = priority;
    }

    const status = resolveStatus(updates.status);
    if (status) {
        cleanUpdates.status = status;
        if (source !== 'templates') {
            if (status === 'done') {
                cleanUpdates.completedDate = formatLocalDateTime(new Date());
            } else if (status === 'doing' && !task.startTime) {
                cleanUpdates.startTime = formatLocalDateTime(new Date());
            }
        }
    }

    if (source === 'tasks') {
        if (updates.date) cleanUpdates.date = String(updates.date);
        if (updates.deadline !== undefined) cleanUpdates.deadline = String(updates.deadline || '');
    }

    if (source === 'scheduled') {
        if (updates.date !== undefined) cleanUpdates.date = String(updates.date || '');
        if (updates.deadline !== undefined) cleanUpdates.deadline = String(updates.deadline || '');
        if (updates.repeatDays !== undefined) cleanUpdates.repeatDays = normalizeRepeatDays(updates.repeatDays || []);
        if (typeof updates.enabled === 'boolean') cleanUpdates.enabled = updates.enabled;
    }

    if (Array.isArray(updates.subtasks)) {
        cleanUpdates.subtasks = normalizeNativeSubtasks(updates.subtasks);
    }

    return cleanUpdates;
}

async function getNativeProjectItems(source, assistantContext = {}) {
    const normalizedSource = normalizeNativeProjectSource(source, assistantContext.source);
    if (normalizeNativeProjectSource(assistantContext.source, 'tasks') === normalizedSource &&
        Array.isArray(assistantContext.items)) {
        return assistantContext.items;
    }

    const { taskStore } = await import('./tasks.js');
    const taskState = get(taskStore);
    if (normalizedSource === 'templates') return taskState.templates || [];
    if (normalizedSource === 'scheduled') return taskState.scheduledTasks || [];
    return taskState.tasks || [];
}

// Models routinely echo a shortened id, so a suffix match is kept as a fallback.
// A bare `endsWith` was far too loose though: ids are `${Date.now()}_${random}`,
// so a one-character id like "7" matched every task whose id happened to end in
// 7 — and the update/mixed/subtask paths then silently operated on the first of
// them. Require enough characters for the suffix to be meaningfully unique.
const MIN_SUFFIX_ID_LENGTH = 6;

function matchNativeItemsBySingleId(items, id) {
    const exact = items.filter(item => item.id === id);
    if (exact.length) return exact;
    if (id.length < MIN_SUFFIX_ID_LENGTH) return [];
    return items.filter(item => String(item.id || '').endsWith(id));
}

function findNativeItemsByIds(items = [], ids = []) {
    const idList = (Array.isArray(ids) ? ids : [ids])
        .map(id => String(id || '').trim())
        .filter(Boolean);
    if (!idList.length) return [];
    const matched = [];
    for (const id of idList) {
        for (const item of matchNativeItemsBySingleId(items, id)) {
            if (!matched.includes(item)) matched.push(item);
        }
    }
    return matched;
}

/**
 * Single-item lookup for the update/mixed/subtask paths.
 * Returns `{ task, reason }` where reason explains a miss ('missing' or
 * 'ambiguous'); an ambiguous id must not resolve to an arbitrary match, because
 * the caller is about to stage a mutation against it.
 */
function findOneNativeItemById(items, ids) {
    const matched = findNativeItemsByIds(items, ids);
    if (!matched.length) return { task: null, reason: 'missing' };
    if (matched.length > 1) return { task: null, reason: 'ambiguous' };
    return { task: matched[0], reason: '' };
}

const SKIP_REASON_LABELS = {
    missing: '未找到对应项目',
    ambiguous: 'ID 不唯一，匹配到多个项目',
    no_changes: '没有可应用的字段变更'
};

/**
 * Operations dropped during matching used to vanish from the count, so the model
 * would report "已修改 5 个任务" after 2 were staged. Append what was skipped and
 * why to the confirmation message.
 */
function describeSkippedOperations(message, skipped = []) {
    if (!skipped.length) return message;
    const details = skipped
        .map(({ id, reason }) => `${id || '(缺少 ID)'}：${SKIP_REASON_LABELS[reason] || reason}`)
        .join('；');
    return `${message}\n\n⚠️ 已跳过 ${skipped.length} 项操作 —— ${details}`;
}

async function runNativeProjectAction(args = {}, userText = '', assistantContext = {}) {
    const source = normalizeNativeProjectSource(args.source, assistantContext.source);
    const operation = String(args.operation || '').toLowerCase();
    const items = await getNativeProjectItems(source, assistantContext);
    const dateInfo = getDateInfo();
    const fallbackDate = `${formatDateForAI(dateInfo.today)}T09:00`;

    if (operation === 'create') {
        const rawTasks = Array.isArray(args.tasks) && args.tasks.length > 0
            ? args.tasks
            : (args.title ? [args] : []);
        if (!rawTasks.length) {
            return {
                role: 'assistant',
                type: 'text',
                content: args.__parseFailed
                    ? '模型返回的任务数据不完整（输出被截断），没有创建任何任务。请拆成多批创建，或在 AI 设置里提高最大输出长度后重试。'
                    : '没有获得可创建的任务内容，请描述标题和必要字段。'
            };
        }

        const entities = rawTasks.map((task, index) => {
            if (source === 'templates') {
                return normalizeTemplateEntity(task, index);
            }
            if (source === 'scheduled') {
                return normalizeScheduledEntity(task, index);
            }
            return normalizeCreatedTask({
                ...task,
                priority: normalizePriority(task.priority || 'normal'),
                subtasks: normalizeNativeSubtasks(task.subtasks || [])
            }, fallbackDate, index);
        });

        return entities.length > 1 ? { tasks: entities } : entities[0];
    }

    if (operation === 'query') {
        const requestedIds = args.task_ids || args.matched_task_ids || args.delete_task_ids || args.task_id || [];
        const matched = findNativeItemsByIds(items, requestedIds);

        if (matched.length > 0) {
            return {
                role: 'assistant',
                type: 'query_result',
                tasks: matched,
                summary: args.summary || `找到 ${matched.length} 个${assistantContext.entityLabel || '任务'}`,
                filterDescription: args.filter_description || ''
            };
        }
        return {
            role: 'assistant',
            type: 'text',
            content: args.summary || args.message || '未找到匹配的项目数据。'
        };
    }

    if (operation === 'delete') {
        const matched = findNativeItemsByIds(items, args.delete_task_ids || args.task_ids || args.task_id || []);
        if (!matched.length) {
            return { role: 'assistant', type: 'text', content: args.message || '未找到要删除的项目数据。' };
        }
        return {
            role: 'assistant',
            type: 'delete_confirm',
            tasks: matched,
            message: args.message || `找到 ${matched.length} 个项目待删除`,
            reason: args.reason || ''
        };
    }

    if (operation === 'update') {
        const operations = Array.isArray(args.operations) && args.operations.length > 0
            ? args.operations
            : [{ task_id: args.task_id || args.task_ids?.[0], updates: args.updates || {} }];
        const updateOperations = [];
        const skipped = [];
        for (const operationItem of operations) {
            const rawId = operationItem.task_id || operationItem.task_ids || [];
            const { task, reason } = findOneNativeItemById(items, rawId);
            if (!task) {
                skipped.push({ id: String(rawId), reason });
                continue;
            }
            const updates = cleanNativeUpdates(operationItem.updates || {}, source, task);
            if (Object.keys(updates).length === 0) {
                skipped.push({ id: task.id, reason: 'no_changes' });
                continue;
            }
            updateOperations.push({
                task: JSON.parse(JSON.stringify(task)),
                updates
            });
        }

        if (!updateOperations.length) {
            return {
                role: 'assistant',
                type: 'text',
                content: describeSkippedOperations(args.message || '未找到可修改的项目数据。', skipped)
            };
        }

        if (updateOperations.length === 1) {
            return {
                role: 'assistant',
                type: 'update_confirm',
                task: updateOperations[0].task,
                updates: updateOperations[0].updates,
                message: describeSkippedOperations(args.message || '确认修改该项目吗？', skipped)
            };
        }

        return {
            role: 'assistant',
            type: 'multi_update_confirm',
            operations: updateOperations,
            message: describeSkippedOperations(args.message || `将修改 ${updateOperations.length} 个项目`, skipped)
        };
    }

    if (operation === 'mixed') {
        const updateOps = [];
        const skipped = [];
        for (const operationItem of args.operations || []) {
            const rawId = operationItem.task_id || operationItem.task_ids || [];
            const { task, reason } = findOneNativeItemById(items, rawId);
            if (!task) {
                skipped.push({ id: String(rawId), reason });
                continue;
            }
            const updates = cleanNativeUpdates(operationItem.updates || {}, source, task);
            if (Object.keys(updates).length === 0) {
                skipped.push({ id: task.id, reason: 'no_changes' });
                continue;
            }
            updateOps.push({
                task: JSON.parse(JSON.stringify(task)),
                updates
            });
        }
        const deleteOps = findNativeItemsByIds(items, args.delete_task_ids || []);

        if (!updateOps.length && !deleteOps.length) {
            return {
                role: 'assistant',
                type: 'text',
                content: describeSkippedOperations(args.message || '未找到可执行的混合操作。', skipped)
            };
        }

        return {
            role: 'assistant',
            type: 'mixed_confirm',
            updateOps,
            deleteOps,
            message: describeSkippedOperations(args.message || '确认执行这些项目操作吗？', skipped)
        };
    }

    if (operation === 'subtask') {
        const { task, reason } = findOneNativeItemById(items, args.task_id || args.task_ids || []);
        const subtaskChanges = Array.isArray(args.subtask_changes) ? args.subtask_changes : [];
        if (!task || !subtaskChanges.length) {
            const detail = task ? '' : (reason === 'ambiguous'
                ? `（ID "${args.task_id || args.task_ids}" 匹配到多个项目，无法确定目标）`
                : '');
            return {
                role: 'assistant',
                type: 'text',
                content: `${args.message || '未找到要操作的子任务。'}${detail}`
            };
        }
        return {
            role: 'assistant',
            type: 'subtask_confirm',
            task: JSON.parse(JSON.stringify(task)),
            subtaskChanges,
            message: args.message || `确认对 "${task.title}" 的子任务进行操作？`
        };
    }

    return {
        role: 'assistant',
        type: 'text',
        content: args.message || `未支持的项目工具操作：${operation || userText}`
    };
}

async function confirmAiMutation(title, message, isCurrent = captureAiOperationGuard()) {
    if (!isCurrent()) return false;
    const { showConfirm } = await import('./modal.js');
    const accepted = await showConfirm({
        title,
        message,
        confirmText: '执行',
        cancelText: '取消',
        variant: 'danger'
    });
    return accepted && isCurrent();
}

function formatWorklogList(state, limit = 30) {
    const overtime = (state.overtimeRecords || []).filter(record => !record.aiLocked).slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
    const leave = (state.leaveRecords || []).filter(record => !record.aiLocked).slice().sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, limit);
    const lines = [];
    lines.push(`【加班记录】共 ${(state.overtimeRecords || []).filter(record => !record.aiLocked).length} 条（AI 不可访问的已隐藏）`);
    for (const record of overtime) {
        lines.push(`- ${record.id} ${record.date} ${record.start}-${record.end} ${record.hours}h 类型=${record.type} 补偿=${record.compensation || 'pay'} 备注=${record.note || ''}`);
    }
    lines.push(`【请假记录】共 ${(state.leaveRecords || []).filter(record => !record.aiLocked).length} 条（AI 不可访问的已隐藏）`);
    for (const record of leave) {
        lines.push(`- ${record.id} ${record.startDate}~${record.endDate} ${record.duration}${record.unit === 'hour' ? '小时' : '天'} 类型=${record.type} 带薪=${record.paid !== false} 备注=${record.note || ''}`);
    }
    return lines.join('\n');
}

async function runNativeWorklogAction(args, isCurrent = captureAiOperationGuard()) {
    const { taskStore } = await import('./tasks.js');
    const {
        calculateLeaveDays,
        calculateOvertimeHours,
        inferOvertimeType,
        isValidDate,
        normalizeLeaveRecord,
        normalizeOvertimeRecord
    } = await import('../utils/overtime.js');
    const state = get(taskStore);
    if (!isCurrent() || get(settingsStore).enableOvertime !== true) return { role: 'assistant', type: 'text', content: '工时工具已关闭或当前操作已取消。' };
    const action = String(args.action || '').toLowerCase();
    const kind = args.kind || (action.includes('leave') ? 'leave' : 'overtime');

    if (action === 'list') {
        return {
            role: 'assistant',
            type: 'text',
            content: formatWorklogList(state, Number(args.limit) || 30)
        };
    }

    const isSameAccount = () => isCurrent() && get(taskStore).accessKey === state.accessKey && get(settingsStore).enableOvertime === true;
    if (action === 'create_overtime' || (action === 'create' && kind === 'overtime')) {
        const hours = calculateOvertimeHours(args.start, args.end);
        if (!isValidDate(args.date) || hours <= 0) {
            return { role: 'assistant', type: 'text', content: '加班记录缺少有效的日期或起止时间。' };
        }
        const record = normalizeOvertimeRecord({
            id: `overtime_${Date.now()}`,
            date: args.date,
            start: args.start,
            end: args.end,
            hours,
            type: args.type || inferOvertimeType(args.date),
            compensation: args.compensation || 'pay',
            note: args.note || ''
        });
        const ok = await confirmAiMutation('确认新增加班记录', `${record.date} ${record.start}-${record.end}（${record.hours} 小时）\n类型：${record.type}\n补偿：${record.compensation}\n备注：${record.note || '无'}`);
        if (!ok || !isSameAccount()) return { role: 'assistant', type: 'text', content: '已取消新增加班记录。' };
        taskStore.addOvertimeRecord(record);
        return { role: 'assistant', type: 'text', applied: true, content: `已新增加班记录：${record.date} ${record.start}-${record.end}，${record.hours} 小时。` };
    }

    if (action === 'create_leave' || (action === 'create' && kind === 'leave')) {
        if (!isValidDate(args.start_date) || !isValidDate(args.end_date) || args.start_date > args.end_date
            || (args.duration !== undefined && !(args.duration > 0))) {
            return { role: 'assistant', type: 'text', content: '请假记录缺少开始或结束日期。' };
        }
        const record = normalizeLeaveRecord({
            id: `leave_${Date.now()}`,
            startDate: args.start_date,
            endDate: args.end_date,
            unit: args.unit || 'day',
            duration: args.duration || calculateLeaveDays(args.start_date, args.end_date),
            type: args.leave_type || 'annual',
            paid: args.paid !== false,
            note: args.note || ''
        });
        const ok = await confirmAiMutation('确认新增请假记录', `${record.startDate} ~ ${record.endDate}\n类型：${record.type}\n时长：${record.duration}${record.unit === 'hour' ? '小时' : '天'}\n带薪：${record.paid ? '是' : '否'}\n备注：${record.note || '无'}`);
        if (!ok || !isSameAccount()) return { role: 'assistant', type: 'text', content: '已取消新增请假记录。' };
        taskStore.addLeaveRecord(record);
        return { role: 'assistant', type: 'text', applied: true, content: `已新增请假记录：${record.startDate} ~ ${record.endDate}，${record.duration}${record.unit === 'hour' ? '小时' : '天'}。` };
    }

    if (action === 'update' || action === 'delete') {
        const list = kind === 'leave' ? state.leaveRecords : state.overtimeRecords;
        const existing = (list || []).find(record => record.id === args.id);
        if (!existing) {
            return { role: 'assistant', type: 'text', content: `没有找到 ID 为 ${args.id || '(空)'} 的${kind === 'leave' ? '请假' : '加班'}记录。` };
        }
        if (existing.aiLocked) {
            return { role: 'assistant', type: 'text', content: '该记录已标记为 AI 不可访问，AI 不能读取或修改。' };
        }
        const targetUnchanged = () => isSameAccount() && (kind === 'leave' ? get(taskStore).leaveRecords : get(taskStore).overtimeRecords)?.find(record => record.id === existing.id) === existing;
        if (action === 'delete') {
            const label = kind === 'leave'
                ? `${existing.startDate} ~ ${existing.endDate} 的请假`
                : `${existing.date} ${existing.start}-${existing.end} 的加班`;
            const ok = await confirmAiMutation('确认删除记录', `确定删除${label}记录吗？此操作不可撤销。`);
            if (!ok || !targetUnchanged()) return { role: 'assistant', type: 'text', content: '已取消删除，或记录已发生变化，请重新确认。' };
            if (kind === 'leave') taskStore.deleteLeaveRecord(existing.id);
            else taskStore.deleteOvertimeRecord(existing.id);
            return { role: 'assistant', type: 'text', applied: true, content: `已删除${label}记录。` };
        }
        const updates = {};
        if (kind === 'leave') {
            for (const key of ['startDate', 'endDate', 'unit', 'type', 'paid', 'note']) {
                const source = key === 'startDate' ? args.start_date : key === 'endDate' ? args.end_date : key === 'type' ? args.leave_type : args[key];
                if (source !== undefined) updates[key] = source;
            }
            if (args.duration !== undefined) updates.duration = Number(args.duration);
            if ((updates.startDate || updates.endDate) && updates.duration === undefined) {
                updates.duration = calculateLeaveDays(updates.startDate || existing.startDate, updates.endDate || existing.endDate);
            }
        } else {
            for (const key of ['date', 'start', 'end', 'type', 'compensation', 'note']) {
                if (args[key] !== undefined) updates[key] = args[key];
            }
            if (updates.start || updates.end) {
                updates.hours = calculateOvertimeHours(updates.start || existing.start, updates.end || existing.end);
            }
        }
        const merged = kind === 'leave'
            ? normalizeLeaveRecord({ ...existing, ...updates })
            : normalizeOvertimeRecord({ ...existing, ...updates });
        const validRecord = kind === 'leave'
            ? isValidDate(merged.startDate) && isValidDate(merged.endDate) && merged.startDate <= merged.endDate && merged.duration > 0
            : isValidDate(merged.date) && calculateOvertimeHours(merged.start, merged.end) > 0;
        if (!validRecord) return { role: 'assistant', type: 'text', content: '修改后的日期、起止时间或时长无效，未执行修改。' };
        const ok = await confirmAiMutation('确认修改记录', `将修改${kind === 'leave' ? '请假' : '加班'}记录 ${existing.id}。\n修改后：${kind === 'leave' ? `${merged.startDate}~${merged.endDate} ${merged.duration}${merged.unit === 'hour' ? '小时' : '天'}` : `${merged.date} ${merged.start}-${merged.end} ${merged.hours}h`}\n备注：${merged.note || '无'}`);
        if (!ok || !targetUnchanged()) return { role: 'assistant', type: 'text', content: '已取消修改，或记录已发生变化，请重新确认。' };
        if (kind === 'leave') taskStore.updateLeaveRecord(existing.id, updates);
        else taskStore.updateOvertimeRecord(existing.id, updates);
        return { role: 'assistant', type: 'text', applied: true, content: `已修改记录 ${existing.id}。` };
    }

    return { role: 'assistant', type: 'text', content: '无法识别工时操作。' };
}

async function runNativeNotesAction(args, isCurrent = captureAiOperationGuard()) {
    const action = String(args.action || '').toLowerCase();
    const state = get(notesStore);
    const visibleNotes = (state.notes || []).filter(note => !note.aiLocked);
    if (!isCurrent()) return { role: 'assistant', type: 'text', content: '当前操作已取消。' };

    if (action === 'list') {
        const limit = Number(args.limit) || 20;
        const lines = visibleNotes.slice(0, limit).map(note => (
            `- ${note.id}《${String(note.title || '').slice(0, 300)}》分类=${String(note.category || '').slice(0, 100)}`
        ));
        return {
            role: 'assistant',
            type: 'text',
            content: lines.length ? `共 ${visibleNotes.length} 篇可读笔记（仅标题，正文需按ID调用workplan_read_data）：\n${lines.join('\n')}` : '没有可读的工作笔记。'
        };
    }

    if (action === 'create') {
        if (!args.title && !args.content) {
            return { role: 'assistant', type: 'text', content: '没有提供笔记标题或内容。' };
        }
        const ok = await confirmAiMutation('确认新建笔记', `标题：${args.title || '无标题'}\n分类：${args.category || '默认'}\n内容：${String(args.content || '').slice(0, 200)}`);
        if (!ok || !isCurrent()) return { role: 'assistant', type: 'text', content: '已取消新建笔记。' };
        notesStore.addNote({
            title: args.title || '未命名笔记',
            content: args.content || '',
            category: args.category || '默认'
        });
        return { role: 'assistant', type: 'text', applied: true, content: `已新建笔记《${args.title || '未命名笔记'}》。` };
    }

    const note = (state.notes || []).find(item => item.id === args.id);
    if (!note) return { role: 'assistant', type: 'text', content: `没有找到 ID 为 ${args.id || '(空)'} 的笔记。` };
    if (note.aiLocked) return { role: 'assistant', type: 'text', content: '该笔记已锁定，AI 不能读取或修改。' };
    const targetUnchanged = () => isCurrent() && get(notesStore).notes.find(item => item.id === note.id) === note;

    if (action === 'delete') {
        const ok = await confirmAiMutation('确认删除笔记', `确定删除《${note.title}》吗？此操作不可撤销。`);
        if (!ok || !targetUnchanged()) return { role: 'assistant', type: 'text', content: '已取消删除笔记，或笔记已发生变化，请重新确认。' };
        notesStore.deleteNote(note.id);
        return { role: 'assistant', type: 'text', applied: true, content: `已删除笔记《${note.title}》。` };
    }

    if (action === 'update') {
        const updates = {};
        for (const key of ['title', 'content', 'category']) {
            if (args[key] !== undefined) updates[key] = args[key];
        }
        const ok = await confirmAiMutation('确认修改笔记', `将修改《${note.title}》。\n新标题：${updates.title || note.title}\n内容：${String(updates.content ?? note.content).slice(0, 200)}`);
        if (!ok || !targetUnchanged()) return { role: 'assistant', type: 'text', content: '已取消修改笔记，或笔记已发生变化，请重新确认。' };
        notesStore.updateNote(note.id, updates);
        return { role: 'assistant', type: 'text', applied: true, content: `已修改笔记《${updates.title || note.title}》。` };
    }

    return { role: 'assistant', type: 'text', content: '无法识别笔记操作。' };
}

async function executeNativeToolCall(toolCall, userText, config, assistantContext, requireFileConfirmation, progress, allowLocalFiles = true) {
    const isCurrent = config.isCurrent || captureAiOperationGuard(config.signal);
    if (!isCurrent()) throw new DOMException('操作已取消或上下文已改变', 'AbortError');
    const checked = validateNativeToolCall(toolCall, buildNativeToolDefinitions(allowLocalFiles, config.allowApplicationData !== false));
    if (!checked.valid) return { role: 'assistant', type: 'text', content: `工具参数无效，未执行任何操作：${checked.error}` };
    const args = checked.args;
    if (toolCall.name === 'workplan_web_search') {
        if (args.url && !isExplicitWebFetchTarget(userText, args.url)) {
            return { role: 'assistant', type: 'text', content: '模型返回了用户未明确提供的网页地址，未自动访问。请直接提供需要访问的完整网址。' };
        }
        progress('web_searching');
        return await runWebSearchPlan({
            mode: 'web',
            url: args.url || '',
            query: args.query || userText,
            maxResults: args.maxResults || 6,
            response_goal: args.response_goal || '根据网页搜索结果直接回答用户，并保留关键链接。',
            message: args.message || '已通过原生工具调用执行网页搜索。'
        }, userText, config, progress);
    }

    if (toolCall.name === 'workplan_local_file') {
        if (!allowLocalFiles) {
            return {
                role: 'assistant',
                type: 'text',
                content: '本地文件操作仅在 AI 聊天卡片中可用，当前对话无法执行文件操作。'
            };
        }
        progress('file_operating');
        const plan = {
            mode: 'file',
            operation: args.operation,
            path: args.path || '',
            root: args.root || '',
            query: args.query || '',
            ...Object.fromEntries(['maxResults', 'maxBytes', 'offset', 'kind', 'extensions', 'recursive', 'maxDepth', 'summaryOnly', 'includeGenerated']
                .filter(key => args[key] !== undefined).map(key => [key, args[key]])),
            content: args.content || '',
            response_goal: args.response_goal || '',
            message: args.message || '已通过原生工具调用解析为本地文件操作。'
        };
        return await runLocalFilePlan(plan, userText, config, requireFileConfirmation);
    }

    if (toolCall.name === 'workplan_worklog_action') {
        progress('task_processing');
        return await runNativeWorklogAction(args, isCurrent);
    }

    if (toolCall.name === 'workplan_notes_action') {
        progress('task_processing');
        return await runNativeNotesAction(args, isCurrent);
    }

    if (toolCall.name === 'workplan_project_action') {
        progress('task_processing');
        const source = normalizeNativeProjectSource(args.source, assistantContext.source);
        const entityLabel = source === 'templates' ? '任务模板' : source === 'scheduled' ? '定时任务' : '任务';
        return normalizeAssistantResult(await runNativeProjectAction(args, userText, assistantContext), {
            ...assistantContext, source, entityLabel
        });
    }

    return {
        role: 'assistant',
        type: 'text',
        content: `模型请求了未知工具：${toolCall.name}`
    };
}

function normalizeAssistantResult(result, assistantContext) {
    const baseMeta = {
        assistantSource: assistantContext.source || 'tasks',
        assistantScope: assistantContext.scope || 'dashboard',
        entityLabel: assistantContext.entityLabel || '任务'
    };

    if (result && result.type) {
        return {
            ...baseMeta,
            ...result
        };
    }

    if (result && Array.isArray(result.tasks) && result.tasks.length > 0) {
        return {
            ...baseMeta,
            role: 'assistant',
            type: 'multi_task_card',
            tasks: result.tasks,
            confirmedIndexes: []
        };
    }

    if (result) {
        return {
            ...baseMeta,
            role: 'assistant',
            type: 'task_card',
            data: result,
            confirmed: false
        };
    }

    return {
        ...baseMeta,
        role: 'assistant',
        type: 'text',
        content: '无法理解您的输入，请描述得更具体一些。例如："明天下午3点开会"、"删除今天的会议任务"、"把明天的任务改到后天"。'
    };
}

async function requestOnDemandReply(text, config, context = {}, attachments = [], chatStyle = 'default', initialResult = null) {
    const api = await import('../utils/ai-providers.js');
    const isCurrent = config.isCurrent || captureAiOperationGuard(config.signal, false);
    const toolsEnabled = get(settingsStore).enableAiChatTools !== false;
    const supportsNative = toolsEnabled && api.canProviderUseNativeTools(config.provider);
    const bodyFormat = api.getProviderBodyFormat(config.provider);
    const userContent = buildUserMessageContentForAI({ content: text, attachments }, bodyFormat);
    const messages = [
        { role: 'system', content: `你是 WorkPlan 助手。当前时间：${getFormattedDateTime()}。${AI_TRUST_RULES}
本轮不预载任何应用数据。根据用户当前问题自行决定是否需要数据：普通闲聊、常识、写作只直接回答；涉及当前笔记、任务等应用记录时，先用 workplan_read_data 按需查询，拿到真实内容后再回答，不要让已选择笔记的用户重复粘贴。
当前页面类型：${context.scope === 'notes' ? '笔记页面' : '通用聊天'}，${context.activeNoteId ? '有选中笔记，可查询current_note' : '未显式选择笔记'}。标题、正文和其他记录必须查询才能获得。
本地路径交由系统原生解析，不猜测系统目录，不自行拼接用户目录别名。授权只代表指定范围的访问权限，不代表目标存在或操作成功。权限或路径失败时如实说明，不盲目重试；读取内容不等于运行或验证其行为。
所有工具都按最小必要范围执行：先定位明确对象，再查询所需字段或关键内容。多候选时先澄清，不自动扩大权限、目录或数据范围。以工具返回的实际范围、条件、错误和截断标记为准，不编造结果缺失的原因；已有足够事实时立即回答。只返回确认卡片的操作尚未执行，已失败的变更不自动重试。
${context.scope === 'notes' ? '工作文档模式：通过工具取得正文后保持原有Markdown结构，直接给出草稿，不声称已保存。' : ''}
查询其他笔记先列出标题，再按真实ID读取单篇；分页与截断必须告知范围。锁定、删除或查询失败时准确说明，不编造数据。仅用户明确要求保存/修改/删除时可请求变更工具；返回确认卡片不等于执行成功。
回复风格：${['default', 'fun', 'professional', 'concise', 'teacher'].includes(chatStyle) ? chatStyle : 'default'}。
${supportsNative ? '' : '当前连接未提供原生工具，不能查询应用数据；不要声称已读取。可正常回答通用问题，需要应用数据时提示选择支持原生工具的连接。'}` },
        bodyFormat === 'google' && Array.isArray(userContent) ? { role: 'user', parts: userContent } : { role: 'user', content: userContent }
    ];
    if (!supportsNative) return { role: 'assistant', type: 'text', content: await api.callAIWithMessages(config, messages) };
    const allowFiles = get(settingsStore).localFileConfig?.enabled === true;
    const actionTools = buildNativeToolDefinitions(allowFiles, true);
    const tools = [READ_APP_DATA_TOOL, ...actionTools];
    let projectStore;
    try {
        return await runOnDemandAssistant({
            messages, tools, isCurrent, initialResult, describeOperation,
            finalizeModel: transcript => api.callAIWithMessages(config, transcript),
            callModel: (transcript, definitions) => {
                if (get(settingsStore).enableAiChatTools === false) throw new DOMException('工具已关闭', 'AbortError');
                return api.callAIWithMessagesAndTools(config, transcript, definitions, { toolChoice: 'auto', signal: config.signal });
            },
            executeTool: async (call, args) => {
                if (!captureAiOperationGuard(config.signal)()) throw new DOMException('工具不可用或已取消', 'AbortError');
                if (call.name === 'workplan_read_data') {
                    const query = await queryApplicationData(args, {
                        context, getNotes: () => get(notesStore),
                        getProjects: async () => {
                            projectStore ||= (await import('./tasks.js')).taskStore;
                            return get(projectStore);
                        },
                        getProjectsSnapshot: () => projectStore ? get(projectStore) : null,
                        overtimeEnabled: () => get(settingsStore).enableOvertime === true
                    });
                    return { ...query, lease: { source: args.source, id: query.data?.note?.id || args.id } };
                }
                const current = { ...context };
                // Resolve targets locally at execution time, never as a passive
                // prompt snapshot. The model must obtain real IDs via queries.
                if (call.name === 'workplan_project_action') {
                    projectStore ||= (await import('./tasks.js')).taskStore;
                    if (!isCurrent()) throw new DOMException('操作已取消', 'AbortError');
                    const state = get(projectStore);
                    current.source = args.source;
                    current.items = args.source === 'templates' ? state.templates : args.source === 'scheduled' ? state.scheduledTasks : state.tasks;
                }
                const result = await executeNativeToolCall(call, text, { ...config, rawToolResults: true }, current,
                    get(settingsStore).localFileConfig?.requireConfirmation ?? true, () => {}, allowFiles);
                return { data: result?.toolData || result, applied: result?.applied === true,
                    card: result?.type && result.type !== 'text' ? result : null };
            }
        });
    } catch (error) {
        if (isNativeToolUnsupportedError(error)) {
            throw new Error('当前API或模型未支持原生工具调用，未读取应用数据。请在AI设置选择支持tool_calls的模型后重试。');
        }
        throw error;
    }
}

export async function sendAiMessage(text, existingTasks = [], retryIndex = null) {
    if (!text.trim()) return;
    if (get(isAiLoading)) throw new Error('请等待当前 AI 请求完成或先停止请求。');

    const controller = new AbortController();
    const isCurrent = captureAiOperationGuard(controller.signal, false);
    const context = get(aiPanelContext);
    const currentConfig = { ...getEffectiveConfig(), signal: controller.signal, isCurrent: () => isCurrent() && get(aiPanelContext) === context };
    const loading = { role: 'assistant', type: 'loading' };

    const needsApiKey = providerNeedsApiKey(currentConfig.provider);

    if (needsApiKey && !currentConfig.apiKey) {
        showAiSettings.set(true);
        throw new Error('请先配置 AI API Key');
    }

    if (retryIndex !== null) {
        if (get(chatHistory)[retryIndex]?.type !== 'error') throw new Error('重试消息已失效。');
        chatHistory.update(h => {
            const newHistory = [...h];
            if (newHistory[retryIndex] && newHistory[retryIndex].type === 'error') {
                newHistory[retryIndex] = loading;
            }
            return newHistory;
        });
    } else {
        chatHistory.update(h => [...h, { role: 'user', type: 'text', content: text }]);
        chatHistory.update(h => [...h, loading]);
    }

    isAiLoading.set(true);
    _streamAbortController = controller;
    lastFailedMessage.set({ text, index: retryIndex });

    try {
        const result = await requestOnDemandReply(text, currentConfig, normalizeAssistantPayload(existingTasks));

        if (controller.signal.aborted || !isCurrent() || get(aiPanelContext) !== context) return;

        chatHistory.update(h => {
            const newHistory = [...h];
            const loadingIndex = newHistory.indexOf(loading);
            if (loadingIndex !== -1) {
                if (result?.__batchResults?.length) {
                    newHistory.splice(loadingIndex, 1, ...result.__batchResults);
                } else {
                    newHistory[loadingIndex] = result;
                }
            }
            return newHistory;
        });

        lastFailedMessage.set(null);
    } catch (error) {
        if (controller.signal.aborted || !isCurrent() || get(aiPanelContext) !== context) return;
        chatHistory.update(h => {
            const newHistory = [...h];
            const loadingIndex = newHistory.indexOf(loading);
            if (loadingIndex !== -1) {
                newHistory[loadingIndex] = {
                    role: 'assistant',
                    type: 'error',
                    content: error.message,
                    originalText: text
                };
            }
            return newHistory;
        });
    } finally {
        if (_streamAbortController === controller) {
            _streamAbortController = null;
            isAiLoading.set(false);
        }
    }
}

export async function retryLastMessage(index, existingTasks = []) {
    const history = get(chatHistory);
    if (history[index] && history[index].type === 'error') {
        const originalText = history[index].originalText;
        if (originalText) {
            await sendAiMessage(originalText, existingTasks, index);
        }
    }
}

export async function confirmAiChatLocalFileOperation(index, operation) {
    if (get(isAiLoading)) return { success: false, error: '请等待当前请求结束后再确认。' };
    const staged = get(aiChatHistory)[index];
    if (!staged || staged.type !== 'file_confirm' || staged.operation !== operation) {
        return { success: false, error: '确认卡片已失效，请重新发起文件操作。' };
    }
    const guard = captureAiOperationGuard();
    if (!guard() || !get(settingsStore).localFileConfig?.enabled) {
        return { success: false, error: '文件工具已关闭或操作已取消。' };
    }
    const controller = new AbortController();
    const currentConfig = { ...getEffectiveConfig(), signal: controller.signal, rawToolResults: true,
        isCurrent: () => guard() && !controller.signal.aborted && get(aiChatHistory)[index] === loading };
    operation = JSON.parse(JSON.stringify(operation));
    const loading = { role: 'assistant', type: 'loading' };

    aiChatHistory.update(history => {
        const nextHistory = [...history];
        if (nextHistory[index]) {
            nextHistory[index] = loading;
        }
        return nextHistory;
    });
    saveAiChatHistory();
    isAiLoading.set(true);
    _streamAbortController = controller;

    try {
        if (!guard() || get(aiChatHistory)[index] !== loading) return { success: false, error: '文件确认已取消。' };
        if (operation?.authorizationDirectory) {
            const requested = operation.authorizationDirectory;
            const resolved = await resolveLocalPath(requested);
            if (!guard() || get(aiChatHistory)[index] !== loading) return { success: false, error: '授权已取消。' };
            if (!resolved.exists || !resolved.isDirectory) throw new Error(`授权目录不存在或不可用：${resolved.path}`);
            if (normalizeComparablePath(resolved.path) !== normalizeComparablePath(requested)) throw new Error('授权目录已改变，请重新确认实际目录。');
            const directories = [...(get(settingsStore).localFileConfig?.trustedDirectories || []), resolved.path];
            const accepted = await syncTrustedDirectories(directories);
            if (!accepted.some(path => normalizeComparablePath(path) === normalizeComparablePath(resolved.path))) throw new Error('原生端未接受目录授权，未执行文件操作。');
            if (!guard() || get(aiChatHistory)[index] !== loading) return { success: false, error: '授权已取消。' };
            settingsStore.addTrustedDirectory(resolved.path);
        }
        const result = await runLocalFilePlan(operation, operation.originalUserText || operation.message || '', currentConfig, false);
        if (!guard() || get(aiChatHistory)[index] !== loading) return { success: false, error: '文件操作结果属于已关闭的对话。' };
        let reply = result;
        if (['search', 'read'].includes(operation.operation) && result.type === 'text') {
            const args = Object.fromEntries(['operation', 'path', 'root', 'query', 'response_goal', 'message', 'maxResults', 'maxBytes', 'offset', 'kind', 'extensions', 'recursive', 'maxDepth', 'summaryOnly', 'includeGenerated']
                .filter(key => operation[key] !== undefined).map(key => [key, operation[key]]));
            reply = await requestOnDemandReply(operation.originalUserText || operation.message || '请根据已授权文件结果回答',
                currentConfig, {}, [], 'default', { name: 'workplan_local_file', arguments: JSON.stringify(args), data: result.toolData || result,
                    aliases: operation.operation === 'search' && operation.requestedRoot ? [{ ...args, root: operation.requestedRoot }] : [] });
            if (!guard() || get(aiChatHistory)[index] !== loading) return { success: false, error: '文件操作结果属于已关闭的对话。' };
        }
        aiChatHistory.update(history => {
            const nextHistory = [...history];
            nextHistory[index] = reply;
            return nextHistory;
        });
        saveAiChatHistory();
        return { success: true, result: reply };
    } catch (error) {
        if (!guard() || get(aiChatHistory)[index] !== loading) return { success: false, error: '文件操作已取消。' };
        aiChatHistory.update(history => {
            const nextHistory = [...history];
            nextHistory[index] = {
                role: 'assistant',
                type: 'error',
                content: error.message || String(error),
                originalText: operation?.message || ''
            };
            return nextHistory;
        });
        saveAiChatHistory();
        return { success: false, error: error.message || String(error) };
    } finally {
        if (_streamAbortController === controller) {
            _streamAbortController = null;
            isAiLoading.set(false);
        }
    }
}

function normalizeCreatedTask(task = {}, fallbackDate = '', index = 0) {
    const status = normalizeStatus(task.status);
    const subtaskStatusFromParent = status === 'done' ? 'done' : 'todo';
    const result = {
        id: task.id || `${Date.now() + index}_${Math.random().toString(36).slice(2, 7)}`,
        title: task.title || '未命名任务',
        date: task.date || fallbackDate,
        deadline: task.deadline || '',
        status,
        priority: normalizePriority(task.priority),
        subtasks: (task.subtasks || []).map(s => {
            const subStatus = typeof s === 'object'
                ? (resolveStatus(s.status) || subtaskStatusFromParent)
                : subtaskStatusFromParent;
            return {
                title: typeof s === 'string' ? s : (s.title || ''),
                status: subStatus
            };
        }),
        note: task.note || ''
    };
    if (status === 'done') {
        result.completedDate = task.completedDate || task.date || fallbackDate;
    }
    return result;
}

export async function sendChatMessage(text, chatStyle = 'default', retryIndex = null, options = {}) {
    if (get(isAiLoading)) throw new Error('请等待当前 AI 请求完成或先停止请求。');
    const requestedText = String(text || '').trim();
    const selectedAttachments = normalizeChatAttachments(
        retryIndex === null
            ? (options.attachments ?? get(aiChatComposerAttachments))
            : (options.attachments ?? [])
    );
    if (!requestedText && selectedAttachments.length === 0) return;

    const effectiveText = requestedText || '请阅读并分析这些附件。';

    const currentConfig = getEffectiveConfig();
    assertChatAttachments(currentConfig, selectedAttachments);
    const needsApiKey = providerNeedsApiKey(currentConfig.provider);

    if (needsApiKey && !currentConfig.apiKey) {
        showAiSettings.set(true);
        throw new Error('请先配置 AI API Key');
    }

    let streamingIndex = -1;

    if (retryIndex !== null) {
        if (get(aiChatHistory)[retryIndex]?.type !== 'error') throw new Error('重试消息已失效。');
        aiChatHistory.update(h => {
            const newHistory = [...h];
            if (newHistory[retryIndex] && newHistory[retryIndex].type === 'error') {
                newHistory[retryIndex] = { role: 'assistant', type: 'streaming', content: '', isStreaming: true };
                streamingIndex = retryIndex;
            }
            return newHistory;
        });
    } else {
        aiChatHistory.update(h => [...h, {
            role: 'user',
            type: 'text',
            content: effectiveText,
            attachments: selectedAttachments
        }]);
        aiChatHistory.update(h => {
            const newHistory = [...h, { role: 'assistant', type: 'loading' }];
            streamingIndex = newHistory.length - 1;
            return newHistory;
        });
        clearAiChatComposerAttachments();
    }

    if (streamingIndex === -1) {
        const currentHistory = get(aiChatHistory);
        streamingIndex = currentHistory.length - 1;
    }

    isAiLoading.set(true);
    streamingContent.set('');
    const abortController = new AbortController();
    _streamAbortController = abortController;
    const isCurrent = captureAiOperationGuard(abortController.signal, false);
    currentConfig.signal = abortController.signal;
    currentConfig.isCurrent = isCurrent;

    try {
        const result = await requestOnDemandReply(effectiveText, currentConfig, get(aiChatContext) || {}, selectedAttachments, chatStyle);
        if (!isCurrent()) return;
        aiChatHistory.update(history => {
            const next = [...history];
            if (result?.__batchResults?.length) next.splice(streamingIndex, 1, ...result.__batchResults);
            else next[streamingIndex] = result;
            return next;
        });
        streamingContent.set('');
        saveAiChatHistory();
    } catch (error) {
        if (!isCurrent()) return;
        if (error?.name === 'AbortError') {
            aiChatHistory.update(h => {
                const newHistory = [...h];
                if (newHistory[streamingIndex]) {
                    const content = newHistory[streamingIndex].content;
                    if (!content) {
                        newHistory.splice(streamingIndex, 1);
                    } else {
                        newHistory[streamingIndex] = {
                            role: 'assistant', type: 'text', content, isStreaming: false
                        };
                    }
                }
                return newHistory;
            });
            streamingContent.set('');
            saveAiChatHistory();
            return;
        }
        aiChatHistory.update(h => {
            const newHistory = [...h];
            if (newHistory[streamingIndex]) {
                    newHistory[streamingIndex] = {
                        role: 'assistant',
                        type: 'error',
                        content: error.message,
                        originalText: effectiveText,
                        originalAttachments: selectedAttachments,
                        chatStyle: chatStyle
                    };
                }
                return newHistory;
        });
        saveAiChatHistory();
    } finally {
        if (_streamAbortController === abortController) {
            _streamAbortController = null;
            isAiLoading.set(false);
        }
    }
}

export async function retryChatMessage(index) {
    const history = get(aiChatHistory);
    if (history[index] && history[index].type === 'error') {
        const originalText = history[index].originalText;
        const originalAttachments = history[index].originalAttachments || [];
        const chatStyle = history[index].chatStyle || 'default';
        if (originalText) {
            await sendChatMessage(originalText, chatStyle, index, { attachments: originalAttachments });
        }
    }
}

export async function retryFromAssistantMessage(assistantIndex) {
    const history = get(aiChatHistory);
    // Find the user message before this assistant message
    let userIndex = -1;
    for (let i = assistantIndex - 1; i >= 0; i--) {
        if (history[i]?.role === 'user') {
            userIndex = i;
            break;
        }
    }
    if (userIndex === -1) return;

    const originalText = history[userIndex].content;
    const originalAttachments = history[userIndex].attachments || [];
    if (!originalText) return;

    // Truncate everything after this assistant message, then replace it with loading
    aiChatHistory.update(h => {
        const newHistory = h.slice(0, assistantIndex + 1);
        newHistory[assistantIndex] = { role: 'assistant', type: 'loading' };
        return newHistory;
    });

    await sendChatMessage(originalText, 'default', assistantIndex, { attachments: originalAttachments });
}

export function editAndResend(messageIndex) {
    stopStreaming();
    const history = get(aiChatHistory);
    const msg = history[messageIndex];
    if (!msg || msg.role !== 'user') return null;

    const content = msg.content;
    aiChatComposerAttachments.set(normalizeChatAttachments(msg.attachments || []));
    // Remove this message and everything after it
    aiChatHistory.update(h => h.slice(0, messageIndex));
    saveAiChatHistory();
    return content;
}

export function rollbackMessage(messageIndex) {
    stopStreaming();
    const history = get(aiChatHistory);
    const msg = history[messageIndex];
    if (!msg || msg.role !== 'user') return;

    // Remove the user message and the next assistant message (if exists)
    const removeEnd = (messageIndex + 1 < history.length && history[messageIndex + 1]?.role === 'assistant')
        ? messageIndex + 2
        : messageIndex + 1;

    aiChatHistory.update(h => [...h.slice(0, messageIndex), ...h.slice(removeEnd)]);
    saveAiChatHistory();
}

export function exportChatToMarkdown() {
    const history = get(aiChatHistory);
    const session = get(aiChatSessions).find(s => s.id === get(activeAiChatSessionId));
    const title = session?.title || 'AI Chat';
    const lines = [`# ${title}\n`];

    for (const msg of history) {
        if (msg.role === 'user') {
            lines.push(`**You:**\n> ${msg.content.replace(/\n/g, '\n> ')}\n`);
            if (msg.attachments?.length) {
                lines.push('**Attachments:**');
                for (const attachment of msg.attachments) {
                    lines.push(`- ${attachment.name} (${attachment.path})${attachment.truncated ? ' [truncated]' : ''}`);
                }
                lines.push('');
            }
        } else if (msg.type === 'text' || msg.type === 'streaming') {
            lines.push(`**AI:**\n${msg.content || ''}\n`);
        } else if (msg.type === 'web_search_result') {
            lines.push(`**AI (Web Search):**\n${msg.summary || ''}\n`);
            if (msg.entries?.length) {
                for (const entry of msg.entries) {
                    lines.push(`- [${entry.title}](${entry.url}): ${entry.snippet || ''}`);
                }
                lines.push('');
            }
        } else if (msg.type === 'error') {
            lines.push(`**Error:** ${msg.content || ''}\n`);
        }
    }

    return lines.join('\n');
}

export async function generateReport(tasks, reportType) {
    const { callAI } = await import('../utils/ai-providers.js');
    const config = getEffectiveConfig();

    const nowStr = getFormattedDateTime();
    const taskSummary = (Array.isArray(tasks) ? tasks : []).map(t => {
        const status = t.status === 'done' ? '已完成' : (t.status === 'doing' ? '进行中' : '未开始');
        const priority = t.priority === 'critical' ? '特急' : (t.priority === 'urgent' ? '紧急' : '普通');
        const subtaskInfo = t.subtasks && t.subtasks.length > 0
            ? ` (子任务: ${t.subtasks.map(s => `${s.title}[${s.status === 'done' ? '完成' : '待办'}]`).join(', ')})`
            : '';
        return `- ${t.title || '未命名任务'} [${status}] [${priority}] 计划:${String(t.date || '').split('T')[0] || '未安排'}${subtaskInfo}`;
    }).join('\n');

    const reportTypeText = reportType === 'daily' ? '日报' : '周报';
    const customPrompt = reportType === 'daily' ? config.dailyReportPrompt : config.weeklyReportPrompt;

    const defaultPrompt = `你是一个专业的工作汇报助手。当前时间：${nowStr}。
请根据用户消息中提供的任务列表生成一份${reportTypeText}。
【要求】
1. 生成简洁专业的${reportTypeText}
2. 包含：工作概述、已完成事项、进行中事项、待办事项、工作亮点/问题
3. 使用 Markdown 格式
4. 语言简练，突出重点`;

    const systemPrompt = customPrompt
        ? customPrompt.replaceAll('{{tasks}}', '（任务数据见后续用户上下文）').replaceAll('{{time}}', nowStr).replaceAll('{{type}}', reportTypeText)
        : defaultPrompt;

    const userMessage = `${untrustedAiContext('REPORT_TASKS', taskSummary, 64000)}\n\n请根据这些任务生成${reportTypeText}。若数据已截断请说明范围，不要声称涵盖未提供的任务。`;
    return await callAI(config, userMessage, `${systemPrompt}\n${AI_TRUST_RULES}`);
}

export function confirmAiTask(index) {
    chatHistory.update(h => {
        const newHistory = [...h];
        if (newHistory[index] && newHistory[index].type === 'task_card') {
            newHistory[index].confirmed = true;
        }
        return newHistory;
    });
}

export function confirmMultiTask(msgIndex, taskIndex) {
    chatHistory.update(h => {
        const newHistory = [...h];
        if (newHistory[msgIndex] && newHistory[msgIndex].type === 'multi_task_card') {
            if (!newHistory[msgIndex].confirmedIndexes) {
                newHistory[msgIndex].confirmedIndexes = [];
            }
            if (!newHistory[msgIndex].confirmedIndexes.includes(taskIndex)) {
                newHistory[msgIndex].confirmedIndexes.push(taskIndex);
            }
        }
        return newHistory;
    });
}

export function confirmAllMultiTasks(msgIndex) {
    chatHistory.update(h => {
        const newHistory = [...h];
        if (newHistory[msgIndex] && newHistory[msgIndex].type === 'multi_task_card') {
            newHistory[msgIndex].confirmedIndexes = newHistory[msgIndex].tasks.map((_, i) => i);
        }
        return newHistory;
    });
}

export function markMessageProcessed(index) {
    chatHistory.update(h => {
        const newHistory = [...h];
        if (newHistory[index]) {
            newHistory[index].processed = true;
        }
        return newHistory;
    });
}

export function removeAiMessage(index) {
    if (get(isAiLoading)) stopStreaming();
    chatHistory.update(h => h.filter((_, i) => i !== index));
}

export function clearChatHistory() {
    stopStreaming();
    chatHistory.set([]);
}

export function clearAiChatHistory() {
    stopStreaming();
    aiChatHistory.set([]);
    clearAiChatComposerAttachments();
    saveAiChatHistory();
}

export async function testAiConnection() {
    const currentConfig = getEffectiveConfig();
    const { testConnection } = await import('../utils/ai-providers.js');
    return await testConnection(currentConfig);
}

export async function getCurrentProvider() {
    const config = get(aiConfig);
    const { getProviderInfo } = await import('../utils/ai-providers.js');
    return getProviderInfo(config.provider);
}

export function confirmSubtaskOperation(index) {
    chatHistory.update(h => {
        const newHistory = [...h];
        if (newHistory[index] && newHistory[index].type === 'subtask_confirm') {
            newHistory[index].confirmed = true;
        }
        return newHistory;
    });
}
