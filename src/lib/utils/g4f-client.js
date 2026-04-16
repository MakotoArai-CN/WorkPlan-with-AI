import g4fConfig from '../../../g4f.dev/dist/js/providers.json';

let g4fModule = null;
let g4fLoadPromise = null;

const G4F_PROVIDER_NAME_MAP = {
    default: 'G4F Auto',
    pollinations: 'Pollinations AI',
    deepinfra: 'DeepInfra',
    groq: 'Groq',
    openrouter: 'OpenRouter',
    nvidia: 'NVIDIA',
    puter: 'Puter',
    gemini: 'Gemini',
    huggingface: 'Hugging Face',
    ollama: 'Ollama',
    azure: 'Azure',
    audio: 'Audio',
    'api.airforce': 'API Airforce',
    perplexity: 'Perplexity'
};

const G4F_PROVIDER_ORDER = [
    'default',
    'pollinations',
    'deepinfra',
    'groq',
    'openrouter',
    'nvidia',
    'puter',
    'gemini',
    'huggingface',
    'ollama',
    'azure',
    'audio',
    'api.airforce',
    'perplexity'
];

const G4F_PROVIDER_STORAGE_KEYS = g4fConfig?.providerLocalStorage || {};
const G4F_PROVIDER_SETTINGS = g4fConfig?.providers || {};
const G4F_PROVIDER_DEFAULT_MODELS = Object.fromEntries(
    Object.entries(g4fConfig?.defaultModels || {}).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
    ])
);

const G4F_FALLBACK_MODELS = {
    default: ['auto', 'gpt-4o-mini', 'gpt-4o', 'claude-3.5-sonnet', 'deepseek-v3'],
    pollinations: ['openai', 'openai-fast', 'deepseek', 'gemini', 'mistral'],
    deepinfra: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3'],
    groq: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    openrouter: ['openrouter/free', 'openai/gpt-4o', 'meta-llama/llama-3.3-70b-instruct:free'],
    nvidia: ['deepseek-ai/deepseek-v3.2', 'meta/llama-3.3-70b-instruct'],
    puter: ['anthropic:anthropic/claude-sonnet-4-6', 'gpt-4o', 'gpt-4o-mini'],
    gemini: ['models/gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-1.5-flash'],
    huggingface: ['meta-llama/Llama-3.3-70B-Instruct', 'meta-llama/Llama-3.2-3B-Instruct'],
    ollama: ['deepseek-v3.2', 'llama3.3', 'qwen2.5'],
    azure: ['model-router3', 'model-router'],
    audio: ['gpt-audio'],
    'api.airforce': ['gpt-4o', 'claude-sonnet-4.5', 'deepseek-v3.2'],
    perplexity: ['turbo', 'sonar', 'sonar-pro']
};

export const G4F_PROVIDER_CATALOG = (() => {
    const keys = Array.from(
        new Set([
            ...G4F_PROVIDER_ORDER,
            ...Object.keys(G4F_PROVIDER_SETTINGS)
        ])
    ).filter((key) => key && key !== 'custom' && key !== 'master');

    return keys.map((key) => ({
        id: `g4f-${key}`,
        key,
        name: G4F_PROVIDER_NAME_MAP[key] || G4F_PROVIDER_SETTINGS[key]?.label || key,
        tags: G4F_PROVIDER_SETTINGS[key]?.tags || '',
        requiresApiKey: Boolean(G4F_PROVIDER_STORAGE_KEYS[key])
    }));
})();

async function loadG4FModule() {
    if (g4fModule) {
        return g4fModule;
    }

    if (g4fLoadPromise) {
        return g4fLoadPromise;
    }

    g4fLoadPromise = (async () => {
        try {
            const module = await import('../../../g4f.dev/dist/js/client.js');
            g4fModule = {
                Client: module.Client,
                Pollinations: module.Pollinations,
                DeepInfra: module.DeepInfra,
                Together: module.Together,
                Puter: module.Puter,
                HuggingFace: module.HuggingFace,
                Worker: module.Worker,
                Audio: module.Audio
            };
            return g4fModule;
        } catch (error) {
            console.error('Failed to load G4F module from root g4f.dev/dist:', error);
            return null;
        }
    })();

    return g4fLoadPromise;
}

function getProviderClass(module, providerKey) {
    return {
        default: module.Client,
        pollinations: module.Pollinations,
        nectar: module.Pollinations,
        audio: module.Audio,
        deepinfra: module.DeepInfra,
        huggingface: module.HuggingFace,
        puter: module.Puter,
        worker: module.Worker,
        together: module.Together
    }[providerKey] || module.Client;
}

function getSessionToken() {
    if (typeof localStorage === 'undefined') {
        return undefined;
    }
    return localStorage.getItem('session_token') || undefined;
}

