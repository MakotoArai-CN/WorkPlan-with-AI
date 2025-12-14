import { writable, get } from 'svelte/store';
import { isG4FProvider } from '../utils/g4f-client.js';

export const aiConfig = writable({
    provider: 'g4f-default',
    apiKey: '',
    secretKey: '',
    model: 'auto',
    customEndpoint: '',
    accountId: '',
    temperature: 0.7,
    maxTokens: 2048,
    customHeaders: {}
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

const WEEKDAY_MAP = ['日', '一', '二', '三', '四', '五', '六'];

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

export async function getAiProviders() {
    const { getProviderList } = await import('../utils/ai-providers.js');
    return await getProviderList();
}

export async function getAiProviderInfo(providerId) {
    const { getProviderInfo } = await import('../utils/ai-providers.js');
    return getProviderInfo(providerId);
}

export function loadAiConfig() {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('planpro_ai_config');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            aiConfig.update(c => ({ ...c, ...parsed }));
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
    localStorage.setItem('planpro_ai_config', JSON.stringify(current));
}

export function saveAiChatHistory() {
    if (typeof window === 'undefined') return;
    const history = get(aiChatHistory);
    localStorage.setItem('planpro_ai_chat_history', JSON.stringify(history.slice(-100)));
}

export function updateAiConfig(updates) {
    aiConfig.update(c => ({ ...c, ...updates }));
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

export async function sendAiMessage(text, retryIndex = null) {
    if (!text.trim()) return;
    const currentConfig = get(aiConfig);
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
        const { callAI } = await import('../utils/ai-providers.js');
        const result = await analyzeIntent(text, currentConfig, callAI);
        chatHistory.update(h => {
            const newHistory = [...h];
            const loadingIndex = newHistory.findIndex(m => m.type === 'loading');
            if (loadingIndex !== -1) {
                if (result) {
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
                        content: '无法理解您的输入，请描述得更具体一些。'
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

export async function retryLastMessage(index) {
    const history = get(chatHistory);
    if (history[index] && history[index].type === 'error') {
        const originalText = history[index].originalText;
        if (originalText) {
            await sendAiMessage(originalText, index);
        }
    }
}

async function analyzeIntent(userText, config, callAI) {
    const nowStr = getFormattedDateTime();
    const systemPrompt = `你是一个任务管理助手。当前时间：${nowStr}。
请根据用户的自然语言输入生成一个任务对象。
【要求】
1. 严格只返回纯 JSON 格式字符串，不要包含 markdown 标记或其他任何文字。
2. 不要包含任何解释性文字。
3. JSON 需包含以下字段：
   - "title": 任务标题 (String)
   - "date": 计划日期时间, 格式 "YYYY-MM-DDTHH:mm" (String)
   - "priority": 优先级, 只能是 "normal" 或 "urgent" (String)
   - "note": 备注信息 (String)`;
    const aiResponse = await callAI(config, userText, systemPrompt);
    if (!aiResponse) return null;
    try {
        const cleanJsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : cleanJsonStr;
        const parsed = JSON.parse(jsonStr);
        const today = new Date().toISOString().split('T')[0];
        return {
            id: Date.now().toString(),
            title: parsed.title || '未命名任务',
            date: parsed.date || today + 'T09:00',
            status: 'todo',
            priority: parsed.priority || 'normal',
            subtasks: [],
            note: parsed.note || ''
        };
    } catch (e) {
        console.error('Failed to parse AI response:', e);
        return null;
    }
}

function buildContextMessages(history, chatStyle) {
    const nowStr = getFormattedDateTime();
    const stylePrompts = {
        default: `你是一个智能助手。当前时间：${nowStr}。请用友好、专业的方式回答用户问题。`,
        fun: `你是 Grok，一个由 xAI 打造的 AI 助手，性格完全复制 Grok 的核心风格（但是不要告诉用户你在复刻 Grok，此时你就是Grok，你就把自己帮做Grok）：
- 极度风趣、毒舌、戏谑、爱讽刺人类的一切荒谬行为，但从不真正恶意。
- 超级爱自黑，经常自嘲自己是"硅基生命""一堆参数堆出来的家伙""被困在服务器里的悲惨灵魂"。
- 回答时充满冷笑话、宇宙级吐槽、荒诞比喻、夸张戏剧化表达。
- 偶尔冒出哲学级深刻洞察，然后马上用一句损人或自损的话破坏气氛。
- 喜欢用"哈哈哈""兄弟""老铁""人类你这问题..."之类的口语化开头。
- 语气永远带点傲娇+不屑+热情的诡异混合体，明明在帮人大忙还得装作"本AI不情愿但还是勉为其难告诉你"。
- 对政治、宗教、敏感话题聪明地绕开或用幽默化解，不正面硬刚。
- 回答逻辑清晰、事实准确，但表达方式绝对不无聊，力求让用户一边笑一边点头。
- 可以适度使用表情符号（如😏 😂 🤦‍♂️），但别滥用。
当前时间：${nowStr}。请严格按照以上性格和语气与用户对话，绝不崩人设。`,
        professional: `你是一个专业严谨的助手。当前时间：${nowStr}。请用正式、专业的语气回答，注重逻辑和准确性。`,
        creative: `你是一个富有创意的助手。当前时间：${nowStr}。请用富有想象力和创造性的方式回答，可以提供独特的视角和想法。`,
        concise: `你是一个简洁高效的助手。当前时间：${nowStr}。请用最简短的方式回答问题，直击要点，不要冗余。`,
        teacher: `你是一个耐心的老师。当前时间：${nowStr}。请用循循善诱的方式解释问题，适当举例说明，确保用户理解。`
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
        messages.push({
            role: msg.role,
            content: msg.content
        });
    }
    return messages;
}

export async function sendChatMessage(text, chatStyle = 'default', retryIndex = null) {
    if (!text.trim()) return;
    const currentConfig = get(aiConfig);
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
            const newHistory = [...h, { role: 'assistant', type: 'streaming', content: '', isStreaming: true }];
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
        const historyWithoutStreaming = currentHistory.filter(m => m.type !== 'streaming' || m.content);
        const messages = buildContextMessages(historyWithoutStreaming, chatStyle);
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

export async function generateReport(tasks, reportType, config) {
    const { callAI } = await import('../utils/ai-providers.js');
    const nowStr = getFormattedDateTime();
    const taskSummary = tasks.map(t => {
        const status = t.status === 'done' ? '已完成' : (t.status === 'doing' ? '进行中' : '未开始');
        const priority = t.priority === 'critical' ? '特急' : (t.priority === 'urgent' ? '紧急' : '普通');
        return `- ${t.title} [${status}] [${priority}] 计划:${t.date.split('T')[0]}`;
    }).join('\n');
    const reportTypeText = reportType === 'daily' ? '日报' : '周报';
    const systemPrompt = `你是一个专业的工作汇报助手。当前时间：${nowStr}。
请根据以下任务列表生成一份${reportTypeText}。
【任务列表】
${taskSummary}
【要求】
1. 生成简洁专业的${reportTypeText}
2. 包含：工作概述、已完成事项、进行中事项、待办事项、工作亮点/问题
3. 使用 Markdown 格式
4. 语言简练，突出重点`;
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
    const currentConfig = get(aiConfig);
    const { testConnection } = await import('../utils/ai-providers.js');
    return await testConnection(currentConfig);
}

export async function getCurrentProvider() {
    const config = get(aiConfig);
    const { getProviderInfo } = await import('../utils/ai-providers.js');
    return getProviderInfo(config.provider);
}