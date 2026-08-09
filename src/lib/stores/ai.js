import { writable, get, derived } from 'svelte/store';
import { isG4FProvider } from '../utils/g4f-client.js';
import {
    looksLikeFileIntent,
    searchLocalFiles,
    readLocalFile,
    writeLocalFile,
    deleteLocalFile,
    pickLocalTextFiles,
    readSelectedTextFiles,
    readPastedFilesAsAttachments,
    isContentUri,
    pickMediaFiles,
    readSelectedMediaFiles,
    getMediaType,
    getFileExtension,
    SUPPORTED_MEDIA_EXTENSIONS,
    isPathCoveredByContentTree
} from '../utils/local-file-tools.js';
import {
    looksLikeWebSearchIntent,
    searchWeb,
    fetchWebContent
} from '../utils/web-search.js';
import { settingsStore } from './settings.js';
import { connectorConfig } from './connector.js';
import { notesStore } from './notes.js';
import { getConnectorBaseUrl, resolveConnectorTransport, getConnectorHttpChatEndpoint } from '../utils/connector-client.js';
import { TASK_STATUSES, TASK_PRIORITIES, resolveStatus, resolvePriority, normalizeStatus, normalizePriority } from '../utils/task-vocabulary.js';

const STORAGE_KEY = 'planpro_ai_config';
const AI_CHAT_HISTORY_KEY = 'planpro_ai_chat_history';
const AI_CHAT_SESSIONS_KEY = 'planpro_ai_chat_sessions';
const PROVIDER_CONFIG_FIELDS = ['apiKey', 'secretKey', 'model', 'customModel', 'customEndpoint', 'accountId'];
const OPTIONAL_API_KEY_PROVIDERS = new Set(['ollama', 'lmstudio', 'custom', 'webhook']);
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

function createId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
        provider: 'g4f-default',
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
    return !isG4FProvider(providerId) && !OPTIONAL_API_KEY_PROVIDERS.has(providerId);
}

function applyConnectorRuntimeConfig(config) {
    if (config.provider !== 'webhook') return config;
    const cfg = get(connectorConfig);
    if (!cfg.enabled) {
        return {
            ...config,
            apiKey: config.apiKey || '',
            customEndpoint: ''
        };
    }
    const transport = resolveConnectorTransport(cfg);
    const base = {
        ...config,
        apiKey: cfg.apiKey || config.apiKey || '',
        connectorTransport: transport,
        connectorPreset: cfg.preset || 'nanobot',
        sessionKey: cfg.sessionKey || '',
        clientId: cfg.clientId || '',
        connectorTimeoutMs: cfg.timeoutMs || 180000,
        timeoutMs: cfg.timeoutMs || 180000,
        baseUrl: cfg.baseUrl || '',
        customHeaders: { ...(config.customHeaders || {}), ...(cfg.headers || {}) }
    };
    if (transport === 'http') {
        const httpEndpoint = getConnectorHttpChatEndpoint(cfg);
        return {
            ...base,
            customEndpoint: httpEndpoint || config.customEndpoint || ''
        };
    }
    const wsBaseUrl = getConnectorBaseUrl(cfg);
    return {
        ...base,
        customEndpoint: wsBaseUrl || config.customEndpoint || '',
        connectorBaseUrl: wsBaseUrl || config.customEndpoint || ''
    };
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

export function stopStreaming() {
    if (_streamAbortController) {
        _streamAbortController.abort();
        _streamAbortController = null;
    }
    isAiLoading.set(false);
    streamingContent.set('');
}
export const pendingTaskOperation = writable(null);
function getDefaultAiChatRuntimeCapabilities() {
    return {
        probed: false,
        probing: false,
        localFilesRuntimeAvailable: null,
        webSearchRuntimeAvailable: null,
        toolCallRuntimeAvailable: null,
        nativeToolCallRuntimeAvailable: null
    };
}

export const aiChatRuntimeCapabilities = writable(getDefaultAiChatRuntimeCapabilities());

function resetAiChatRuntimeCapabilities() {
    aiChatRuntimeCapabilities.set(getDefaultAiChatRuntimeCapabilities());
}
export const aiChatCapabilities = derived(
    [settingsStore, aiConfig, aiChatRuntimeCapabilities, connectorConfig],
    ([$settings, $config, $runtime, $connectorConfig]) => {
        const needsApiKey = providerNeedsApiKey($config.provider);
        const connectorReady = $config.provider !== 'webhook' ||
            ($connectorConfig.enabled && Boolean($connectorConfig.baseUrl));
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
            connectionReady: connectorReady && (!needsApiKey || Boolean($config.apiKey)),
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

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('get_workspace_root');
        localFilesOk = true;
    } catch {
        localFilesOk = false;
    }

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('search_web', { query: 'test', maxResults: 1 });
        webSearchOk = true;
    } catch (e) {
        const errMsg = String(e?.message || e || '').toLowerCase();
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
        }
    } catch (e) {
        console.warn('[Probe] tool call probe failed:', e?.message || e);
        toolCallOk = false;
    }

    if (toolCallOk) {
        try {
            const config = getEffectiveConfig();
            const { canProviderUseNativeTools, callAIWithMessagesAndTools } = await import('../utils/ai-providers.js');
            if (!canProviderUseNativeTools(config.provider, config)) {
                nativeToolCallOk = false;
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
            }
        } catch (e) {
            console.warn('[Probe] native tool call probe failed:', e?.message || e);
            nativeToolCallOk = false;
        }
    } else if (nativeToolCallOk === null) {
        nativeToolCallOk = false;
    }

    aiChatRuntimeCapabilities.set({
        probed: true,
        probing: false,
        localFilesRuntimeAvailable: localFilesOk,
        webSearchRuntimeAvailable: webSearchOk,
        toolCallRuntimeAvailable: toolCallOk,
        nativeToolCallRuntimeAvailable: nativeToolCallOk
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
const AI_PASSIVE_CONTEXT_LIMIT = 8;
const AI_PROJECT_SUMMARY_LIMIT = 6;
const AI_LARGE_TASK_CONTEXT_THRESHOLD = 1000;

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

    // 兼容旧存档：OpenClaw provider 已移除，把 localStorage 里残留的 'openclaw'
    // 及其缓存的 providerConfigs 迁移到通用 webhook 连接器。仅为升级旧配置而存在。
    if (normalized.provider === 'openclaw') {
        normalized.provider = 'webhook';
    }
    if (normalized.providerConfigs?.openclaw && !normalized.providerConfigs.webhook) {
        normalized.providerConfigs = {
            ...normalized.providerConfigs,
            webhook: normalized.providerConfigs.openclaw
        };
    }

    normalized.id = normalized.id || createId('profile');
    normalized.name = normalized.name || `连接 ${index + 1}`;
    normalized.provider = normalized.provider || 'g4f-default';
    normalized.model = normalized.model || 'auto';
    normalized.providerConfigs = normalized.providerConfigs || {};
    normalized.createdAt = normalized.createdAt || new Date().toISOString();
    normalized.updatedAt = normalized.updatedAt || normalized.createdAt;
    return normalized;
}

function createConnectionProfileFromState(state, overrides = {}) {
    const profile = normalizeConnectionProfile({
        ...extractProviderConfigFromAiConfig(state),
        provider: state.provider || 'g4f-default',
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
    const providerId = profile.provider || 'g4f-default';
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
    const providerId = nextState.provider || activeProfile.provider || 'g4f-default';
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
    const providerId = current.provider || 'g4f-default';
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
    const providerId = current.provider || 'g4f-default';
    const providerInfo = await getProviderInfoCached(providerId);
    const latest = get(aiConfig);
    if ((latest.provider || 'g4f-default') !== providerId) return;

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
    const prevProviderId = current.provider || 'g4f-default';
    if (prevProviderId === newProviderId) return;
    resetAiChatRuntimeCapabilities();

    const providerConfigsUpdated = mergeProviderConfigs(current.providerConfigs, prevProviderId, current);

    const newProviderInfo = await getProviderInfoCached(newProviderId);
    const cached = providerConfigsUpdated[newProviderId] || null;
    const merged = cached ? { ...getDefaultProviderConfig(), ...cached } : getDefaultProviderConfig();

    const normalizedModel = await normalizeProviderModel(newProviderId, newProviderInfo, merged);

    const latest = get(aiConfig);
    if ((latest.provider || 'g4f-default') !== prevProviderId) return;
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
                    provider: parsed.provider || 'g4f-default',
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
            const parsedSessions = JSON.parse(savedSessions);
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
        dailyReportPrompt: nextState.dailyReportPrompt,
        weeklyReportPrompt: nextState.weeklyReportPrompt,
        connectionProfiles: nextState.connectionProfiles
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    setAiConfigIfChanged(nextState);
    saveApiKeyToPasswords(nextState.provider, nextState, nextState.activeProfileName);
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
        return applyProfileToState({
            ...current,
            connectionProfiles: profiles,
            activeProfileId: nextActiveId
        }, nextActiveId);
    });
}

async function saveApiKeyToPasswords(providerId, config, profileName = '') {
    if (typeof window === 'undefined') return;

    const settingsStr = localStorage.getItem('planpro_system_settings');
    if (!settingsStr) return;

    try {
        const settings = JSON.parse(settingsStr);
        if (!settings.autoSaveApiKey) return;
    } catch {
        return;
    }

    const apiKey = config.apiKey;
    if (!apiKey || !apiKey.trim()) return;

    try {
        const { passwordsStore, isPasswordsUnlocked } = await import('./passwords.js');
        const { get: storeGet } = await import('svelte/store');

        const unlocked = storeGet(isPasswordsUnlocked);
        if (!unlocked) return;

        const { getProviderInfo } = await import('../utils/ai-providers.js');
        const providerInfo = getProviderInfo(providerId);
        const providerName = providerInfo?.name || providerId;
        const cleanProfile = String(profileName || '').trim();
        const title = cleanProfile && cleanProfile !== '默认连接'
            ? `${providerName} · ${cleanProfile} API Key`
            : `${providerName} API Key`;
        const endpointSuffix = config.customEndpoint ? ` (${config.customEndpoint})` : '';
        const username = `${providerId}${endpointSuffix}`;

        const existingPasswords = storeGet(passwordsStore).passwords;
        const existingEntry = existingPasswords.find(p =>
            p.category === 'API密钥' &&
            p.title === title &&
            p.username === username
        );

        if (existingEntry) {
            const decrypted = passwordsStore.decryptPassword(existingEntry.password);
            if (decrypted !== apiKey) {
                passwordsStore.updatePassword(existingEntry.id, {
                    password: apiKey,
                    notes: `由 AI 设置自动同步\n更新时间: ${new Date().toLocaleString()}`
                });
            }
        } else {
            passwordsStore.addPassword({
                title,
                username,
                password: apiKey,
                url: config.customEndpoint || providerInfo?.apiUrl || '',
                category: 'API密钥',
                notes: `由 AI 设置自动同步\n连接：${cleanProfile || '默认'}\n创建时间: ${new Date().toLocaleString()}`
            });
        }
    } catch (e) {
        console.warn('Failed to save API key to passwords:', e);
    }
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

export function saveAiChatHistory() {
    if (typeof window === 'undefined') return;
    const history = get(aiChatHistory);
    const sessions = syncAiChatSessionHistory(history);
    const activeSessionId = get(activeAiChatSessionId);
    localStorage.setItem(AI_CHAT_HISTORY_KEY, JSON.stringify(history.slice(-100)));
    localStorage.setItem(AI_CHAT_SESSIONS_KEY, JSON.stringify({
        activeSessionId,
        sessions
    }));
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
        maxBytes: 10_000_000,
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

    aiChatComposerAttachments.update((current) => {
        const merged = normalizeChatAttachments([...(current || []), ...files]);
        return merged.slice(0, 8);
    });

    return files;
}

export async function attachPastedFilesToAiChatComposer(fileList) {
    const files = normalizeChatAttachments(await readPastedFilesAsAttachments(fileList, {
        textMaxBytes: 96000,
        mediaMaxBytes: 10_000_000
    }));
    if (!files.length) {
        return [];
    }

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
    aiPanelContext.set(getDefaultAiPanelContext());
}

export function configureAiPanel(context = {}, clearHistory = false) {
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
            const models = await fetchProviderModels(providerId, apiKey, customEndpoint);
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
    return applyConnectorRuntimeConfig({
        provider: config.provider,
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        model: isCustom ? (config.customModel || 'auto') : (config.model || 'auto'),
        customModel: config.customModel,
        customEndpoint: config.customEndpoint,
        accountId: config.accountId,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        customHeaders: config.customHeaders,
        dailyReportPrompt: config.dailyReportPrompt,
        weeklyReportPrompt: config.weeklyReportPrompt
    });
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

function formatFullTaskForAI(task) {
    const dateInfo = getDateInfo();
    const rawDate = task.date ? task.date.split('T')[0] : '';
    const taskDate = rawDate ? parseDateOnlyToLocal(rawDate) : null;
    let relativeDay = '无日期';
    if (taskDate && !Number.isNaN(taskDate.getTime())) {
        if (taskDate.getTime() === dateInfo.today.getTime()) {
            relativeDay = '今天';
        } else if (taskDate.getTime() === dateInfo.tomorrow.getTime()) {
            relativeDay = '明天';
        } else if (taskDate.getTime() === dateInfo.dayAfterTomorrow.getTime()) {
            relativeDay = '后天';
        } else if (taskDate.getTime() === dateInfo.yesterday.getTime()) {
            relativeDay = '昨天';
        } else if (taskDate.getTime() === dateInfo.dayBeforeYesterday.getTime()) {
            relativeDay = '前天';
        } else {
            relativeDay = formatDateForAI(taskDate);
        }
    }
    const priorityMap = { normal: '普通', urgent: '紧急', critical: '特急' };
    const statusMap = { todo: '未开始', doing: '进行中', done: '已完成' };
    let subtasksStr = '';
    if (task.subtasks && task.subtasks.length > 0) {
        subtasksStr = `\n    子任务: ${task.subtasks.map(s => `[${s.status === 'done' ? '✓' : '○'}]${s.title}`).join(', ')}`;
    }
    const repeatDays = Array.isArray(task.repeatDays) && task.repeatDays.length > 0
        ? ` | 重复:${task.repeatDays.join(',')}`
        : '';
    const enabledState = typeof task.enabled === 'boolean'
        ? ` | 启用:${task.enabled ? '是' : '否'}`
        : '';
    const timeText = task.date?.split('T')[1] || '';
    return `[ID:${task.id}] "${task.title}" | ${relativeDay}${timeText ? ` ${timeText}` : ''} | 状态:${statusMap[task.status] || '未开始'} | 优先级:${priorityMap[task.priority] || '普通'}${repeatDays}${enabledState}${task.deadline ? ` | 截止:${task.deadline}` : ''}${task.note ? ` | 备注:${task.note}` : ''}${subtasksStr}`;
}

function formatTemplateForAI(template) {
    const priorityMap = { normal: '普通', urgent: '紧急', critical: '特急' };
    const statusMap = { todo: '未开始', doing: '进行中', done: '已完成' };
    let subtasksStr = '';
    if (template.subtasks && template.subtasks.length > 0) {
        subtasksStr = `\n    子任务: ${template.subtasks.map(item => `[${item.status === 'done' ? '✓' : '○'}]${item.title}`).join(', ')}`;
    }
    return `[ID:${template.id}] "${template.title}" | 状态:${statusMap[template.status] || '未开始'} | 优先级:${priorityMap[template.priority] || '普通'}${template.note ? ` | 备注:${template.note}` : ''}${subtasksStr}`;
}

function formatItemsForAI(items = [], formatter) {
    const sourceItems = Array.isArray(items) ? items : [];
    return sourceItems.map(item => formatter(item)).join('\n');
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

const DELETE_KEYWORDS = [
    '删除', '删掉', '取消', '移除', '去掉', '不要了', '作废', '清除', '干掉',
    'delete', 'remove', 'cancel', 'clear', 'drop'
];
const UPDATE_KEYWORDS = [
    '修改', '更改', '改成', '改为', '调整', '推迟', '提前', '延后', '延期',
    '变更', '换成', '改到', '挪到', '移到', '调到', '换到',
    '完成', '已完成', '标记完成', '完成了', '做完了', '搞定了',
    'change', 'update', 'modify', 'reschedule', 'postpone', 'move',
    'complete', 'done', 'finish'
];
const QUERY_KEYWORDS = [
    '查询', '查看', '搜索', '找', '有什么', '哪些', '列出', '显示', '查一下',
    '看看', '告诉我', '有没有', '是否有', '什么任务',
    '什么时候', '何时', '哪天', '哪日', '哪月', '哪一年', '做了什么', '干了什么',
    'query', 'search', 'find', 'list', 'show', 'what'
];
const CREATE_KEYWORDS = ['新增', '添加', '创建', '新建', '加个', '帮我加', 'add', 'create', 'new'];
// 内容/变更动词（不含查询动词）。用于判断一句话是否在罗列"要做/已做的多项工作内容"，
// 从而与"对现有任务的批量增删改命令"区分开。
const MULTI_ACTION_VERBS = [
    '修改', '更改', '更新', '删除', '删掉', '去掉', '移除', '整理', '撰写', '编写',
    '提交', '发布', '发表', '上线', '核对', '检查', '联系', '跟进', '处理', '制作',
    '完成', '搞定', '录入', '添加'
];
const TASK_LOOKUP_QUESTION_REGEX = /(什么时候|何时|哪天|哪日|哪月|哪一年|做了什么|干了什么|什么时候做|什么时候干)/;

const SUBTASK_KEYWORDS = [
    '子任务', '子步骤', '步骤', '小任务', '分解', '拆分',
    'subtask', 'step', 'sub-task'
];

const SUBTASK_ADD_KEYWORDS = ['添加子任务', '新增子任务', '加个子任务', '添加步骤', '新增步骤'];
const SUBTASK_DELETE_KEYWORDS = ['删除子任务', '移除子任务', '去掉子任务', '删除步骤'];
const SUBTASK_UPDATE_KEYWORDS = ['修改子任务', '更改子任务', '改子任务', '修改步骤'];
const CHAT_ASSISTANT_CONTEXT_SCOPES = new Set(['dashboard', 'templates', 'scheduled', 'statistics', 'notes', 'project']);
const PROJECT_CHAT_KEYWORDS = [
    '任务', '看板', '模板', '定时', '统计', '子任务', '笔记',
    'priority', 'deadline', 'subtask', 'task', 'tasks', 'template',
    'templates', 'schedule', 'scheduled', 'kanban', 'note', 'notes'
];
const PROJECT_ANALYSIS_KEYWORDS = [
    '总结', '汇总', '复盘', '统计', '分析', '日报', '周报', '月报', '进展',
    '完成情况', 'report', 'summary', 'review', 'progress', 'analysis'
];
const NATURAL_TASK_ACTION_KEYWORDS = [
    '安排', '提醒', '记得', '跟进', '处理', '提交', '开会', '会议', '沟通', '拜访',
    '面试', '复盘', '汇报', '发布', '上线', '整理', '采购', '报销', 'review',
    'meeting', 'call', 'sync', 'submit', 'follow up', 'follow-up', 'remind'
];
const TIME_REFERENCE_REGEX = /(今天|明天|后天|今晚|今早|上午|中午|下午|傍晚|晚上|本周|下周|本月|下个月|周一|周二|周三|周四|周五|周六|周日|\b(today|tomorrow|tonight|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\d{1,2}\s*点(\d{1,2}分)?)/i;
const SOURCE_KEYWORD_MAP = {
    scheduled: ['定时', '周期', '每周', '每天', '重复', 'scheduled', 'schedule', 'recurring'],
    templates: ['模板', '模版', 'template', 'templates'],
    notes: ['笔记', '便签', 'note', 'notes'],
    tasks: ['任务', '看板', 'task', 'tasks', 'kanban']
};

function detectSubtaskOperation(text) {
    const lowerText = text.toLowerCase();
    for (const kw of SUBTASK_ADD_KEYWORDS) {
        if (lowerText.includes(kw)) return 'add_subtask';
    }
    for (const kw of SUBTASK_DELETE_KEYWORDS) {
        if (lowerText.includes(kw)) return 'delete_subtask';
    }
    for (const kw of SUBTASK_UPDATE_KEYWORDS) {
        if (lowerText.includes(kw)) return 'update_subtask';
    }
    for (const kw of SUBTASK_KEYWORDS) {
        if (lowerText.includes(kw)) return 'subtask_general';
    }
    return null;
}

function looksLikeProjectIntent(text = '') {
    const lowerText = String(text).toLowerCase();
    const hasProjectKeyword = PROJECT_CHAT_KEYWORDS.some(keyword => lowerText.includes(keyword));
    const hasActionKeyword = DELETE_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase())) ||
        UPDATE_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase())) ||
        QUERY_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase())) ||
        SUBTASK_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase())) ||
        ['新增', '添加', '创建', '新建', '整理', '汇总', '总结', '复盘', '统计', 'report'].some(keyword => lowerText.includes(keyword));
    const hasAnalysisKeyword = PROJECT_ANALYSIS_KEYWORDS.some(keyword => lowerText.includes(keyword));
    return (hasProjectKeyword && hasActionKeyword) ||
        looksLikeNaturalTaskIntent(text) ||
        (hasAnalysisKeyword && (hasProjectKeyword || TIME_REFERENCE_REGEX.test(text)));
}

