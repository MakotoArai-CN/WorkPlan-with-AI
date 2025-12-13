import { writable, get } from 'svelte/store';

export const aiConfig = writable({
    provider: 'groq',
    apiKey: '',
    secretKey: '',
    model: '',
    customEndpoint: '',
    accountId: '',
    temperature: 0.7,
    maxTokens: 2048,
    customHeaders: {}
});

export const chatHistory = writable([]);
export const isAiLoading = writable(false);
export const showAiPanel = writable(false);
export const showAiSettings = writable(false);

export const aiProviders = [
    { id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'], defaultModel: 'gpt-4o-mini', authType: 'bearer' },
    { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'], defaultModel: 'deepseek-chat', authType: 'bearer' },
    { id: 'groq', name: 'Groq (免费)', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3.2-90b-vision-preview', 'mixtral-8x7b-32768', 'gemma2-9b-it'], defaultModel: 'llama-3.3-70b-versatile', authType: 'bearer' },
    { id: 'siliconflow', name: '硅基流动 (免费)', models: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V2.5', 'THUDM/glm-4-9b-chat'], defaultModel: 'Qwen/Qwen2.5-7B-Instruct', authType: 'bearer' },
    { id: 'zhipu', name: '智谱 GLM', models: ['glm-4-plus', 'glm-4', 'glm-4-air', 'glm-4-airx', 'glm-4-flash', 'glm-4-long'], defaultModel: 'glm-4-flash', authType: 'bearer' },
    { id: 'qwen', name: '阿里通义千问', models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-max-longcontext', 'qwen-long'], defaultModel: 'qwen-turbo', authType: 'bearer' },
    { id: 'moonshot', name: '月之暗面 Kimi', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'], defaultModel: 'moonshot-v1-8k', authType: 'bearer' },
    { id: 'spark', name: '讯飞星火', models: ['4.0Ultra', 'generalv3.5', 'generalv3', 'generalv2'], defaultModel: 'generalv3.5', authType: 'bearer' },
    { id: 'baidu', name: '百度文心一言', models: ['ERNIE-4.0-8K', 'ERNIE-4.0-Turbo-8K', 'ERNIE-3.5-8K', 'ERNIE-Speed-8K', 'ERNIE-Lite-8K'], defaultModel: 'ERNIE-3.5-8K', authType: 'baidu_token' },
    { id: 'hunyuan', name: '腾讯混元', models: ['hunyuan-turbo', 'hunyuan-pro', 'hunyuan-standard', 'hunyuan-lite'], defaultModel: 'hunyuan-turbo', authType: 'bearer' },
    { id: 'anthropic', name: 'Anthropic Claude', models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'], defaultModel: 'claude-3-5-sonnet-20241022', authType: 'x-api-key' },
    { id: 'google', name: 'Google Gemini', models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-2.0-flash-exp'], defaultModel: 'gemini-1.5-flash', authType: 'query_key' },
    { id: 'mistral', name: 'Mistral AI', models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'open-mistral-7b'], defaultModel: 'mistral-small-latest', authType: 'bearer' },
    { id: 'perplexity', name: 'Perplexity', models: ['llama-3.1-sonar-small-128k-online', 'llama-3.1-sonar-large-128k-online'], defaultModel: 'llama-3.1-sonar-small-128k-online', authType: 'bearer' },
    { id: 'together', name: 'Together AI', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo'], defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', authType: 'bearer' },
    { id: 'fireworks', name: 'Fireworks AI', models: ['accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/mixtral-8x22b-instruct'], defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct', authType: 'bearer' },
    { id: 'openrouter', name: 'OpenRouter', models: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro-1.5', 'meta-llama/llama-3.3-70b-instruct'], defaultModel: 'meta-llama/llama-3.3-70b-instruct', authType: 'bearer' },
    { id: 'yi', name: '零一万物', models: ['yi-lightning', 'yi-large', 'yi-medium', 'yi-spark'], defaultModel: 'yi-lightning', authType: 'bearer' },
    { id: 'baichuan', name: '百川智能', models: ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan3-Turbo-128k'], defaultModel: 'Baichuan3-Turbo', authType: 'bearer' },
    { id: 'minimax', name: 'MiniMax', models: ['abab6.5s-chat', 'abab6.5-chat', 'abab5.5-chat'], defaultModel: 'abab6.5s-chat', authType: 'bearer' },
    { id: 'stepfun', name: '阶跃星辰', models: ['step-1-8k', 'step-1-32k', 'step-1-128k', 'step-2-16k'], defaultModel: 'step-1-8k', authType: 'bearer' },
    { id: 'doubao', name: '字节豆包', models: ['doubao-pro-32k', 'doubao-pro-128k', 'doubao-lite-32k'], defaultModel: 'doubao-pro-32k', authType: 'bearer' },
    { id: 'sensetime', name: '商汤日日新', models: ['SenseChat-5', 'SenseChat-128K', 'SenseChat-Turbo'], defaultModel: 'SenseChat-5', authType: 'bearer' },
    { id: 'cohere', name: 'Cohere', models: ['command-r-plus', 'command-r', 'command'], defaultModel: 'command-r', authType: 'bearer' },
    { id: 'cloudflare', name: 'Cloudflare Workers AI', models: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3-8b-instruct'], defaultModel: '@cf/meta/llama-3-8b-instruct', authType: 'bearer' },
    { id: 'huggingface', name: 'Hugging Face', models: ['meta-llama/Llama-3.2-3B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'], defaultModel: 'meta-llama/Llama-3.2-3B-Instruct', authType: 'bearer' },
    { id: 'novita', name: 'Novita AI', models: ['meta-llama/llama-3.1-70b-instruct', 'meta-llama/llama-3.1-8b-instruct'], defaultModel: 'meta-llama/llama-3.1-8b-instruct', authType: 'bearer' },
    { id: 'ollama', name: 'Ollama (本地)', models: ['llama3.2', 'llama3.1', 'qwen2.5', 'mistral', 'phi3', 'gemma2', 'deepseek-r1'], defaultModel: 'llama3.2', authType: 'none' },
    { id: 'lmstudio', name: 'LM Studio (本地)', models: ['local-model'], defaultModel: 'local-model', authType: 'none' },
    { id: 'custom', name: '自定义接口', models: [], defaultModel: '', authType: 'bearer' }
];

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
}

export function saveAiConfig() {
    if (typeof window === 'undefined') return;
    const current = get(aiConfig);
    localStorage.setItem('planpro_ai_config', JSON.stringify(current));
}

export function updateAiConfig(updates) {
    aiConfig.update(c => ({ ...c, ...updates }));
}

export async function sendAiMessage(text) {
    if (!text.trim()) return;
    const currentConfig = get(aiConfig);
    if (!currentConfig.apiKey && currentConfig.provider !== 'ollama' && currentConfig.provider !== 'lmstudio') {
        showAiSettings.set(true);
        throw new Error('请先配置 AI API Key');
    }
    chatHistory.update(h => [...h, { role: 'user', type: 'text', content: text }]);
    chatHistory.update(h => [...h, { role: 'assistant', type: 'loading' }]);
    isAiLoading.set(true);
    try {
        const { callAI } = await import('../utils/ai-providers.js');
        const result = await analyzeIntent(text, currentConfig, callAI);
        chatHistory.update(h => h.slice(0, -1));
        if (result) {
            chatHistory.update(h => [...h, {
                role: 'assistant',
                type: 'task_card',
                data: result,
                confirmed: false
            }]);
        } else {
            chatHistory.update(h => [...h, {
                role: 'assistant',
                type: 'text',
                content: '无法理解您的输入，请描述得更具体一些。'
            }]);
        }
    } catch (error) {
        chatHistory.update(h => h.slice(0, -1));
        chatHistory.update(h => [...h, {
            role: 'assistant',
            type: 'text',
            content: `出错了: ${error.message}`
        }]);
    } finally {
        isAiLoading.set(false);
    }
}

async function analyzeIntent(userText, config, callAI) {
    const nowStr = new Date().toLocaleString('zh-CN', { hour12: false });
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

export async function testAiConnection() {
    const currentConfig = get(aiConfig);
    const { testConnection } = await import('../utils/ai-providers.js');
    return await testConnection(currentConfig);
}

export function getCurrentProvider() {
    const config = get(aiConfig);
    return aiProviders.find(p => p.id === config.provider);
}