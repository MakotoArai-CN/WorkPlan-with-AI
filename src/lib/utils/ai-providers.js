const AI_PROVIDERS = {
    openai: {
        name: 'OpenAI',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'],
        defaultModel: 'gpt-4o-mini',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://platform.openai.com/docs/api-reference'
    },
    deepseek: {
        name: 'DeepSeek',
        endpoint: 'https://api.deepseek.com/chat/completions',
        models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
        defaultModel: 'deepseek-chat',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://platform.deepseek.com/api-docs/'
    },
    moonshot: {
        name: '月之暗面 Kimi',
        endpoint: 'https://api.moonshot.cn/v1/chat/completions',
        models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
        defaultModel: 'moonshot-v1-8k',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://platform.moonshot.cn/docs/'
    },
    groq: {
        name: 'Groq (免费)',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3.2-90b-vision-preview', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
        defaultModel: 'llama-3.3-70b-versatile',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://console.groq.com/docs/'
    },
    zhipu: {
        name: '智谱 GLM',
        endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        models: ['glm-4-plus', 'glm-4', 'glm-4-air', 'glm-4-airx', 'glm-4-flash', 'glm-4-long', 'glm-4v-plus'],
        defaultModel: 'glm-4-flash',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://open.bigmodel.cn/dev/api'
    },
    qwen: {
        name: '阿里通义千问',
        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-max-longcontext', 'qwen-long', 'qwen2.5-72b-instruct', 'qwen2.5-32b-instruct'],
        defaultModel: 'qwen-turbo',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://help.aliyun.com/zh/dashscope/'
    },
    baidu: {
        name: '百度文心一言',
        endpoint: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro',
        models: ['ERNIE-4.0-8K', 'ERNIE-4.0-Turbo-8K', 'ERNIE-3.5-8K', 'ERNIE-Speed-8K', 'ERNIE-Lite-8K', 'ERNIE-Tiny-8K'],
        defaultModel: 'ERNIE-3.5-8K',
        authType: 'baidu_token',
        bodyFormat: 'baidu',
        tokenEndpoint: 'https://aip.baidubce.com/oauth/2.0/token',
        docUrl: 'https://cloud.baidu.com/doc/WENXINWORKSHOP/'
    },
    hunyuan: {
        name: '腾讯混元',
        endpoint: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions',
        models: ['hunyuan-turbo', 'hunyuan-pro', 'hunyuan-standard', 'hunyuan-lite', 'hunyuan-turbo-latest'],
        defaultModel: 'hunyuan-turbo',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://cloud.tencent.com/document/product/1729'
    },
    spark: {
        name: '讯飞星火',
        endpoint: 'https://spark-api-open.xf-yun.com/v1/chat/completions',
        models: ['4.0Ultra', 'generalv3.5', 'generalv3', 'generalv2', 'general'],
        defaultModel: 'generalv3.5',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://www.xfyun.cn/doc/spark/Web.html'
    },
    siliconflow: {
        name: '硅基流动 (免费)',
        endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
        models: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V2.5', 'THUDM/glm-4-9b-chat', 'meta-llama/Meta-Llama-3.1-8B-Instruct'],
        defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://siliconflow.cn/'
    },
    anthropic: {
        name: 'Anthropic Claude',
        endpoint: 'https://api.anthropic.com/v1/messages',
        models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
        defaultModel: 'claude-3-5-sonnet-20241022',
        authType: 'x-api-key',
        headers: { 'anthropic-version': '2023-06-01' },
        bodyFormat: 'anthropic',
        docUrl: 'https://docs.anthropic.com/'
    },
    google: {
        name: 'Google Gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-2.0-flash-exp'],
        defaultModel: 'gemini-1.5-flash',
        authType: 'query_key',
        bodyFormat: 'google',
        docUrl: 'https://ai.google.dev/docs'
    },
    mistral: {
        name: 'Mistral AI',
        endpoint: 'https://api.mistral.ai/v1/chat/completions',
        models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'open-mistral-7b', 'open-mixtral-8x7b', 'codestral-latest'],
        defaultModel: 'mistral-small-latest',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://docs.mistral.ai/'
    },
    perplexity: {
        name: 'Perplexity',
        endpoint: 'https://api.perplexity.ai/chat/completions',
        models: ['llama-3.1-sonar-small-128k-online', 'llama-3.1-sonar-large-128k-online', 'llama-3.1-sonar-huge-128k-online'],
        defaultModel: 'llama-3.1-sonar-small-128k-online',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://docs.perplexity.ai/'
    },
    together: {
        name: 'Together AI',
        endpoint: 'https://api.together.xyz/v1/chat/completions',
        models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', 'mistralai/Mixtral-8x22B-Instruct-v0.1', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
        defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://docs.together.ai/'
    },
    fireworks: {
        name: 'Fireworks AI',
        endpoint: 'https://api.fireworks.ai/inference/v1/chat/completions',
        models: ['accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/mixtral-8x22b-instruct', 'accounts/fireworks/models/qwen2p5-72b-instruct'],
        defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://docs.fireworks.ai/'
    },
    openrouter: {
        name: 'OpenRouter',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        models: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro-1.5', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat'],
        defaultModel: 'meta-llama/llama-3.3-70b-instruct',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://openrouter.ai/docs'
    },
    yi: {
        name: '零一万物',
        endpoint: 'https://api.lingyiwanwu.com/v1/chat/completions',
        models: ['yi-lightning', 'yi-large', 'yi-medium', 'yi-spark', 'yi-large-turbo'],
        defaultModel: 'yi-lightning',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://platform.lingyiwanwu.com/docs'
    },
    baichuan: {
        name: '百川智能',
        endpoint: 'https://api.baichuan-ai.com/v1/chat/completions',
        models: ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan3-Turbo-128k', 'Baichuan2-Turbo'],
        defaultModel: 'Baichuan3-Turbo',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://platform.baichuan-ai.com/docs/api'
    },
    minimax: {
        name: 'MiniMax',
        endpoint: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
        models: ['abab6.5s-chat', 'abab6.5-chat', 'abab5.5-chat'],
        defaultModel: 'abab6.5s-chat',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://platform.minimaxi.com/document/guides'
    },
    stepfun: {
        name: '阶跃星辰',
        endpoint: 'https://api.stepfun.com/v1/chat/completions',
        models: ['step-1-8k', 'step-1-32k', 'step-1-128k', 'step-1-256k', 'step-2-16k'],
        defaultModel: 'step-1-8k',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://platform.stepfun.com/docs'
    },
    doubao: {
        name: '字节豆包',
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        models: ['doubao-pro-32k', 'doubao-pro-128k', 'doubao-lite-32k', 'doubao-lite-128k'],
        defaultModel: 'doubao-pro-32k',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://www.volcengine.com/docs/82379'
    },
    tiangong: {
        name: '昆仑天工',
        endpoint: 'https://sky-api.singularity-ai.com/saas/api/v4/generate',
        models: ['SkyChat-MegaVerse'],
        defaultModel: 'SkyChat-MegaVerse',
        authType: 'bearer',
        bodyFormat: 'tiangong',
        docUrl: 'https://model-platform.tiangong.cn/'
    },
    sensetime: {
        name: '商汤日日新',
        endpoint: 'https://api.sensenova.cn/v1/llm/chat-completions',
        models: ['SenseChat-5', 'SenseChat-128K', 'SenseChat-Turbo'],
        defaultModel: 'SenseChat-5',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://platform.sensenova.cn/'
    },
    qihoo360: {
        name: '360智脑',
        endpoint: 'https://api.360.cn/v1/chat/completions',
        models: ['360gpt-turbo', '360gpt-pro'],
        defaultModel: '360gpt-turbo',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://ai.360.com/'
    },
    cohere: {
        name: 'Cohere',
        endpoint: 'https://api.cohere.ai/v1/chat',
        models: ['command-r-plus', 'command-r', 'command', 'command-light'],
        defaultModel: 'command-r',
        authType: 'bearer',
        bodyFormat: 'cohere',
        docUrl: 'https://docs.cohere.com/'
    },
    cloudflare: {
        name: 'Cloudflare Workers AI',
        endpoint: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/meta/llama-3-8b-instruct',
        models: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3-8b-instruct', '@cf/mistral/mistral-7b-instruct-v0.1', '@cf/qwen/qwen1.5-14b-chat-awq'],
        defaultModel: '@cf/meta/llama-3-8b-instruct',
        authType: 'bearer',
        bodyFormat: 'cloudflare',
        docUrl: 'https://developers.cloudflare.com/workers-ai/'
    },
    huggingface: {
        name: 'Hugging Face',
        endpoint: 'https://api-inference.huggingface.co/models/{model}/v1/chat/completions',
        models: ['meta-llama/Llama-3.2-3B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.3'],
        defaultModel: 'meta-llama/Llama-3.2-3B-Instruct',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://huggingface.co/docs/api-inference'
    },
    novita: {
        name: 'Novita AI',
        endpoint: 'https://api.novita.ai/v3/openai/chat/completions',
        models: ['meta-llama/llama-3.1-70b-instruct', 'meta-llama/llama-3.1-8b-instruct', 'mistralai/mistral-7b-instruct'],
        defaultModel: 'meta-llama/llama-3.1-8b-instruct',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: 'https://novita.ai/docs'
    },
    ollama: {
        name: 'Ollama (本地)',
        endpoint: 'http://localhost:11434/api/chat',
        models: ['llama3.2', 'llama3.1', 'qwen2.5', 'mistral', 'phi3', 'gemma2', 'deepseek-r1'],
        defaultModel: 'llama3.2',
        authType: 'none',
        bodyFormat: 'ollama',
        docUrl: 'https://ollama.com/'
    },
    lmstudio: {
        name: 'LM Studio (本地)',
        endpoint: 'http://localhost:1234/v1/chat/completions',
        models: ['local-model'],
        defaultModel: 'local-model',
        authType: 'none',
        bodyFormat: 'openai',
        docUrl: 'https://lmstudio.ai/'
    },
    custom: {
        name: '自定义接口',
        endpoint: '',
        models: [],
        defaultModel: '',
        authType: 'bearer',
        bodyFormat: 'openai',
        docUrl: ''
    }
};