function looksLikeNaturalTaskIntent(text = '') {
    const lowerText = String(text).toLowerCase();
    const hasTimeHint = TIME_REFERENCE_REGEX.test(text);
    const hasActionHint = NATURAL_TASK_ACTION_KEYWORDS.some(keyword => lowerText.includes(keyword));
    const hasImperativeHint = /(帮我|请帮我|记一下|安排一下|提醒我|创建一个|新建一个|add|create|schedule|remind)/i.test(text);
    const hasEventLikePattern = /(会议|开会|跟进|提交|汇报|提醒|面试|复盘|付款|报销|review|meeting|call|sync)/i.test(text);

    return (hasTimeHint && (hasActionHint || hasImperativeHint || hasEventLikePattern)) ||
        (hasImperativeHint && hasEventLikePattern);
}

function detectAssistantSourceFromText(text = '', fallbackSource = 'tasks') {
    const lowerText = String(text).toLowerCase();
    for (const [source, keywords] of Object.entries(SOURCE_KEYWORD_MAP)) {
        if (keywords.some(keyword => lowerText.includes(keyword))) {
            return source;
        }
    }
    return fallbackSource || 'tasks';
}

function getAssistantMetaBySource(source = 'tasks') {
    if (source === 'templates') {
        return {
            scope: 'templates',
            title: '任务模板 AI',
            description: '当前对话将优先处理任务模板相关操作与问答。',
            entityLabel: '任务模板'
        };
    }
    if (source === 'scheduled') {
        return {
            scope: 'scheduled',
            title: '定时任务 AI',
            description: '当前对话将优先处理定时任务、周期规则与提醒计划。',
            entityLabel: '定时任务'
        };
    }
    if (source === 'notes') {
        return {
            scope: 'notes',
            title: '工作笔记 AI',
            description: '当前对话将优先处理工作笔记内容。',
            entityLabel: '笔记'
        };
    }
    return {
        scope: 'project',
        title: '项目 AI',
        description: '当前对话可操作任务看板并结合整个项目上下文回答。',
        entityLabel: '任务'
    };
}

// "强信号"判断：消息是否在指代已存在的任务（而非描述要新建/记录的工作内容）。
// 避免把"今天需要修改文章状态、删除某文章信息"这类工作描述误判为对任务列表的增删改。
function referencesExistingTask(text = '') {
    return /任务|待办|todo|task/i.test(text) ||
        /(这个|那个|这些|那些|这条|那条|这项|那项|上面|下面|前面|刚才|刚刚|第[一二三四五六七八九十百\d]+\s*(个|条|项)?)/.test(text) ||
        /(把|将|给)\s*\S{0,16}?(删除|删掉|去掉|移除|取消|改成|改为|标记|完成|调整|推迟|延期)/.test(text);
}

// "强信号"判断：消息是否在用计划/安排语气描述"要去做的新工作"，
// 其中的"修改/删除/完成"等是工作内容，而非对现有任务的命令。
function looksLikePlannedWorkCreate(text = '') {
    return /(需要|要|打算|计划|准备|安排)\s*\S{0,12}?(做|处理|完成|搞定|修改|删除|删掉|更新|整理|撰写|编写|写|改|提交|发布|发表|上线|核对|检查|联系|跟进)/.test(text);
}

// 统计文本中出现的不同内容动词数量（重复同一动词只计一次）。
function countDistinctActionVerbs(text = '') {
    const lower = String(text || '').toLowerCase();
    let count = 0;
    for (const verb of MULTI_ACTION_VERBS) {
        if (lower.includes(verb.toLowerCase())) count += 1;
    }
    return count;
}

// "强信号"判断：消息是否在补录/记录"已经做完的工作"（应新建为已完成任务，而非修改现有任务）。
function isRetroactiveLogIntent(text = '') {
    return /(补录|补记|记录一下|录入|补上|补一下|登记)/i.test(text) ||
        (/(补充|新增|添加|创建|记录|登记)[^，。；、\n]{0,10}(任务|待办|工作|事项|事情|内容|项)/.test(text) &&
         /(已经?完成|完成了|做完|搞定|已搞定|已做完)/.test(text)) ||
        (/(昨天|前天|上周|上个月|之前|刚才|刚刚)\S{0,6}(完成|搞定|做完|结束|弄好|修改|处理|提交|写完|发布)/i.test(text) &&
         !/(哪个|哪些|什么|查|找|列出|显示|把|将|标记)/.test(text));
}

function detectOperationType(text) {
    const lowerText = text.toLowerCase();
    const hasCreateIntent = CREATE_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase())) ||
        /(安排|提醒|记得|帮我安排|请安排|schedule|remind)/i.test(text);
    const isRetroactiveLog = isRetroactiveLogIntent(text);
    if (isRetroactiveLog) {
        return 'create';
    }
    if (!hasCreateIntent && looksLikeTaskAnalysisRequest(text)) {
        return 'query';
    }
    // 计划语气描述的新工作（且未指代已有任务）→ 视为新建，
    // 避免"修改/删除/完成"等内容动词被误判为对任务列表的批量操作。
    if (looksLikePlannedWorkCreate(text) && !referencesExistingTask(text)) {
        return 'create';
    }
    // 一句话罗列 >=2 个不同内容动词且未指代现有任务 → 视为"工作清单/记录"而非对现有任务的批量增删改。
    if (countDistinctActionVerbs(text) >= 2 && !referencesExistingTask(text)) {
        return 'create';
    }
    let deleteScore = 0;
    let updateScore = 0;
    let queryScore = 0;
    if (lowerText.includes('完成') || lowerText.includes('搞定') ||
        lowerText.includes('做完') || lowerText.includes('complete') ||
        lowerText.includes('done') || lowerText.includes('finish')) {
        updateScore += 3;
    }
    for (const keyword of DELETE_KEYWORDS) {
        if (lowerText.includes(keyword.toLowerCase())) {
            deleteScore += 2;
        }
    }
    for (const keyword of UPDATE_KEYWORDS) {
        if (lowerText.includes(keyword.toLowerCase())) {
            updateScore += 2;
        }
    }
    for (const keyword of QUERY_KEYWORDS) {
        if (lowerText.includes(keyword.toLowerCase())) {
            queryScore += 2;
        }
    }
    if (lowerText.includes('不做') || lowerText.includes('不用做') || lowerText.includes('暂时不')) {
        deleteScore += 1;
    }
    if (deleteScore > 0 && updateScore > 0) {
        return 'mixed';
    }
    if (deleteScore > updateScore && deleteScore > queryScore) {
        return 'delete';
    }
    if (updateScore > deleteScore && updateScore > queryScore) {
        return 'update';
    }
    if (queryScore > deleteScore && queryScore > updateScore) {
        return 'query';
    }
    return 'create';
}

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

function getMonthRange(date) {
    const d = new Date(date);
    return {
        startDate: startOfDay(new Date(d.getFullYear(), d.getMonth(), 1)),
        endDate: endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0))
    };
}

function normalizeTimeScope({ startDate, endDate, explicit = true, rangeType = 'range', mentionedDate = null } = {}) {
    return {
        explicit,
        rangeType,
        mentionedDate: mentionedDate ? startOfDay(mentionedDate) : (startDate ? startOfDay(startDate) : null),
        startDate: startDate ? startOfDay(startDate) : null,
        endDate: endDate ? endOfDay(endDate) : null
    };
}

function getDefaultTaskTimeScope(dateInfo) {
    return normalizeTimeScope({
        explicit: false,
        rangeType: 'default',
        startDate: dateInfo.lastMonth.start,
        endDate: dateInfo.nextMonth.end,
        mentionedDate: dateInfo.today
    });
}

function getMonthToCurrentScope(mentionedDate, dateInfo) {
    const monthRange = getMonthRange(mentionedDate);
    const mentionedDay = startOfDay(mentionedDate);
    const today = startOfDay(dateInfo.today);

    if (mentionedDay <= today) {
        return normalizeTimeScope({
            startDate: monthRange.startDate,
            endDate: dateInfo.today,
            explicit: true,
            rangeType: 'month_to_current',
            mentionedDate
        });
    }

    return normalizeTimeScope({
        startDate: monthRange.startDate,
        endDate: monthRange.endDate,
        explicit: true,
        rangeType: 'month',
        mentionedDate
    });
}

function extractExplicitDateMentions(text = '', dateInfo = getDateInfo()) {
    const mentions = [];
    const used = [];
    const addMention = (index, length, startDate, endDate, rangeType = 'day') => {
        if (used.some(([start, end]) => index < end && index + length > start)) return;
        used.push([index, index + length]);
        mentions.push({
            index,
            startDate: startOfDay(startDate),
            endDate: endOfDay(endDate || startDate),
            mentionedDate: startOfDay(startDate),
            rangeType
        });
    };

    const patterns = [
        {
            regex: /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/g,
            parse: (m) => ({ date: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), type: 'day' })
        },
        {
            regex: /(\d{4})[-/.年](\d{1,2})月?/g,
            parse: (m) => ({ date: new Date(Number(m[1]), Number(m[2]) - 1, 1), type: 'month' })
        },
        {
            regex: /(\d{1,2})月(\d{1,2})日?/g,
            parse: (m) => ({ date: new Date(dateInfo.today.getFullYear(), Number(m[1]) - 1, Number(m[2])), type: 'day' })
        },
        {
            regex: /(\d{1,2})月/g,
            parse: (m) => ({ date: new Date(dateInfo.today.getFullYear(), Number(m[1]) - 1, 1), type: 'month' })
        }
    ];

    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern.regex)) {
            const parsed = pattern.parse(match);
            if (!parsed.date || Number.isNaN(parsed.date.getTime())) continue;
            if (parsed.type === 'month') {
                const monthRange = getMonthRange(parsed.date);
                addMention(match.index || 0, match[0].length, monthRange.startDate, monthRange.endDate, 'month');
            } else {
                addMention(match.index || 0, match[0].length, parsed.date, parsed.date, 'day');
            }
        }
    }

    return mentions.sort((a, b) => a.index - b.index);
}

function detectTimeScope(text, dateInfo) {
    const lowerText = text.toLowerCase();
    const defaultScope = getDefaultTaskTimeScope(dateInfo);
    let scope = null;

    if (lowerText.includes('昨天')) {
        scope = normalizeTimeScope({ startDate: dateInfo.yesterday, endDate: dateInfo.yesterday, rangeType: 'day' });
    } else if (lowerText.includes('前天')) {
        scope = normalizeTimeScope({ startDate: dateInfo.dayBeforeYesterday, endDate: dateInfo.dayBeforeYesterday, rangeType: 'day' });
    } else if (lowerText.includes('今天') || lowerText.includes('今日')) {
        scope = normalizeTimeScope({ startDate: dateInfo.today, endDate: dateInfo.today, rangeType: 'day' });
    } else if (lowerText.includes('明天') && lowerText.includes('后天')) {
        scope = normalizeTimeScope({ startDate: dateInfo.tomorrow, endDate: dateInfo.dayAfterTomorrow, rangeType: 'range' });
    } else if (lowerText.includes('明天')) {
        scope = normalizeTimeScope({ startDate: dateInfo.tomorrow, endDate: dateInfo.tomorrow, rangeType: 'day' });
    } else if (lowerText.includes('后天')) {
        scope = normalizeTimeScope({ startDate: dateInfo.dayAfterTomorrow, endDate: dateInfo.dayAfterTomorrow, rangeType: 'day' });
    } else if (lowerText.includes('上周') || lowerText.includes('上一周')) {
        scope = normalizeTimeScope({ startDate: dateInfo.lastWeek.start, endDate: dateInfo.lastWeek.end, rangeType: 'week' });
    } else if (lowerText.includes('下周') || lowerText.includes('下一周')) {
        scope = normalizeTimeScope({ startDate: dateInfo.nextWeek.start, endDate: dateInfo.nextWeek.end, rangeType: 'week' });
    } else if (lowerText.includes('本周') || lowerText.includes('这周') || lowerText.includes('整周')) {
        scope = normalizeTimeScope({ startDate: dateInfo.thisWeek.start, endDate: dateInfo.thisWeek.end, rangeType: 'week' });
    } else if (lowerText.includes('上个月') || lowerText.includes('上月')) {
        scope = normalizeTimeScope({ startDate: dateInfo.lastMonth.start, endDate: dateInfo.lastMonth.end, rangeType: 'month' });
    } else if (lowerText.includes('下个月') || lowerText.includes('下月')) {
        scope = normalizeTimeScope({ startDate: dateInfo.nextMonth.start, endDate: dateInfo.nextMonth.end, rangeType: 'month' });
    } else if (lowerText.includes('本月') || lowerText.includes('这个月') || lowerText.includes('整月')) {
        scope = normalizeTimeScope({ startDate: dateInfo.thisMonth.start, endDate: dateInfo.thisMonth.end, rangeType: 'month' });
    }

    const explicitMentions = extractExplicitDateMentions(text, dateInfo);
    const rangeRequested = /(到|至|--|—|-|~|～)/.test(text);
    const untilNowRequested = /(至今|到现在|到今天|到目前|截止目前|以来)/.test(text);
    if (explicitMentions.length >= 2 && rangeRequested) {
        const first = explicitMentions[0];
        const last = explicitMentions[explicitMentions.length - 1];
        scope = normalizeTimeScope({
            startDate: first.startDate <= last.startDate ? first.startDate : last.startDate,
            endDate: first.endDate >= last.endDate ? first.endDate : last.endDate,
            rangeType: 'range',
            mentionedDate: first.mentionedDate
        });
    } else if (explicitMentions.length >= 1) {
        const mention = explicitMentions[0];
        if (untilNowRequested) {
            const monthRange = getMonthRange(mention.mentionedDate);
            scope = normalizeTimeScope({
                startDate: monthRange.startDate,
                endDate: dateInfo.today,
                rangeType: 'range',
                mentionedDate: mention.mentionedDate
            });
        } else {
            scope = normalizeTimeScope(mention);
        }
    }

    return scope || defaultScope;
}

function getTaskScopeForContext(tasks = [], timeScope = getDefaultTaskTimeScope(getDateInfo()), dateInfo = getDateInfo(), options = {}) {
    const scope = timeScope || getDefaultTaskTimeScope(dateInfo);
    if (options.mode !== 'ai_context') {
        return scope;
    }

    if (!scope.explicit || !scope.mentionedDate) {
        return scope;
    }

    if (
        Array.isArray(tasks) &&
        tasks.length >= AI_LARGE_TASK_CONTEXT_THRESHOLD &&
        (scope.rangeType === 'day' || scope.rangeType === 'month')
    ) {
        return {
            ...normalizeTimeScope({
                ...getMonthRange(scope.mentionedDate),
                explicit: true,
                rangeType: 'month',
                mentionedDate: scope.mentionedDate
            }),
            narrowedForLargeDataset: true
        };
    }

    if (scope.rangeType === 'day') {
        return getMonthToCurrentScope(scope.mentionedDate, dateInfo);
    }

    return scope;
}

function filterTasksByTimeScope(tasks, timeScope) {
    if (!tasks || tasks.length === 0) return [];
    return tasks.filter(task => {
        const taskDate = getTaskDateOnly(task);
        if (!taskDate) {
            return !timeScope.explicit;
        }
        if (timeScope.startDate && timeScope.endDate) {
            return taskDate >= timeScope.startDate && taskDate <= timeScope.endDate;
        }
        return true;
    });
}

function getTimeScopedItems(assistantContext, timeScope, dateInfo, options = {}) {
    const items = assistantContext.items || [];
    const effectiveScope = getTaskScopeForContext(
        items,
        timeScope || getDefaultTaskTimeScope(dateInfo),
        dateInfo,
        options
    );
    return assistantContext.source === 'tasks'
        ? filterTasksByTimeScope(items, effectiveScope)
        : items;
}

function normalizeSearchText(value = '') {
    return String(value || '')
        .toLowerCase()
        .replace(/[，。！？、；;,.!?()[\]{}"'“”‘’`~～:：/\\|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getTaskSearchText(task = {}) {
    return normalizeSearchText([
        task.title || '',
        task.note || '',
        task.date || '',
        task.deadline || '',
        task.status || '',
        task.priority || '',
        ...(Array.isArray(task.subtasks) ? task.subtasks.map(item => item?.title || '') : [])
    ].join(' '));
}

function looksLikeTaskAnalysisRequest(text = '') {
    const lowerText = String(text || '').toLowerCase();
    // 真正的"分析/汇总/复盘"意图动词。
    const hasAnalysisVerb = /(分析|总结|汇总|统计|复盘|趋势|占比|完成率|完成情况|report|summary|analysis|review|progress)/i.test(lowerText);
    if (hasAnalysisVerb) return true;
    // 日报/周报/月报/报告/进展 等常作为任务主体的名词，单独出现不算分析意图，
    // 需配合"看看/查询/有哪些/情况"等查阅意图，才视为分析查询（避免"删除周报任务""把周报改成下周"被误判为 query）。
    const hasReportNoun = /(日报|周报|月报|报告|进展)/.test(lowerText);
    const hasViewIntent = /(看看|查看|看一下|查一下|查询|有哪些|多少|情况|进度|怎么样|如何|是否)/.test(lowerText);
    return hasReportNoun && hasViewIntent;
}

function looksLikeSingleTaskLookup(text = '', operationType = '') {
    const lowerText = String(text || '').toLowerCase();
    const hasReferenceLookup = /(参照|参考|对照)/.test(lowerText);
    const hasMutationKeyword = CREATE_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase())) ||
        DELETE_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase())) ||
        UPDATE_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase()));
    if (operationType !== 'query' && !(hasReferenceLookup && !hasMutationKeyword)) return false;
    if (looksLikeTaskAnalysisRequest(text)) return false;
    if (/(全部|所有|列表|列出|显示|有哪些|多少|几项|所有任务|全部任务)/.test(lowerText)) return false;
    return hasReferenceLookup ||
        TASK_LOOKUP_QUESTION_REGEX.test(lowerText) ||
        /(查.*任务|查询.*任务|搜索.*任务|找.*任务|有没有.*任务|是否有.*任务)/.test(lowerText) ||
        Boolean(extractQuotedSegment(text));
}

