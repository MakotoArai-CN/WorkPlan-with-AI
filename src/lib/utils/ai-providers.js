import { isG4FProvider, chatWithG4F, fetchG4FModels, getG4FDefaultModels, getG4FProvidersList, streamChatWithG4F } from './g4f-client.js';

const PROVIDER_CONFIGS = {
    openai: {
        name: 'OpenAI',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        modelsEndpoint: 'https://api.openai.com/v1/models',
        defaultModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'],
        defaultModel: 'gpt-4o-mini',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://platform.openai.com/docs/api-reference',
        apiUrl: 'https://platform.openai.com/api-keys'
    },
    deepseek: {
        name: 'DeepSeek',
        endpoint: 'https://api.deepseek.com/chat/completions',
        modelsEndpoint: 'https://api.deepseek.com/models',
        defaultModels: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
        defaultModel: 'deepseek-chat',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://platform.deepseek.com/api-docs/',
        apiUrl: 'https://platform.deepseek.com/api_keys'
    },
    groq: {
        name: 'Groq',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        modelsEndpoint: 'https://api.groq.com/openai/v1/models',
        defaultModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
        defaultModel: 'llama-3.3-70b-versatile',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://console.groq.com/docs/',
        apiUrl: 'https://console.groq.com/keys'
    },
    siliconflow: {
        name: '硅基流动',
        endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
        modelsEndpoint: 'https://api.siliconflow.cn/v1/models',
        defaultModels: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V2.5', 'THUDM/glm-4-9b-chat'],
        defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://siliconflow.cn/',
        apiUrl: 'https://cloud.siliconflow.cn/account/ak'
    },
    zhipu: {
        name: '智谱 GLM',
        endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        modelsEndpoint: 'https://open.bigmodel.cn/api/paas/v4/models',
        defaultModels: ['GLM-4.6V-Flash', 'GLM-4.5-Flash', 'GLM-4.1V-Thinking-Flash', 'GLM-4-Flash-250414', 'GLM-4V-Flash', 'GLM-4.6', 'glm-4-flash', 'glm-4', 'glm-4-plus', 'glm-4-air', 'glm-4-airx', 'glm-4-long', 'glm-4v', 'glm-4v-plus'],
        defaultModel: 'glm-4-flash',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://open.bigmodel.cn/dev/api',
        apiUrl: 'https://open.bigmodel.cn/usercenter/apikeys'
    },
    qwen: {
        name: '阿里通义千问',
        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        modelsEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
        defaultModels: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-turbo-latest', 'qwen-plus-latest'],
        defaultModel: 'qwen-turbo',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://help.aliyun.com/zh/dashscope/',
        apiUrl: 'https://dashscope.console.aliyun.com/apiKey'
    },
    moonshot: {
        name: '月之暗面 Kimi',
        endpoint: 'https://api.moonshot.cn/v1/chat/completions',
        modelsEndpoint: 'https://api.moonshot.cn/v1/models',
        defaultModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
        defaultModel: 'moonshot-v1-8k',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://platform.moonshot.cn/docs/',
        apiUrl: 'https://platform.moonshot.cn/console/api-keys'
    },
    spark: {
        name: '讯飞星火',
        endpoint: 'https://spark-api-open.xf-yun.com/v1/chat/completions',
        defaultModels: ['4.0Ultra', 'generalv3.5', 'generalv3', 'lite'],
        defaultModel: 'generalv3.5',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        docUrl: 'https://www.xfyun.cn/doc/spark/Web.html',
        apiUrl: 'https://console.xfyun.cn/services/cbm'
    },
    baidu: {
        name: '百度文心一言',
        endpoint: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro',
        tokenEndpoint: 'https://aip.baidubce.com/oauth/2.0/token',
        defaultModels: ['ERNIE-4.0-8K', 'ERNIE-3.5-8K', 'ERNIE-Speed-8K'],
        defaultModel: 'ERNIE-3.5-8K',
        authType: 'baidu_token',
        bodyFormat: 'baidu',
        supportsModelList: false,
        docUrl: 'https://cloud.baidu.com/doc/WENXINWORKSHOP/',
        apiUrl: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application'
    },
    hunyuan: {
        name: '腾讯混元',
        endpoint: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions',
        defaultModels: ['hunyuan-turbo', 'hunyuan-pro', 'hunyuan-standard', 'hunyuan-lite'],
        defaultModel: 'hunyuan-lite',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        docUrl: 'https://cloud.tencent.com/document/product/1729',
        apiUrl: 'https://console.cloud.tencent.com/cam/capi'
    },
    mimo: {
        name: '小米 MiMo',
        endpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
        modelsEndpoint: 'https://api.xiaomimimo.com/v1/models',
        defaultModels: ['mimo-v2-flash', 'mimo-v2-pro'],
        defaultModel: 'mimo-v2-flash',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://dev.mi.com/xiaomihyperos/documentation/doc?docId=AGIServiceApiDoc',
        apiUrl: 'https://dev.mi.com/platform/personalcenter/apiKey'
    },
    anthropic: {
        name: 'Anthropic Claude',
        endpoint: 'https://api.anthropic.com/v1/messages',
        defaultModels: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
        defaultModel: 'claude-3-5-sonnet-20241022',
        authType: 'x-api-key',
        headers: { 'anthropic-version': '2023-06-01' },
        bodyFormat: 'anthropic',
        supportsModelList: false,
        docUrl: 'https://docs.anthropic.com/',
        apiUrl: 'https://console.anthropic.com/settings/keys'
    },
    google: {
        name: 'Google Gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        modelsEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
        defaultModels: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash-exp'],
        defaultModel: 'gemini-1.5-flash',
        authType: 'query_key',
        bodyFormat: 'google',
        supportsModelList: true,
        docUrl: 'https://ai.google.dev/docs',
        apiUrl: 'https://aistudio.google.com/app/apikey'
    },
    mistral: {
        name: 'Mistral AI',
        endpoint: 'https://api.mistral.ai/v1/chat/completions',
        modelsEndpoint: 'https://api.mistral.ai/v1/models',
        defaultModels: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-7b', 'codestral-latest'],
        defaultModel: 'mistral-small-latest',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://docs.mistral.ai/',
        apiUrl: 'https://console.mistral.ai/api-keys/'
    },
    openrouter: {
        name: 'OpenRouter',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        modelsEndpoint: 'https://openrouter.ai/api/v1/models',
        defaultModels: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.3-70b-instruct'],
        defaultModel: 'meta-llama/llama-3.3-70b-instruct',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://openrouter.ai/docs',
        apiUrl: 'https://openrouter.ai/keys'
    },
    together: {
        name: 'Together AI',
        endpoint: 'https://api.together.xyz/v1/chat/completions',
        modelsEndpoint: 'https://api.together.xyz/v1/models',
        defaultModels: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'mistralai/Mixtral-8x22B-Instruct-v0.1'],
        defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://docs.together.ai/',
        apiUrl: 'https://api.together.xyz/settings/api-keys'
    },
    fireworks: {
        name: 'Fireworks AI',
        endpoint: 'https://api.fireworks.ai/inference/v1/chat/completions',
        modelsEndpoint: 'https://api.fireworks.ai/inference/v1/models',
        defaultModels: ['accounts/fireworks/models/llama-v3p3-70b-instruct'],
        defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://docs.fireworks.ai/',
        apiUrl: 'https://fireworks.ai/account/api-keys'
    },
    yi: {
        name: '零一万物',
        endpoint: 'https://api.lingyiwanwu.com/v1/chat/completions',
        modelsEndpoint: 'https://api.lingyiwanwu.com/v1/models',
        defaultModels: ['yi-lightning', 'yi-large', 'yi-medium', 'yi-spark'],
        defaultModel: 'yi-lightning',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://platform.lingyiwanwu.com/docs',
        apiUrl: 'https://platform.lingyiwanwu.com/apikeys'
    },
    baichuan: {
        name: '百川智能',
        endpoint: 'https://api.baichuan-ai.com/v1/chat/completions',
        defaultModels: ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan2-Turbo'],
        defaultModel: 'Baichuan3-Turbo',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        docUrl: 'https://platform.baichuan-ai.com/docs/api',
        apiUrl: 'https://platform.baichuan-ai.com/console/apikey'
    },
    minimax: {
        name: 'MiniMax',
        endpoint: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
        defaultModels: ['abab6.5s-chat', 'abab6.5-chat', 'abab5.5-chat'],
        defaultModel: 'abab6.5s-chat',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        docUrl: 'https://platform.minimaxi.com/document/guides',
        apiUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key'
    },
    stepfun: {
        name: '阶跃星辰',
        endpoint: 'https://api.stepfun.com/v1/chat/completions',
        defaultModels: ['step-1-8k', 'step-1-32k', 'step-2-16k'],
        defaultModel: 'step-1-8k',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        docUrl: 'https://platform.stepfun.com/docs',
        apiUrl: 'https://platform.stepfun.com/interface-key'
    },
    doubao: {
        name: '字节豆包',
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        defaultModels: ['doubao-pro-32k', 'doubao-pro-128k', 'doubao-lite-32k'],
        defaultModel: 'doubao-pro-32k',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        docUrl: 'https://www.volcengine.com/docs/82379',
        apiUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey'
    },
    sensetime: {
        name: '商汤日日新',
        endpoint: 'https://api.sensenova.cn/v1/llm/chat-completions',
        defaultModels: ['SenseChat-5', 'SenseChat-Turbo'],
        defaultModel: 'SenseChat-5',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        docUrl: 'https://platform.sensenova.cn/',
        apiUrl: 'https://platform.sensenova.cn/home'
    },
    cohere: {
        name: 'Cohere',
        endpoint: 'https://api.cohere.ai/v1/chat',
        modelsEndpoint: 'https://api.cohere.ai/v1/models',
        defaultModels: ['command-r-plus', 'command-r', 'command'],
        defaultModel: 'command-r',
        authType: 'bearer',
        bodyFormat: 'cohere',
        supportsModelList: true,
        docUrl: 'https://docs.cohere.com/',
        apiUrl: 'https://dashboard.cohere.com/api-keys'
    },
    perplexity: {
        name: 'Perplexity',
        endpoint: 'https://api.perplexity.ai/chat/completions',
        defaultModels: ['llama-3.1-sonar-small-128k-online', 'llama-3.1-sonar-large-128k-online'],
        defaultModel: 'llama-3.1-sonar-small-128k-online',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        docUrl: 'https://docs.perplexity.ai/',
        apiUrl: 'https://www.perplexity.ai/settings/api'
    },
    cloudflare: {
        name: 'Cloudflare Workers AI',
        endpoint: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}',
        defaultModels: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3-8b-instruct'],
        defaultModel: '@cf/meta/llama-3-8b-instruct',
        authType: 'bearer',
        bodyFormat: 'cloudflare',
        supportsModelList: false,
        docUrl: 'https://developers.cloudflare.com/workers-ai/',
        apiUrl: 'https://dash.cloudflare.com/profile/api-tokens'
    },
    huggingface: {
        name: 'Hugging Face',
        endpoint: 'https://api-inference.huggingface.co/models/{model}/v1/chat/completions',
        defaultModels: ['meta-llama/Llama-3.2-3B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'],
        defaultModel: 'meta-llama/Llama-3.2-3B-Instruct',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        docUrl: 'https://huggingface.co/docs/api-inference',
        apiUrl: 'https://huggingface.co/settings/tokens'
    },
    novita: {
        name: 'Novita AI',
        endpoint: 'https://api.novita.ai/v3/openai/chat/completions',
        modelsEndpoint: 'https://api.novita.ai/v3/openai/models',
        defaultModels: ['meta-llama/llama-3.1-70b-instruct', 'meta-llama/llama-3.1-8b-instruct'],
        defaultModel: 'meta-llama/llama-3.1-8b-instruct',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://novita.ai/docs',
        apiUrl: 'https://novita.ai/dashboard/key'
    },
    ollama: {
        name: 'Ollama (本地)',
        endpoint: 'http://localhost:11434/api/chat',
        modelsEndpoint: 'http://localhost:11434/api/tags',
        defaultModels: ['llama3.2', 'qwen2.5', 'mistral', 'deepseek-r1'],
        defaultModel: 'llama3.2',
        authType: 'none',
        bodyFormat: 'ollama',
        supportsModelList: true,
        docUrl: 'https://ollama.com/',
        apiUrl: ''
    },
    lmstudio: {
        name: 'LM Studio (本地)',
        endpoint: 'http://localhost:1234/v1/chat/completions',
        modelsEndpoint: 'http://localhost:1234/v1/models',
        defaultModels: ['local-model'],
        defaultModel: 'local-model',
        authType: 'none',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://lmstudio.ai/',
        apiUrl: ''
    },
    custom: {
        name: '自定义接口',
        endpoint: '',
        defaultModels: [],
        defaultModel: '',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        supportsCustomModel: true,
        docUrl: '',
        apiUrl: ''
    }
};

