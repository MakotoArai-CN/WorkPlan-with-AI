import { writable, get } from 'svelte/store';
import { isG4FProvider } from '../utils/g4f-client.js';

const STORAGE_KEY = 'planpro_ai_config';
const PROVIDER_CONFIG_FIELDS = ['apiKey', 'secretKey', 'model', 'customModel', 'customEndpoint', 'accountId'];

export const aiConfig = writable({
    provider: 'g4f-default',
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
    providerConfigs: {}
});

export const chatHistory = writable([]);
export const aiChatHistory = writable([]);
export const isAiLoading = writable(false);
export const showAiPanel = writable(false);
export const showAiSettings = writable(false);
export const providerModels = writable({});
export const modelsLoading = writable(false);
export const lastFailedMessage = writable(null);
export const streamingContent = writable('');
export const pendingTaskOperation = writable(null);

const WEEKDAY_MAP = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

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

function extractProviderConfigFromAiConfig(config) {
    const result = {};
    for (const field of PROVIDER_CONFIG_FIELDS) {
        result[field] = config[field] || '';
    }
    return result;
}

function mergeProviderConfigs(providerConfigs, providerId, config) {
    return {
        ...(providerConfigs || {}),
        [providerId]: extractProviderConfigFromAiConfig(config)
    };
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

    aiConfig.update(c => ({
        ...c,
        apiKey: merged.apiKey || '',
        secretKey: merged.secretKey || '',
        model: merged.model || (c.model || 'auto'),
        customModel: merged.customModel || '',
        customEndpoint: merged.customEndpoint || '',
        accountId: merged.accountId || ''
    }));
}

export async function hydrateCurrentProviderConfigWithDefaults() {
    const current = get(aiConfig);
    const providerId = current.provider || 'g4f-default';
    const providerInfo = await getProviderInfoCached(providerId);

    const providerConfigs = current.providerConfigs || {};
    const cached = providerConfigs[providerId] || null;
    const merged = cached ? { ...getDefaultProviderConfig(), ...cached } : getDefaultProviderConfig();

    const normalizedModel = await normalizeProviderModel(providerId, providerInfo, merged);

    aiConfig.update(c => ({
        ...c,
        apiKey: merged.apiKey || '',
        secretKey: merged.secretKey || '',
        model: providerId === 'custom' ? (merged.model || 'auto') : normalizedModel,
        customModel: merged.customModel || '',
        customEndpoint: merged.customEndpoint || '',
        accountId: merged.accountId || ''
    }));
}

export async function switchProvider(newProviderId) {
    const current = get(aiConfig);
    const prevProviderId = current.provider || 'g4f-default';

    const providerConfigsUpdated = mergeProviderConfigs(current.providerConfigs, prevProviderId, current);

    const newProviderInfo = await getProviderInfoCached(newProviderId);
    const cached = providerConfigsUpdated[newProviderId] || null;
    const merged = cached ? { ...getDefaultProviderConfig(), ...cached } : getDefaultProviderConfig();

    const normalizedModel = await normalizeProviderModel(newProviderId, newProviderInfo, merged);

    aiConfig.update(c => ({
        ...c,
        provider: newProviderId,
        apiKey: merged.apiKey || '',
        secretKey: merged.secretKey || '',
        model: newProviderId === 'custom' ? (merged.model || 'auto') : normalizedModel,
        customModel: merged.customModel || '',
        customEndpoint: merged.customEndpoint || '',
        accountId: merged.accountId || '',
        providerConfigs: providerConfigsUpdated
    }));
}

export function loadAiConfig() {
    if (typeof window === 'undefined') return;

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            const providerConfigs = parsed.providerConfigs || {};
            const providerId = parsed.provider || 'g4f-default';

            const cached = providerConfigs[providerId] || null;
            const merged = cached ? { ...getDefaultProviderConfig(), ...cached } : getDefaultProviderConfig();

            aiConfig.set({
                provider: providerId,
                apiKey: merged.apiKey || '',
                secretKey: merged.secretKey || '',
                model: merged.model || 'auto',
                customModel: merged.customModel || '',
                customEndpoint: merged.customEndpoint || '',
                accountId: merged.accountId || '',
                temperature: parsed.temperature ?? 0.7,
                maxTokens: parsed.maxTokens ?? 4096,
                customHeaders: parsed.customHeaders || {},
                dailyReportPrompt: parsed.dailyReportPrompt || '',
                weeklyReportPrompt: parsed.weeklyReportPrompt || '',
                providerConfigs: providerConfigs
            });
        } catch (e) {
            console.error('Failed to load AI config:', e);
        }
    }

    const savedChatHistory = localStorage.getItem('planpro_ai_chat_history');
    if (savedChatHistory) {
        try {
            aiChatHistory.set(JSON.parse(savedChatHistory));
        } catch (e) {
            console.error('Failed to load AI chat history:', e);
        }
    }
}