let baiduTokenCache = { token: null, expireTime: 0 };

async function fetchWithTauri(url, options = {}) {
    if (typeof window === 'undefined') {
        throw new Error('Not in browser environment');
    }
    try {
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        const response = await tauriFetch(url, {
            method: options.method || 'GET',
            headers: options.headers || {},
            body: options.body ? JSON.parse(options.body) : undefined
        });
        return {
            ok: response.ok,
            status: response.status,
            json: async () => response.json(),
            text: async () => response.text()
        };
    } catch (e) {
        console.log('Tauri fetch not available, using native fetch');
        return window.fetch(url, options);
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

function buildRequestBody(provider, model, messages, options) {
    const format = provider.bodyFormat || 'openai';
    const temperature = options.temperature || 0.7;
    const maxTokens = options.maxTokens || 2048;

    switch (format) {
        case 'baidu':
            return { messages, temperature, max_output_tokens: maxTokens };
        case 'anthropic':
            return {
                model,
                messages: messages.filter(m => m.role !== 'system'),
                system: messages.find(m => m.role === 'system')?.content,
                max_tokens: maxTokens,
                temperature
            };
        case 'cohere':
            return { message: messages[messages.length - 1].content, model, temperature, max_tokens: maxTokens };
        case 'cloudflare':
            return { messages, temperature, max_tokens: maxTokens };
        case 'ollama':
            return { model, messages, stream: false };
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
        case 'tiangong':
            return {
                messages,
                model,
                stream: false
            };
        default:
            return { model, messages, temperature, max_tokens: maxTokens, stream: false };
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
        case 'tiangong':
            return responseData.resp_data?.reply || '';
        default:
            return responseData.choices?.[0]?.message?.content || '';
    }
}

export async function callAI(config, userMessage, systemPrompt) {
    const providerId = config.provider || 'groq';
    const provider = AI_PROVIDERS[providerId];
    if (!provider) throw new Error('未知的 AI 厂商: ' + providerId);

    let endpoint = config.customEndpoint || provider.endpoint;
    const model = config.model || provider.defaultModel;
    const apiKey = config.apiKey || '';
    const secretKey = config.secretKey || '';

    if (providerId === 'cloudflare' && config.accountId) {
        endpoint = endpoint.replace('{account_id}', config.accountId);
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
        maxTokens: config.maxTokens || 2048
    });

    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    Object.assign(headers, provider.headers || {});
    if (config.customHeaders) Object.assign(headers, config.customHeaders);

    let finalEndpoint = endpoint;
    if (provider.authType === 'baidu_token') {
        const accessToken = await getBaiduAccessToken(apiKey, secretKey);
        finalEndpoint = endpoint + '?access_token=' + encodeURIComponent(accessToken);
    } else if (provider.authType === 'bearer') {
        headers['Authorization'] = 'Bearer ' + apiKey;
    } else if (provider.authType === 'x-api-key') {
        headers['X-API-Key'] = apiKey;
    } else if (provider.authType === 'query_key') {
        finalEndpoint = endpoint + '?key=' + encodeURIComponent(apiKey);
    }

    const response = await fetchWithTauri(finalEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error('HTTP ' + response.status + ': ' + errorText.substring(0, 500));
    }

    const responseData = await response.json();
    return parseResponse(provider, responseData);
}

export async function testConnection(config) {
    try {
        const result = await callAI(config, '你好，请回复"连接成功"', null);
        return { success: true, message: '连接成功', response: result };
    } catch (error) {
        return { success: false, message: error.message, response: null };
    }
}

export function getProviderList() {
    return Object.entries(AI_PROVIDERS).map(([id, provider]) => ({
        id,
        name: provider.name,
        models: provider.models,
        defaultModel: provider.defaultModel,
        docUrl: provider.docUrl,
        authType: provider.authType
    }));
}

export function getProviderInfo(providerId) {
    return AI_PROVIDERS[providerId] || null;
}

export { AI_PROVIDERS };