let baiduTokenCache = { token: null, expireTime: 0 };
let modelCache = {};

async function fetchWithTauri(url, options = {}) {
    if (typeof window === 'undefined') {
        throw new Error('Not in browser environment');
    }
    try {
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        const headers = {};
        if (options.headers) {
            for (const [key, value] of Object.entries(options.headers)) {
                if (value !== undefined && value !== null) {
                    headers[key] = String(value);
                }
            }
        }
        const fetchOptions = {
            method: options.method || 'GET',
            headers: headers
        };
        if (options.body) {
            if (typeof options.body === 'string') {
                fetchOptions.body = options.body;
            } else {
                fetchOptions.body = JSON.stringify(options.body);
            }
        }
        const response = await tauriFetch(url, fetchOptions);
        return {
            ok: response.ok,
            status: response.status,
            json: async () => response.json(),
            text: async () => response.text(),
            body: response.body
        };
    } catch (e) {
        const errorMsg = e.message || String(e);
        console.error('Tauri fetch error:', errorMsg);
        if (errorMsg.includes('not allowed on the configured scope')) {
            throw new Error('网络权限受限：请确保应用配置允许访问此 API 地址');
        }
        if (errorMsg.includes('Failed to fetch') || errorMsg.includes('Network') || errorMsg.includes('connect')) {
            throw new Error('网络请求失败：请检查网络连接或 API 地址是否正确');
        }
        throw new Error('请求失败: ' + errorMsg);
    }
}