function extractTaskLookupKeywords(text = '') {
    const quoted = extractQuotedSegment(text);
    if (quoted) return [normalizeSearchText(quoted)].filter(Boolean);

    const cleaned = normalizeSearchText(text)
        .replace(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/g, ' ')
        .replace(/(\d{4})[-/.年](\d{1,2})月?/g, ' ')
        .replace(/(\d{1,2})月(\d{1,2})日?/g, ' ')
        .replace(/(\d{1,2})月/g, ' ')
        .replace(/(今天|今日|明天|后天|昨天|前天|本周|这周|上周|下周|本月|这个月|上月|上个月|下月|下个月|上午|中午|下午|晚上|今晚|早上|凌晨|周一|周二|周三|周四|周五|周六|周日)/g, ' ')
        .replace(/(查询|查看|搜索|查一下|找一下|找|告诉我|有没有|是否有|参照|参考|对照|类似|相似|上次|之前|以前|任务|事项|安排|什么时候|何时|哪天|哪日|哪月|哪一年|什么|做了什么|干了什么|做的|干的|完成|已完成|搞定|处理|执行|进行|关于|有关|分析|总结|汇总|统计|复盘|报告|日报|周报|月报|这些|相关|的|了|吗|呢|请|帮我|一下)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return cleaned
        .split(/\s+/)
        .map(item => item.trim())
        .filter(item => item.length >= 2);
}

function searchTasksLocally(tasks = [], keywords = []) {
    const normalizedKeywords = keywords
        .map(item => normalizeSearchText(item))
        .filter(Boolean);
    if (!Array.isArray(tasks) || normalizedKeywords.length === 0) return [];

    return tasks
        .map(task => {
            const title = normalizeSearchText(task.title || '');
            const note = normalizeSearchText(task.note || '');
            const subtaskText = normalizeSearchText((task.subtasks || []).map(item => item?.title || '').join(' '));
            const fullText = getTaskSearchText(task);
            let score = 0;
            for (const keyword of normalizedKeywords) {
                if (title.includes(keyword)) score += 8;
                if (note.includes(keyword)) score += 3;
                if (subtaskText.includes(keyword)) score += 2;
                if (fullText.includes(keyword)) score += 1;
            }
            return { task, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const aTime = getTaskDateOnly(a.task)?.getTime() || 0;
            const bTime = getTaskDateOnly(b.task)?.getTime() || 0;
            return bTime - aTime;
        })
        .map(item => item.task);
}

function tryResolveLocalTaskLookup(userText, allTasks = [], relevantTasks = [], operationType = '', timeScope = null) {
    if (!looksLikeSingleTaskLookup(userText, operationType)) return null;
    const keywords = extractTaskLookupKeywords(userText);
    if (keywords.length === 0) return null;

    const baseTasks = timeScope?.explicit ? relevantTasks : allTasks;
    const matchedTasks = searchTasksLocally(baseTasks, keywords);
    if (matchedTasks.length === 0) {
        return {
            role: 'assistant',
            type: 'text',
            content: '本地任务检索没有找到匹配项。请补充更具体的任务标题、关键词或时间。'
        };
    }

    return {
        role: 'assistant',
        type: 'query_result',
        tasks: matchedTasks,
        summary: `本地检索到 ${matchedTasks.length} 个匹配任务。`,
        filterDescription: `关键词：${keywords.join('、')}。未向 AI 提交完整任务列表。`
    };
}

function getTaskCandidatesForAI(userText, allTasks = [], relevantTasks = [], operationType = '', timeScope = null) {
    if (operationType !== 'query' && !looksLikeTaskAnalysisRequest(userText)) {
        return relevantTasks;
    }
    if (looksLikeSingleTaskLookup(userText, operationType)) {
        return relevantTasks;
    }

    const keywords = extractTaskLookupKeywords(userText);
    if (keywords.length === 0) {
        return relevantTasks;
    }

    const matchedTasks = searchTasksLocally(relevantTasks, keywords);
    return matchedTasks.length > 0 ? matchedTasks : relevantTasks;
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

async function buildAiChatAssistantPayload(text = '') {
    const context = normalizeAssistantPayload(get(aiChatContext));
    if (context.mode === 'note' || context.scope === 'notes') {
        return context;
    }

    const { taskStore } = await import('./tasks.js');
    const taskState = get(taskStore);
    const fallbackSource = context.source && context.source !== 'notes'
        ? context.source
        : 'tasks';
    const source = CHAT_ASSISTANT_CONTEXT_SCOPES.has(context.scope)
        ? detectAssistantSourceFromText(text, fallbackSource)
        : fallbackSource;
    const sourceMeta = getAssistantMetaBySource(source);
    const items = source === 'templates'
        ? (taskState.templates || [])
        : source === 'scheduled'
            ? (taskState.scheduledTasks || [])
            : (taskState.tasks || []);

    return {
        ...getDefaultAiPanelContext(),
        ...sourceMeta,
        ...context,
        scope: context.scope && CHAT_ASSISTANT_CONTEXT_SCOPES.has(context.scope)
            ? context.scope
            : sourceMeta.scope,
        title: context.title || sourceMeta.title,
        description: context.description || sourceMeta.description,
        source,
        entityLabel: context.entityLabel || sourceMeta.entityLabel,
        items
    };
}

function shouldUseAssistantToolsInChat(text = '') {
    const context = get(aiChatContext);
    if (context?.scope && CHAT_ASSISTANT_CONTEXT_SCOPES.has(context.scope)) {
        return true;
    }
    return looksLikeFileIntent(text) ||
        looksLikeWebSearchIntent(text) ||
        looksLikeProjectIntent(text);
}

function extractQuotedSegment(text = '') {
    const patterns = [
        /`([^`]+)`/,
        /“([^”]+)”/,
        /"([^"]+)"/,
        /'([^']+)'/
    ];
    for (const pattern of patterns) {
        const match = String(text).match(pattern);
        if (match?.[1]?.trim()) {
            return match[1].trim();
        }
    }
    return '';
}

function trimPathLikeValue(value = '') {
    return String(value || '')
        .trim()
        .replace(/^\\\\\?\\/, '')
        .replace(/[\u3000\s]+$/g, '')
        .replace(/[，。；、]+$/g, '');
}

function sanitizeFilename(value = '') {
    const cleaned = String(value || '')
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F：／＼？＊｜]/g, '-')
        .replace(/[，。；、]+$/g, '')
        .replace(/^[.\s]+|[.\s]+$/g, '');
    return cleaned;
}

function joinDirectoryAndFilename(directory = '', filename = '') {
    const cleanDirectory = trimPathLikeValue(directory);
    const cleanFilename = sanitizeFilename(filename);
    if (!cleanDirectory) {
        return cleanFilename;
    }
    if (!cleanFilename) {
        return cleanDirectory;
    }
    const separator = cleanDirectory.includes('\\') ? '\\' : '/';
    return `${cleanDirectory.replace(/[\\/]+$/g, '')}${separator}${cleanFilename}`;
}

function extractLikelyFilename(text = '') {
    const patterns = [
        /(?:文件名|命名为|保存为|写入(?:一个)?文件|创建(?:一个)?文件|新建(?:一个)?文件)[：:\s]+([^\\/:*?"<>|,\s，。；、]+?\.(?:md|txt|json|js|ts|tsx|jsx|svelte|rs|html|css|scss|yml|yaml|toml|csv|sql|log|xml))/i,
        /([^\\/:*?"<>|,\s，。；、]+?\.(?:md|txt|json|js|ts|tsx|jsx|svelte|rs|html|css|scss|yml|yaml|toml|csv|sql|log|xml))(?=$|[\s，。；、,])/i
    ];

    for (const pattern of patterns) {
        const match = String(text).match(pattern);
        if (match?.[1]) {
            return sanitizeFilename(match[1]);
        }
    }
    return '';
}

function extractLikelyDirectory(text = '') {
    const patterns = [
        /([A-Za-z]:\\[^\n\r"'`]+?)(?=(?:\\)?(?:写入|保存|创建|新建|导出|生成|内容[：:]|文件(?:名)?[：:]|$))/i,
        /([A-Za-z]:\\[^\n\r"'`]+?)(?=$|[\s，。；、,])/i,
        /((?:\.\/|\/)[^\n\r"'`]+?)(?=(?:\/)?(?:写入|保存|创建|新建|导出|生成|内容[：:]|文件(?:名)?[：:]|$))/i,
        /((?:\.\/|\/)[^\n\r"'`]+?)(?=$|[\s，。；、,])/i
    ];

    for (const pattern of patterns) {
        const match = String(text).match(pattern);
        if (match?.[1]) {
            return trimPathLikeValue(match[1]).replace(/[\\/]+$/g, '');
        }
    }
    return '';
}

function containsPathNoise(value = '') {
    return /(内容[：:]|访问网站|访问网址|打开网站|看一下|有没有注册|是否注册|whois|https?:\/\/|写入(?:一个)?文件[：:]?|创建(?:一个)?文件[：:]?|新建(?:一个)?文件[：:]?|保存为[：:]?|文件名[：:]?)/i
        .test(String(value || ''));
}

function sanitizePathCandidate(path = '', operation = 'read') {
    const cleanPath = trimPathLikeValue(path);
    if (!cleanPath || isContentUri(cleanPath)) {
        return cleanPath;
    }

    const separator = cleanPath.includes('\\') ? '\\' : '/';
    const parts = cleanPath.split(/[\\/]/);
    if (operation === 'write' && parts.length > 0) {
        const last = parts.pop() || '';
        parts.push(sanitizeFilename(last) || last);
        return parts.join(separator);
    }

    return cleanPath;
}

function extractStructuredWriteTarget(text = '') {
    const explicitFullPath =
        String(text).match(/[A-Za-z]:\\[^\n\r"'`<>|?*：／＼？＊｜]+?\.(?:md|txt|json|js|ts|tsx|jsx|svelte|rs|html|css|scss|yml|yaml|toml|csv|sql|log|xml)(?=$|[\s，。；、,])/i)?.[0] ||
        String(text).match(/(?:\.\/|\/)[^\n\r"'`<>|?*：／＼？＊｜]+?\.(?:md|txt|json|js|ts|tsx|jsx|svelte|rs|html|css|scss|yml|yaml|toml|csv|sql|log|xml)(?=$|[\s，。；、,])/i)?.[0] ||
        '';

    if (explicitFullPath) {
        return sanitizePathCandidate(explicitFullPath, 'write');
    }

    const directory = extractLikelyDirectory(text);
    const filename = extractLikelyFilename(text);
    if (directory && filename) {
        return sanitizePathCandidate(joinDirectoryAndFilename(directory, filename), 'write');
    }

    const quoted = extractQuotedSegment(text);
    if (quoted && /[\\/]/.test(quoted)) {
        return sanitizePathCandidate(quoted, 'write');
    }

    return '';
}

function extractLikelyPath(text = '') {
    const candidates = [
        extractStructuredWriteTarget(text),
        extractQuotedSegment(text),
        String(text).match(/[A-Za-z]:\\[^\n\r"'`<>|?*：／＼？＊｜]+?\.(?:md|txt|json|js|ts|tsx|jsx|svelte|rs|html|css|scss|yml|yaml|toml|csv|sql|log|xml)(?=$|[\s，。；、,])/i)?.[0] || '',
        extractLikelyDirectory(text),
        String(text).match(/[A-Za-z]:\\[^\n\r"'`]+/)?.[0] || '',
        String(text).match(/(?:^|[\s(])(\.\/[^\s"'`]+|\/[^\s"'`]+)(?=$|[\s)])/i)?.[1] || '',
        String(text).match(/([A-Za-z0-9_.\-\/\\]+\.(?:md|txt|json|js|ts|tsx|jsx|svelte|rs|html|css|scss|yml|yaml|toml|csv|sql|log|xml))/i)?.[1] || ''
    ];

    const candidate = candidates.find((item) => item && /[\\/\.]/.test(item)) || '';
    return sanitizePathCandidate(candidate);
}

function extractFencedContent(text = '') {
    const fenced = String(text).match(/```(?:[\w-]+)?\n([\s\S]*?)```/);
    if (fenced?.[1] !== undefined) {
        return fenced[1].trimEnd();
    }

    const inline = String(text).match(/内容(?:为|是)?[：:]\s*([\s\S]+)/);
    return inline?.[1]?.trim() || '';
}

function splitExplicitToolSteps(text = '') {
    const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) {
        return [];
    }

    const markerRegex = /(^|\n)\s*(\d+)[\.\)、]\s+/g;
    const markers = [...normalized.matchAll(markerRegex)];
    if (markers.length < 2) {
        return [];
    }

    const steps = markers.map((match, index) => {
        const start = match.index + match[0].length;
        const end = index + 1 < markers.length ? markers[index + 1].index : normalized.length;
        return normalized.slice(start, end).trim();
    }).filter(Boolean);

    return steps.length > 1 ? steps : [];
}

function normalizeLocalFilePlan(plan = {}, userText = '') {
    const operation = String(plan.operation || inferLocalFileOperation(userText) || '').toLowerCase();
    const nextPlan = {
        ...plan,
        operation
    };

    if (operation === 'write') {
        const structuredPath = extractStructuredWriteTarget(userText);
        nextPlan.path = sanitizePathCandidate(
            structuredPath || (containsPathNoise(nextPlan.path) ? '' : nextPlan.path),
            'write'
        );
        nextPlan.content = typeof nextPlan.content === 'string' && nextPlan.content.trim()
            ? nextPlan.content
            : extractFencedContent(userText);
        return nextPlan;
    }

    if (operation === 'read' || operation === 'delete') {
        const fallbackPath = extractLikelyPath(userText);
        nextPlan.path = sanitizePathCandidate(
            containsPathNoise(nextPlan.path) ? fallbackPath : (nextPlan.path || fallbackPath),
            operation
        );
        return nextPlan;
    }

    if (operation === 'search') {
        const fallbackRoot = extractLikelyDirectory(userText);
        nextPlan.root = sanitizePathCandidate(
            containsPathNoise(nextPlan.root) ? fallbackRoot : (nextPlan.root || fallbackRoot),
            'search'
        );
        return nextPlan;
    }

    return nextPlan;
}

function inferLocalFileOperation(text = '') {
    const lowerText = String(text).toLowerCase();
    if (/(删除文件|移除文件|删掉文件|delete file|remove file|unlink)/i.test(text)) {
        return 'delete';
    }
    if (/(写入|保存到|创建文件|新建文件|修改文件|覆盖|追加|write file|save file|create file|update file)/i.test(text)) {
        return 'write';
    }
    if (/(读取|打开文件|查看文件|读取文件|read file|open file|cat )/i.test(text)) {
        return 'read';
    }
    if (/(扫描|列出|搜索文件|查找文件|找文件|scan|search file|find file|list files|workspace)/i.test(text)) {
        return 'search';
    }
    return null;
}

function buildFallbackLocalFileIntent(userText, settings = get(settingsStore)) {
    if (!looksLikeFileIntent(userText)) {
        return null;
    }

    const operation = inferLocalFileOperation(userText) || 'search';
    const path = operation === 'write'
        ? (extractStructuredWriteTarget(userText) || extractLikelyPath(userText))
        : extractLikelyPath(userText);
    const extractedContent = extractFencedContent(userText);
    const cleanedQuery = String(userText)
        .replace(/请|帮我|麻烦|一下|在项目里|在工作目录里|工作目录|workspace|目录里|文件夹里/gi, ' ')
        .replace(/(读取|打开|查看|扫描|列出|搜索|查找|找|写入|保存|创建|新建|修改|删除)(文件|目录|文件夹)?/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const fallbackQuery = extractQuotedSegment(userText) || path || cleanedQuery;

    if ((operation === 'read' || operation === 'delete') && !path) {
        return null;
    }

    if (operation === 'write' && !path) {
        return null;
    }

    if (operation === 'write') {
        return {
            mode: 'file',
            operation,
            path,
            content: extractedContent,
            response_goal: '说明文件已写入的位置；如果用户给了内容，概括写入结果。',
            message: '已按本地文件兼容模式解析为写入操作。'
        };
    }

    if (operation === 'read') {
        return {
            mode: 'file',
            operation,
            path,
            response_goal: '基于文件内容直接回答用户，并明确说明读取的是哪个文件。',
            message: '已按本地文件兼容模式解析为读取操作。'
        };
    }

    if (operation === 'delete') {
        return {
            mode: 'file',
            operation,
            path,
            response_goal: '明确说明文件删除结果。',
            message: '已按本地文件兼容模式解析为删除操作。'
        };
    }

    return {
        mode: 'file',
        operation: 'search',
        root: '',
        query: fallbackQuery || settings.workspaceRoot || '',
        response_goal: '列出匹配的本地文件或目录，并指出最相关的候选结果。',
        message: '已按本地文件兼容模式解析为搜索操作。'
    };
}

function buildFallbackWebSearchIntent(userText = '') {
    if (!looksLikeWebSearchIntent(userText)) {
        return null;
    }

    const explicitUrl = String(userText).match(/https?:\/\/[^\s<>"'`，。；、]+/i)?.[0] || '';

    const query = String(userText)
        .replace(/请|帮我|麻烦|一下/gi, ' ')
        .replace(/(联网|网页|网上|在线|online|web)\s*(搜索|查找|查询)/gi, ' ')
        .replace(/搜索一下|查一下|搜一下|帮我搜索|web search|online search/gi, ' ')
        .replace(/(访问|打开|查看|看看)\s*(网站|网页)/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        mode: 'web',
        url: explicitUrl,
        query: query || userText,
        response_goal: '根据搜索结果回答用户，并保留关键链接与来源。',
        message: '已按网页搜索兼容模式执行检索。'
    };
}

function extractJsonPayload(value = '') {
    const cleanValue = String(value || '')
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
    const jsonMatch = cleanValue.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : cleanValue);
}

function formatContextItemsForAI(items = [], context = {}) {
    const label = context.entityLabel || '任务';
    const sourceItems = Array.isArray(items) ? items : [];
    if (sourceItems.length === 0) {
        return `- [${label}] 暂无`;
    }
    const limit = context.source === 'tasks' ? sourceItems.length : AI_PASSIVE_CONTEXT_LIMIT;
    const lines = sourceItems
        .slice(0, limit)
        .map((item) => {
            const parts = [`- [${label}] ${item.title || '未命名'}`];
            if (item.status) parts.push(item.status);
            if (item.date) parts.push(item.date);
            if (Array.isArray(item.repeatDays) && item.repeatDays.length > 0) {
                parts.push(`repeat=${item.repeatDays.join(',')}`);
            }
            if (typeof item.enabled === 'boolean') {
                parts.push(`enabled=${item.enabled}`);
            }
            if (item.category) parts.push(`category=${item.category}`);
            return parts.join(' | ');
        });
    if (context.source !== 'tasks' && sourceItems.length > AI_PASSIVE_CONTEXT_LIMIT) {
        lines.push(`- [${label}] 共 ${sourceItems.length} 项，仅显示前 ${AI_PASSIVE_CONTEXT_LIMIT} 项`);
    }
    return lines.join('\n');
}

function formatNoteContextForAI(context = {}) {
    if (!context?.activeNoteId) return '';

    const noteState = get(notesStore);
    const note = (noteState.notes || []).find(n => n.id === context.activeNoteId);
    if (note?.aiLocked) {
        return '【当前工作笔记】\n此笔记已被用户设置为禁止 AI 访问，无法读取内容。';
    }

    return [
        '【当前工作笔记】',
        `标题：${context.noteTitle || '未命名笔记'}`,
        `分类：${context.noteCategory || '全部'}`,
        '内容：',
        context.noteContent || '（当前为空）'
    ].join('\n');
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
            `路径: ${item.path}`,
            `大小: ${formatFileSize(item.size)}`,
            item.truncated ? '说明: 文件内容已截断' : '',
            '内容：',
            item.content || '（空文件）'
        ].filter(Boolean).join('\n'))
    ].join('\n\n');
}

function hasMediaAttachments(attachments = []) {
    return normalizeChatAttachments(attachments).some(
        (item) => item.mediaType && item.mediaType !== 'text' && item.base64Data
    );
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

async function buildContextualAssistantResponse(userText, assistantContext, config, options = {}) {
    const { callAIWithMessages } = await import('../utils/ai-providers.js');
    const nowStr = getFormattedDateTime();
    const projectContext = await getProjectContextSummary();
    const dateInfo = getDateInfo();
    const timeScope = detectTimeScope(userText, dateInfo);
    const operationType = detectOperationType(userText);
    const contextItems = assistantContext.source === 'tasks'
        ? getTaskCandidatesForAI(
            userText,
            assistantContext.items || [],
            getTimeScopedItems(assistantContext, timeScope, dateInfo, { mode: 'ai_context' }),
            operationType,
            timeScope
        )
        : (assistantContext.items || []);
    const scopedItems = formatContextItemsForAI(contextItems, assistantContext);
    const noteContext = formatNoteContextForAI(assistantContext);
    const allowActions = options.allowActions ?? true;

    const messages = [
        {
            role: 'system',
            content: `你是 WorkPlan 的内置 AI 助手。当前时间：${nowStr}。
你正在右侧助手面板中工作，必须优先基于当前页面上下文回答。
${allowActions
        ? '如果用户没有明确要求执行结构化的新增/修改/删除操作，就直接给出专业回答、总结、规划建议或内容改写结果。'
        : '当前 AI 聊天的工具调用能力已关闭。你只能基于现有上下文提供建议、解释、总结或草稿，不能声称已经执行项目修改、本地文件操作或网页搜索。'}
回答必须准确、克制，不要捏造项目中不存在的数据。

【当前页面】
- scope: ${assistantContext.scope}
- 标题: ${assistantContext.title || 'AI 助手'}
- 描述: ${assistantContext.description || '无'}

【当前页面数据】
${scopedItems}

${noteContext ? `${noteContext}\n` : ''}${projectContext}`
        },
        {
            role: 'user',
            content: userText
        }
    ];

    const result = await callAIWithMessages(config, messages);
    return {
        role: 'assistant',
        type: 'text',
        content: result || '暂时没有可返回的内容。'
    };
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

const VALID_INTENTS = new Set(['chat', 'web_search', 'file', 'task', 'image_generation', 'audio_generation']);

async function classifyUserIntent(text, config) {
    const systemPrompt = `You are a strict intent classifier. Classify the user message into exactly one category. Return ONLY valid JSON, no explanation.

Categories:
- "chat": general conversation, Q&A, writing, translation, explaining concepts, greetings, jokes
- "web_search": requires real-time or online information (weather, news, stock/gold/oil prices, exchange rates, search the web, latest version of something, current events, official websites)
- "file": involves local file operations (read, write, delete, scan, search files/directories, check file contents, file paths mentioned)
- "task": involves tasks/todos/templates/scheduled tasks — adding, deleting, modifying, querying, completing, or listing tasks
- "image_generation": user explicitly asks to generate/create/draw an image, picture, illustration, or artwork (e.g. "画一张", "生成图片", "generate an image", "draw me a")
- "audio_generation": user explicitly asks for text-to-speech, voice synthesis, or audio generation (e.g. "朗读", "语音合成", "TTS", "read aloud", "generate speech")

Output: {"intent": "chat"}  or  {"intent": "web_search"}  or  {"intent": "file"}  or  {"intent": "task"}  or  {"intent": "image_generation"}  or  {"intent": "audio_generation"}`;

    try {
        const { callAI } = await import('../utils/ai-providers.js');
        const aiResponse = await callAI(config, text, systemPrompt);
        if (!aiResponse) return 'chat';
        const parsed = extractJsonPayload(aiResponse);
        const intent = String(parsed?.intent || 'chat').toLowerCase();
        return VALID_INTENTS.has(intent) ? intent : 'chat';
    } catch (error) {
        console.warn('classifyUserIntent failed, falling back to keyword detection:', error);
        return null;
    }
}

async function analyzeLocalFileIntent(userText, config, callAI, intentHint = null) {
    const settings = get(settingsStore);
    const localFileConfig = settings.localFileConfig || {};
    if (!localFileConfig.enabled || (!looksLikeFileIntent(userText) && intentHint !== 'file')) {
        return null;
    }
    const fallbackPlan = buildFallbackLocalFileIntent(userText, settings);

    const workspaceRoot = settings.workspaceRoot || '未知工作目录';
    const trustedDirectories = localFileConfig.trustedDirectories || [];
    const systemPrompt = `你是 WorkPlan 的本地文件技能路由器。你需要把用户的自然语言请求解析为单个文件操作。

【工作目录】${workspaceRoot}
【额外受信任目录】
${trustedDirectories.length > 0 ? trustedDirectories.map((item) => `- ${item}`).join('\n') : '- 无'}

【允许的操作】
- search: 扫描目录、搜索文件或列出目录内容
- read: 读取单个文件
- write: 新建文件、覆盖写入或修改文件
- delete: 删除单个文件

【安全规则】
1. write / delete 仅用于明确要求写入、修改、删除文件的请求
2. 用户未提供路径时，优先使用工作目录内的相对路径
3. 如果只是普通问答，不要输出文件操作，返回 {"mode":"reply"}
4. 只返回 JSON

【输出格式】
{
  "mode": "reply|file",
  "operation": "search|read|write|delete",
  "path": "目标路径，可为相对工作目录的路径",
  "root": "搜索根目录，可选",
  "query": "搜索关键词，可选",
  "content": "写入内容，仅 write 使用",
  "response_goal": "执行完成后如何向用户说明结果",
  "message": "给用户的简短说明"
}`;

    try {
        const aiResponse = await callAI(config, userText, systemPrompt);
        if (!aiResponse) return normalizeLocalFilePlan(fallbackPlan, userText);
        const parsed = extractJsonPayload(aiResponse);
        if (parsed.mode !== 'file' || !parsed.operation) {
            return normalizeLocalFilePlan(fallbackPlan, userText);
        }
        return normalizeLocalFilePlan({
            ...fallbackPlan,
            ...parsed,
            path: parsed.path || fallbackPlan?.path || '',
            root: parsed.root || fallbackPlan?.root || '',
            query: parsed.query || fallbackPlan?.query || '',
            content: parsed.content ?? fallbackPlan?.content ?? '',
            response_goal: parsed.response_goal || fallbackPlan?.response_goal,
            message: parsed.message || fallbackPlan?.message
        }, userText);
    } catch (error) {
        console.error('Failed to parse local file intent:', error);
        return normalizeLocalFilePlan(fallbackPlan, userText);
    }
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

async function analyzeWebSearchIntent(userText, config, callAI, intentHint = null) {
    if (!looksLikeWebSearchIntent(userText) && intentHint !== 'web_search') {
        return null;
    }
    const fallbackPlan = buildFallbackWebSearchIntent(userText);

    const systemPrompt = `你是 WorkPlan 的网页搜索技能路由器。你需要判断用户是否真的需要联网搜索，并提取搜索词。

【什么时候需要搜索】
1. 用户明确要求搜索网页、联网查询、查看官网、查最新消息
2. 用户的问题依赖实时信息，例如天气、股价、汇率、新闻、产品最新版本
3. 用户要求给出网页结果、链接或在线资料

【什么时候不需要搜索】
1. 只是项目内任务、模板、定时任务或笔记操作
2. 只是让 AI 做一般性解释、写作或总结

【输出格式】
只返回 JSON：
{
  "mode": "reply|web",
  "url": "用户明确给出的网页 URL，可选",
  "query": "精简后的搜索关键词",
  "response_goal": "基于搜索结果应如何回答用户",
  "message": "给用户的简短提示"
}`;

    try {
        const aiResponse = await callAI(config, userText, systemPrompt);
        if (!aiResponse) return fallbackPlan;
        const parsed = extractJsonPayload(aiResponse);
        if (parsed.mode !== 'web' || !parsed.query) {
            return fallbackPlan;
        }
        return {
            ...fallbackPlan,
            ...parsed,
            url: parsed.url || fallbackPlan?.url || '',
            query: parsed.query || fallbackPlan?.query || userText,
            response_goal: parsed.response_goal || fallbackPlan?.response_goal,
            message: parsed.message || fallbackPlan?.message
        };
    } catch (error) {
        console.error('Failed to parse web search intent:', error);
        return fallbackPlan;
    }
}

async function finalizeToolAnswer(userText, plan, toolResult, config) {
    if (!plan?.response_goal) {
        return null;
    }

    const { callAIWithMessages } = await import('../utils/ai-providers.js');
    const messages = [
        {
            role: 'system',
            content: '你正在根据工具执行结果回复用户。只能依据提供的结果作答，不能捏造不存在的事实、文件内容或网页信息。'
        },
        {
            role: 'user',
            content: `用户请求：${userText}

操作：${plan.operation}
目标：${plan.response_goal}
结果：
${toolResult}`
        }
    ];

    const result = await callAIWithMessages(config, messages);
    return result || null;
}

async function runLocalFilePlan(plan, userText, config, requireConfirmation = true) {
    const settings = get(settingsStore);
    const trustedDirectories = settings.localFileConfig?.trustedDirectories || [];
    const operation = String(plan.operation || '').toLowerCase();
    const authorizationDirectory = resolveUnauthorizedDirectory(plan, settings);

    if (authorizationDirectory) {
        return {
            role: 'assistant',
            type: 'file_confirm',
            operation: {
                ...plan,
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
            content: `已删除本地文件：${result.path}`
        };
    }

    if (operation === 'read') {
        const result = await readLocalFile({
            path: plan.path,
            trustedDirectories
        });
        const fallback = [
            `已读取文件：${result.path}`,
            '',
            '```',
            result.content || '',
            '```'
        ].join('\n');
        const summarized = await finalizeToolAnswer(
            userText,
            plan,
            `文件路径：${result.path}\n文件大小：${result.size}\n是否截断：${result.truncated}\n文件内容：\n${result.content}`,
            config
        );
        return {
            role: 'assistant',
            type: 'text',
            content: summarized || fallback
        };
    }

    const results = await searchLocalFiles({
        root: plan.root || '',
        query: plan.query || plan.path || '',
        maxResults: 40,
        trustedDirectories
    });
    const fallback = formatLocalFileSearchResult(results);
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

function parseNativeToolArguments(value = '') {
    if (value && typeof value === 'object') {
        return value;
    }

    const raw = String(value || '').trim();
    if (!raw) return {};

    try {
        return JSON.parse(raw);
    } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch {
                // Unbalanced JSON — the model's output was almost certainly cut
                // off by the token limit. Flag it so callers can say so.
            }
        }
        return { __parseFailed: true };
    }
}

function isNativeToolUnsupportedError(error) {
    if (error?.nativeToolUnsupported) return true;
    return /tool|function|tool_choice|unsupported|not support|不支持/i.test(String(error?.message || error || ''));
}

function markNativeToolCapability(value) {
    aiChatRuntimeCapabilities.update(runtime => ({
        ...runtime,
        nativeToolCallRuntimeAvailable: Boolean(value)
    }));
}

async function shouldAttemptNativeToolCalling(config) {
    const { canProviderUseNativeTools } = await import('../utils/ai-providers.js');
    if (!canProviderUseNativeTools(config.provider)) {
        return false;
    }

    const runtime = get(aiChatRuntimeCapabilities);
    if (runtime.nativeToolCallRuntimeAvailable === false) {
        return false;
    }

    return true;
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

function buildNativeToolDefinitions(allowLocalFiles = true) {
    const settings = get(settingsStore);
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
                        root: { type: 'string', description: '搜索根目录，可选。' },
                        query: { type: 'string', description: '搜索关键词。' },
                        content: { type: 'string', description: 'write 时写入的完整内容。' },
                        response_goal: { type: 'string' },
                        message: { type: 'string' }
                    },
                    required: ['operation']
                }
            }
        });
    }

    return tools;
}

function normalizeNativeProjectSource(source = '', fallback = 'tasks') {
    const value = String(source || fallback || 'tasks').toLowerCase();
    if (value === 'template' || value === 'templates') return 'templates';
    if (value === 'scheduled' || value === 'schedule' || value === 'recurring') return 'scheduled';
    return 'tasks';
}

function formatNativeProjectItemsForAI(assistantContext = {}) {
    const source = normalizeNativeProjectSource(assistantContext.source, 'tasks');
    const items = Array.isArray(assistantContext.items) ? assistantContext.items : [];
    if (!items.length) {
        return `【可操作数据】\n- 当前 ${source} 为空`;
    }

    const formatter = source === 'templates' ? formatTemplateForAI : formatFullTaskForAI;
    return [
        `【可操作数据 source=${source}】`,
        formatItemsForAI(items, formatter)
    ].join('\n');
}

function buildNativeToolMessages(userText, assistantContext = {}, intentHint = null, allowLocalFiles = true) {
    const settings = get(settingsStore);
    const nowStr = getFormattedDateTime();
    const dateInfo = getDateInfo();
    const localFileConfig = settings.localFileConfig || {};
    const trustedDirectories = localFileConfig.trustedDirectories || [];

    const hintText = intentHint
        ? `\n【已知意图】${intentHint}`
        : '';

    return [
        {
            role: 'system',
            content: `你是 WorkPlan 的工具调用路由器。当前时间：${nowStr}。
今天：${formatDateForAI(dateInfo.today)}，明天：${formatDateForAI(dateInfo.tomorrow)}，后天：${formatDateForAI(dateInfo.dayAfterTomorrow)}。
你可以调用 WorkPlan 提供的工具完成项目、本地文件和网页搜索操作。

规则：
1. 用户要求项目任务、模板、定时任务的新增/查询/修改/删除时，调用 workplan_project_action。
2. 用户要求搜索网页、访问 URL、查询实时/最新信息时，调用 workplan_web_search。
3. 用户要求本地文件搜索/读取/写入/删除时，调用 workplan_local_file。
4. 普通闲聊、解释、写作、翻译、不需要项目工具的问题，不要调用工具，直接回答文本。
5. update/delete/query/subtask 必须使用上下文中的完整 ID，不要编造 ID。
6. 普通任务时间使用 YYYY-MM-DDTHH:mm；定时任务 repeatDays 中周日=0，周一至周六=1-6。
7. 普通任务的可操作数据已按时间范围过滤；用户未明确提到过去/历史时，不要操作未列出的历史任务。
8. 用户描述要做/已做的工作内容（即使含"修改/删除/完成"等动词），若对象不在上面列出的任务中，应使用 operation=create 新建任务记录该工作，而非 update/delete 已有任务。
9. 描述"已经完成的工作"（如"补充已完成的任务""昨天完成了X"）时，operation=create 且 status=done。
${hintText}

【当前页面】
- scope: ${assistantContext.scope || 'dashboard'}
- source: ${assistantContext.source || 'tasks'}
- 标题: ${assistantContext.title || 'AI 助手'}

${formatNativeProjectItemsForAI(assistantContext)}

【本地文件权限】
- 本地文件工具: ${(allowLocalFiles && localFileConfig.enabled) ? '已开启' : '未开启（当前对话不可用）'}
- 工作目录: ${settings.workspaceRoot || '未设置'}
- 受信任目录: ${trustedDirectories.length ? trustedDirectories.join(' | ') : '无'}`
        },
        {
            role: 'user',
            content: userText
        }
    ];
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
                cleanUpdates.completedDate = new Date().toISOString().slice(0, 16);
            } else if (status === 'doing' && !task.startTime) {
                cleanUpdates.startTime = new Date().toISOString().slice(0, 16);
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
        const matched = findNativeItemsByIds(items, args.task_ids || args.matched_task_ids || args.delete_task_ids || []);
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

async function executeNativeToolCall(toolCall, userText, config, assistantContext, requireFileConfirmation, progress, allowLocalFiles = true) {
    const args = parseNativeToolArguments(toolCall.arguments);
    if (toolCall.name === 'workplan_web_search') {
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
        const plan = normalizeLocalFilePlan({
            mode: 'file',
            operation: args.operation,
            path: args.path || '',
            root: args.root || '',
            query: args.query || '',
            content: args.content || '',
            response_goal: args.response_goal || '',
            message: args.message || '已通过原生工具调用解析为本地文件操作。'
        }, userText);
        return await runLocalFilePlan(plan, userText, config, requireFileConfirmation);
    }

    if (toolCall.name === 'workplan_project_action') {
        progress('task_processing');
        return await runNativeProjectAction(args, userText, assistantContext);
    }

    return {
        role: 'assistant',
        type: 'text',
        content: `模型请求了未知工具：${toolCall.name}`
    };
}

async function tryResolveWithNativeTools(userText, assistantContext, config, intentHint, progress, allowLocalFiles = true) {
    if (!await shouldAttemptNativeToolCalling(config)) {
        return null;
    }

    const tools = buildNativeToolDefinitions(allowLocalFiles);
    if (!tools.length) return null;

    try {
        const { callAIWithMessagesAndTools } = await import('../utils/ai-providers.js');
        const response = await callAIWithMessagesAndTools(
            config,
            buildNativeToolMessages(userText, assistantContext, intentHint, allowLocalFiles),
            tools,
            { maxTokens: Number(config.maxTokens) || 4096, toolChoice: 'auto' }
        );

        const toolCalls = response.toolCalls || [];
        if (!toolCalls.length) {
            return null;
        }

        markNativeToolCapability(true);
        const requireFileConfirmation = get(settingsStore).localFileConfig?.requireConfirmation ?? true;
        const results = [];
        for (const toolCall of toolCalls) {
            results.push(await executeNativeToolCall(
                toolCall,
                userText,
                config,
                assistantContext,
                requireFileConfirmation,
                progress,
                allowLocalFiles
            ));
        }

        if (results.length === 1) {
            return results[0];
        }

        return { __batchResults: results };
    } catch (error) {
        if (isNativeToolUnsupportedError(error)) {
            markNativeToolCapability(false);
            return null;
        }
        console.warn('[AI Tools] native tool calling failed, falling back to internal router:', error?.message || error);
        return null;
    }
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

function looksLikeImageGenerationIntent(text = '') {
    const lower = String(text).toLowerCase();
    const patterns = [
        /画[一个张幅]/, /生成[一张个幅]?图/, /生成图片/, /生成图像/, /生成插画/, /生成海报/,
        /画个/, /画一/, /帮我画/, /请画/, /给我画/,
        /generate\s+(an?\s+)?image/i, /draw\s+(me\s+)?/i, /create\s+(an?\s+)?image/i,
        /create\s+(an?\s+)?picture/i, /make\s+(an?\s+)?image/i,
        /生成一张/, /做一张图/, /做张图/, /出一张图/
    ];
    return patterns.some(p => p.test(lower));
}

function looksLikeAudioGenerationIntent(text = '') {
    const lower = String(text).toLowerCase();
    const patterns = [
        /朗读/, /语音合成/, /文字转语音/, /念出来/, /读出来/, /帮我念/, /帮我读/,
        /tts/i, /text.?to.?speech/i, /read\s+aloud/i, /speak\s+this/i,
        /generate\s+(audio|speech|voice)/i, /生成语音/, /生成音频/, /转成语音/
    ];
    return patterns.some(p => p.test(lower));
}

async function handleImageGeneration(text, config) {
    try {
        const { generateImage, supportsImageGeneration } = await import('../utils/ai-media-generation.js');
        if (!supportsImageGeneration(config.provider)) {
            return {
                role: 'assistant',
                type: 'text',
                content: `当前提供商 (${config.provider}) 不支持图片生成。请切换到支持图片生成的提供商（如 OpenAI）。`
            };
        }

        const { callAI } = await import('../utils/ai-providers.js');
        const promptResponse = await callAI(config, text,
            'Extract the image generation prompt from the user message. Return ONLY the image description/prompt in English, optimized for DALL-E. No explanation, no JSON, just the prompt text.');
        const imagePrompt = promptResponse?.trim() || text;

        const result = await generateImage({
            provider: config.provider,
            apiKey: config.apiKey,
            prompt: imagePrompt,
            customEndpoint: config.customEndpoint
        });

        return {
            role: 'assistant',
            type: 'generated_image',
            content: result.revisedPrompt || imagePrompt,
            base64Data: result.base64Data,
            url: result.url,
            mimeType: result.mimeType,
            prompt: imagePrompt,
            provider: config.provider
        };
    } catch (error) {
        return {
            role: 'assistant',
            type: 'error',
            content: `图片生成失败: ${error.message || error}`
        };
    }
}

async function handleAudioGeneration(text, config) {
    try {
        const { generateAudio, supportsTTS } = await import('../utils/ai-media-generation.js');
        if (!supportsTTS(config.provider)) {
            return {
                role: 'assistant',
                type: 'text',
                content: `当前提供商 (${config.provider}) 不支持语音合成。请切换到支持 TTS 的提供商（如 OpenAI）。`
            };
        }

        const { callAI } = await import('../utils/ai-providers.js');
        const ttsTextResponse = await callAI(config, text,
            'The user wants text-to-speech. Extract the text they want spoken. Return ONLY the text to be spoken, nothing else. If the user says "read this aloud: hello world", return "hello world".');
        const ttsText = ttsTextResponse?.trim() || text;

        const result = await generateAudio({
            provider: config.provider,
            apiKey: config.apiKey,
            text: ttsText,
            customEndpoint: config.customEndpoint
        });

        return {
            role: 'assistant',
            type: 'generated_audio',
            content: `语音已生成: "${ttsText.slice(0, 100)}${ttsText.length > 100 ? '...' : ''}"`,
            base64Data: result.base64Data,
            mimeType: result.mimeType,
            text: ttsText,
            voice: result.voice,
            provider: config.provider
        };
    } catch (error) {
        return {
            role: 'assistant',
            type: 'error',
            content: `语音生成失败: ${error.message || error}`
        };
    }
}

async function resolveAssistantMessage(text, existingTasks = [], currentConfig = getEffectiveConfig(), intentHint = null, onProgress = null, options = {}) {
    const progress = (step) => { if (onProgress) onProgress(step); };
    const assistantContext = normalizeAssistantPayload(existingTasks);
    const allowBatchExecution = options.allowBatchExecution ?? true;
    const scopedItems = assistantContext.items || [];
    const aiChatToolsEnabled = get(settingsStore).enableAiChatTools ?? true;
    const allowLocalFiles = options.allowLocalFiles ?? true;
    const subtaskOperation = detectSubtaskOperation(text);
    const lowerText = text.toLowerCase();
    const isExplicitCreate = CREATE_KEYWORDS.some(keyword => lowerText.includes(keyword));
    const hasNoActionKeyword = !DELETE_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase())) &&
        !UPDATE_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase())) &&
        !QUERY_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase()));
    const operationType = detectOperationType(text);
    const dateInfo = getDateInfo();
    const timeScope = detectTimeScope(text, dateInfo);
    const relevantTasks = getTimeScopedItems(assistantContext, timeScope, dateInfo);
    const needsExpandedTaskContext = operationType === 'query' || looksLikeTaskAnalysisRequest(text);
    const aiRelevantTasks = needsExpandedTaskContext
        ? getTimeScopedItems(assistantContext, timeScope, dateInfo, { mode: 'ai_context' })
        : relevantTasks;
    const aiTaskCandidates = assistantContext.source === 'tasks'
        ? getTaskCandidatesForAI(text, scopedItems, aiRelevantTasks, operationType, timeScope)
        : scopedItems;
    const hasWebIntent = intentHint === 'web_search' || (!intentHint && looksLikeWebSearchIntent(text));
    const hasFileIntent = allowLocalFiles && (intentHint === 'file' || (!intentHint && looksLikeFileIntent(text)));
    const hasProjectIntent = intentHint === 'task' ||
        (!hasWebIntent && !hasFileIntent && (looksLikeProjectIntent(text) || assistantContext.source !== 'tasks'));
    const allowImplicitCreate = assistantContext.scope === 'dashboard' ||
        assistantContext.scope === 'project' ||
        assistantContext.source === 'templates' ||
        assistantContext.source === 'scheduled';
    // operationType==='create' 已涵盖：显式新建、补录已完成、计划语气新工作、多动词工作清单、无动作关键词。
    const shouldHandleAsCreate = isExplicitCreate ||
        (allowImplicitCreate && operationType === 'create');
    const shouldUseInternalCreate = assistantContext.mode !== 'note' &&
        shouldHandleAsCreate;

    const { callAI } = await import('../utils/ai-providers.js');
    const requireFileConfirmation = get(settingsStore).localFileConfig?.requireConfirmation ?? true;

    if (!aiChatToolsEnabled) {
        return normalizeAssistantResult(
            await buildContextualAssistantResponse(text, assistantContext, currentConfig, { allowActions: false }),
            assistantContext
        );
    }

    if (allowBatchExecution) {
        const explicitSteps = splitExplicitToolSteps(text);
        if (explicitSteps.length > 1) {
            const batchResults = [];
            for (const stepText of explicitSteps) {
                const stepResult = await resolveAssistantMessage(
                    stepText,
                    assistantContext,
                    currentConfig,
                    null,
                    onProgress,
                    { allowBatchExecution: false, allowLocalFiles }
                );

                if (stepResult?.__useStreamingChat) {
                    batchResults.push(
                        normalizeAssistantResult(
                            await buildContextualAssistantResponse(stepText, assistantContext, currentConfig),
                            assistantContext
                        )
                    );
                    continue;
                }

                if (stepResult?.__batchResults?.length) {
                    batchResults.push(...stepResult.__batchResults);
                    continue;
                }

                batchResults.push(stepResult);
            }

            return { __batchResults: batchResults };
        }
    }

    progress('classifying');
    const localTaskLookupResult = assistantContext.source === 'tasks'
        ? tryResolveLocalTaskLookup(text, scopedItems, relevantTasks, operationType, timeScope)
        : null;
    if (localTaskLookupResult) {
        return normalizeAssistantResult(localTaskLookupResult, assistantContext);
    }

    if (!shouldUseInternalCreate) {
        const nativeToolContext = {
            ...assistantContext,
            items: hasProjectIntent ? aiTaskCandidates : []
        };
        const nativeToolResult = await tryResolveWithNativeTools(
            text,
            nativeToolContext,
            currentConfig,
            intentHint,
            progress,
            allowLocalFiles
        );
        if (nativeToolResult?.__batchResults?.length) {
            return {
                __batchResults: nativeToolResult.__batchResults.map(item => normalizeAssistantResult(item, assistantContext))
            };
        }
        if (nativeToolResult) {
            return normalizeAssistantResult(nativeToolResult, assistantContext);
        }
    }

    const webSearchPlan = await analyzeWebSearchIntent(text, currentConfig, callAI, intentHint);
    const localFilePlan = allowLocalFiles
        ? await analyzeLocalFileIntent(text, currentConfig, callAI, intentHint)
        : null;

    let result;

    if (intentHint === 'image_generation' || (!intentHint && looksLikeImageGenerationIntent(text))) {
        progress('generating');
        result = await handleImageGeneration(text, currentConfig);
    } else if (intentHint === 'audio_generation' || (!intentHint && looksLikeAudioGenerationIntent(text))) {
        progress('generating');
        result = await handleAudioGeneration(text, currentConfig);
    } else {
    const userMentionsUrl = /https?:\/\/\S+/i.test(text)
        || /\b[a-z0-9-]+\.(?:com|cn|net|org|io|cool|app|dev|ai|tech|xyz|info|me|so|gg|cc|tv|us|uk|de|jp|fr|co|club|store|shop|site|online|top|art|live|run)\b/i.test(text)
        || /访问网站|打开网站|访问网址|whois|有没有注册|是否注册|备案/i.test(text);
    if (webSearchPlan && (userMentionsUrl || !localFilePlan)) {
        progress('web_searching');
        result = await runWebSearchPlan(webSearchPlan, text, currentConfig, progress);
    } else if (localFilePlan) {
        progress('file_operating');
        result = await runLocalFilePlan(localFilePlan, text, currentConfig, requireFileConfirmation);
    } else if (webSearchPlan) {
        progress('web_searching');
        result = await runWebSearchPlan(webSearchPlan, text, currentConfig, progress);
    } else if (assistantContext.mode === 'note') {
        progress('generating');
        result = await buildContextualAssistantResponse(text, assistantContext, currentConfig);
    } else if (assistantContext.source === 'templates' && subtaskOperation) {
        progress('task_processing');
        result = await analyzeSubtaskIntent(text, scopedItems, scopedItems, dateInfo, currentConfig, callAI);
    } else if (assistantContext.source === 'templates' && shouldHandleAsCreate) {
        progress('task_processing');
        result = await analyzeTemplateCreateIntent(text, scopedItems, currentConfig, callAI);
    } else if (assistantContext.source === 'templates' && operationType === 'mixed') {
        progress('task_processing');
        result = await analyzeTemplateMixedIntent(text, scopedItems, currentConfig, callAI);
    } else if (assistantContext.source === 'templates' && operationType === 'delete') {
        progress('task_processing');
        result = await analyzeTemplateDeleteIntent(text, scopedItems, currentConfig, callAI);
    } else if (assistantContext.source === 'templates' && operationType === 'update') {
        progress('task_processing');
        result = await analyzeTemplateUpdateIntent(text, scopedItems, currentConfig, callAI);
    } else if (assistantContext.source === 'templates' && operationType === 'query') {
        progress('task_processing');
        result = await analyzeTemplateQueryIntent(text, scopedItems, currentConfig, callAI);
    } else if (assistantContext.source === 'scheduled' && subtaskOperation) {
        progress('task_processing');
        result = await analyzeSubtaskIntent(text, scopedItems, scopedItems, dateInfo, currentConfig, callAI);
    } else if (assistantContext.source === 'scheduled' && shouldHandleAsCreate) {
        progress('task_processing');
        result = await analyzeScheduledCreateIntent(text, scopedItems, dateInfo, currentConfig, callAI);
    } else if (assistantContext.source === 'scheduled' && operationType === 'update') {
        progress('task_processing');
        result = await analyzeScheduledUpdateIntent(text, scopedItems, aiTaskCandidates, dateInfo, currentConfig, callAI);
    } else if (subtaskOperation) {
        progress('task_processing');
        result = await analyzeSubtaskIntent(text, scopedItems, aiTaskCandidates, dateInfo, currentConfig, callAI);
    } else if (shouldHandleAsCreate) {
        progress('task_processing');
        result = await analyzeCreateIntent(text, scopedItems, dateInfo, currentConfig, callAI);
    } else if (operationType === 'mixed') {
        progress('task_processing');
        result = await analyzeMixedIntent(text, scopedItems, aiTaskCandidates, dateInfo, currentConfig, callAI);
    } else if (operationType === 'delete') {
        progress('task_processing');
        result = await analyzeDeleteIntent(text, scopedItems, aiTaskCandidates, dateInfo, currentConfig, callAI);
    } else if (operationType === 'update') {
        progress('task_processing');
        result = await analyzeUpdateIntent(text, scopedItems, aiTaskCandidates, dateInfo, currentConfig, callAI);
    } else if (operationType === 'query') {
        progress('task_processing');
        result = await analyzeQueryIntent(text, scopedItems, aiTaskCandidates, dateInfo, currentConfig, callAI);
    } else if (hasNoActionKeyword) {
        // No specific tool action matched — signal caller to use streaming chat instead
        return { __useStreamingChat: true };
    } else {
        progress('task_processing');
        result = await analyzeCreateIntent(text, scopedItems, dateInfo, currentConfig, callAI);
    }
    }

    return normalizeAssistantResult(result, assistantContext);
}

export async function sendAiMessage(text, existingTasks = [], retryIndex = null) {
    if (!text.trim()) return;

    const currentConfig = getEffectiveConfig();

    const needsApiKey = providerNeedsApiKey(currentConfig.provider);

    if (needsApiKey && !currentConfig.apiKey) {
        showAiSettings.set(true);
        throw new Error('请先配置 AI API Key');
    }

    if (retryIndex !== null) {
        chatHistory.update(h => {
            const newHistory = [...h];
            if (newHistory[retryIndex] && newHistory[retryIndex].type === 'error') {
                newHistory[retryIndex] = { role: 'assistant', type: 'loading' };
            }
            return newHistory;
        });
    } else {
        chatHistory.update(h => [...h, { role: 'user', type: 'text', content: text }]);
        chatHistory.update(h => [...h, { role: 'assistant', type: 'loading' }]);
    }

    isAiLoading.set(true);
    lastFailedMessage.set({ text, index: retryIndex });

    try {
        let result = await resolveAssistantMessage(text, existingTasks, currentConfig, null, null, { allowLocalFiles: false });

        // Right-side assistant doesn't support streaming — fallback to non-stream response
        if (result?.__useStreamingChat) {
            const { callAI } = await import('../utils/ai-providers.js');
            const reply = await callAI(currentConfig, text, null);
            result = { role: 'assistant', type: 'text', content: reply || '' };
        }

        chatHistory.update(h => {
            const newHistory = [...h];
            const loadingIndex = newHistory.findIndex(m => m.type === 'loading');
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
        chatHistory.update(h => {
            const newHistory = [...h];
            const loadingIndex = newHistory.findIndex(m => m.type === 'loading');
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
        isAiLoading.set(false);
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
    const currentConfig = getEffectiveConfig();

    aiChatHistory.update(history => {
        const nextHistory = [...history];
        if (nextHistory[index]) {
            nextHistory[index] = {
                role: 'assistant',
                type: 'loading'
            };
        }
        return nextHistory;
    });
    saveAiChatHistory();

    try {
        if (operation?.authorizationDirectory) {
            settingsStore.addTrustedDirectory(operation.authorizationDirectory);
        }
        const result = await runLocalFilePlan(operation, operation.message || '', currentConfig, false);
        aiChatHistory.update(history => {
            const nextHistory = [...history];
            nextHistory[index] = result;
            return nextHistory;
        });
        saveAiChatHistory();
        return { success: true, result };
    } catch (error) {
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
    }
}

async function analyzeScheduledCreateIntent(userText, existingTasks, dateInfo, config, callAI) {
    const nowStr = getFormattedDateTime();
    const systemPrompt = `你是 WorkPlan 的定时任务助手。请根据用户要求创建定时任务。

【当前时间】${nowStr}
【星期映射】
- 周一=1
- 周二=2
- 周三=3
- 周四=4
- 周五=5
- 周六=6
- 周日=0

【规则】
1. 这是新增定时任务，不要修改已有任务
2. repeatDays 必须返回数字数组
3. “工作日”=[1,2,3,4,5]，“每天”=[1,2,3,4,5,6,0]，“周末”=[6,0]
4. 可以包含标题、优先级、备注、子任务、是否启用
5. 严格只返回 JSON

【输出格式】
单任务：
{"title":"任务标题","priority":"normal|urgent|critical","note":"备注","repeatDays":[1,2,3,4,5],"enabled":true,"subtasks":[{"title":"子任务","status":"todo"}]}
多任务：
{"tasks":[{...},{...}]}`;

    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) {
        return { role: 'assistant', type: 'text', content: '无法理解要创建的定时任务，请更具体地说明周期。' };
    }

    try {
        const parsed = extractJsonPayload(aiResponse);
        const normalizeTask = (task) => ({
            id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
            title: task.title || '未命名定时任务',
            status: normalizeStatus(task.status),
            priority: normalizePriority(task.priority),
            date: task.date || '',
            deadline: task.deadline || '',
            note: task.note || '',
            repeatDays: normalizeRepeatDays(task.repeatDays),
            enabled: task.enabled !== false,
            subtasks: (task.subtasks || []).map(item => ({
                title: typeof item === 'string' ? item : item.title,
                status: item.status || 'todo'
            }))
        });

        if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
            return {
                tasks: parsed.tasks.map(normalizeTask)
            };
        }

        if (parsed.title) {
            return normalizeTask(parsed);
        }

        return {
            role: 'assistant',
            type: 'text',
            content: '未能生成有效的定时任务，请明确说明重复规则，例如“每周一早上 9 点提醒我写周报”。'
        };
    } catch (error) {
        console.error('Failed to parse scheduled create response:', error, aiResponse);
        return { role: 'assistant', type: 'text', content: '解析定时任务失败，请重试。' };
    }
}

async function analyzeScheduledUpdateIntent(userText, allTasks, relevantTasks, dateInfo, config, callAI) {
    if (!allTasks || allTasks.length === 0) {
        return {
            role: 'assistant',
            type: 'text',
            content: '当前没有任何定时任务可以修改。'
        };
    }

    const scopedTasks = relevantTasks?.length ? relevantTasks : allTasks;
    const taskList = formatItemsForAI(scopedTasks, formatFullTaskForAI);
    const systemPrompt = `你是 WorkPlan 的定时任务助手。用户想修改定时任务。

【现有定时任务】
${taskList}

【星期映射】
- 周一=1
- 周二=2
- 周三=3
- 周四=4
- 周五=5
- 周六=6
- 周日=0

【允许修改字段】
- title
- priority（normal|urgent|critical）
- note
- repeatDays（数字数组）
- enabled（true/false）
- subtasks

【规则】
1. task_id 必须是完整任务 ID
2. 如果用户说“工作日”返回 [1,2,3,4,5]
3. 如果用户说“每天”返回 [1,2,3,4,5,6,0]
4. 严格只返回 JSON

【输出格式】
{
  "operations": [
    {
      "task_id": "完整任务ID",
      "updates": {
        "repeatDays": [1,3,5],
        "enabled": true
      }
    }
  ],
  "message": "修改说明"
}`;

    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) {
        return { role: 'assistant', type: 'text', content: '无法理解要修改的定时任务。' };
    }

    try {
        const parsed = extractJsonPayload(aiResponse);
        if (!Array.isArray(parsed.operations) || parsed.operations.length === 0) {
            return { role: 'assistant', type: 'text', content: parsed.message || '未找到匹配的定时任务。' };
        }

        const updateOperations = [];
        for (const operation of parsed.operations) {
            const { task } = findOneNativeItemById(scopedTasks, operation.task_id);
            if (!task || !operation.updates) continue;

            const updates = {};
            if (operation.updates.title) updates.title = operation.updates.title;
            if (operation.updates.note !== undefined) updates.note = operation.updates.note;
            const scheduledPriority = resolvePriority(operation.updates.priority);
            if (scheduledPriority) {
                updates.priority = scheduledPriority;
            }
            if (operation.updates.repeatDays !== undefined) {
                updates.repeatDays = normalizeRepeatDays(operation.updates.repeatDays);
            }
            if (typeof operation.updates.enabled === 'boolean') {
                updates.enabled = operation.updates.enabled;
            }
            if (Array.isArray(operation.updates.subtasks)) {
                updates.subtasks = operation.updates.subtasks.map(item => ({
                    title: typeof item === 'string' ? item : item.title,
                    status: item.status || 'todo'
                }));
            }

            if (Object.keys(updates).length > 0) {
                updateOperations.push({
                    task: JSON.parse(JSON.stringify(task)),
                    updates
                });
            }
        }

        if (updateOperations.length === 0) {
            return { role: 'assistant', type: 'text', content: parsed.message || '未找到可修改的内容。' };
        }

        if (updateOperations.length === 1) {
            return {
                role: 'assistant',
                type: 'update_confirm',
                task: updateOperations[0].task,
                updates: updateOperations[0].updates,
                message: parsed.message || '确认修改该定时任务吗？'
            };
        }

        return {
            role: 'assistant',
            type: 'multi_update_confirm',
            operations: updateOperations,
            message: parsed.message || `将修改 ${updateOperations.length} 个定时任务`
        };
    } catch (error) {
        console.error('Failed to parse scheduled update response:', error, aiResponse);
        return { role: 'assistant', type: 'text', content: '解析定时任务修改失败，请重试。' };
    }
}

async function analyzeTemplateCreateIntent(userText, existingTemplates, config, callAI) {
    const systemPrompt = `你是 WorkPlan 的任务模板助手。请根据用户要求创建任务模板。

【规则】
1. 这是新增模板，不要修改、删除已有模板
2. 模板不包含计划时间和截止时间，不要输出 date / deadline
3. 模板关注标题、优先级、备注、子任务结构
4. 如果用户描述了多个不同模板，拆成多个对象
5. 严格只返回 JSON

【输出格式】
单模板：
{"title":"模板标题","priority":"normal|urgent|critical","note":"备注","subtasks":[{"title":"子任务","status":"todo"}]}
多模板：
{"tasks":[{...},{...}]}`;

    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) return null;

    try {
        const parsed = extractJsonPayload(aiResponse);
        if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
            return {
                tasks: parsed.tasks.map((item, index) => normalizeTemplateEntity(item, index))
            };
        }

        if (parsed.title) {
            return normalizeTemplateEntity(parsed);
        }

        return null;
    } catch (error) {
        console.error('Failed to parse template create response:', error, aiResponse);
        return null;
    }
}

async function analyzeTemplateDeleteIntent(userText, allTemplates, config, callAI) {
    if (!allTemplates || allTemplates.length === 0) {
        return {
            role: 'assistant',
            type: 'text',
            content: '当前没有任何任务模板可以删除。'
        };
    }

    const templateList = formatItemsForAI(allTemplates, formatTemplateForAI);
    const systemPrompt = `你是 WorkPlan 的任务模板助手。用户想删除任务模板。

【现有模板】
${templateList}

【规则】
1. delete_task_ids 必须返回完整模板 ID
2. 按模板标题、关键词、优先级、备注、子任务来匹配
3. 严格只返回 JSON

【输出格式】
{
  "delete_task_ids": ["完整模板ID1", "完整模板ID2"],
  "message": "删除说明",
  "reason": "匹配原因"
}`;

    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) {
        return { role: 'assistant', type: 'text', content: '无法理解您要删除哪个模板，请更具体地描述。' };
    }

    try {
        const parsed = extractJsonPayload(aiResponse);
        if (parsed.delete_task_ids && parsed.delete_task_ids.length > 0) {
            const tasksToDelete = findNativeItemsByIds(allTemplates, parsed.delete_task_ids);
            if (tasksToDelete.length > 0) {
                return {
                    role: 'assistant',
                    type: 'delete_confirm',
                    tasks: tasksToDelete,
                    message: parsed.message || `找到 ${tasksToDelete.length} 个模板待删除`,
                    reason: parsed.reason || ''
                };
            }
        }
        return { role: 'assistant', type: 'text', content: parsed.message || '未找到匹配的模板。' };
    } catch (error) {
        console.error('Failed to parse template delete response:', error, aiResponse);
        return { role: 'assistant', type: 'text', content: '解析模板删除请求失败，请重试。' };
    }
}

async function analyzeTemplateUpdateIntent(userText, allTemplates, config, callAI) {
    if (!allTemplates || allTemplates.length === 0) {
        return {
            role: 'assistant',
            type: 'text',
            content: '当前没有任何任务模板可以修改。'
        };
    }

    const templateList = formatItemsForAI(allTemplates, formatTemplateForAI);
    const systemPrompt = `你是 WorkPlan 的任务模板助手。用户想修改任务模板。

【现有模板】
${templateList}

【允许修改字段】
- title
- priority（normal|urgent|critical）
- note
- subtasks
- status（todo|doing|done）

【规则】
1. task_id 必须是完整模板 ID
2. 不要输出 date / deadline
3. 严格只返回 JSON

【输出格式】
{
  "operations": [
    {
      "task_id": "完整模板ID",
      "updates": {
        "title": "新标题",
        "priority": "urgent",
        "note": "新备注"
      }
    }
  ],
  "message": "修改说明"
}`;

    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) {
        return { role: 'assistant', type: 'text', content: '无法理解您要修改哪个模板。' };
    }

    try {
        const parsed = extractJsonPayload(aiResponse);
        if (!Array.isArray(parsed.operations) || parsed.operations.length === 0) {
            return { role: 'assistant', type: 'text', content: parsed.message || '未找到匹配的模板。' };
        }

        const updateOperations = [];
        for (const operation of parsed.operations) {
            if (!operation.updates || Object.keys(operation.updates).length === 0) continue;
            const { task: template } = findOneNativeItemById(allTemplates, operation.task_id);
            if (!template) continue;

            const updates = {};
            if (operation.updates.title) updates.title = operation.updates.title;
            if (operation.updates.note !== undefined) updates.note = operation.updates.note;
            const templatePriority = resolvePriority(operation.updates.priority);
            if (templatePriority) {
                updates.priority = templatePriority;
            }
            const templateStatus = resolveStatus(operation.updates.status);
            if (templateStatus) {
                updates.status = templateStatus;
            }
            if (Array.isArray(operation.updates.subtasks)) {
                updates.subtasks = operation.updates.subtasks.map(item => ({
                    title: typeof item === 'string' ? item : (item.title || ''),
                    status: item.status || 'todo'
                }));
            }

            if (Object.keys(updates).length > 0) {
                updateOperations.push({
                    task: JSON.parse(JSON.stringify(template)),
                    updates
                });
            }
        }

        if (updateOperations.length === 0) {
            return { role: 'assistant', type: 'text', content: parsed.message || '未找到可修改的模板内容。' };
        }

        if (updateOperations.length === 1) {
            return {
                role: 'assistant',
                type: 'update_confirm',
                task: updateOperations[0].task,
                updates: updateOperations[0].updates,
                message: parsed.message || '确认修改该模板吗？'
            };
        }

        return {
            role: 'assistant',
            type: 'multi_update_confirm',
            operations: updateOperations,
            message: parsed.message || `将修改 ${updateOperations.length} 个任务模板`
        };
    } catch (error) {
        console.error('Failed to parse template update response:', error, aiResponse);
        return { role: 'assistant', type: 'text', content: '解析模板修改失败，请重试。' };
    }
}

async function analyzeTemplateMixedIntent(userText, allTemplates, config, callAI) {
    if (!allTemplates || allTemplates.length === 0) {
        return {
            role: 'assistant',
            type: 'text',
            content: '当前没有任何任务模板可以操作。'
        };
    }

    const templateList = formatItemsForAI(allTemplates, formatTemplateForAI);
    const systemPrompt = `你是 WorkPlan 的任务模板助手。用户想对模板执行混合操作（修改和删除）。

【现有模板】
${templateList}

【规则】
1. 只允许 delete 和 update 两种操作
2. update 只允许 title、priority、note、subtasks、status
3. 不要输出 date / deadline
4. 严格只返回 JSON

【输出格式】
{
  "update_operations": [
    {
      "task_id": "完整模板ID",
      "updates": {
        "title": "新标题",
        "priority": "urgent"
      }
    }
  ],
  "delete_task_ids": ["完整模板ID"],
  "message": "操作说明"
}`;

    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) {
        return { role: 'assistant', type: 'text', content: '无法理解模板混合操作，请重试。' };
    }

    try {
        const parsed = extractJsonPayload(aiResponse);
        const updateOps = [];
        const deleteOps = findNativeItemsByIds(allTemplates, parsed.delete_task_ids || []);

        for (const operation of parsed.update_operations || []) {
            const { task: template } = findOneNativeItemById(allTemplates, operation.task_id);
            if (!template || !operation.updates) continue;

            const updates = {};
            if (operation.updates.title) updates.title = operation.updates.title;
            if (operation.updates.note !== undefined) updates.note = operation.updates.note;
            const mixedPriority = resolvePriority(operation.updates.priority);
            if (mixedPriority) {
                updates.priority = mixedPriority;
            }
            const mixedStatus = resolveStatus(operation.updates.status);
            if (mixedStatus) {
                updates.status = mixedStatus;
            }
            if (Array.isArray(operation.updates.subtasks)) {
                updates.subtasks = operation.updates.subtasks.map(item => ({
                    title: typeof item === 'string' ? item : (item.title || ''),
                    status: item.status || 'todo'
                }));
            }

            if (Object.keys(updates).length > 0) {
                updateOps.push({
                    task: JSON.parse(JSON.stringify(template)),
                    updates
                });
            }
        }

        if (!updateOps.length && !deleteOps.length) {
            return {
                role: 'assistant',
                type: 'text',
                content: parsed.message || '未找到匹配的模板操作。'
            };
        }

        return {
            role: 'assistant',
            type: 'mixed_confirm',
            updateOps,
            deleteOps,
            message: parsed.message || '确认执行模板批量操作吗？'
        };
    } catch (error) {
        console.error('Failed to parse template mixed response:', error, aiResponse);
        return { role: 'assistant', type: 'text', content: '解析模板混合操作失败，请重试。' };
    }
}

async function analyzeTemplateQueryIntent(userText, allTemplates, config, callAI) {
    if (!allTemplates || allTemplates.length === 0) {
        return {
            role: 'assistant',
            type: 'text',
            content: '当前没有任何任务模板。'
        };
    }

    const templateList = formatItemsForAI(allTemplates, formatTemplateForAI);
    const systemPrompt = `你是 WorkPlan 的任务模板助手。用户想查询任务模板。

【现有模板】
${templateList}

【查询范围】
1. 标题关键词
2. 优先级
3. 备注内容
4. 子任务内容
5. 状态

【输出格式】
严格只返回 JSON：
{
  "matched_task_ids": ["完整模板ID1", "完整模板ID2"],
  "summary": "查询结果描述",
  "filter_description": "筛选条件说明"
}`;

    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) {
        return { role: 'assistant', type: 'text', content: '模板查询失败，请重试。' };
    }

    try {
        const parsed = extractJsonPayload(aiResponse);
        if (parsed.matched_task_ids && parsed.matched_task_ids.length > 0) {
            const matchedTemplates = findNativeItemsByIds(allTemplates, parsed.matched_task_ids);
            if (matchedTemplates.length > 0) {
                return {
                    role: 'assistant',
                    type: 'query_result',
                    tasks: matchedTemplates,
                    summary: parsed.summary || `找到 ${matchedTemplates.length} 个模板`,
                    filterDescription: parsed.filter_description || ''
                };
            }
        }

        return { role: 'assistant', type: 'text', content: parsed.summary || '未找到匹配的模板。' };
    } catch (error) {
        console.error('Failed to parse template query response:', error, aiResponse);
        return { role: 'assistant', type: 'text', content: '解析模板查询失败，请重试。' };
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

function splitCreateIntentSegments(userText = '') {
    const rawText = String(userText || '').trim();
    if (!rawText) {
        return [];
    }

    const separatorNormalized = rawText
        .replace(/\r\n/g, '\n')
        .replace(/[；;]+/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .replace(/(?<=[^，。,])，(?=(今天|明天|后天|今晚|上午|中午|下午|傍晚|晚上|本周|下周|下个月|周[一二三四五六日天]|\d{1,2}[:点]))/g, '\n')
        .replace(/(?:然后|接着|随后|并且|再)(?=(今天|明天|后天|今晚|上午|中午|下午|傍晚|晚上|本周|下周|下个月|周[一二三四五六日天]|\d{1,2}[:点]))/g, '\n');

    return separatorNormalized
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item, index, arr) => arr.indexOf(item) === index);
}

async function analyzeCreateIntentWithAI(userText, dateInfo, config, callAI) {
    const nowStr = getFormattedDateTime();
    const todayStr = formatDateForAI(dateInfo.today);
    const tomorrowStr = formatDateForAI(dateInfo.tomorrow);
    const dayAfterTomorrowStr = formatDateForAI(dateInfo.dayAfterTomorrow);

    const systemPrompt = `你是一个智能任务管理助手。请根据用户的自然语言描述创建任务。

【当前时间信息】
- 现在时间: ${nowStr}
- 今天: ${todayStr} (${dateInfo.weekdayName})
- 明天: ${tomorrowStr}
- 后天: ${dayAfterTomorrowStr}
- 本周: ${formatDateForAI(dateInfo.thisWeek.start)} 至 ${formatDateForAI(dateInfo.thisWeek.end)}

【核心规则 - 必须严格遵守】
1. 这是一个【新增任务】的请求，必须创建新任务
2. 绝对不能修改、更新、删除任何现有任务
3. 不要检查是否存在同名任务，直接创建新任务
4. 即使用户描述的任务与现有任务完全相同，也必须创建新任务
5. 输出格式必须是创建任务的JSON格式

【补录已完成任务识别 - 重要】
当用户描述的是"已经做完的事"（即补录历史任务），必须把任务的 status 设为 "done"，并把 completedDate 设为对应的完成时间（YYYY-MM-DDTHH:mm）。
判断信号包括：
- 出现过去时间词："昨天"、"前天"、"上周"、"上个月"、"之前"、"刚才"等
- 配合完成动词："已完成"、"已经完成"、"完成了"、"做完了"、"搞定了"、"已经做完"、"刚做完"
- 显式补录词："补录"、"补记"、"补登记"、"记录一下"、"录入"
示例：
- "昨天修改了错别字，昨天16时已经完成" → date 和 completedDate 都用昨天16:00，status="done"
- "刚才补录一下：今天上午10点处理了客户投诉" → date 和 completedDate 用今天10:00，status="done"
- "上周三下午写完了周报" → 算出上周三日期，时间用14:00，status="done"
如果用户没说完成时间但说了"已完成"，completedDate 用任务的 date 字段值兜底。
如果是未来要做的任务，status 不要写 done，省略 completedDate 字段或留空。

【任务拆分规则】
1. 如果用户描述包含多个不同的任务（不同时间或不同事项），必须拆分成多个独立任务对象
2. 如果单个任务较复杂（包含多个步骤），需要创建子任务（subtasks）
3. "下周一到下周五" 表示需要创建5个任务，每天一个

【子任务生成指引 - 主动推理】
对每个任务都要主动思考："这件事要做完，需要哪几步？"，而不是只在用户明确列出步骤时才拆。
- 显式信号（必拆）：用户用"先...再...""包括""步骤是""分几步"或顿号/逗号串联多个动作 → 按用户给的动作直接拆
- 隐式推理（应拆）：任务本身是常识性多步骤工作时，主动推断标准子步骤。例如：
  · "准备季度汇报" → 收集数据 / 撰写大纲 / 制作PPT / 内部review / 正式汇报
  · "上线新功能" → 代码合并 / 部署预发 / 冒烟测试 / 切换生产流量 / 观察监控
  · "面试候选人小王" → 阅读简历 / 准备问题清单 / 进行面试 / 写评估反馈
  · "搬家" → 打包物品 / 联系搬家公司 / 搬运 / 拆箱整理
- 子任务标题用动作短语（动词开头），不要重复主任务名
- 单一原子动作（"修改一个错别字""回复一条微信"）不需要子任务
- 拿不准时倾向于拆出 2-4 个子任务，帮用户提前看清工作量；但不要为了凑数生造无意义的步骤
- 补录已完成任务时，子任务的 status 跟随父任务设为 "done"

【备注（note）生成指引 - 主动推理】
对每个任务都要扫一遍用户原话："除了任务名和时间，他还说了什么有用信息？" 这些信息应当进 note，避免丢失。
应当写进 note 的内容包括但不限于：
- 对接人、参与者："和张总开会" → note 写"参与人：张总"
- 地点、链接、单据号、文件路径："去财务报销 5月差旅" → note 写"报销内容：5月差旅"
- 目的、背景、约束："改 README 里的错别字，老板说下午 review" → note 写"老板下午 review，需在此之前完成"
- 用户口语化的补充说明、注意事项、参考资料
- 完成方式、交付物的描述
原则：
- note 是给未来的用户自己看的提示，写人话，不要写"备注："这种前缀
- 不要把已经放进 title/date/deadline/priority 的内容再抄一遍到 note
- 用户原话信息全部已经映射到结构化字段，确实没有额外细节时，note 才用空字符串 ""

【时间解析规则】
- "上午" = 09:00, "中午" = 12:00, "下午" = 14:00, "傍晚" = 17:00, "晚上" = 19:00
- 如果用户说"8点到10点"，date设为开始时间，deadline设为结束时间
- 默认创建的是当前时间往后的任务，除非用户明确提到过去的时间
- 用户明确提到过去时间时（如"昨天"、"上周"），date 必须使用过去日期，不要平移到未来

【输出格式】
严格只返回纯 JSON 格式，不要包含任何 markdown 标记或解释文字
单任务: {"title":"任务标题","date":"YYYY-MM-DDTHH:mm","deadline":"YYYY-MM-DDTHH:mm或空字符串","priority":"normal|urgent|critical","status":"todo|doing|done","completedDate":"YYYY-MM-DDTHH:mm或空字符串","note":"备注","subtasks":[{"title":"子任务名","status":"todo|done"}]}
多任务: {"tasks":[{...},{...}]}

【priority说明】
- normal: 普通任务
- urgent: 用户强调"紧急"、"重要"、"优先"
- critical: 用户强调"特急"、"非常紧急"、"最优先"

【status说明】
- todo: 默认值，未开始
- doing: 用户表示"在做"、"进行中"、"已经在弄了"
- done: 补录已完成任务时使用`;

    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) return [];

    try {
        const cleanJsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : cleanJsonStr;
        const parsed = JSON.parse(jsonStr);

        const fallbackDate = `${formatDateForAI(dateInfo.today)}T09:00`;

        if (parsed.tasks && Array.isArray(parsed.tasks)) {
            return parsed.tasks.map((task, index) => normalizeCreatedTask(task, fallbackDate, index));
        }

        return [normalizeCreatedTask(parsed, fallbackDate, 0)];
    } catch (e) {
        console.error('Failed to parse AI response:', e, aiResponse);
        return [];
    }
}

async function analyzeCreateIntent(userText, existingTasks, dateInfo, config, callAI) {
    const tasksFromAI = await analyzeCreateIntentWithAI(userText, dateInfo, config, callAI);
    const segments = splitCreateIntentSegments(userText);

    if (tasksFromAI.length > 1 || segments.length <= 1) {
        return tasksFromAI.length > 1 ? { tasks: tasksFromAI } : (tasksFromAI[0] || null);
    }

    const segmentTasks = [];
    for (const segment of segments) {
        const parsedTasks = await analyzeCreateIntentWithAI(segment, dateInfo, config, callAI);
        if (parsedTasks.length > 0) {
            segmentTasks.push(...parsedTasks);
        }
    }

    const uniqueTasks = segmentTasks.filter((task, index, arr) => {
        const signature = `${task.title}|${task.date}|${task.deadline}|${task.note}`;
        return index === arr.findIndex((candidate) =>
            `${candidate.title}|${candidate.date}|${candidate.deadline}|${candidate.note}` === signature
        );
    });

    if (uniqueTasks.length > 1) {
        return { tasks: uniqueTasks };
    }

    return tasksFromAI[0] || uniqueTasks[0] || null;
}

async function analyzeSubtaskIntent(userText, allTasks, relevantTasks, dateInfo, config, callAI) {
    if (!allTasks || allTasks.length === 0) {
        return {
            role: 'assistant',
            type: 'text',
            content: '当前没有任何任务可以操作子任务。'
        };
    }
    if (!relevantTasks || relevantTasks.length === 0) {
        return {
            role: 'assistant',
            type: 'text',
            content: '在指定的时间范围内没有找到可操作的任务。'
        };
    }

    const nowStr = getFormattedDateTime();
    const taskList = formatItemsForAI(relevantTasks, formatFullTaskForAI);

    const systemPrompt = `你是一个智能任务管理助手。用户想要对任务的子任务进行操作。

【当前时间】${nowStr}
【今天】${formatDateForAI(dateInfo.today)}
【明天】${formatDateForAI(dateInfo.tomorrow)}

【所有任务列表（含子任务详情）】
${taskList}

【子任务操作类型】
- add: 添加新子任务
- delete: 删除指定子任务
- update: 修改子任务内容
- toggle: 切换子任务完成状态

【输出格式】
严格只返回 JSON：
{
  "task_id": "要操作的任务完整ID",
  "operation": "add|delete|update|toggle",
  "subtask_changes": [
    {
      "action": "add|delete|update|toggle",
      "index": 0,
      "old_title": "原子任务名（删除/修改时需要）",
      "new_title": "新子任务名（添加/修改时需要）",
      "status": "todo|done"
    }
  ],
  "message": "操作说明"
}

【重要】
1. task_id 必须是完整的任务ID
2. 删除和修改时需要提供 old_title 来精确匹配
3. index 从0开始，用于指定子任务位置
4. 如果找不到匹配的任务或子任务，返回 {"task_id": "", "message": "未找到..."}`;

    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) {
        return { role: 'assistant', type: 'text', content: '无法理解您的子任务操作请求。' };
    }

    try {
        const cleanJsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { role: 'assistant', type: 'text', content: 'AI 返回了无效的格式，请重试。' };
        }

        const parsed = JSON.parse(jsonMatch[0]);

        if (!parsed.task_id || !parsed.subtask_changes || parsed.subtask_changes.length === 0) {
            return { role: 'assistant', type: 'text', content: parsed.message || '未找到匹配的任务或子任务。' };
        }

        const { task, reason } = findOneNativeItemById(relevantTasks, parsed.task_id);
        if (!task) {
            return {
                role: 'assistant',
                type: 'text',
                content: reason === 'ambiguous'
                    ? `ID "${parsed.task_id}" 匹配到多个任务，无法确定要操作哪一个，请提供完整 ID。`
                    : '未找到指定的任务。'
            };
        }

        return {
            role: 'assistant',
            type: 'subtask_confirm',
            task: JSON.parse(JSON.stringify(task)),
            subtaskChanges: parsed.subtask_changes,
            message: parsed.message || `确认对 "${task.title}" 的子任务进行操作？`
        };

    } catch (e) {
        console.error('Failed to parse subtask response:', e, aiResponse);
        return { role: 'assistant', type: 'text', content: '解析子任务操作失败，请重新描述。' };
    }
}

async function analyzeDeleteIntent(userText, allTasks, relevantTasks, dateInfo, config, callAI) {
    if (!allTasks || allTasks.length === 0) {
        return {
            role: 'assistant',
            type: 'text',
            content: '当前没有任何任务可以删除。'
        };
    }
    if (relevantTasks.length === 0) {
        // 未指代现有任务（无 任务/这个那个/把…删除 等）→ 视为描述新工作，自动新建。
        if (!referencesExistingTask(userText)) {
            return await analyzeCreateIntent(userText, allTasks, dateInfo, config, callAI);
        }
        return {
            role: 'assistant',
            type: 'text',
            content: '在指定的时间范围内没有找到任务。请检查时间描述是否正确。'
        };
    }
    const nowStr = getFormattedDateTime();
    const taskList = formatItemsForAI(relevantTasks, formatFullTaskForAI);
    const systemPrompt = `你是一个智能任务管理助手。用户想要删除任务。
【当前时间】${nowStr}
【今天】${formatDateForAI(dateInfo.today)}
【明天】${formatDateForAI(dateInfo.tomorrow)}
【后天】${formatDateForAI(dateInfo.dayAfterTomorrow)}
【相关时间范围内的任务列表】
${taskList}
【任务说明】
- 用户说"删除明天后天的任务"意味着删除明天和后天的所有任务
- 用户说"后天暂时不做"意味着删除后天的任务
- 用户说"取消某某任务"意味着删除标题包含"某某"的任务
【输出格式】
严格只返回 JSON，格式：
{
  "delete_task_ids": ["完整任务ID1", "完整任务ID2"],
  "message": "将删除X个任务：任务1、任务2...",
  "reason": "删除原因说明"
}
如果找不到匹配的任务，返回：
{"delete_task_ids": [], "message": "未找到匹配的任务", "reason": "原因"}
【重要】
1. delete_task_ids 必须是任务的完整 ID，不是后4位
2. 仔细分析用户意图，确保找到所有符合条件的任务
3. 如果用户说"明天后天"，要同时匹配明天和后天的所有任务`;
    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) {
        return { role: 'assistant', type: 'text', content: '无法理解您要删除哪个任务，请更具体地描述。' };
    }
    try {
        const cleanJsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleanJsonStr);
        if (parsed.delete_task_ids && parsed.delete_task_ids.length > 0) {
            const tasksToDelete = findNativeItemsByIds(relevantTasks, parsed.delete_task_ids);
            if (tasksToDelete.length > 0) {
                return {
                    role: 'assistant',
                    type: 'delete_confirm',
                    tasks: tasksToDelete,
                    message: parsed.message || `找到 ${tasksToDelete.length} 个任务待删除`,
                    reason: parsed.reason || ''
                };
            }
        }
        return { role: 'assistant', type: 'text', content: parsed.message || '未找到匹配的任务。' };
    } catch (e) {
        console.error('Failed to parse delete response:', e, aiResponse);
        return { role: 'assistant', type: 'text', content: '解析失败，请重新描述要删除的任务。' };
    }
}

