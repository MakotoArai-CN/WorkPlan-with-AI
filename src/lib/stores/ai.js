import { writable, get, derived } from 'svelte/store';
import { isG4FProvider } from '../utils/g4f-client.js';
import {
    looksLikeFileIntent,
    searchLocalFiles,
    readLocalFile,
    writeLocalFile,
    deleteLocalFile
} from '../utils/local-file-tools.js';
import {
    looksLikeWebSearchIntent,
    searchWeb,
    fetchWebContent
} from '../utils/web-search.js';
import { settingsStore } from './settings.js';

const STORAGE_KEY = 'planpro_ai_config';
const AI_CHAT_HISTORY_KEY = 'planpro_ai_chat_history';
const AI_CHAT_SESSIONS_KEY = 'planpro_ai_chat_sessions';
const PROVIDER_CONFIG_FIELDS = ['apiKey', 'secretKey', 'model', 'customModel', 'customEndpoint', 'accountId'];

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

export const aiConfig = writable(getDefaultAiConfigState());

export const chatHistory = writable([]);
export const aiChatHistory = writable([]);
export const aiChatSessions = writable([]);
export const activeAiChatSessionId = writable(null);
export const aiChatDraft = writable('');
export const aiChatContext = writable(null);
export const aiPanelContext = writable(getDefaultAiPanelContext());
export const isAiLoading = writable(false);
export const showAiPanel = writable(false);
export const showAiSettings = writable(false);
export const providerModels = writable({});
export const modelsLoading = writable(false);
export const lastFailedMessage = writable(null);
export const streamingContent = writable('');
export const pendingTaskOperation = writable(null);
export const aiChatRuntimeCapabilities = writable({
    probed: false,
    probing: false,
    localFilesRuntimeAvailable: null,
    webSearchRuntimeAvailable: null,
    toolCallRuntimeAvailable: null
});
export const aiChatCapabilities = derived(
    [settingsStore, aiConfig, aiChatRuntimeCapabilities],
    ([$settings, $config, $runtime]) => {
        const needsApiKey = !isG4FProvider($config.provider) &&
            $config.provider !== 'ollama' &&
            $config.provider !== 'lmstudio';
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

        return {
            mode: toolRouterEnabled ? 'internal_router' : 'chat_only',
            connectionReady: !needsApiKey || Boolean($config.apiKey),
            toolRouterEnabled,
            projectToolsAvailable: toolRouterEnabled && toolCallAvailable,
            localFilesAvailable,
            localFilesRequireConfirmation: localFilesAvailable &&
                ($settings.localFileConfig?.requireConfirmation ?? true),
            webSearchAvailable,
            toolCallRuntimeAvailable: toolCallAvailable,
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
        const needsApiKey = !isG4FProvider(config.provider) &&
            config.provider !== 'ollama' &&
            config.provider !== 'lmstudio';
        if (needsApiKey && !config.apiKey) {
            toolCallOk = false;
        } else {
            const { callAI } = await import('../utils/ai-providers.js');
            const probe = await callAI(config, 'respond with only the word OK', 'You are a test probe. Respond with only the word OK.');
            toolCallOk = typeof probe === 'string' && probe.length > 0;
        }
    } catch {
        toolCallOk = false;
    }

    aiChatRuntimeCapabilities.set({
        probed: true,
        probing: false,
        localFilesRuntimeAvailable: localFilesOk,
        webSearchRuntimeAvailable: webSearchOk,
        toolCallRuntimeAvailable: toolCallOk
    });

    return {
        localFilesRuntimeAvailable: localFilesOk,
        webSearchRuntimeAvailable: webSearchOk,
        toolCallRuntimeAvailable: toolCallOk
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

    profiles[profileIndex >= 0 ? profileIndex : 0] = {
        ...activeProfile,
        name: nextState.activeProfileName || activeProfile.name || '默认连接',
        provider: providerId,
        apiKey: nextState.apiKey || '',
        secretKey: nextState.secretKey || '',
        model: nextState.model || 'auto',
        customModel: nextState.customModel || '',
        customEndpoint: nextState.customEndpoint || '',
        accountId: nextState.accountId || '',
        providerConfigs,
        updatedAt: new Date().toISOString()
    };

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
    const normalized = firstUserMessage.content.replace(/\s+/g, ' ').trim();
    return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
}

function createChatSession(title = '新对话', history = []) {
    const timestamp = new Date().toISOString();
    return {
        id: createId('chat'),
        title,
        history,
        createdAt: timestamp,
        updatedAt: timestamp
    };
}

function normalizeChatSessions(rawSessions = [], legacyHistory = []) {
    const normalized = Array.isArray(rawSessions)
        ? rawSessions
            .map((session, index) => ({
                ...createChatSession(`对话 ${index + 1}`),
                ...(session || {}),
                history: Array.isArray(session?.history) ? session.history : [],
                title: session?.title || inferChatSessionTitle(session?.history || []) || `对话 ${index + 1}`
            }))
        : [];

    if (normalized.length > 0) {
        return normalized;
    }

    if (Array.isArray(legacyHistory) && legacyHistory.length > 0) {
        return [createChatSession(inferChatSessionTitle(legacyHistory), legacyHistory)];
    }

    return [createChatSession()];
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

    aiConfig.update(c => {
        const nextState = {
            ...c,
            apiKey: merged.apiKey || '',
            secretKey: merged.secretKey || '',
            model: merged.model || (c.model || 'auto'),
            customModel: merged.customModel || '',
            customEndpoint: merged.customEndpoint || '',
            accountId: merged.accountId || ''
        };
        return { ...nextState, ...syncActiveProfile(nextState) };
    });
}

export async function hydrateCurrentProviderConfigWithDefaults() {
    const current = get(aiConfig);
    const providerId = current.provider || 'g4f-default';
    const providerInfo = await getProviderInfoCached(providerId);

    const providerConfigs = current.providerConfigs || {};
    const cached = providerConfigs[providerId] || null;
    const merged = cached ? { ...getDefaultProviderConfig(), ...cached } : getDefaultProviderConfig();

    const normalizedModel = await normalizeProviderModel(providerId, providerInfo, merged);

    aiConfig.update(c => {
        const nextState = {
            ...c,
            apiKey: merged.apiKey || '',
            secretKey: merged.secretKey || '',
            model: providerId === 'custom' ? (merged.model || 'auto') : normalizedModel,
            customModel: merged.customModel || '',
            customEndpoint: merged.customEndpoint || '',
            accountId: merged.accountId || ''
        };
        return { ...nextState, ...syncActiveProfile(nextState) };
    });
}

export async function switchProvider(newProviderId) {
    const current = get(aiConfig);
    const prevProviderId = current.provider || 'g4f-default';

    const providerConfigsUpdated = mergeProviderConfigs(current.providerConfigs, prevProviderId, current);

    const newProviderInfo = await getProviderInfoCached(newProviderId);
    const cached = providerConfigsUpdated[newProviderId] || null;
    const merged = cached ? { ...getDefaultProviderConfig(), ...cached } : getDefaultProviderConfig();

    const normalizedModel = await normalizeProviderModel(newProviderId, newProviderInfo, merged);

    aiConfig.update(c => {
        const nextState = {
            ...c,
            provider: newProviderId,
            apiKey: merged.apiKey || '',
            secretKey: merged.secretKey || '',
            model: newProviderId === 'custom' ? (merged.model || 'auto') : normalizedModel,
            customModel: merged.customModel || '',
            customEndpoint: merged.customEndpoint || '',
            accountId: merged.accountId || '',
            providerConfigs: providerConfigsUpdated
        };
        return { ...nextState, ...syncActiveProfile(nextState) };
    });
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

            aiConfig.set(nextState);
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
    aiConfig.set(nextState);
    saveApiKeyToPasswords(nextState.provider, nextState);
}

export function addConnectionProfile(name = '') {
    aiConfig.update(current => {
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
    aiConfig.update(current => applyProfileToState(current, profileId));
}

export function updateConnectionProfileName(name) {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    aiConfig.update(current => {
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
    aiConfig.update(current => {
        const profiles = (current.connectionProfiles || []).filter(profile => profile.id !== profileId);
        if (profiles.length === 0) {
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

async function saveApiKeyToPasswords(providerId, config) {
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

        const existingPasswords = storeGet(passwordsStore).passwords;
        const existingEntry = existingPasswords.find(p => 
            p.category === 'API密钥' && 
            p.title === `${providerName} API Key`
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
                title: `${providerName} API Key`,
                username: providerId,
                password: apiKey,
                url: providerInfo?.apiUrl || '',
                category: 'API密钥',
                notes: `由 AI 设置自动同步\n创建时间: ${new Date().toLocaleString()}`
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

export function clearAiChatDraft() {
    aiChatDraft.set('');
    aiChatContext.set(null);
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
    const newSession = createChatSession(title);
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
    aiConfig.update(c => {
        const nextState = { ...c, ...updates };
        return { ...nextState, ...syncActiveProfile(nextState) };
    });
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
    modelsLoading.set(true);
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
        modelsLoading.set(false);
    }
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
        model: isCustom ? (config.customModel || 'auto') : (config.model || 'auto'),
        customModel: config.customModel,
        customEndpoint: config.customEndpoint,
        accountId: config.accountId,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        customHeaders: config.customHeaders,
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
    const taskDate = rawDate ? new Date(rawDate) : null;
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

function normalizeTemplateEntity(template, index = 0) {
    return {
        id: template.id || `${Date.now() + index}_${Math.random().toString(36).slice(2, 6)}`,
        title: template.title || '未命名模板',
        status: template.status || 'todo',
        priority: ['normal', 'urgent', 'critical'].includes(template.priority) ? template.priority : 'normal',
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
    'query', 'search', 'find', 'list', 'show', 'what'
];
const PAST_TIME_KEYWORDS = [
    '过去', '昨天', '前天', '上周', '上个月', '之前', '以前', '历史',
    '去年', '前几天', '早些时候'
];

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

function detectOperationType(text) {
    const lowerText = text.toLowerCase();
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

function detectTimeScope(text, dateInfo) {
    const lowerText = text.toLowerCase();
    let includePast = false;
    let includeFuture = true;
    let startDate = null;
    let endDate = null;
    for (const keyword of PAST_TIME_KEYWORDS) {
        if (lowerText.includes(keyword)) {
            includePast = true;
            break;
        }
    }
    if (lowerText.includes('昨天')) {
        startDate = dateInfo.yesterday;
        endDate = dateInfo.yesterday;
        includePast = true;
    } else if (lowerText.includes('前天')) {
        startDate = dateInfo.dayBeforeYesterday;
        endDate = dateInfo.dayBeforeYesterday;
        includePast = true;
    } else if (lowerText.includes('今天') || lowerText.includes('今日')) {
        startDate = dateInfo.today;
        endDate = dateInfo.today;
    } else if (lowerText.includes('明天')) {
        startDate = dateInfo.tomorrow;
        endDate = dateInfo.tomorrow;
    } else if (lowerText.includes('后天')) {
        startDate = dateInfo.dayAfterTomorrow;
        endDate = dateInfo.dayAfterTomorrow;
    }
    if (lowerText.includes('明天') && lowerText.includes('后天')) {
        startDate = dateInfo.tomorrow;
        endDate = dateInfo.dayAfterTomorrow;
    }
    if (lowerText.includes('上周') || lowerText.includes('上一周')) {
        startDate = dateInfo.lastWeek.start;
        endDate = dateInfo.lastWeek.end;
        includePast = true;
    } else if (lowerText.includes('下周') || lowerText.includes('下一周')) {
        startDate = dateInfo.nextWeek.start;
        endDate = dateInfo.nextWeek.end;
    } else if (lowerText.includes('本周') || lowerText.includes('这周') || lowerText.includes('整周')) {
        startDate = dateInfo.thisWeek.start;
        endDate = dateInfo.thisWeek.end;
        includePast = true;
    }
    if (lowerText.includes('上个月') || lowerText.includes('上月')) {
        startDate = dateInfo.lastMonth.start;
        endDate = dateInfo.lastMonth.end;
        includePast = true;
    } else if (lowerText.includes('下个月') || lowerText.includes('下月')) {
        startDate = dateInfo.nextMonth.start;
        endDate = dateInfo.nextMonth.end;
    } else if (lowerText.includes('本月') || lowerText.includes('这个月') || lowerText.includes('整月')) {
        startDate = dateInfo.thisMonth.start;
        endDate = dateInfo.thisMonth.end;
        includePast = true;
    }
    if (lowerText.includes('所有') || lowerText.includes('全部')) {
        if (includePast || lowerText.includes('过去所有') || lowerText.includes('历史')) {
            startDate = new Date(2020, 0, 1);
            endDate = new Date(2099, 11, 31);
            includePast = true;
        } else {
            startDate = dateInfo.today;
            endDate = new Date(2099, 11, 31);
        }
    }
    return { includePast, includeFuture, startDate, endDate };
}

function filterTasksByTimeScope(tasks, timeScope, dateInfo) {
    if (!tasks || tasks.length === 0) return [];
    return tasks.filter(task => {
        const taskDate = new Date(task.date.split('T')[0]);
        if (timeScope.startDate && timeScope.endDate) {
            const start = new Date(timeScope.startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(timeScope.endDate);
            end.setHours(23, 59, 59, 999);
            return taskDate >= start && taskDate <= end;
        }
        if (!timeScope.includePast && taskDate < dateInfo.today) {
            return false;
        }
        return true;
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

function extractLikelyPath(text = '') {
    const candidates = [
        extractQuotedSegment(text),
        String(text).match(/[A-Za-z]:\\[^\n\r"'`]+/)?.[0] || '',
        String(text).match(/(?:^|[\s(])(\.\/[^\s"'`]+|\/[^\s"'`]+)(?=$|[\s)])/i)?.[1] || '',
        String(text).match(/([A-Za-z0-9_.\-\/\\]+\.(?:md|txt|json|js|ts|tsx|jsx|svelte|rs|html|css|scss|yml|yaml|toml|csv|sql|log|xml))/i)?.[1] || ''
    ];

    return candidates.find((candidate) => candidate && /[\\/\.]/.test(candidate)) || '';
}

function extractFencedContent(text = '') {
    const fenced = String(text).match(/```(?:[\w-]+)?\n([\s\S]*?)```/);
    if (fenced?.[1] !== undefined) {
        return fenced[1].trimEnd();
    }

    const inline = String(text).match(/内容[：:]\s*([\s\S]+)/);
    return inline?.[1]?.trim() || '';
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
    const path = extractLikelyPath(userText);
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
            content: extractFencedContent(userText),
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

    const query = String(userText)
        .replace(/请|帮我|麻烦|一下/gi, ' ')
        .replace(/(联网|网页|网上|在线|online|web)\s*(搜索|查找|查询)/gi, ' ')
        .replace(/搜索一下|查一下|搜一下|帮我搜索|web search|online search/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        mode: 'web',
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
    if (!Array.isArray(items) || items.length === 0) {
        return `- [${label}] 暂无`;
    }
    return items
        .slice(0, 24)
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
        })
        .join('\n');
}

function formatNoteContextForAI(context = {}) {
    if (!context?.activeNoteId) return '';
    return [
        '【当前工作笔记】',
        `标题：${context.noteTitle || '未命名笔记'}`,
        `分类：${context.noteCategory || '全部'}`,
        '内容：',
        context.noteContent || '（当前为空）'
    ].join('\n');
}

async function buildContextualAssistantResponse(userText, assistantContext, config, options = {}) {
    const { callAIWithMessages } = await import('../utils/ai-providers.js');
    const nowStr = getFormattedDateTime();
    const projectContext = await getProjectContextSummary();
    const scopedItems = formatContextItemsForAI(assistantContext.items, assistantContext);
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

const VALID_INTENTS = new Set(['chat', 'web_search', 'file', 'task']);

async function classifyUserIntent(text, config) {
    const systemPrompt = `You are a strict intent classifier. Classify the user message into exactly one category. Return ONLY valid JSON, no explanation.

Categories:
- "chat": general conversation, Q&A, writing, translation, explaining concepts, greetings, jokes
- "web_search": requires real-time or online information (weather, news, stock/gold/oil prices, exchange rates, search the web, latest version of something, current events, official websites)
- "file": involves local file operations (read, write, delete, scan, search files/directories, check file contents, file paths mentioned)
- "task": involves tasks/todos/templates/scheduled tasks — adding, deleting, modifying, querying, completing, or listing tasks

Output: {"intent": "chat"}  or  {"intent": "web_search"}  or  {"intent": "file"}  or  {"intent": "task"}`;

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
        if (!aiResponse) return fallbackPlan;
        const parsed = extractJsonPayload(aiResponse);
        if (parsed.mode !== 'file' || !parsed.operation) {
            return fallbackPlan;
        }
        return {
            ...fallbackPlan,
            ...parsed,
            path: parsed.path || fallbackPlan?.path || '',
            root: parsed.root || fallbackPlan?.root || '',
            query: parsed.query || fallbackPlan?.query || '',
            content: parsed.content ?? fallbackPlan?.content ?? '',
            response_goal: parsed.response_goal || fallbackPlan?.response_goal,
            message: parsed.message || fallbackPlan?.message
        };
    } catch (error) {
        console.error('Failed to parse local file intent:', error);
        return fallbackPlan;
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
        const result = await readLocalFile({ path: plan.path });
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
        maxResults: 40
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

async function resolveAssistantMessage(text, existingTasks = [], currentConfig = getEffectiveConfig(), intentHint = null, onProgress = null) {
    const progress = (step) => { if (onProgress) onProgress(step); };
    const assistantContext = normalizeAssistantPayload(existingTasks);
    const scopedItems = assistantContext.items || [];
    const aiChatToolsEnabled = get(settingsStore).enableAiChatTools ?? true;
    const subtaskOperation = detectSubtaskOperation(text);
    const lowerText = text.toLowerCase();
    const createKeywords = ['新增', '添加', '创建', '新建', '加个', '帮我加', 'add', 'create', 'new'];
    const isExplicitCreate = createKeywords.some(keyword => lowerText.includes(keyword));
    const hasNoActionKeyword = !DELETE_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase())) &&
        !UPDATE_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase())) &&
        !QUERY_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase()));
    const operationType = detectOperationType(text);
    const dateInfo = getDateInfo();
    const timeScope = detectTimeScope(text, dateInfo);

    const { callAI } = await import('../utils/ai-providers.js');
    const requireFileConfirmation = get(settingsStore).localFileConfig?.requireConfirmation ?? true;

    if (!aiChatToolsEnabled) {
        return normalizeAssistantResult(
            await buildContextualAssistantResponse(text, assistantContext, currentConfig, { allowActions: false }),
            assistantContext
        );
    }

    progress('classifying');
    const webSearchPlan = await analyzeWebSearchIntent(text, currentConfig, callAI, intentHint);
    const localFilePlan = await analyzeLocalFileIntent(text, currentConfig, callAI, intentHint);
    const relevantTasks = filterTasksByTimeScope(scopedItems, timeScope, dateInfo);
    const allowImplicitCreate = assistantContext.scope === 'dashboard' ||
        assistantContext.scope === 'project' ||
        assistantContext.source === 'templates' ||
        assistantContext.source === 'scheduled';

    let result;
    if (localFilePlan) {
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
        result = await analyzeSubtaskIntent(text, scopedItems, dateInfo, currentConfig, callAI);
    } else if (assistantContext.source === 'templates' && (isExplicitCreate || (allowImplicitCreate && hasNoActionKeyword))) {
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
        result = await analyzeSubtaskIntent(text, scopedItems, dateInfo, currentConfig, callAI);
    } else if (assistantContext.source === 'scheduled' && (isExplicitCreate || (allowImplicitCreate && hasNoActionKeyword))) {
        progress('task_processing');
        result = await analyzeScheduledCreateIntent(text, scopedItems, dateInfo, currentConfig, callAI);
    } else if (assistantContext.source === 'scheduled' && operationType === 'update') {
        progress('task_processing');
        result = await analyzeScheduledUpdateIntent(text, scopedItems, relevantTasks, dateInfo, currentConfig, callAI);
    } else if (subtaskOperation) {
        progress('task_processing');
        result = await analyzeSubtaskIntent(text, scopedItems, dateInfo, currentConfig, callAI);
    } else if (isExplicitCreate || (allowImplicitCreate && hasNoActionKeyword)) {
        progress('task_processing');
        result = await analyzeCreateIntent(text, scopedItems, dateInfo, currentConfig, callAI);
    } else if (operationType === 'mixed') {
        progress('task_processing');
        result = await analyzeMixedIntent(text, scopedItems, relevantTasks, dateInfo, currentConfig, callAI);
    } else if (operationType === 'delete') {
        progress('task_processing');
        result = await analyzeDeleteIntent(text, scopedItems, relevantTasks, dateInfo, currentConfig, callAI);
    } else if (operationType === 'update') {
        progress('task_processing');
        result = await analyzeUpdateIntent(text, scopedItems, relevantTasks, dateInfo, currentConfig, callAI);
    } else if (operationType === 'query') {
        progress('task_processing');
        result = await analyzeQueryIntent(text, scopedItems, relevantTasks, dateInfo, currentConfig, callAI);
    } else if (hasNoActionKeyword) {
        progress('generating');
        result = await buildContextualAssistantResponse(text, assistantContext, currentConfig);
    } else {
        progress('task_processing');
        result = await analyzeCreateIntent(text, scopedItems, dateInfo, currentConfig, callAI);
    }

    return normalizeAssistantResult(result, assistantContext);
}

export async function sendAiMessage(text, existingTasks = [], retryIndex = null) {
    if (!text.trim()) return;

    const currentConfig = getEffectiveConfig();

    const needsApiKey = !isG4FProvider(currentConfig.provider) &&
        currentConfig.provider !== 'ollama' &&
        currentConfig.provider !== 'lmstudio';

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
        const result = await resolveAssistantMessage(text, existingTasks, currentConfig);

        chatHistory.update(h => {
            const newHistory = [...h];
            const loadingIndex = newHistory.findIndex(m => m.type === 'loading');
            if (loadingIndex !== -1) {
                newHistory[loadingIndex] = result;
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

export async function confirmLocalFileOperation(index, operation) {
    const currentConfig = getEffectiveConfig();

    chatHistory.update(history => {
        const nextHistory = [...history];
        if (nextHistory[index]) {
            nextHistory[index] = {
                role: 'assistant',
                type: 'loading'
            };
        }
        return nextHistory;
    });

    try {
        const result = await runLocalFilePlan(operation, operation.message || '', currentConfig, false);
        chatHistory.update(history => {
            const nextHistory = [...history];
            nextHistory[index] = result;
            return nextHistory;
        });
    } catch (error) {
        chatHistory.update(history => {
            const nextHistory = [...history];
            nextHistory[index] = {
                role: 'assistant',
                type: 'error',
                content: error.message || String(error),
                originalText: operation?.message || ''
            };
            return nextHistory;
        });
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
            status: task.status || 'todo',
            priority: ['normal', 'urgent', 'critical'].includes(task.priority) ? task.priority : 'normal',
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

    const taskList = allTasks.map(task => formatFullTaskForAI(task)).join('\n');
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
            const task = allTasks.find(item => item.id === operation.task_id || item.id.endsWith(operation.task_id));
            if (!task || !operation.updates) continue;

            const updates = {};
            if (operation.updates.title) updates.title = operation.updates.title;
            if (operation.updates.note !== undefined) updates.note = operation.updates.note;
            if (operation.updates.priority && ['normal', 'urgent', 'critical'].includes(operation.updates.priority)) {
                updates.priority = operation.updates.priority;
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

    const templateList = allTemplates.map(item => formatTemplateForAI(item)).join('\n');
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
            const tasksToDelete = allTemplates.filter(item =>
                parsed.delete_task_ids.includes(item.id) ||
                parsed.delete_task_ids.some(id => item.id.endsWith(id))
            );
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

    const templateList = allTemplates.map(item => formatTemplateForAI(item)).join('\n');
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
            const template = allTemplates.find(item => item.id === operation.task_id || item.id.endsWith(operation.task_id));
            if (!template) continue;

            const updates = {};
            if (operation.updates.title) updates.title = operation.updates.title;
            if (operation.updates.note !== undefined) updates.note = operation.updates.note;
            if (operation.updates.priority && ['normal', 'urgent', 'critical'].includes(operation.updates.priority)) {
                updates.priority = operation.updates.priority;
            }
            if (operation.updates.status && ['todo', 'doing', 'done'].includes(operation.updates.status)) {
                updates.status = operation.updates.status;
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

    const templateList = allTemplates.map(item => formatTemplateForAI(item)).join('\n');
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
        const deleteOps = allTemplates.filter(item =>
            (parsed.delete_task_ids || []).includes(item.id) ||
            (parsed.delete_task_ids || []).some(id => item.id.endsWith(id))
        );

        for (const operation of parsed.update_operations || []) {
            const template = allTemplates.find(item => item.id === operation.task_id || item.id.endsWith(operation.task_id));
            if (!template || !operation.updates) continue;

            const updates = {};
            if (operation.updates.title) updates.title = operation.updates.title;
            if (operation.updates.note !== undefined) updates.note = operation.updates.note;
            if (operation.updates.priority && ['normal', 'urgent', 'critical'].includes(operation.updates.priority)) {
                updates.priority = operation.updates.priority;
            }
            if (operation.updates.status && ['todo', 'doing', 'done'].includes(operation.updates.status)) {
                updates.status = operation.updates.status;
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

    const templateList = allTemplates.map(item => formatTemplateForAI(item)).join('\n');
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
            const matchedTemplates = allTemplates.filter(item =>
                parsed.matched_task_ids.includes(item.id) ||
                parsed.matched_task_ids.some(id => item.id.endsWith(id))
            );
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

async function analyzeCreateIntent(userText, existingTasks, dateInfo, config, callAI) {
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

【任务拆分规则】
1. 如果用户描述包含多个不同的任务（不同时间或不同事项），必须拆分成多个独立任务对象
2. 如果单个任务较复杂（包含多个步骤），需要创建子任务（subtasks）
3. "下周一到下周五" 表示需要创建5个任务，每天一个

【时间解析规则】
- "上午" = 09:00, "中午" = 12:00, "下午" = 14:00, "傍晚" = 17:00, "晚上" = 19:00
- 如果用户说"8点到10点"，date设为开始时间，deadline设为结束时间
- 默认创建的是当前时间往后的任务，除非用户明确提到过去的时间

【输出格式】
严格只返回纯 JSON 格式，不要包含任何 markdown 标记或解释文字
单任务: {"title":"任务标题","date":"YYYY-MM-DDTHH:mm","deadline":"YYYY-MM-DDTHH:mm或空字符串","priority":"normal|urgent|critical","note":"备注","subtasks":[{"title":"子任务名","status":"todo"}]}
多任务: {"tasks":[{...},{...}]}

【priority说明】
- normal: 普通任务
- urgent: 用户强调"紧急"、"重要"、"优先"
- critical: 用户强调"特急"、"非常紧急"、"最优先"`;

    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) return null;

    try {
        const cleanJsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : cleanJsonStr;
        const parsed = JSON.parse(jsonStr);

        const today = formatDateForAI(dateInfo.today);

        if (parsed.tasks && Array.isArray(parsed.tasks)) {
            const tasks = parsed.tasks.map((t, idx) => ({
                id: (Date.now() + idx).toString() + Math.random().toString(36).substr(2, 5),
                title: t.title || '未命名任务',
                date: t.date || today + 'T09:00',
                deadline: t.deadline || '',
                status: 'todo',
                priority: t.priority || 'normal',
                subtasks: (t.subtasks || []).map(s => ({
                    title: typeof s === 'string' ? s : (s.title || ''),
                    status: 'todo'
                })),
                note: t.note || ''
            }));
            return { tasks };
        }

        return {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            title: parsed.title || '未命名任务',
            date: parsed.date || today + 'T09:00',
            deadline: parsed.deadline || '',
            status: 'todo',
            priority: parsed.priority || 'normal',
            subtasks: (parsed.subtasks || []).map(s => ({
                title: typeof s === 'string' ? s : (s.title || ''),
                status: 'todo'
            })),
            note: parsed.note || ''
        };
    } catch (e) {
        console.error('Failed to parse AI response:', e, aiResponse);
        return null;
    }
}

async function analyzeSubtaskIntent(userText, allTasks, dateInfo, config, callAI) {
    if (!allTasks || allTasks.length === 0) {
        return {
            role: 'assistant',
            type: 'text',
            content: '当前没有任何任务可以操作子任务。'
        };
    }

    const nowStr = getFormattedDateTime();
    const taskList = allTasks.map(t => formatFullTaskForAI(t)).join('\n');

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

        const task = allTasks.find(t => t.id === parsed.task_id || t.id.endsWith(parsed.task_id));
        if (!task) {
            return { role: 'assistant', type: 'text', content: '未找到指定的任务。' };
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
        return {
            role: 'assistant',
            type: 'text',
            content: '在指定的时间范围内没有找到任务。请检查时间描述是否正确。'
        };
    }
    const nowStr = getFormattedDateTime();
    const taskList = relevantTasks.map(t => formatFullTaskForAI(t)).join('\n');
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
            const tasksToDelete = allTasks.filter(t =>
                parsed.delete_task_ids.includes(t.id) ||
                parsed.delete_task_ids.some(id => t.id.endsWith(id))
            );
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
    const nowStr = getFormattedDateTime();
    const taskList = allTasks.map(t => formatFullTaskForAI(t)).join('\n');
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
                    const task = allTasks.find(t => t.id === op.task_id || t.id.endsWith(op.task_id));
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
            const priorityMap = {
                '普通': 'normal', '紧急': 'urgent', '特急': 'critical',
                'normal': 'normal', 'urgent': 'urgent', 'critical': 'critical'
            };
            const statusMap = {
                '未开始': 'todo', '进行中': 'doing', '已完成': 'done',
                'todo': 'todo', 'doing': 'doing', 'done': 'done'
            };
            for (const op of parsed.operations) {
                if (!op.updates || Object.keys(op.updates).length === 0) continue;
                const task = allTasks.find(t => t.id === op.task_id || t.id.endsWith(op.task_id));
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
                    const normalized = priorityMap[op.updates.priority] || op.updates.priority;
                    if (['normal', 'urgent', 'critical'].includes(normalized)) {
                        cleanUpdates.priority = normalized;
                    }
                }
                if (op.updates.status) {
                    const normalized = statusMap[op.updates.status] || op.updates.status;
                    if (['todo', 'doing', 'done'].includes(normalized)) {
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
    const nowStr = getFormattedDateTime();
    const taskList = allTasks.map(t => formatFullTaskForAI(t)).join('\n');
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
            const priorityMap = {
                '普通': 'normal',
                '紧急': 'urgent',
                '特急': 'critical',
                'normal': 'normal',
                'urgent': 'urgent',
                'critical': 'critical'
            };
            for (const op of parsed.operations) {
                const task = allTasks.find(t => t.id === op.task_id || t.id.endsWith(op.task_id));
                if (task && op.updates && Object.keys(op.updates).length > 0) {
                    const taskSnapshot = JSON.parse(JSON.stringify(task));
                    if (op.updates.priority) {
                        const normalizedPriority = priorityMap[op.updates.priority] || op.updates.priority;
                        if (!['normal', 'urgent', 'critical'].includes(normalizedPriority)) {
                            op.updates.priority = 'normal';
                        } else {
                            op.updates.priority = normalizedPriority;
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
    const nowStr = getFormattedDateTime();
    const taskList = allTasks.map(t => formatFullTaskForAI(t)).join('\n');
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
            const matchedTasks = allTasks.filter(t =>
                parsed.matched_task_ids.includes(t.id) ||
                parsed.matched_task_ids.some(id => t.id.endsWith(id))
            );
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
    const { notesStore } = await import('./notes.js');

    const taskState = get(taskStore);
    const noteState = get(notesStore);

    const taskLines = (taskState.tasks || [])
        .slice(-20)
        .map(task => `- [任务] ${task.title} | ${task.status} | ${task.date}`)
        .join('\n');
    const templateLines = (taskState.templates || [])
        .slice(-12)
        .map(template => `- [模板] ${template.title}`)
        .join('\n');
    const scheduledLines = (taskState.scheduledTasks || [])
        .slice(-12)
        .map(task => `- [定时] ${task.title} | ${Array.isArray(task.repeatDays) ? task.repeatDays.join(',') : ''}`)
        .join('\n');
    const noteLines = (noteState.notes || [])
        .slice(-12)
        .map(note => `- [笔记] ${note.title} | ${note.category || '未分类'}`)
        .join('\n');

    return [
        '【项目上下文】',
        taskLines || '- [任务] 暂无',
        templateLines || '- [模板] 暂无',
        scheduledLines || '- [定时] 暂无',
        noteLines || '- [笔记] 暂无'
    ].join('\n');
}

async function buildContextMessages(history, chatStyle) {
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
        if (!msg.content && !msg.summary && !msg.data) return false;
        if (msg.role !== 'user' && msg.role !== 'assistant') return false;
        // Skip transient types that don't carry meaningful content
        if (msg.type === 'loading' || msg.type === 'streaming' || msg.type === 'tool_progress') return false;
        return true;
    });
    const recentHistory = validHistory.slice(-20);
    for (const msg of recentHistory) {
        if (msg.role === 'user') {
            messages.push({ role: 'user', content: msg.content });
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

export async function sendChatMessage(text, chatStyle = 'default', retryIndex = null) {
    if (!text.trim()) return;

    const currentConfig = getEffectiveConfig();
    const needsApiKey = !isG4FProvider(currentConfig.provider) &&
        currentConfig.provider !== 'ollama' &&
        currentConfig.provider !== 'lmstudio';

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
        aiChatHistory.update(h => [...h, { role: 'user', type: 'text', content: text }]);
        aiChatHistory.update(h => {
            const newHistory = [...h, { role: 'assistant', type: 'loading' }];
            streamingIndex = newHistory.length - 1;
            return newHistory;
        });
    }

    if (streamingIndex === -1) {
        const currentHistory = get(aiChatHistory);
        streamingIndex = currentHistory.length - 1;
    }

    isAiLoading.set(true);
    streamingContent.set('');

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
            if (shouldUseAssistantToolsInChat(text)) {
                // Fast path: keyword match → go straight to tool router (zero delay)
                useToolRouter = true;
                updateToolProgress('classifying');
            } else {
                // AI fallback: keywords missed, let AI classify intent
                updateToolProgress('ai_classifying');
                const aiIntent = await classifyUserIntent(text, currentConfig);
                if (aiIntent === null) {
                    // classifyUserIntent failed (API error), fall back to chat
                    useToolRouter = false;
                } else if (aiIntent !== 'chat') {
                    useToolRouter = true;
                    intentHint = aiIntent;
                }
            }
        }

        if (useToolRouter) {
            const assistantPayload = await buildAiChatAssistantPayload(text);
            const assistantResult = await resolveAssistantMessage(text, assistantPayload, currentConfig, intentHint, updateToolProgress);
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

        const { callAIWithMessagesStream } = await import('../utils/ai-providers.js');
        const currentHistory = get(aiChatHistory);
        const historyWithoutStreaming = currentHistory.filter(m => m.type !== 'streaming' && m.type !== 'loading');
        const messages = await buildContextMessages(historyWithoutStreaming, chatStyle);

        aiChatHistory.update(h => {
            const newHistory = [...h];
            if (newHistory[streamingIndex] && newHistory[streamingIndex].type === 'loading') {
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

        const result = await callAIWithMessagesStream(currentConfig, messages, onChunk);

        aiChatHistory.update(h => {
            const newHistory = [...h];
            if (newHistory[streamingIndex]) {
                newHistory[streamingIndex] = {
                    role: 'assistant',
                    type: 'text',
                    content: result || 'Sorry, I could not understand your question.',
                    isStreaming: false
                };
            }
            return newHistory;
        });

        streamingContent.set('');
        saveAiChatHistory();
    } catch (error) {
        aiChatHistory.update(h => {
            const newHistory = [...h];
            if (newHistory[streamingIndex]) {
                newHistory[streamingIndex] = {
                    role: 'assistant',
                    type: 'error',
                    content: error.message,
                    originalText: text,
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
        const chatStyle = history[index].chatStyle || 'default';
        if (originalText) {
            await sendChatMessage(originalText, chatStyle, index);
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
    if (!originalText) return;

    // Remove the assistant message at assistantIndex, replace with loading
    aiChatHistory.update(h => {
        const newHistory = [...h];
        newHistory[assistantIndex] = { role: 'assistant', type: 'loading' };
        return newHistory;
    });

    await sendChatMessage(originalText, 'default', assistantIndex);
}

export function editAndResend(messageIndex) {
    const history = get(aiChatHistory);
    const msg = history[messageIndex];
    if (!msg || msg.role !== 'user') return null;

    const content = msg.content;
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