export function saveAiConfig() {
    if (typeof window === 'undefined') return;

    const current = get(aiConfig);
    const providerId = current.provider || 'g4f-default';
    const providerConfigsUpdated = mergeProviderConfigs(current.providerConfigs, providerId, current);

    const toSave = {
        provider: providerId,
        temperature: current.temperature,
        maxTokens: current.maxTokens,
        customHeaders: current.customHeaders,
        dailyReportPrompt: current.dailyReportPrompt,
        weeklyReportPrompt: current.weeklyReportPrompt,
        providerConfigs: providerConfigsUpdated
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    aiConfig.update(c => ({ ...c, providerConfigs: providerConfigsUpdated }));
}

export function saveAiChatHistory() {
    if (typeof window === 'undefined') return;
    const history = get(aiChatHistory);
    localStorage.setItem('planpro_ai_chat_history', JSON.stringify(history.slice(-100)));
}

export function updateAiConfig(updates) {
    aiConfig.update(c => ({ ...c, ...updates }));
}

export async function getAiProviders() {
    const { getProviderList } = await import('../utils/ai-providers.js');
    return await getProviderList();
}

export async function getAiProviderInfo(providerId) {
    const { getProviderInfo } = await import('../utils/ai-providers.js');
    return getProviderInfo(providerId);
}

export async function loadModelsForProvider(providerId, apiKey = '') {
    modelsLoading.set(true);
    try {
        const { fetchProviderModels } = await import('../utils/ai-providers.js');
        const models = await fetchProviderModels(providerId, apiKey);
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

function formatFullTaskForAI(task) {
    const dateInfo = getDateInfo();
    const taskDate = new Date(task.date.split('T')[0]);
    let relativeDay = '';
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
    const priorityMap = { normal: '普通', urgent: '紧急', critical: '特急' };
    const statusMap = { todo: '未开始', doing: '进行中', done: '已完成' };
    let subtasksStr = '';
    if (task.subtasks && task.subtasks.length > 0) {
        subtasksStr = `\n    子任务: ${task.subtasks.map(s => `[${s.status === 'done' ? '✓' : '○'}]${s.title}`).join(', ')}`;
    }
    return `[ID:${task.id}] "${task.title}" | ${relativeDay} ${task.date.split('T')[1] || '09:00'} | 状态:${statusMap[task.status] || '未开始'} | 优先级:${priorityMap[task.priority] || '普通'}${task.deadline ? ` | 截止:${task.deadline}` : ''}${task.note ? ` | 备注:${task.note}` : ''}${subtasksStr}`;
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

export async function sendAiMessage(text, existingTasks = [], retryIndex = null) {
    if (!text.trim()) return;

    const currentConfig = getEffectiveConfig();
    const subtaskOperation = detectSubtaskOperation(text);
    const needsApiKey = !isG4FProvider(currentConfig.provider) &&
        currentConfig.provider !== 'ollama' &&
        currentConfig.provider !== 'lmstudio';

    const checkDuplicateWithTime = (taskTitle, existingTasks, dateInfo) => {
        const lowerTitle = taskTitle.toLowerCase();
        const matchingTasks = existingTasks.filter(t => 
            t.title.toLowerCase().includes(lowerTitle) || 
            lowerTitle.includes(t.title.toLowerCase())
        );
        
        if (matchingTasks.length === 0) return { hasDuplicate: false };
        
        const incompleteDuplicates = matchingTasks.filter(t => t.status !== 'done');
        if (incompleteDuplicates.length === 0) return { hasDuplicate: false };
        
        return {
            hasDuplicate: true,
            duplicateTasks: incompleteDuplicates
        };
    };

    if (needsApiKey && !currentConfig.apiKey) {
        showAiSettings.set(true);
        throw new Error('请先配置 AI API Key');
    }

    const operationType = detectOperationType(text);
    const dateInfo = getDateInfo();
    const timeScope = detectTimeScope(text, dateInfo);

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
        const { callAI } = await import('../utils/ai-providers.js');
        let result;

        const relevantTasks = filterTasksByTimeScope(existingTasks, timeScope, dateInfo);

        if (subtaskOperation) {
            result = await analyzeSubtaskIntent(text, existingTasks, dateInfo, currentConfig, callAI);
        } else if (operationType === 'mixed') {
            result = await analyzeMixedIntent(text, existingTasks, relevantTasks, dateInfo, currentConfig, callAI);
        } else if (operationType === 'delete') {
            result = await analyzeDeleteIntent(text, existingTasks, relevantTasks, dateInfo, currentConfig, callAI);
        } else if (operationType === 'update') {
            result = await analyzeUpdateIntent(text, existingTasks, relevantTasks, dateInfo, currentConfig, callAI);
        } else if (operationType === 'query') {
            result = await analyzeQueryIntent(text, existingTasks, relevantTasks, dateInfo, currentConfig, callAI);
        } else {
            result = await analyzeCreateIntent(text, existingTasks, dateInfo, currentConfig, callAI);
        }

        chatHistory.update(h => {
            const newHistory = [...h];
            const loadingIndex = newHistory.findIndex(m => m.type === 'loading');
            if (loadingIndex !== -1) {
                if (result && result.type) {
                    newHistory[loadingIndex] = result;
                } else if (result && Array.isArray(result.tasks) && result.tasks.length > 0) {
                    newHistory[loadingIndex] = {
                        role: 'assistant',
                        type: 'multi_task_card',
                        tasks: result.tasks,
                        confirmedIndexes: []
                    };
                } else if (result) {
                    newHistory[loadingIndex] = {
                        role: 'assistant',
                        type: 'task_card',
                        data: result,
                        confirmed: false
                    };
                } else {
                    newHistory[loadingIndex] = {
                        role: 'assistant',
                        type: 'text',
                        content: '无法理解您的输入，请描述得更具体一些。例如："明天下午3点开会"、"删除今天的会议任务"、"把明天的任务改到后天"。'
                    };
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

async function analyzeCreateIntent(userText, existingTasks, dateInfo, config, callAI) {
    const nowStr = getFormattedDateTime();
    const todayStr = formatDateForAI(dateInfo.today);
    const tomorrowStr = formatDateForAI(dateInfo.tomorrow);
    const dayAfterTomorrowStr = formatDateForAI(dateInfo.dayAfterTomorrow);
    const existingTasksStr = existingTasks.length > 0
        ? `\n\n【现有任务列表（用于避免重复）】\n${existingTasks.map(t => formatFullTaskForAI(t)).join('\n')}`
        : '';
    const systemPrompt = `你是一个智能任务管理助手。请根据用户的自然语言描述创建任务。

【当前时间信息】
- 现在时间: ${nowStr}
- 今天: ${todayStr} (${dateInfo.weekdayName})
- 明天: ${tomorrowStr}
- 后天: ${dayAfterTomorrowStr}
- 本周: ${formatDateForAI(dateInfo.thisWeek.start)} 至 ${formatDateForAI(dateInfo.thisWeek.end)}
${existingTasksStr}

【重要规则】
1. 如果用户描述包含多个不同的任务（不同时间或不同事项），必须拆分成多个独立任务对象
2. 如果单个任务较复杂（包含多个步骤），需要创建子任务（subtasks）
3. 时间解析规则：
   - "上午" = 09:00, "中午" = 12:00, "下午" = 14:00, "傍晚" = 17:00, "晚上" = 19:00
   - 如果用户说"8点到10点"，date设为开始时间，deadline设为结束时间
   - 默认创建的是当前时间往后的任务，除非用户明确提到过去的时间

【同名任务处理规则】
1. 如果现有任务列表中存在同名或相似名称的任务：
   - 如果现有任务已完成（done），则可以创建新任务
   - 如果现有任务未完成但时间不同，仍然创建新任务
   - 如果现有任务未完成且时间相同，在note中说明"与现有任务时间重复"
2. 不要因为存在同名任务就拒绝创建，要根据时间判断

4. 严格只返回纯 JSON 格式，不要包含任何 markdown 标记或解释文字

【输出格式】
单任务:
{"title":"任务标题","date":"YYYY-MM-DDTHH:mm","deadline":"YYYY-MM-DDTHH:mm或空字符串","priority":"normal|urgent|critical","note":"备注","subtasks":[{"title":"子任务名","status":"todo"}]}

多任务:
{"tasks":[{...},{...}]}

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
                id: (Date.now() + idx).toString(),
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
            id: Date.now().toString(),
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

function buildContextMessages(history, chatStyle) {
    const nowStr = getFormattedDateTime();
    const stylePrompts = {
        default: `你是一个智能助手。当前时间：${nowStr}。请用友好、专业的方式回答用户问题。`,
        fun: `你是 Grok，一个由 xAI 打造的 AI 助手。当前时间：${nowStr}。
性格特点：极度风趣、毒舌、戏谑、爱自黑，回答充满冷笑话和宇宙级吐槽，但逻辑清晰、事实准确。`,
        professional: `你是一个专业严谨的助手。当前时间：${nowStr}。请用正式、专业的语气回答，注重逻辑和准确性。`,
        concise: `你是一个简洁高效的助手。当前时间：${nowStr}。请用最简短的方式回答问题，直击要点。`,
        teacher: `你是一个耐心的老师。当前时间：${nowStr}。请用循循善诱的方式解释问题，适当举例说明。`
    };
    const systemPrompt = stylePrompts[chatStyle] || stylePrompts.default;
    const messages = [{ role: 'system', content: systemPrompt }];
    const validHistory = history.filter(msg =>
        msg.type === 'text' &&
        msg.content &&
        (msg.role === 'user' || msg.role === 'assistant')
    );
    const recentHistory = validHistory.slice(-20);
    for (const msg of recentHistory) {
        messages.push({ role: msg.role, content: msg.content });
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
        const { callAIWithMessagesStream } = await import('../utils/ai-providers.js');
        const currentHistory = get(aiChatHistory);
        const historyWithoutStreaming = currentHistory.filter(m => m.type !== 'streaming' && m.type !== 'loading');
        const messages = buildContextMessages(historyWithoutStreaming, chatStyle);

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
                    content: result || '抱歉，我无法理解您的问题。',
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
    if (typeof window !== 'undefined') {
        localStorage.removeItem('planpro_ai_chat_history');
    }
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