async function analyzeUpdateIntent(userText, allTasks, relevantTasks, dateInfo, config, callAI) {
    if (!allTasks || allTasks.length === 0) {
        return {
            role: 'assistant',
            type: 'text',
            content: '当前没有任何任务可以修改。'
        };
    }
    if (!relevantTasks || relevantTasks.length === 0) {
        if (!referencesExistingTask(userText)) {
            return await analyzeCreateIntent(userText, allTasks, dateInfo, config, callAI);
        }
        return {
            role: 'assistant',
            type: 'text',
            content: '在指定的时间范围内没有找到可修改的任务。'
        };
    }
    const nowStr = getFormattedDateTime();
    const taskList = formatItemsForAI(relevantTasks, formatFullTaskForAI);
    const lowerText = userText.toLowerCase();
    const statusKeywords = {
        done: ['完成', '搞定', '做完', '已完成', 'complete', 'done', 'finish'],
        doing: ['进行中', '正在做', '开始做', '开始', 'doing', 'in progress', 'start'],
        todo: ['未开始', '待办', '重置', '还原', '取消开始', 'todo', 'pending', 'not started']
    };
    let detectedStatus = null;
    for (const [status, keywords] of Object.entries(statusKeywords)) {
        if (keywords.some(kw => lowerText.includes(kw))) {
            detectedStatus = status;
            break;
        }
    }
    if (detectedStatus) {
        const statusPrompt = `你是一个智能任务管理助手。用户想要将任务状态修改为 ${detectedStatus}。
【当前时间】${nowStr}
【今天】${formatDateForAI(dateInfo.today)}
【所有任务列表】
${taskList}
【状态说明】
- todo: 未开始
- doing: 进行中
- done: 已完成
【输出格式】
严格只返回纯 JSON，不要任何额外文字：
{
  "operations": [
    {
      "task_id": "完整任务ID",
      "action": "update",
      "updates": { "status": "${detectedStatus}" }
    }
  ],
  "message": "已修改"
}
【重要】
1. task_id 必须是完整的任务ID
2. status 只能是 todo、doing 或 done
3. 不要返回中文描述，只返回 JSON`;
        const aiResponse = await callAI(config, userText, statusPrompt);
        if (!aiResponse) {
            return { role: 'assistant', type: 'text', content: '无法理解您要修改什么。' };
        }
        try {
            const cleanJsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            const jsonMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return { role: 'assistant', type: 'text', content: 'AI 返回了无效的格式，请重试。' };
            }
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.operations && parsed.operations.length > 0) {
                const updateOperations = [];
                for (const op of parsed.operations) {
                    const { task } = findOneNativeItemById(relevantTasks, op.task_id);
                    if (task) {
                        const updates = { status: detectedStatus };
                        if (detectedStatus === 'done') {
                            updates.completedDate = new Date().toISOString().slice(0, 16);
                        } else if (detectedStatus === 'doing' && !task.startTime) {
                            updates.startTime = new Date().toISOString().slice(0, 16);
                        }
                        updateOperations.push({
                            task: JSON.parse(JSON.stringify(task)),
                            updates: updates
                        });
                    }
                }
                if (updateOperations.length > 0) {
                    const statusLabels = { todo: '未开始', doing: '进行中', done: '已完成' };
                    return {
                        role: 'assistant',
                        type: updateOperations.length === 1 ? 'update_confirm' : 'multi_update_confirm',
                        ...(updateOperations.length === 1
                            ? { task: updateOperations[0].task, updates: updateOperations[0].updates }
                            : { operations: updateOperations }
                        ),
                        message: `将 ${updateOperations.length} 个任务状态修改为"${statusLabels[detectedStatus]}"`
                    };
                }
            }
            return { role: 'assistant', type: 'text', content: '未找到匹配的任务。' };
        } catch (e) {
            console.error('Failed to parse status update:', e, aiResponse);
            return { role: 'assistant', type: 'text', content: '解析失败，请重新描述。' };
        }
    }
    const systemPrompt = `你是一个智能任务管理助手。用户想要修改任务。
【当前时间】${nowStr}
【今天】${formatDateForAI(dateInfo.today)}
【明天】${formatDateForAI(dateInfo.tomorrow)}
【后天】${formatDateForAI(dateInfo.dayAfterTomorrow)}
【所有任务列表】
${taskList}
【重要规则】
1. task_id 必须是完整的任务ID
2. 优先级：normal（普通）、urgent（紧急）、critical（特急）
3. 状态：todo（未开始）、doing（进行中）、done（已完成）
4. 严格只返回 JSON，不要任何 markdown 标记或额外文字
【输出格式】
{
  "operations": [
    {
      "task_id": "完整任务ID",
      "action": "update",
      "updates": {
        "priority": "urgent"
      }
    }
  ],
  "message": "已修改"
}
如果找不到任务：{"operations": [], "message": "未找到匹配的任务"}`;
    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) {
        return { role: 'assistant', type: 'text', content: '无法理解您要修改什么。' };
    }
    try {
        const cleanJsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { role: 'assistant', type: 'text', content: 'AI 返回了无效格式，请重试。' };
        }
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.operations && parsed.operations.length > 0) {
            const updateOperations = [];
            for (const op of parsed.operations) {
                if (!op.updates || Object.keys(op.updates).length === 0) continue;
                const { task } = findOneNativeItemById(relevantTasks, op.task_id);
                if (!task) continue;
                const taskSnapshot = {
                    id: task.id, title: task.title, date: task.date,
                    deadline: task.deadline, priority: task.priority,
                    status: task.status, note: task.note, subtasks: task.subtasks
                };
                const cleanUpdates = {};
                if (op.updates.title) cleanUpdates.title = op.updates.title;
                if (op.updates.date) cleanUpdates.date = op.updates.date;
                if (op.updates.deadline) cleanUpdates.deadline = op.updates.deadline;
                if (op.updates.note !== undefined) cleanUpdates.note = op.updates.note;
                if (op.updates.priority) {
                    const normalized = resolvePriority(op.updates.priority);
                    if (normalized) {
                        cleanUpdates.priority = normalized;
                    }
                }
                if (op.updates.status) {
                    const normalized = resolveStatus(op.updates.status);
                    if (normalized) {
                        cleanUpdates.status = normalized;
                        if (normalized === 'done') {
                            cleanUpdates.completedDate = new Date().toISOString().slice(0, 16);
                        } else if (normalized === 'doing' && !task.startTime) {
                            cleanUpdates.startTime = new Date().toISOString().slice(0, 16);
                        }
                    }
                }
                if (Object.keys(cleanUpdates).length > 0) {
                    updateOperations.push({ task: taskSnapshot, updates: cleanUpdates });
                }
            }
            if (updateOperations.length > 0) {
                if (updateOperations.length === 1) {
                    return {
                        role: 'assistant',
                        type: 'update_confirm',
                        task: updateOperations[0].task,
                        updates: updateOperations[0].updates,
                        message: parsed.message || '确认修改？'
                    };
                } else {
                    return {
                        role: 'assistant',
                        type: 'multi_update_confirm',
                        operations: updateOperations,
                        message: parsed.message || `将修改 ${updateOperations.length} 个任务`
                    };
                }
            }
        }
        return { role: 'assistant', type: 'text', content: parsed.message || '未找到任务或无需修改。' };
    } catch (e) {
        console.error('Failed to parse update:', e, aiResponse);
        return { role: 'assistant', type: 'text', content: '解析失败，请重试。' };
    }
}

