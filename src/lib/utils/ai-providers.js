import {
    G4F_PROVIDER_CATALOG,
    chatWithG4F,
    fetchG4FModels,
    getG4FDefaultModels,
    isG4FProvider,
    streamChatWithG4F
} from './g4f-client.js';
import { isTauriRuntime } from './runtime.js';

const PROVIDER_CONFIGS = {
    openai: {
        name: 'OpenAI',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        modelsEndpoint: 'https://api.openai.com/v1/models',
        defaultModels: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna'],
        defaultModel: 'gpt-6.1-sol',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://platform.openai.com/docs/api-reference',
        apiUrl: 'https://platform.openai.com/api-keys'
    },
    xai: {
        name: 'xAI Grok',
        endpoint: 'https://api.x.ai/v1/chat/completions',
        modelsEndpoint: 'https://api.x.ai/v1/models',
        defaultModels: ['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-4.20'],
        defaultModel: 'grok-4.7',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://docs.x.ai/',
        apiUrl: 'https://console.x.ai/'
    },
    deepseek: {
        name: 'DeepSeek',
        endpoint: 'https://api.deepseek.com/chat/completions',
        modelsEndpoint: 'https://api.deepseek.com/models',
        defaultModels: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-pro-0813'],
        defaultModel: 'deepseek-flash',
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
        defaultModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'qwen/qwen3.8-27b', 'minimaxai/minimax-m2.7'],
        defaultModel: 'openai/gpt-oss-120b',
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
        defaultModels: ['deepseek-ai/DeepSeek-V4', 'deepseek-ai/DeepSeek-V3.2', 'Qwen/Qwen3.5-397B-A17B', 'Qwen/Qwen3-Max'],
        defaultModel: 'Qwen/Qwen3.5-397B-A17B',
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
        defaultModels: ['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx', 'glm-4.7', 'glm-4.5-air'],
        defaultModel: 'glm-5.3',
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
        defaultModels: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.8-flash', 'qwen3.8-omni-flash'],
        defaultModel: 'qwen3.8-max',
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
        defaultModels: ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3', 'kimi-k2.7-code'],
        defaultModel: 'kimi-k3.1-pro',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://platform.moonshot.cn/docs/',
        apiUrl: 'https://platform.moonshot.cn/console/api-keys'
    },
    spark: {
        name: '讯飞星火',
        endpoint: 'https://spark-api-open.xf-yun.com/v1/chat/completions',
        defaultModels: ['4.0Ultra', 'spark-x1', 'max-32k', 'pro-128k', 'generalv3.5', 'lite', 'generalv4'],
        defaultModel: '4.0Ultra',
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
        defaultModels: ['ERNIE-4.5-8K', 'ERNIE-4.0-8K', 'ERNIE-4.0-Turbo-8K', 'ERNIE-3.5-8K', 'ERNIE-Speed-8K', 'ERNIE-Lite-8K'],
        defaultModel: 'ERNIE-4.5-8K',
        authType: 'baidu_token',
        bodyFormat: 'baidu',
        supportsModelList: false,
        docUrl: 'https://cloud.baidu.com/doc/WENXINWORKSHOP/',
        apiUrl: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application'
    },
    hunyuan: {
        name: '腾讯混元',
        endpoint: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions',
        defaultModels: ['hunyuan-turbo', 'hunyuan-lite', 'hunyuan-standard', 'hunyuan-pro', 'hunyuan-2.0'],
        defaultModel: 'hunyuan-turbo',
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
        defaultModels: ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'],
        defaultModel: 'mimo-v2.6-pro',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://dev.mi.com/xiaomihyperos/documentation/doc?docId=AGIServiceApiDoc',
        apiUrl: 'https://dev.mi.com/platform/personalcenter/apiKey'
    },
    anthropic: {
        name: 'Anthropic Claude',
        endpoint: 'https://api.anthropic.com/v1/messages',
        modelsEndpoint: 'https://api.anthropic.com/v1/models',
        defaultModels: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
        defaultModel: 'claude-sonnet-5-5',
        authType: 'x-api-key',
        headers: { 'anthropic-version': '2023-06-01' },
        bodyFormat: 'anthropic',
        supportsModelList: true,
        docUrl: 'https://docs.anthropic.com/',
        apiUrl: 'https://console.anthropic.com/settings/keys'
    },
    google: {
        name: 'Google Gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        modelsEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
        defaultModels: ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview'],
        defaultModel: 'gemini-4-argon',
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
        defaultModels: ['mistral-large-4', 'mistral-medium-3-5', 'mistral-small-4-0', 'ministral-3-14b-25-12', 'mistral-large-3-25-12'],
        defaultModel: 'mistral-large-4',
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
        defaultModels: ['anthropic/claude-sonnet-5-5', 'openai/gpt-6.1-sol', 'google/gemini-4-argon', 'deepseek/deepseek-v4.1-flash', 'qwen/qwen3.8-max', 'z-ai/glm-5.3'],
        defaultModel: 'anthropic/claude-sonnet-5-5',
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
        defaultModels: ['moonshotai/Kimi-K3', 'zai-org/GLM-5.3', 'deepseek-ai/DeepSeek-V4.1-Flash', 'Qwen/Qwen3.8-2.4T-A95B', 'Qwen/Qwen3.5-9B'],
        defaultModel: 'moonshotai/Kimi-K3',
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
        defaultModels: ['accounts/fireworks/models/glm-5p3', 'accounts/fireworks/models/glm-5p3-flash', 'accounts/fireworks/models/deepseek-v4p1-flash-1017', 'accounts/fireworks/models/minimax-m3p1-flash', 'accounts/fireworks/models/qwen3p8-flash-next-nvfp4'],
        defaultModel: 'accounts/fireworks/models/glm-5p3',
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
        defaultModels: ['yi-lightning', 'yi-large', 'yi-large-turbo'],
        defaultModel: 'yi-large-turbo',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        docUrl: 'https://platform.lingyiwanwu.com/docs',
        apiUrl: 'https://platform.lingyiwanwu.com/apikeys'
    },
    baichuan: {
        name: '百川智能',
        endpoint: 'https://api.baichuan-ai.com/v1/chat/completions',
        defaultModels: ['Baichuan4', 'Baichuan4-Turbo', 'Baichuan3-Turbo', 'Baichuan3-Turbo-128k'],
        defaultModel: 'Baichuan4',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        docUrl: 'https://platform.baichuan-ai.com/docs/api',
        apiUrl: 'https://platform.baichuan-ai.com/console/apikey'
    },
    minimax: {
        name: 'MiniMax',
        endpoint: 'https://api.minimax.cn/v1/chat/completions',
        defaultModels: ['MiniMax-M3.1-Flash', 'MiniMax-M3'],
        defaultModel: 'MiniMax-M3.1-Flash',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        docUrl: 'https://platform.minimaxi.com/document/guides',
        apiUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key'
    },
    stepfun: {
        name: '阶跃星辰',
        endpoint: 'https://api.stepfun.com/v1/chat/completions',
        defaultModels: ['step-5-preview'],
        defaultModel: 'step-5-preview',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        docUrl: 'https://platform.stepfun.com/docs',
        apiUrl: 'https://platform.stepfun.com/interface-key'
    },
    doubao: {
        name: '字节豆包',
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        defaultModels: ['doubao-2.0', 'doubao-seed-2.0', 'doubao-1.5-pro-256k', 'doubao-1.5-lite-32k', 'doubao-pro-32k'],
        defaultModel: 'doubao-2.0',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        docUrl: 'https://www.volcengine.com/docs/82379',
        apiUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey'
    },
    sensetime: {
        name: '商汤日日新',
        endpoint: 'https://api.sensenova.cn/v1/llm/chat-completions',
        defaultModels: ['SenseChat-5.5', 'SenseChat-5', 'SenseChat-Turbo', 'SenseNova-V6-Pro'],
        defaultModel: 'SenseChat-5',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: false,
        docUrl: 'https://platform.sensenova.cn/',
        apiUrl: 'https://platform.sensenova.cn/home'
    },
    cohere: {
        name: 'Cohere',
        endpoint: 'https://api.cohere.com/v2/chat',
        modelsEndpoint: 'https://api.cohere.com/v1/models',
        defaultModels: ['command-a-plus-05-2026', 'command-a-03-2025', 'command-a-reasoning-08-2025', 'command-r7b-12-2024', 'north-mini-code-1-0'],
        defaultModel: 'command-a-plus-05-2026',
        authType: 'bearer',
        bodyFormat: 'cohere-v2',
        supportsModelList: true,
        docUrl: 'https://docs.cohere.com/',
        apiUrl: 'https://dashboard.cohere.com/api-keys'
    },
    perplexity: {
        name: 'Perplexity',
        endpoint: 'https://api.perplexity.ai/v1/agent',
        defaultModels: ['perplexity/sonar', 'openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5-5'],
        defaultModel: 'perplexity/sonar',
        authType: 'bearer',
        bodyFormat: 'perplexity-agent',
        supportsModelList: false,
        docUrl: 'https://docs.perplexity.ai/',
        apiUrl: 'https://www.perplexity.ai/settings/api'
    },
    cloudflare: {
        name: 'Cloudflare Workers AI',
        endpoint: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}',
        defaultModels: ['@cf/meta/llama-3.3-70b-instruct', '@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3-8b-instruct', '@cf/deepseek/deepseek-r1', '@cf/qwen/qwen1.5-14b-chat-awq'],
        defaultModel: '@cf/meta/llama-3.3-70b-instruct',
        authType: 'bearer',
        bodyFormat: 'cloudflare',
        supportsModelList: false,
        docUrl: 'https://developers.cloudflare.com/workers-ai/',
        apiUrl: 'https://dash.cloudflare.com/profile/api-tokens'
    },
    huggingface: {
        name: 'Hugging Face',
        endpoint: 'https://api-inference.huggingface.co/models/{model}/v1/chat/completions',
        defaultModels: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B', 'mistralai/Mistral-7B-Instruct-v0.3'],
        defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
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
        defaultModels: ['moonshotai/kimi-k3.1-pro', 'deepseek/deepseek-v4.1-flash-1017', 'minimax/minimax-m3.1-flash', 'xiaomimimo/mimo-v2.6-pro', 'deepseek/deepseek-v4-pro-0813'],
        defaultModel: 'moonshotai/kimi-k3.1-pro',
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
        defaultModels: ['llama3.3', 'qwen2.5', 'mistral', 'deepseek-r1', 'phi4'],
        defaultModel: 'llama3.3',
        authType: 'none',
        bodyFormat: 'ollama',
        supportsModelList: true,
        supportsCustomEndpoint: true,
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
        supportsCustomEndpoint: true,
        docUrl: 'https://lmstudio.ai/',
        apiUrl: ''
    },
    magpie: {
        name: 'Magpie (本地网关)',
        endpoint: 'http://127.0.0.1:3425/v1/chat/completions',
        modelsEndpoint: 'http://127.0.0.1:3425/v1/models',
        defaultModels: [
            'auto/minimax-m3.1-flash',
            'auto/minimax-m3',
            'auto/gpt-6.1-sol',
            'auto/glm-5.3',
            'auto/kimi-k3.1-pro',
            'auto/deepseek-v4.1-flash'
        ],
        defaultModel: 'auto/minimax-m3.1-flash',
        authType: 'bearer',
        bodyFormat: 'openai',
        supportsModelList: true,
        supportsCustomEndpoint: true,
        docUrl: '',
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
        supportsCustomEndpoint: true,
        docUrl: '',
        apiUrl: ''
    }
};