function getStoredProviderApiKey(providerKey) {
    if (typeof localStorage === 'undefined') {
        return undefined;
    }

    const storageKey = G4F_PROVIDER_STORAGE_KEYS[providerKey];
    if (!storageKey) {
        return undefined;
    }

    return localStorage.getItem(storageKey) || undefined;
}

export async function getG4FProvidersList() {
    return G4F_PROVIDER_CATALOG.length > 0
        ? G4F_PROVIDER_CATALOG
        : [
            { id: 'g4f-default', key: 'default', name: 'G4F Auto', tags: '', requiresApiKey: false }
        ];
}

export async function createG4FClient(providerId, options = {}) {
    const providerKey = providerId.replace('g4f-', '');
    const module = await loadG4FModule();

    if (!module) {
        throw new Error('G4F SDK not loaded');
    }

    const ProviderClass = getProviderClass(module, providerKey);
    const providerConfig = G4F_PROVIDER_SETTINGS[providerKey];

    if (!providerConfig) {
        return new ProviderClass({
            baseUrl: options.baseUrl || `https://g4f.space/api/${providerKey}`,
            apiKey: options.apiKey || getSessionToken(),
            sleep: options.sleep || 10000,
            ...options
        });
    }

    const {
        backupUrl,
        tags: _tags,
        label: _label,
        provider: _provider,
        ...config
    } = providerConfig;

    const clientOptions = {
        ...config,
        ...options
    };

    if (providerKey === 'default') {
        clientOptions.modelAliases = g4fConfig?.defaultModels || {};
    }

    if (!clientOptions.apiKey) {
        clientOptions.apiKey = getStoredProviderApiKey(providerKey);
    }

    if (backupUrl && !options.apiKey && !options.baseUrl) {
        clientOptions.baseUrl = backupUrl;
        clientOptions.apiKey = clientOptions.apiKey || getSessionToken();
        clientOptions.sleep = clientOptions.sleep || 10000;
    }

    if (!clientOptions.defaultModel && g4fConfig?.defaultModels?.[providerKey]) {
        clientOptions.defaultModel = g4fConfig.defaultModels[providerKey];
    }

    return new ProviderClass(clientOptions);
}

export async function fetchG4FModels(providerId, options = {}) {
    const providerKey = providerId.replace('g4f-', '');

    try {
        const client = await createG4FClient(providerId, options);
        const models = await client.models.list();

        if (Array.isArray(models) && models.length > 0) {
            return models
                .map((model) => {
                    if (typeof model === 'string') return model;
                    return model.id || model.name || String(model);
                })
                .filter(Boolean);
        }
    } catch (error) {
        console.error(`Failed to fetch G4F models for ${providerId}:`, error);
    }

    return getG4FDefaultModels(providerId);
}

function extractDeltaFromChunk(chunk) {
    if (!chunk) return '';
    if (typeof chunk === 'string') return chunk;

    if (chunk.choices && Array.isArray(chunk.choices) && chunk.choices[0]) {
        const choice = chunk.choices[0];
        if (choice.delta) {
            return choice.delta.content || choice.delta.reasoning || '';
        }
        if (choice.text !== undefined) {
            return String(choice.text);
        }
        if (choice.content !== undefined) {
            return String(choice.content);
        }
    }

    if (chunk.content !== undefined) return String(chunk.content);
    if (chunk.text !== undefined) return String(chunk.text);
    if (chunk.response !== undefined) return String(chunk.response);
    if (chunk.delta && chunk.delta.content !== undefined) {
        return String(chunk.delta.content);
    }

    return '';
}

function extractTextContent(value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const extracted = extractTextContent(item);
            if (extracted) return extracted;
        }
        return null;
    }

    if (typeof value === 'object') {
        if (value.text !== undefined) return extractTextContent(value.text);
        if (value.content !== undefined) return extractTextContent(value.content);
        if (value.message !== undefined) return extractTextContent(value.message);
        if (value.response !== undefined) return extractTextContent(value.response);
        if (value.result !== undefined) return extractTextContent(value.result);
        if (value.output !== undefined) return extractTextContent(value.output);
    }

    return null;
}