async function analyzeMixedIntent(userText, allTasks, relevantTasks, dateInfo, config, callAI) {
    if (!allTasks || allTasks.length === 0) {
        return {
            role: 'assistant',
            type: 'text',
            content: '当前没有任何任务可以操作。'
        };
    }
    if (!relevantTasks || relevantTasks.length === 0) {
        if (!referencesExistingTask(userText)) {
            return await analyzeCreateIntent(userText, allTasks, dateInfo, config, callAI);
        }
        return {
            role: 'assistant',
            type: 'text',
            content: '在指定的时间范围内没有找到可操作的任务。'
        };
    }
    const nowStr = getFormattedDateTime();
    const taskList = formatItemsForAI(relevantTasks, formatFullTaskForAI);
    const systemPrompt = `你是一个智能任务管理助手。用户想要修改任务。
【当前时间】${nowStr}
【今天】${formatDateForAI(dateInfo.today)}
【明天】${formatDateForAI(dateInfo.tomorrow)}
【后天】${formatDateForAI(dateInfo.dayAfterTomorrow)}
【所有任务列表】
${taskList}
【优先级说明】
- normal: 普通任务
- urgent: 紧急任务
- critical: 特急任务
【输出格式】
严格只返回 JSON，updates 中只包含需要修改的字段：
{
  "operations": [
    {
      "task_id": "完整任务ID",
      "action": "update",
      "updates": {
        "title": "新标题（不修改则省略此字段）",
        "date": "YYYY-MM-DDTHH:mm（不修改则省略此字段）",
        "deadline": "YYYY-MM-DDTHH:mm（不修改则省略此字段）",
        "priority": "normal|urgent|critical（不修改则省略此字段）",
        "note": "新备注（不修改则省略此字段）"
      }
    }
  ],
  "message": "修改说明"
}
【重要】
1. task_id 必须是完整任务ID
2. priority 只能是 normal、urgent 或 critical，不能是中文
3. 如果用户说"改为紧急"，priority 应为 "urgent"
4. 如果用户说"改为特急"，priority 应为 "critical"
如果找不到任务，返回：{"operations": [], "message": "未找到匹配的任务"}`;
    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) {
        return { role: 'assistant', type: 'text', content: '无法理解您的请求，请更具体地描述。' };
    }
    try {
        const cleanJsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleanJsonStr);
        if (parsed.operations && parsed.operations.length > 0) {
            const updateOperations = [];
            for (const op of parsed.operations) {
                const { task } = findOneNativeItemById(relevantTasks, op.task_id);
                if (task && op.updates && Object.keys(op.updates).length > 0) {
                    const taskSnapshot = JSON.parse(JSON.stringify(task));
                    if (op.updates.priority) {
                        // Drop an unrecognized priority instead of forcing 'normal',
                        // which would demote a task the user never asked to change.
                        const normalizedPriority = resolvePriority(op.updates.priority);
                        if (normalizedPriority) {
                            op.updates.priority = normalizedPriority;
                        } else {
                            delete op.updates.priority;
                        }
                    }
                    updateOperations.push({
                        task: taskSnapshot,
                        updates: op.updates
                    });
                }
            }
            if (updateOperations.length > 0) {
                if (updateOperations.length === 1) {
                    return {
                        role: 'assistant',
                        type: 'update_confirm',
                        task: updateOperations[0].task,
                        updates: updateOperations[0].updates,
                        message: parsed.message || '确认修改以下内容？'
                    };
                } else {
                    return {
                        role: 'assistant',
                        type: 'multi_update_confirm',
                        operations: updateOperations,
                        message: parsed.message || `将修改 ${updateOperations.length} 个任务`
                    };
                }
            }
        }
        return { role: 'assistant', type: 'text', content: parsed.message || '未找到匹配的任务或无法理解操作。' };
    } catch (e) {
        console.error('Failed to parse mixed response:', e, aiResponse);
        return { role: 'assistant', type: 'text', content: '解析失败，请重新描述您的需求。' };
    }
}