let baiduTokenCache = { token: null, expireTime: 0 };
let modelCache = {};
const ALLOWED_ENDPOINT_PROTOCOLS = new Set(['http:', 'https:']);
const NATIVE_TOOL_BODY_FORMATS = new Set(['openai']);

function normalizeHttpEndpoint(url) {
    const value = String(url || '').trim();
    if (!value) {
        throw new Error('未配置 API 端点');
    }

    try {
        const parsed = new URL(value);
        if (!ALLOWED_ENDPOINT_PROTOCOLS.has(parsed.protocol)) {
            throw new Error('仅支持 http/https 协议');
        }
        return parsed.toString();
    } catch {
        throw new Error('无效的 API 地址，仅支持 http/https 协议');
    }
}

async function fetchWithTauri(url, options = {}) {
    const safeUrl = normalizeHttpEndpoint(url);
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
        headers
    };
    if (options.body) {
        fetchOptions.body = typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body);
    }

    if (!isTauriRuntime) {
        if (typeof fetch !== 'function') {
            throw new Error('当前环境不支持 HTTP 请求');
        }
        return await fetch(safeUrl, fetchOptions);
    }

    try {
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        const response = await tauriFetch(safeUrl, fetchOptions);
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

export async function fetchProviderModels(providerId, apiKey = '', customEndpoint = '') {
    const cacheKey = `${providerId}_${customEndpoint || 'default'}_${apiKey ? 'auth' : 'noauth'}`;
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

    if (providerId === 'custom') {
        return await fetchCustomProviderModels(customEndpoint, apiKey);
    }

    const provider = PROVIDER_CONFIGS[providerId];
    if (!provider || !provider.supportsModelList) {
        return provider ? provider.defaultModels : [];
    }

    let modelsEndpoint = provider.modelsEndpoint;
    if (customEndpoint && provider.supportsCustomEndpoint) {
        if (providerId === 'ollama') {
            modelsEndpoint = customEndpoint.replace('/api/chat', '/api/tags');
        } else if (providerId === 'lmstudio') {
            modelsEndpoint = customEndpoint.replace('/v1/chat/completions', '/v1/models');
        }
    }

    if (!modelsEndpoint) {
        return provider.defaultModels;
    }

    try {
        const headers = { 'Accept': 'application/json' };
        if (apiKey && provider.authType === 'bearer') {
            headers['Authorization'] = 'Bearer ' + apiKey;
        } else if (apiKey && provider.authType === 'x-api-key') {
            headers['x-api-key'] = apiKey;
        }
        if (provider.headers) {
            Object.assign(headers, provider.headers);
        }
        let endpoint = modelsEndpoint;
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

function deriveCustomModelsEndpoint(customEndpoint) {
    const raw = String(customEndpoint || '').trim();
    if (!raw) return '';
    let url;
    try {
        url = new URL(raw);
    } catch {
        return '';
    }
    let path = url.pathname.replace(/\/+$/, '');
    path = path.replace(/\/chat\/completions$/i, '');
    path = path.replace(/\/completions$/i, '');
    path = path.replace(/\/messages$/i, '');
    if (!/\/models$/i.test(path)) {
        path = path + '/models';
    }
    url.pathname = path;
    url.search = '';
    url.hash = '';
    return url.toString();
}

export async function fetchCustomProviderModels(customEndpoint, apiKey = '') {
    const modelsUrl = deriveCustomModelsEndpoint(customEndpoint);
    if (!modelsUrl) return [];

    const cacheKey = `custom_${modelsUrl}_${apiKey ? 'auth' : 'noauth'}`;
    if (modelCache[cacheKey] && modelCache[cacheKey].expireTime > Date.now()) {
        return modelCache[cacheKey].models;
    }

    try {
        const headers = { 'Accept': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = 'Bearer ' + apiKey;
        }
        const response = await fetchWithTauri(modelsUrl, { method: 'GET', headers });
        if (!response.ok) return [];
        const data = await response.json();
        let fetchedModels = [];
        if (Array.isArray(data?.data)) {
            fetchedModels = data.data.map(m => typeof m === 'string' ? m : (m.id || m.name)).filter(Boolean);
        } else if (Array.isArray(data?.models)) {
            fetchedModels = data.models.map(m => typeof m === 'string' ? m : (m.id || m.name)).filter(Boolean);
        } else if (Array.isArray(data)) {
            fetchedModels = data.map(m => typeof m === 'string' ? m : (m.id || m.name)).filter(Boolean);
        }
        if (fetchedModels.length > 0) {
            modelCache[cacheKey] = { models: fetchedModels, expireTime: Date.now() + 300000 };
        }
        return fetchedModels;
    } catch (e) {
        return [];
    }
}

// 探测 HTTP（OpenAI 兼容）连接器可达性：服务返回任意 HTTP 响应即视为可达（含 401/404）；
// 仅当网络层失败时 fetchWithTauri 会抛错，借此让「测试连接」区分真实可达性，避免误报成功。
export async function pingHttpConnector(chatEndpoint, apiKey = '') {
    const url = deriveCustomModelsEndpoint(chatEndpoint) || String(chatEndpoint || '').trim();
    if (!url) throw new Error('未配置 HTTP 服务地址');
    const headers = { 'Accept': 'application/json' };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
    const response = await fetchWithTauri(url, { method: 'GET', headers });
    return { ok: true, status: response.status };
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
    const tools = Array.isArray(options.tools) ? options.tools : [];
    const toolChoice = options.toolChoice || 'auto';
    switch (format) {
        case 'baidu':
            return { messages, temperature, max_output_tokens: maxTokens, stream };
        case 'anthropic':
            return {
                model,
                messages: messages.filter(m => m.role !== 'system').map(m => ({
                    role: m.role,
                    content: Array.isArray(m.content) ? m.content : m.content
                })),
                system: messages.find(m => m.role === 'system')?.content,
                max_tokens: maxTokens,
                temperature,
                stream
            };
        case 'cohere':
            return { message: messages[messages.length - 1].content, model, temperature, max_tokens: maxTokens, stream };
        case 'cohere-v2':
            return {
                model,
                messages: messages.map(message => ({
                    role: message.role,
                    content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
                })),
                temperature,
                max_tokens: maxTokens,
                stream
            };
        case 'perplexity-agent':
            // Perplexity retired /chat/completions for Sonar on 2026-09-27; the
            // Agent API follows the OpenAI Responses request shape.
            {
                const instructions = messages.find(message => message.role === 'system')?.content;
                return {
                    model,
                    input: messages
                        .filter(message => message.role !== 'system')
                        .map(message => ({
                            role: message.role,
                            content: typeof message.content === 'string'
                                ? message.content
                                : JSON.stringify(message.content)
                        })),
                    ...(instructions ? { instructions } : {}),
                    temperature,
                    max_output_tokens: maxTokens,
                    stream
                };
            }
        case 'cloudflare':
            return { messages, temperature, max_tokens: maxTokens, stream };
        case 'ollama':
            return { model, messages, stream };
        case 'google':
            return {
                contents: messages.filter(m => m.role !== 'system').map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: m.parts || [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
                })),
                systemInstruction: messages.find(m => m.role === 'system') ? {
                    parts: [{ text: messages.find(m => m.role === 'system').content }]
                } : undefined,
                generationConfig: { temperature, maxOutputTokens: maxTokens }
            };
        default:
            {
                const body = { model, messages, temperature, max_tokens: maxTokens, stream };
                if (tools.length > 0) {
                    body.tools = tools;
                    body.tool_choice = toolChoice;
                }
                return body;
            }
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
        case 'cohere-v2':
            return responseData.message?.content?.find?.(part => part.type === 'text')?.text
                || responseData.message?.content?.[0]?.text
                || '';
        case 'perplexity-agent': {
            if (Array.isArray(responseData.output)) {
                return responseData.output
                    .flatMap(item => item.content || [])
                    .filter(part => part.type === 'output_text')
                    .map(part => part.text)
                    .join('');
            }
            return responseData.output_text || responseData.text || '';
        }
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

function parseResponseWithToolCalls(provider, responseData) {
    const format = provider.bodyFormat || 'openai';
    if (responseData.error) {
        throw new Error('API 错误: ' + (responseData.error.message || JSON.stringify(responseData.error)));
    }

    if (format !== 'openai') {
        return {
            content: parseResponse(provider, responseData),
            toolCalls: [],
            raw: responseData
        };
    }

    const choice = responseData.choices?.[0] || {};
    const message = choice.message || {};
    const toolCalls = Array.isArray(message.tool_calls)
        ? message.tool_calls.map((call, index) => ({
            id: call.id || `tool_call_${index}`,
            type: call.type || 'function',
            name: call.function?.name || '',
            arguments: call.function?.arguments || '{}',
            raw: call
        })).filter(call => call.name)
        : [];

    return {
        content: typeof message.content === 'string' ? message.content : '',
        toolCalls,
        finishReason: choice.finish_reason || '',
        message,
        raw: responseData
    };
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
        case 'cohere-v2':
            return chunk.delta?.message?.content?.text || chunk.text || '';
        case 'perplexity-agent':
            return chunk.type === 'response.output_text.delta'
                ? (chunk.delta || '')
                : (chunk.output_text || '');
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

function isLocalProvider(providerId) {
    return providerId === 'ollama' || providerId === 'lmstudio';
}

export function canProviderUseNativeTools(providerId, config = {}) {
    if (isG4FProvider(providerId)) {
        return false;
    }

    const provider = PROVIDER_CONFIGS[providerId];
    if (!provider) {
        return false;
    }

    return NATIVE_TOOL_BODY_FORMATS.has(provider.bodyFormat || 'openai');
}

function getEffectiveEndpoint(provider, providerId, config) {
    if (config.customEndpoint) {
        return config.customEndpoint;
    }
    return provider.endpoint;
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
    const isLocal = isLocalProvider(providerId);
    let endpoint = getEffectiveEndpoint(provider, providerId, config);
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
    const requiresApiKey = provider.authType !== 'none' && !isLocal && !isCustomProvider;
    if (requiresApiKey && !apiKey) throw new Error('未配置 API Key');
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
    } else if (provider.authType === 'bearer' && apiKey) {
        headers['Authorization'] = 'Bearer ' + apiKey;
    } else if (provider.authType === 'x-api-key' && apiKey) {
        headers['X-API-Key'] = apiKey;
    } else if (provider.authType === 'api-key' && apiKey) {
        headers['api-key'] = apiKey;
    } else if (provider.authType === 'query_key' && apiKey) {
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

export async function callAIWithMessagesAndTools(config, messages, tools = [], options = {}) {
    const providerId = config.provider || 'g4f-default';

    if (!canProviderUseNativeTools(providerId, config)) {
        const error = new Error('当前 AI 提供商不支持原生工具调用');
        error.nativeToolUnsupported = true;
        throw error;
    }

    const provider = PROVIDER_CONFIGS[providerId];
    if (!provider) throw new Error('未知的 AI 厂商: ' + providerId);
    const isCustomProvider = providerId === 'custom';
    const isLocal = isLocalProvider(providerId);
    let endpoint = getEffectiveEndpoint(provider, providerId, config);
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
    const requiresApiKey = provider.authType !== 'none' && !isLocal && !isCustomProvider;
    if (requiresApiKey && !apiKey) throw new Error('未配置 API Key');
    const requestBody = buildRequestBody(provider, model, messages, {
        temperature: options.temperature ?? config.temperature ?? 0.7,
        maxTokens: options.maxTokens ?? config.maxTokens ?? 2048,
        stream: false,
        tools,
        toolChoice: options.toolChoice || 'auto'
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
    } else if (provider.authType === 'bearer' && apiKey) {
        headers['Authorization'] = 'Bearer ' + apiKey;
    } else if (provider.authType === 'x-api-key' && apiKey) {
        headers['X-API-Key'] = apiKey;
    } else if (provider.authType === 'api-key' && apiKey) {
        headers['api-key'] = apiKey;
    } else if (provider.authType === 'query_key' && apiKey) {
        finalEndpoint = endpoint + '?key=' + encodeURIComponent(apiKey);
    }
    const response = await fetchWithTauri(finalEndpoint, {
        method: 'POST',
        headers,
        body: requestBody
    });
    if (!response.ok) {
        const errorText = await response.text();
        const error = new Error('HTTP ' + response.status + ': ' + errorText.substring(0, 500));
        if (/tool|function|unsupported|not support|不支持/i.test(errorText)) {
            error.nativeToolUnsupported = true;
        }
        throw error;
    }
    const responseData = await response.json();
    return parseResponseWithToolCalls(provider, responseData);
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
    const isLocal = isLocalProvider(providerId);
    let endpoint = getEffectiveEndpoint(provider, providerId, config);
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
    const requiresApiKey = provider.authType !== 'none' && !isLocal && !isCustomProvider;
    if (requiresApiKey && !apiKey) throw new Error('未配置 API Key');
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
    } else if (provider.authType === 'bearer' && apiKey) {
        headers['Authorization'] = 'Bearer ' + apiKey;
    } else if (provider.authType === 'x-api-key' && apiKey) {
        headers['X-API-Key'] = apiKey;
    } else if (provider.authType === 'api-key' && apiKey) {
        headers['api-key'] = apiKey;
    } else if (provider.authType === 'query_key' && apiKey) {
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

export async function callAIWithMessagesStream(config, messages, onChunk, { signal } = {}) {
    const providerId = config.provider || 'g4f-default';

    if (isG4FProvider(providerId)) {
        return await streamChatWithG4F(
            providerId,
            config.model,
            messages,
            {
                apiKey: config.apiKey,
                temperature: config.temperature,
                maxTokens: config.maxTokens
            },
            onChunk
        );
    }

        const provider = PROVIDER_CONFIGS[providerId];
    if (!provider) throw new Error('未知的 AI 厂商: ' + providerId);
    const isCustomProvider = providerId === 'custom';
    const isLocal = isLocalProvider(providerId);
    let endpoint = getEffectiveEndpoint(provider, providerId, config);
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
    const requiresApiKey = provider.authType !== 'none' && !isLocal && !isCustomProvider;
    if (requiresApiKey && !apiKey) throw new Error('未配置 API Key');
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
    } else if (provider.authType === 'bearer' && apiKey) {
        headers['Authorization'] = 'Bearer ' + apiKey;
    } else if (provider.authType === 'x-api-key' && apiKey) {
        headers['X-API-Key'] = apiKey;
    } else if (provider.authType === 'api-key' && apiKey) {
        headers['api-key'] = apiKey;
    } else if (provider.authType === 'query_key' && apiKey) {
        finalEndpoint = endpoint + '?key=' + encodeURIComponent(apiKey);
    }
    let fullContent = '';
    const safeUrl = normalizeHttpEndpoint(finalEndpoint);
    const bodyStr = JSON.stringify(requestBody);
    console.log('[Stream] callAIWithMessagesStream called, url:', safeUrl, 'stream:', requestBody.stream, 'TAURI:', isTauriRuntime);

    try {
        let response;
        if (isTauriRuntime) {
            const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
            const tauriHeaders = {};
            for (const [k, v] of Object.entries(headers)) {
                if (v !== undefined && v !== null) tauriHeaders[k] = String(v);
            }
            response = await tauriFetch(safeUrl, {
                method: 'POST',
                headers: tauriHeaders,
                body: bodyStr,
                ...(signal ? { signal } : {})
            });
        } else {
            response = await fetch(safeUrl, {
                method: 'POST',
                headers,
                body: bodyStr,
                ...(signal ? { signal } : {})
            });
        }
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error('HTTP ' + response.status + ': ' + errorText.substring(0, 500));
        }
        const contentType = response.headers?.get?.('content-type') || '';
        console.log('[Stream] response ok, content-type:', contentType, 'body type:', typeof response.body, 'hasGetReader:', typeof response.body?.getReader);

        const isJsonResponse = contentType.includes('application/json');
        if (!response.body || typeof response.body.getReader !== 'function' || isJsonResponse) {
            console.log('[Stream] non-stream response detected, parsing as whole response');
            const text = await response.text();
            try {
                const json = JSON.parse(text);
                fullContent = parseResponse(provider, json);
                if (onChunk && fullContent) onChunk(fullContent, fullContent);
            } catch {
                fullContent = text;
                if (onChunk && fullContent) onChunk(fullContent, fullContent);
            }
            return fullContent || await callAIWithMessages(config, messages);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let chunkCount = 0;
        while (true) {
            if (signal?.aborted) {
                await reader.cancel();
                break;
            }
            const { done, value } = await reader.read();
            if (done) break;
            chunkCount++;
            const text = decoder.decode(value, { stream: true });
            if (chunkCount <= 3) console.log('[Stream] chunk #' + chunkCount + ', length:', text.length, 'preview:', text.substring(0, 100));
            buffer += text;
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
                            if (onChunk) onChunk(delta, fullContent);
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }
        }
        if (buffer.trim()) {
            const trimmedLine = buffer.trim();
            if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
                try {
                    const chunk = JSON.parse(trimmedLine.slice(6));
                    const delta = parseStreamChunk(provider, chunk);
                    if (delta) {
                        fullContent += delta;
                        if (onChunk) onChunk(delta, fullContent);
                    }
                } catch (e) { /* ignore */ }
            }
        }
    } catch (e) {
        if (signal?.aborted) {
            console.log('[Stream] aborted by user, returning partial content');
            return fullContent;
        }
        console.warn('[Stream] streaming failed, falling back to non-stream:', e.message || e, e);
        if (fullContent) return fullContent;
        return await callAIWithMessages(config, messages);
    }
    console.log('[Stream] completed, fullContent length:', fullContent.length);
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

    for (const provider of G4F_PROVIDER_CATALOG) {
        result.push({
            id: provider.id,
            name: provider.name,
            models: getG4FDefaultModels(provider.id),
            defaultModel: getG4FDefaultModels(provider.id)[0] || 'auto',
            docUrl: 'https://g4f.dev/',
            apiUrl: '',
            authType: provider.requiresApiKey ? 'bearer' : 'none',
            supportsModelList: true,
            supportsNativeTools: false
        });
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
            supportsNativeTools: canProviderUseNativeTools(id),
            supportsCustomModel: provider.supportsCustomModel || false,
            supportsCustomEndpoint: provider.supportsCustomEndpoint || false
        });
    }
    return result;
}

export function getProviderInfo(providerId) {
    if (isG4FProvider(providerId)) {
        const provider = G4F_PROVIDER_CATALOG.find((item) => item.id === providerId);
        const models = getG4FDefaultModels(providerId);
        return {
            name: provider?.name || providerId,
            defaultModels: models,
            defaultModel: models[0] || 'auto',
            authType: 'none',
            supportsModelList: true,
            supportsNativeTools: false,
            docUrl: 'https://g4f.dev/',
            apiUrl: ''
        };
    }

    const provider = PROVIDER_CONFIGS[providerId];
    if (!provider) return null;
    return {
        ...provider,
        supportsNativeTools: canProviderUseNativeTools(providerId)
    };
}

export function clearModelCache() {
    modelCache = {};
}

export function getProviderBodyFormat(providerId) {
    const config = PROVIDER_CONFIGS[providerId];
    return config?.bodyFormat || 'openai';
}

export { PROVIDER_CONFIGS };