function extractContentFromG4FResponse(result) {
    if (result === null || result === undefined) {
        return null;
    }

    if (typeof result === 'string') return result;
    if (typeof result === 'number' || typeof result === 'boolean') return String(result);
    if (typeof result !== 'object') return String(result);

    if (result.choices && Array.isArray(result.choices) && result.choices.length > 0) {
        const choice = result.choices[0];
        if (choice.message && choice.message.content !== undefined) {
            return extractTextContent(choice.message.content);
        }
        if (choice.text !== undefined) return extractTextContent(choice.text);
        if (choice.content !== undefined) return extractTextContent(choice.content);
        if (choice.delta && choice.delta.content !== undefined) {
            return extractTextContent(choice.delta.content);
        }
    }

    if (result.message !== undefined) {
        if (typeof result.message === 'string') return result.message;
        if (result.message && result.message.content !== undefined) {
            return extractTextContent(result.message.content);
        }
    }

    if (result.content !== undefined) return extractTextContent(result.content);
    if (result.response !== undefined) return extractTextContent(result.response);
    if (result.text !== undefined) return extractTextContent(result.text);
    if (result.output !== undefined) return extractTextContent(result.output);
    if (result.result !== undefined) return extractTextContent(result.result);
    if (result.data !== undefined) return extractTextContent(result.data);
    if (result.answer !== undefined) return extractTextContent(result.answer);
    if (result.reply !== undefined) return extractTextContent(result.reply);

    const ignoredKeys = new Set([
        'id',
        'object',
        'created',
        'model',
        'usage',
        'type',
        'request',
        'provider',
        'status',
        'code',
        'error',
        'finish_reason',
        'index',
        'logprobs'
    ]);

    for (const [key, value] of Object.entries(result)) {
        if (ignoredKeys.has(key)) continue;
        if (typeof value === 'string' && value.length > 0) {
            return value;
        }
    }

    for (const [key, value] of Object.entries(result)) {
        if (ignoredKeys.has(key)) continue;
        const extracted = extractTextContent(value);
        if (extracted) return extracted;
    }

    return null;
}

export async function chatWithG4F(providerId, model, messages, options = {}) {
    const client = await createG4FClient(providerId, options);
    let fullContent = '';
    let streamWorked = false;

    try {
        const stream = await client.chat.completions.create({
            model: model || client.defaultModel || 'auto',
            messages,
            stream: true
        });

        for await (const chunk of stream) {
            const delta = extractDeltaFromChunk(chunk);
            if (delta) {
                fullContent += delta;
                streamWorked = true;
            }
        }

        if (fullContent) {
            return fullContent;
        }
    } catch (streamError) {
        console.warn('G4F stream failed, trying non-stream:', streamError.message);
    }

    if (!streamWorked) {
        try {
            const result = await client.chat.completions.create({
                model: model || client.defaultModel || 'auto',
                messages,
                stream: false
            });

            const content = extractContentFromG4FResponse(result);
            if (content) {
                return content;
            }
        } catch (nonStreamError) {
            const errorMessage = nonStreamError.message || String(nonStreamError);
            if (errorMessage.includes('not valid JSON')) {
                const match = errorMessage.match(/"([^"]+)"/);
                if (match && match[1]) {
                    return `${match[1]}...（响应被截断，请重试）`;
                }
            }
            throw new Error(`G4F 请求失败: ${errorMessage}`);
        }
    }

    throw new Error('未收到任何响应内容，请重试');
}

export async function streamChatWithG4F(providerId, model, messages, options = {}, onChunk) {
    const client = await createG4FClient(providerId, options);
    let fullContent = '';
    let streamWorked = false;

    try {
        const stream = await client.chat.completions.create({
            model: model || client.defaultModel || 'auto',
            messages,
            stream: true
        });

        for await (const chunk of stream) {
            const delta = extractDeltaFromChunk(chunk);
            if (delta) {
                fullContent += delta;
                streamWorked = true;
                if (onChunk) {
                    onChunk(delta, fullContent);
                }
            }
        }

        if (fullContent) {
            return fullContent;
        }
    } catch (streamError) {
        console.warn('G4F stream failed, fallback to non-stream:', streamError.message);
    }

    if (!streamWorked || !fullContent) {
        try {
            const result = await client.chat.completions.create({
                model: model || client.defaultModel || 'auto',
                messages,
                stream: false
            });

            const content = extractContentFromG4FResponse(result);
            if (content) {
                if (onChunk) {
                    let accumulated = '';
                    for (const char of content.split('')) {
                        accumulated += char;
                        onChunk(char, accumulated);
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                }
                return content;
            }
        } catch (nonStreamError) {
            const errorMessage = nonStreamError.message || String(nonStreamError);
            throw new Error(`G4F 请求失败: ${errorMessage}`);
        }
    }

    return fullContent || '未收到任何响应内容';
}

export function isG4FProvider(providerId) {
    return Boolean(providerId && providerId.startsWith('g4f-'));
}

export function getG4FDefaultModels(providerId) {
    const providerKey = providerId.replace('g4f-', '');
    const configuredModels = G4F_PROVIDER_DEFAULT_MODELS[providerKey] || [];
    const fallbackModels = G4F_FALLBACK_MODELS[providerKey] || G4F_FALLBACK_MODELS.default;
    return [...new Set([...configuredModels, ...fallbackModels])].filter(Boolean);
}

export const G4F_DEFAULT_MODELS = G4F_FALLBACK_MODELS;