async function analyzeQueryIntent(userText, allTasks, relevantTasks, dateInfo, config, callAI) {
    if (!allTasks || allTasks.length === 0) {
        return {
            role: 'assistant',
            type: 'text',
            content: '当前没有任何任务。'
        };
    }
    if (!relevantTasks || relevantTasks.length === 0) {
        return {
            role: 'assistant',
            type: 'text',
            content: '在指定的时间范围内没有找到任务。'
        };
    }
    const nowStr = getFormattedDateTime();
    const taskList = formatItemsForAI(relevantTasks, formatFullTaskForAI);
    const systemPrompt = `你是一个智能任务管理助手。用户想要查询任务。
【当前时间】${nowStr}
【今天】${formatDateForAI(dateInfo.today)}
【明天】${formatDateForAI(dateInfo.tomorrow)}
【后天】${formatDateForAI(dateInfo.dayAfterTomorrow)}
【本周】${formatDateForAI(dateInfo.thisWeek.start)} 至 ${formatDateForAI(dateInfo.thisWeek.end)}
【所有任务列表】
${taskList}
【查询类型】
- 按时间: "今天的任务"、"明天有什么"、"本周的任务"
- 按状态: "未完成的任务"、"进行中的"、"已完成的"
- 按关键词: "关于会议的任务"、"开发相关的"
- 按优先级: "紧急任务"、"重要的任务"
【输出格式】
严格只返回 JSON：
{
  "matched_task_ids": ["完整任务ID1", "完整任务ID2"],
  "summary": "查询结果描述",
  "filter_description": "筛选条件说明"
}`;
    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) {
        return { role: 'assistant', type: 'text', content: '查询失败，请重试。' };
    }
    try {
        const cleanJsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleanJsonStr);
        if (parsed.matched_task_ids && parsed.matched_task_ids.length > 0) {
            const matchedTasks = findNativeItemsByIds(relevantTasks, parsed.matched_task_ids);
            if (matchedTasks.length > 0) {
                return {
                    role: 'assistant',
                    type: 'query_result',
                    tasks: matchedTasks,
                    summary: parsed.summary || `找到 ${matchedTasks.length} 个任务`,
                    filterDescription: parsed.filter_description || ''
                };
            }
        }
        return { role: 'assistant', type: 'text', content: parsed.summary || '未找到匹配的任务。' };
    } catch (e) {
        console.error('Failed to parse query response:', e, aiResponse);
        return { role: 'assistant', type: 'text', content: '查询解析失败，请重新描述。' };
    }
}