async function getBaiduAccessToken(apiKey, secretKey) {
    const now = Date.now();
    if (baiduTokenCache.token && baiduTokenCache.expireTime > now) {
        return baiduTokenCache.token;
    }
    const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`;
    const response = await fetchWithTauri(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error('获取百度 access_token 失败: ' + response.status);
    const data = await response.json();
    if (data.error) throw new Error('百度认证错误: ' + data.error_description);
    baiduTokenCache.token = data.access_token;
    baiduTokenCache.expireTime = now + (data.expires_in - 300) * 1000;
    return data.access_token;
}

export async function fetchProviderModels(providerId, apiKey = '') {
    const cacheKey = `${providerId}_${apiKey ? 'auth' : 'noauth'}`;
    if (modelCache[cacheKey] && modelCache[cacheKey].expireTime > Date.now()) {
        return modelCache[cacheKey].models;
    }
    if (isG4FProvider(providerId)) {
        try {
            const models = await fetchG4FModels(providerId, { apiKey });
            modelCache[cacheKey] = { models, expireTime: Date.now() + 300000 };
            return models;
        } catch (e) {
            console.error(`Failed to fetch G4F models for ${providerId}:`, e);
            return getG4FDefaultModels(providerId);
        }
    }
    const provider = PROVIDER_CONFIGS[providerId];
    if (!provider || !provider.supportsModelList || !provider.modelsEndpoint) {
        return provider ? provider.defaultModels : [];
    }
    try {
        const headers = { 'Accept': 'application/json' };
        if (apiKey && provider.authType === 'bearer') {
            headers['Authorization'] = 'Bearer ' + apiKey;
        }
        let endpoint = provider.modelsEndpoint;
        if (provider.authType === 'query_key' && apiKey) {
            endpoint += '?key=' + encodeURIComponent(apiKey);
        }
        const response = await fetchWithTauri(endpoint, { method: 'GET', headers });
        if (!response.ok) {
            return provider.defaultModels;
        }
        const data = await response.json();
        let fetchedModels = [];
        if (providerId === 'ollama' && data.models) {
            fetchedModels = data.models.map(m => m.name || m.model);
        } else if (providerId === 'google' && data.models) {
            fetchedModels = data.models
                .filter(m => m.name && m.name.includes('gemini'))
                .map(m => m.name.replace('models/', ''));
        } else if (providerId === 'cohere' && data.models) {
            fetchedModels = data.models
                .filter(m => m.endpoints && m.endpoints.includes('chat'))
                .map(m => m.name);
        } else if (providerId === 'zhipu' && data.data) {
            fetchedModels = data.data.map(m => m.id || m.name).filter(Boolean);
        } else if (Array.isArray(data.data)) {
            fetchedModels = data.data.map(m => m.id || m.name).filter(Boolean);
        } else if (Array.isArray(data.models)) {
            fetchedModels = data.models.map(m => typeof m === 'string' ? m : (m.id || m.name)).filter(Boolean);
        } else if (Array.isArray(data)) {
            fetchedModels = data.map(m => typeof m === 'string' ? m : (m.id || m.name)).filter(Boolean);
        }
        if (fetchedModels.length > 0) {
            const mergedModels = [...new Set([...fetchedModels, ...provider.defaultModels])];
            modelCache[cacheKey] = { models: mergedModels, expireTime: Date.now() + 300000 };
            return mergedModels;
        }
        return provider.defaultModels;
    } catch (e) {
        console.error(`Failed to fetch models for ${providerId}:`, e);
        return provider.defaultModels;
    }
}

function getCachedModels(providerId) {
    for (const key in modelCache) {
        if (key.startsWith(providerId + '_') && modelCache[key].expireTime > Date.now()) {
            return modelCache[key].models || [];
        }
    }
    return [];
}

function validateModel(provider, model, cachedModels = [], isCustomProvider = false) {
    if (isCustomProvider) {
        return model || 'auto';
    }
    if (!model || model === 'auto') {
        return provider.defaultModel || 'auto';
    }
    const allModels = [...new Set([...provider.defaultModels, ...cachedModels])];
    if (allModels.length === 0) {
        return provider.defaultModel || model;
    }
    if (allModels.includes(model)) {
        return model;
    }
    const lowerModel = model.toLowerCase();
    const matched = allModels.find(m => m.toLowerCase() === lowerModel);
    if (matched) {
        return matched;
    }
    const partialMatch = allModels.find(m =>
        m.toLowerCase().includes(lowerModel) || lowerModel.includes(m.toLowerCase())
    );
    if (partialMatch) {
        return partialMatch;
    }
    return model;
}

function buildRequestBody(provider, model, messages, options) {
    const format = provider.bodyFormat || 'openai';
    const temperature = options.temperature || 0.7;
    const maxTokens = options.maxTokens || 2048;
    const stream = options.stream || false;
    switch (format) {
        case 'baidu':
            return { messages, temperature, max_output_tokens: maxTokens, stream };
        case 'anthropic':
            return {
                model,
                messages: messages.filter(m => m.role !== 'system'),
                system: messages.find(m => m.role === 'system')?.content,
                max_tokens: maxTokens,
                temperature,
                stream
            };
        case 'cohere':
            return { message: messages[messages.length - 1].content, model, temperature, max_tokens: maxTokens, stream };
        case 'cloudflare':
            return { messages, temperature, max_tokens: maxTokens, stream };
        case 'ollama':
            return { model, messages, stream };
        case 'google':
            return {
                contents: messages.filter(m => m.role !== 'system').map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }]
                })),
                systemInstruction: messages.find(m => m.role === 'system') ? {
                    parts: [{ text: messages.find(m => m.role === 'system').content }]
                } : undefined,
                generationConfig: { temperature, maxOutputTokens: maxTokens }
            };
        default:
            return { model, messages, temperature, max_tokens: maxTokens, stream };
    }
}

function parseResponse(provider, responseData) {
    const format = provider.bodyFormat || 'openai';
    if (responseData.error) {
        throw new Error('API 错误: ' + (responseData.error.message || JSON.stringify(responseData.error)));
    }
    switch (format) {
        case 'baidu':
            if (responseData.error_code) throw new Error('百度 API 错误: ' + responseData.error_msg);
            return responseData.result || '';
        case 'anthropic':
            return responseData.content?.[0]?.text || '';
        case 'cohere':
            return responseData.text || '';
        case 'cloudflare':
            return responseData.result?.response || '';
        case 'ollama':
            return responseData.message?.content || '';
        case 'google':
            return responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        default:
            return responseData.choices?.[0]?.message?.content || '';
    }
}

function parseStreamChunk(provider, chunk) {
    const format = provider.bodyFormat || 'openai';
    if (!chunk) return '';
    switch (format) {
        case 'baidu':
            return chunk.result || '';
        case 'anthropic':
            if (chunk.type === 'content_block_delta') {
                return chunk.delta?.text || '';
            }
            return '';
        case 'cohere':
            return chunk.text || '';
        case 'cloudflare':
            return chunk.response || '';
        case 'ollama':
            return chunk.message?.content || '';
        case 'google':
            return chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
        default:
            return chunk.choices?.[0]?.delta?.content || '';
    }
}

export async function callAI(config, userMessage, systemPrompt) {
    const providerId = config.provider || 'g4f-default';
    if (isG4FProvider(providerId)) {
        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: userMessage });
        return await chatWithG4F(providerId, config.model, messages, {
            apiKey: config.apiKey,
            temperature: config.temperature,
            maxTokens: config.maxTokens
        });
    }
    const provider = PROVIDER_CONFIGS[providerId];
    if (!provider) throw new Error('未知的 AI 厂商: ' + providerId);
    const isCustomProvider = providerId === 'custom';
    let endpoint = isCustomProvider ? config.customEndpoint : (config.customEndpoint || provider.endpoint);
    let model;
    if (isCustomProvider) {
        model = config.customModel || config.model || 'auto';
        if (!endpoint) throw new Error('请配置自定义 API 端点');
    } else {
        const cachedModels = getCachedModels(providerId);
        model = validateModel(provider, config.model, cachedModels, false);
    }
    const apiKey = config.apiKey || '';
    const secretKey = config.secretKey || '';
    if (providerId === 'cloudflare' && config.accountId) {
        endpoint = endpoint.replace('{account_id}', config.accountId).replace('{model}', model);
    }
    if (providerId === 'google') {
        endpoint = endpoint.replace('{model}', model);
    }
    if (providerId === 'huggingface') {
        endpoint = endpoint.replace('{model}', model);
    }
    if (!endpoint) throw new Error('未配置 API 端点');
    if (!apiKey && provider.authType !== 'none') throw new Error('未配置 API Key');
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userMessage });
    const requestBody = buildRequestBody(provider, model, messages, {
        temperature: config.temperature || 0.7,
        maxTokens: config.maxTokens || 2048,
        stream: false
    });
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (provider.headers) {
        Object.assign(headers, provider.headers);
    }
    if (config.customHeaders) {
        Object.assign(headers, config.customHeaders);
    }
    let finalEndpoint = endpoint;
    if (provider.authType === 'baidu_token') {
        const accessToken = await getBaiduAccessToken(apiKey, secretKey);
        finalEndpoint = endpoint + '?access_token=' + encodeURIComponent(accessToken);
    } else if (provider.authType === 'bearer') {
        headers['Authorization'] = 'Bearer ' + apiKey;
    } else if (provider.authType === 'x-api-key') {
        headers['X-API-Key'] = apiKey;
    } else if (provider.authType === 'api-key') {
        headers['api-key'] = apiKey;
    } else if (provider.authType === 'query_key') {
        finalEndpoint = endpoint + '?key=' + encodeURIComponent(apiKey);
    }
    const response = await fetchWithTauri(finalEndpoint, {
        method: 'POST',
        headers,
        body: requestBody
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error('HTTP ' + response.status + ': ' + errorText.substring(0, 500));
    }
    const responseData = await response.json();
    return parseResponse(provider, responseData);
}

export async function callAIWithMessages(config, messages) {
    const providerId = config.provider || 'g4f-default';
    if (isG4FProvider(providerId)) {
        return await chatWithG4F(providerId, config.model, messages, {
            apiKey: config.apiKey,
            temperature: config.temperature,
            maxTokens: config.maxTokens
        });
    }
    const provider = PROVIDER_CONFIGS[providerId];
    if (!provider) throw new Error('未知的 AI 厂商: ' + providerId);
    const isCustomProvider = providerId === 'custom';
    let endpoint = isCustomProvider ? config.customEndpoint : (config.customEndpoint || provider.endpoint);
    let model;
    if (isCustomProvider) {
        model = config.customModel || config.model || 'auto';
        if (!endpoint) throw new Error('请配置自定义 API 端点');
    } else {
        const cachedModels = getCachedModels(providerId);
        model = validateModel(provider, config.model, cachedModels, false);
    }
    const apiKey = config.apiKey || '';
    const secretKey = config.secretKey || '';
    if (providerId === 'cloudflare' && config.accountId) {
        endpoint = endpoint.replace('{account_id}', config.accountId).replace('{model}', model);
    }
    if (providerId === 'google') {
        endpoint = endpoint.replace('{model}', model);
    }
    if (providerId === 'huggingface') {
        endpoint = endpoint.replace('{model}', model);
    }
    if (!endpoint) throw new Error('未配置 API 端点');
    if (!apiKey && provider.authType !== 'none') throw new Error('未配置 API Key');
    const requestBody = buildRequestBody(provider, model, messages, {
        temperature: config.temperature || 0.7,
        maxTokens: config.maxTokens || 2048,
        stream: false
    });
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (provider.headers) {
        Object.assign(headers, provider.headers);
    }
    if (config.customHeaders) {
        Object.assign(headers, config.customHeaders);
    }
    let finalEndpoint = endpoint;
    if (provider.authType === 'baidu_token') {
        const accessToken = await getBaiduAccessToken(apiKey, secretKey);
        finalEndpoint = endpoint + '?access_token=' + encodeURIComponent(accessToken);
    } else if (provider.authType === 'bearer') {
        headers['Authorization'] = 'Bearer ' + apiKey;
    } else if (provider.authType === 'x-api-key') {
        headers['X-API-Key'] = apiKey;
    } else if (provider.authType === 'api-key') {
        headers['api-key'] = apiKey;
    } else if (provider.authType === 'query_key') {
        finalEndpoint = endpoint + '?key=' + encodeURIComponent(apiKey);
    }
    const response = await fetchWithTauri(finalEndpoint, {
        method: 'POST',
        headers,
        body: requestBody
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error('HTTP ' + response.status + ': ' + errorText.substring(0, 500));
    }
    const responseData = await response.json();
    return parseResponse(provider, responseData);
}

export async function callAIWithMessagesStream(config, messages, onChunk) {
    const providerId = config.provider || 'g4f-default';
    if (isG4FProvider(providerId)) {
        return await streamChatWithG4F(providerId, config.model, messages, {
            apiKey: config.apiKey,
            temperature: config.temperature,
            maxTokens: config.maxTokens
        }, onChunk);
    }
    const provider = PROVIDER_CONFIGS[providerId];
    if (!provider) throw new Error('未知的 AI 厂商: ' + providerId);
    const isCustomProvider = providerId === 'custom';
    let endpoint = isCustomProvider ? config.customEndpoint : (config.customEndpoint || provider.endpoint);
    let model;
    if (isCustomProvider) {
        model = config.customModel || config.model || 'auto';
        if (!endpoint) throw new Error('请配置自定义 API 端点');
    } else {
        const cachedModels = getCachedModels(providerId);
        model = validateModel(provider, config.model, cachedModels, false);
    }
    const apiKey = config.apiKey || '';
    const secretKey = config.secretKey || '';
    if (providerId === 'cloudflare' && config.accountId) {
        endpoint = endpoint.replace('{account_id}', config.accountId).replace('{model}', model);
    }
    if (providerId === 'google') {
        endpoint = endpoint.replace('{model}', model);
    }
    if (providerId === 'huggingface') {
        endpoint = endpoint.replace('{model}', model);
    }
    if (!endpoint) throw new Error('未配置 API 端点');
    if (!apiKey && provider.authType !== 'none') throw new Error('未配置 API Key');
    const requestBody = buildRequestBody(provider, model, messages, {
        temperature: config.temperature || 0.7,
        maxTokens: config.maxTokens || 2048,
        stream: true
    });
    const headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
    if (provider.headers) {
        Object.assign(headers, provider.headers);
    }
    if (config.customHeaders) {
        Object.assign(headers, config.customHeaders);
    }
    let finalEndpoint = endpoint;
    if (provider.authType === 'baidu_token') {
        const accessToken = await getBaiduAccessToken(apiKey, secretKey);
        finalEndpoint = endpoint + '?access_token=' + encodeURIComponent(accessToken);
    } else if (provider.authType === 'bearer') {
        headers['Authorization'] = 'Bearer ' + apiKey;
    } else if (provider.authType === 'x-api-key') {
        headers['X-API-Key'] = apiKey;
    } else if (provider.authType === 'api-key') {
        headers['api-key'] = apiKey;
    } else if (provider.authType === 'query_key') {
        finalEndpoint = endpoint + '?key=' + encodeURIComponent(apiKey);
    }
    let fullContent = '';
    try {
        const response = await fetch(finalEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error('HTTP ' + response.status + ': ' + errorText.substring(0, 500));
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;
                if (trimmedLine.startsWith('data: ')) {
                    try {
                        const jsonStr = trimmedLine.slice(6);
                        const chunk = JSON.parse(jsonStr);
                        const delta = parseStreamChunk(provider, chunk);
                        if (delta) {
                            fullContent += delta;
                            if (onChunk) {
                                onChunk(delta, fullContent);
                            }
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }
        }
    } catch (e) {
        if (fullContent) {
            return fullContent;
        }
        return await callAIWithMessages(config, messages);
    }
    return fullContent || await callAIWithMessages(config, messages);
}

export async function testConnection(config) {
    try {
        const result = await callAI(config, '你好，请回复"连接成功"', null);
        return { success: true, message: '连接成功', response: result };
    } catch (error) {
        return { success: false, message: error.message, response: null };
    }
}

export async function getProviderList() {
    const result = [];
    try {
        const g4fProviders = await getG4FProvidersList();
        for (const provider of g4fProviders) {
            result.push({
                id: provider.id,
                name: provider.name,
                models: getG4FDefaultModels(provider.id),
                defaultModel: getG4FDefaultModels(provider.id)[0] || 'auto',
                docUrl: 'https://g4f.dev/',
                apiUrl: '',
                authType: provider.requiresApiKey ? 'bearer' : 'none',
                supportsModelList: true,
                tags: provider.tags
            });
        }
    } catch (e) {
        console.error('Failed to load G4F providers:', e);
    }
    for (const [id, provider] of Object.entries(PROVIDER_CONFIGS)) {
        result.push({
            id,
            name: provider.name,
            models: provider.defaultModels,
            defaultModel: provider.defaultModel,
            docUrl: provider.docUrl,
            apiUrl: provider.apiUrl,
            authType: provider.authType,
            supportsModelList: provider.supportsModelList,
            supportsCustomModel: provider.supportsCustomModel || false
        });
    }
    return result;
}

export function getProviderInfo(providerId) {
    if (isG4FProvider(providerId)) {
        return {
            name: providerId === 'g4f-default' ? 'G4F Auto (免费)' : `G4F ${providerId.replace('g4f-', '')}`,
            defaultModels: getG4FDefaultModels(providerId),
            defaultModel: getG4FDefaultModels(providerId)[0] || 'auto',
            authType: 'none',
            supportsModelList: true,
            docUrl: 'https://g4f.dev/',
            apiUrl: ''
        };
    }
    return PROVIDER_CONFIGS[providerId] || null;
}

export function clearModelCache() {
    modelCache = {};
}

export { PROVIDER_CONFIGS };