async function getProjectContextSummary() {
    const { taskStore } = await import('./tasks.js');

    const taskState = get(taskStore);
    const noteState = get(notesStore);

    const formatSummaryLines = (items, label, formatter, limit = AI_PROJECT_SUMMARY_LIMIT) => {
        const sourceItems = Array.isArray(items) ? items : [];
        if (sourceItems.length === 0) return `- [${label}] 暂无`;

        const shownItems = Number.isFinite(limit)
            ? sourceItems.slice(-limit)
            : sourceItems;
        const lines = shownItems.map(formatter);
        if (sourceItems.length > shownItems.length) {
            lines.push(`- [${label}] 共 ${sourceItems.length} 项，项目摘要显示最近 ${shownItems.length} 项`);
        }
        return lines.join('\n');
    };

    const dateInfo = getDateInfo();
    const defaultTaskScope = getDefaultTaskTimeScope(dateInfo);
    const allTasks = taskState.tasks || [];
    const scopedTasks = filterTasksByTimeScope(allTasks, defaultTaskScope);
    const taskRangeLine = `- [任务范围] ${formatDateForAI(defaultTaskScope.startDate)} 至 ${formatDateForAI(defaultTaskScope.endDate)}，范围内 ${scopedTasks.length} / 全部 ${allTasks.length} 项`;
    const taskLines = formatSummaryLines(
        scopedTasks,
        '任务',
        task => `- [任务] ${task.title} | ${task.status} | ${task.date}`,
        Infinity
    );
    const templateLines = formatSummaryLines(
        taskState.templates || [],
        '模板',
        template => `- [模板] ${template.title}`
    );
    const scheduledLines = formatSummaryLines(
        taskState.scheduledTasks || [],
        '定时',
        task => `- [定时] ${task.title} | ${Array.isArray(task.repeatDays) ? task.repeatDays.join(',') : ''}`
    );
    const accessibleNotes = (noteState.notes || [])
        .filter(note => !note.aiLocked);
    const noteLines = formatSummaryLines(
        accessibleNotes,
        '笔记',
        note => `- [笔记] ${note.title} | ${note.category || '未分类'}`
    );

    return [
        '【项目上下文】',
        taskRangeLine,
        taskLines,
        templateLines,
        scheduledLines,
        noteLines
    ].join('\n');
}

async function buildContextMessages(history, chatStyle, bodyFormat = 'openai') {
    const nowStr = getFormattedDateTime();
    const projectContext = await getProjectContextSummary();
    const stylePrompts = {
        default: `你是一个智能助手。当前时间：${nowStr}。请用友好、专业的方式回答用户问题。\n${projectContext}`,
        fun: `你是 Grok，一个由 xAI 打造的 AI 助手。当前时间：${nowStr}。
性格特点：极度风趣、毒舌、戏谑、爱自黑，回答充满冷笑话和宇宙级吐槽，但逻辑清晰、事实准确。\n${projectContext}`,
        professional: `你是一个专业严谨的助手。当前时间：${nowStr}。请用正式、专业的语气回答，注重逻辑和准确性。\n${projectContext}`,
        concise: `你是一个简洁高效的助手。当前时间：${nowStr}。请用最简短的方式回答问题，直击要点。\n${projectContext}`,
        teacher: `你是一个耐心的老师。当前时间：${nowStr}。请用循循善诱的方式解释问题，适当举例说明。\n${projectContext}`
    };
    const systemPrompt = stylePrompts[chatStyle] || stylePrompts.default;
    const messages = [{ role: 'system', content: systemPrompt }];
    const validHistory = history.filter(msg => {
        if (!msg.content && !msg.summary && !msg.data && !msg.plan && !msg.attachments?.length) return false;
        if (msg.role !== 'user' && msg.role !== 'assistant') return false;
        // Skip transient types that don't carry meaningful content
        if (msg.type === 'loading' || msg.type === 'streaming' || msg.type === 'tool_progress') return false;
        return true;
    });
    const recentHistory = validHistory.slice(-20);
    for (const msg of recentHistory) {
        if (msg.role === 'user') {
            const content = buildUserMessageContentForAI(msg, bodyFormat);
            if (bodyFormat === 'google' && Array.isArray(content)) {
                messages.push({ role: 'user', parts: content });
            } else {
                messages.push({ role: 'user', content });
            }
        } else {
            // Flatten non-text assistant message types into text for context
            let content = msg.content || '';
            if (msg.type === 'web_search_result') {
                const entries = (msg.entries || []).map(e => `- [${e.title}](${e.url}): ${e.snippet || ''}`).join('\n');
                content = (msg.summary || '') + (entries ? '\n' + entries : '');
            } else if (msg.type === 'task_card' && msg.data) {
                content = `[任务] ${msg.data.title || ''}${msg.data.date ? ' (' + msg.data.date + ')' : ''}${msg.data.note ? ' - ' + msg.data.note : ''}`;
            } else if (msg.type === 'file_confirm' && msg.operation) {
                content = `[文件操作待确认] ${msg.message || ''} - ${msg.operation.path || ''}`;
            } else if (msg.type === 'generated_image') {
                content = `[已生成图片] ${msg.content || msg.prompt || ''}`;
            } else if (msg.type === 'generated_audio') {
                content = `[已生成语音] ${msg.content || msg.text || ''}`;
            } else if (msg.type === 'ai_execution_plan' && msg.plan) {
                const stepsSummary = msg.plan.steps.map(s => `${s.status === 'done' ? '✅' : s.status === 'failed' ? '❌' : '⏳'} ${s.title}`).join('\n');
                content = `[执行计划: ${msg.plan.title}]\n${stepsSummary}${msg.summary ? '\n\n' + msg.summary : ''}`;
            } else if (msg.type === 'error') {
                content = `[错误] ${msg.content || ''}`;
            }
            if (content) {
                messages.push({ role: 'assistant', content });
            }
        }
    }
    return messages;
}

export async function sendChatMessage(text, chatStyle = 'default', retryIndex = null, options = {}) {
    const requestedText = String(text || '').trim();
    const selectedAttachments = normalizeChatAttachments(
        retryIndex === null
            ? (options.attachments ?? get(aiChatComposerAttachments))
            : (options.attachments ?? [])
    );
    if (!requestedText && selectedAttachments.length === 0) return;

    const effectiveText = requestedText || '请阅读并分析这些附件。';

    const currentConfig = getEffectiveConfig();
    const needsApiKey = providerNeedsApiKey(currentConfig.provider);

    if (needsApiKey && !currentConfig.apiKey) {
        showAiSettings.set(true);
        throw new Error('请先配置 AI API Key');
    }

    let streamingIndex = -1;

    if (retryIndex !== null) {
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
    _streamAbortController = new AbortController();

    try {
        const aiChatToolsEnabled = get(settingsStore).enableAiChatTools ?? true;

        // Helper: update tool progress in chat history
        function updateToolProgress(stepKey) {
            aiChatHistory.update(h => {
                const nh = [...h];
                const existing = nh[streamingIndex];
                const prevSteps = existing?.steps || [];
                if (existing?.currentStep) prevSteps.push(existing.currentStep);
                nh[streamingIndex] = {
                    role: 'assistant',
                    type: 'tool_progress',
                    steps: prevSteps,
                    currentStep: stepKey
                };
                return nh;
            });
        }

        let useToolRouter = false;
        let intentHint = null;

        if (aiChatToolsEnabled) {
            if (shouldUseAssistantToolsInChat(effectiveText)) {
                useToolRouter = true;
                updateToolProgress('classifying');
            } else {
                updateToolProgress('ai_classifying');
                if (_streamAbortController?.signal.aborted) throw new DOMException('Aborted', 'AbortError');
                const aiIntent = await classifyUserIntent(effectiveText, currentConfig);
                if (_streamAbortController?.signal.aborted) throw new DOMException('Aborted', 'AbortError');
                if (aiIntent === null) {
                    useToolRouter = false;
                } else if (aiIntent !== 'chat') {
                    useToolRouter = true;
                    intentHint = aiIntent;
                }
            }
        }

        // Check if this is a complex multi-step request that should be decomposed
        if (aiChatToolsEnabled) {
            const { shouldDecompose, decomposeIntoSteps, executePlan, formatPlanSummary, cancelPlan, getTaskCreateResults } = await import('../utils/ai-execution-engine.js');
            if (shouldDecompose(effectiveText)) {
                if (_streamAbortController?.signal.aborted) throw new DOMException('Aborted', 'AbortError');
                updateToolProgress('decomposing');
                const plan = await decomposeIntoSteps(effectiveText, currentConfig);
                if (_streamAbortController?.signal.aborted) throw new DOMException('Aborted', 'AbortError');

                const planMessage = {
                    role: 'assistant',
                    type: 'ai_execution_plan',
                    plan: { ...plan },
                    isExecuting: true,
                    summary: ''
                };
                aiChatHistory.update(h => {
                    const nh = [...h];
                    nh[streamingIndex] = planMessage;
                    return nh;
                });

                const abortHandler = () => cancelPlan(plan.id);
                _streamAbortController?.signal.addEventListener('abort', abortHandler);

                await executePlan(plan, {
                    getConfig: () => ({
                        ...currentConfig,
                        trustedDirectories: get(settingsStore).localFileConfig?.trustedDirectories || []
                    }),
                    userMessage: effectiveText,
                    onStepStart: (step) => {
                        aiChatHistory.update(h => {
                            const nh = [...h];
                            if (nh[streamingIndex]?.type === 'ai_execution_plan') {
                                nh[streamingIndex] = { ...nh[streamingIndex], plan: { ...plan }, isExecuting: true };
                            }
                            return nh;
                        });
                    },
                    onStepComplete: (step) => {
                        aiChatHistory.update(h => {
                            const nh = [...h];
                            if (nh[streamingIndex]?.type === 'ai_execution_plan') {
                                nh[streamingIndex] = { ...nh[streamingIndex], plan: { ...plan }, isExecuting: true };
                            }
                            return nh;
                        });
                    },
                    onStepFail: (step) => {
                        aiChatHistory.update(h => {
                            const nh = [...h];
                            if (nh[streamingIndex]?.type === 'ai_execution_plan') {
                                nh[streamingIndex] = { ...nh[streamingIndex], plan: { ...plan }, isExecuting: true };
                            }
                            return nh;
                        });
                    },
                    onPlanComplete: (completedPlan, results) => {
                        const summary = formatPlanSummary(completedPlan, results);
                        const taskResults = getTaskCreateResults(completedPlan);
                        const failedSteps = completedPlan.steps.filter(s => s.status === 'failed');
                        const success = completedPlan.status === 'done';

                        try {
                            settingsStore.notifyAiExecution?.({
                                title: success ? `✅ ${completedPlan.title}` : `⚠️ ${completedPlan.title}`,
                                body: success
                                    ? `已完成 ${completedPlan.steps.length} 个步骤`
                                    : `${failedSteps.length} 个步骤失败 / 共 ${completedPlan.steps.length}`,
                                success
                            });
                        } catch (e) {
                            console.warn('Notify failed:', e);
                        }
                        aiChatHistory.update(h => {
                            const nh = [...h];
                            if (nh[streamingIndex]?.type === 'ai_execution_plan') {
                                nh[streamingIndex] = {
                                    ...nh[streamingIndex],
                                    plan: { ...completedPlan },
                                    isExecuting: false,
                                    summary
                                };
                            }
                            if (taskResults.length > 0) {
                                const dateInfo = getDateInfo();
                                const fallbackDate = `${formatDateForAI(dateInfo.today)}T09:00`;
                                const normalizedTasks = taskResults.map((t, i) => normalizeCreatedTask({
                                    title: t.title,
                                    priority: t.priority === 'high' ? 'high' : t.priority === 'low' ? 'low' : 'normal',
                                    note: t.note || '',
                                    date: fallbackDate
                                }, fallbackDate, i));
                                if (normalizedTasks.length === 1) {
                                    nh.push({
                                        role: 'assistant',
                                        type: 'task_card',
                                        data: normalizedTasks[0],
                                        confirmed: false
                                    });
                                } else {
                                    nh.push({
                                        role: 'assistant',
                                        type: 'multi_task_card',
                                        tasks: normalizedTasks,
                                        confirmedIndexes: []
                                    });
                                }
                            }
                            return nh;
                        });
                    }
                });

                _streamAbortController?.signal.removeEventListener('abort', abortHandler);
                saveAiChatHistory();
                return;
            }
        }

        if (useToolRouter) {
            if (_streamAbortController?.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const assistantPayload = await buildAiChatAssistantPayload(effectiveText);
            if (_streamAbortController?.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const assistantResult = await resolveAssistantMessage(effectiveText, assistantPayload, currentConfig, intentHint, updateToolProgress, { allowLocalFiles: true });
            // If resolveAssistantMessage signals no tool action matched, fall through to streaming chat
            if (assistantResult?.__batchResults?.length) {
                aiChatHistory.update(h => {
                    const newHistory = [...h];
                    if (newHistory[streamingIndex]) {
                        newHistory.splice(streamingIndex, 1, ...assistantResult.__batchResults);
                    }
                    return newHistory;
                });
                saveAiChatHistory();
                return;
            }
            if (!assistantResult?.__useStreamingChat) {
                aiChatHistory.update(h => {
                    const newHistory = [...h];
                    if (newHistory[streamingIndex]) {
                        newHistory[streamingIndex] = assistantResult;
                    }
                    return newHistory;
                });
                saveAiChatHistory();
                return;
            }
        }

        console.log('[Chat] Entering streaming path');
        const { callAIWithMessagesStream, getProviderBodyFormat } = await import('../utils/ai-providers.js');
        const bodyFormat = getProviderBodyFormat(currentConfig.provider);
        const currentHistory = get(aiChatHistory);
        const historyWithoutStreaming = currentHistory.filter(m => m.type !== 'streaming' && m.type !== 'loading' && m.type !== 'tool_progress');
        const messages = await buildContextMessages(historyWithoutStreaming, chatStyle, bodyFormat);

        aiChatHistory.update(h => {
            const newHistory = [...h];
            const msgType = newHistory[streamingIndex]?.type;
            if (msgType === 'loading' || msgType === 'tool_progress') {
                newHistory[streamingIndex] = { role: 'assistant', type: 'streaming', content: '', isStreaming: true };
            }
            return newHistory;
        });

        const onChunk = (delta, fullContent) => {
            streamingContent.set(fullContent);
            aiChatHistory.update(h => {
                const newHistory = [...h];
                if (newHistory[streamingIndex]) {
                    newHistory[streamingIndex] = {
                        ...newHistory[streamingIndex],
                        content: fullContent,
                        isStreaming: true
                    };
                }
                return newHistory;
            });
        };

        const result = await callAIWithMessagesStream(currentConfig, messages, onChunk, { signal: _streamAbortController?.signal });
        _streamAbortController = null;

        aiChatHistory.update(h => {
            const newHistory = [...h];
            if (newHistory[streamingIndex]) {
                if (!result) {
                    newHistory.splice(streamingIndex, 1);
                } else {
                    newHistory[streamingIndex] = {
                        role: 'assistant',
                        type: 'text',
                        content: result,
                        isStreaming: false
                    };
                }
            }
            return newHistory;
        });

        streamingContent.set('');
        saveAiChatHistory();
    } catch (error) {
        _streamAbortController = null;
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
        isAiLoading.set(false);
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
    const taskSummary = tasks.map(t => {
        const status = t.status === 'done' ? '已完成' : (t.status === 'doing' ? '进行中' : '未开始');
        const priority = t.priority === 'critical' ? '特急' : (t.priority === 'urgent' ? '紧急' : '普通');
        const subtaskInfo = t.subtasks && t.subtasks.length > 0
            ? ` (子任务: ${t.subtasks.map(s => `${s.title}[${s.status === 'done' ? '完成' : '待办'}]`).join(', ')})`
            : '';
        return `- ${t.title} [${status}] [${priority}] 计划:${t.date.split('T')[0]}${subtaskInfo}`;
    }).join('\n');

    const reportTypeText = reportType === 'daily' ? '日报' : '周报';
    const customPrompt = reportType === 'daily' ? config.dailyReportPrompt : config.weeklyReportPrompt;

    const defaultPrompt = `你是一个专业的工作汇报助手。当前时间：${nowStr}。
请根据以下任务列表生成一份${reportTypeText}。
【任务列表】
${taskSummary}
【要求】
1. 生成简洁专业的${reportTypeText}
2. 包含：工作概述、已完成事项、进行中事项、待办事项、工作亮点/问题
3. 使用 Markdown 格式
4. 语言简练，突出重点`;

    const systemPrompt = customPrompt
        ? customPrompt.replace('{{tasks}}', taskSummary).replace('{{time}}', nowStr).replace('{{type}}', reportTypeText)
        : defaultPrompt;

    const userMessage = `请根据上述任务生成${reportTypeText}`;
    return await callAI(config, userMessage, systemPrompt);
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
    chatHistory.update(h => h.filter((_, i) => i !== index));
}

export function clearChatHistory() {
    chatHistory.set([]);
}

export function clearAiChatHistory() {
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
