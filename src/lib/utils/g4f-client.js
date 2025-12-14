let g4fModule = null;
let g4fLoadPromise = null;

const G4F_DEFAULT_MODELS = {
    'default': ['auto', 'gpt-4o-mini', 'gpt-4o', 'claude-3.5-sonnet', 'deepseek-v3'],
    'nectar': ['openai', 'openai-fast', 'openai-large', 'deepseek', 'claude', 'gemini', 'grok'],
    'pollinations': ['openai', 'openai-fast', 'deepseek', 'gemini', 'mistral'],
    'deepinfra': ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3'],
    'groq': ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    'openrouter': ['openai/gpt-4o', 'meta-llama/llama-3.3-70b-instruct:free'],
    'nvidia': ['deepseek-ai/deepseek-v3.1', 'meta/llama-3.3-70b-instruct'],
    'puter': ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet-20241022'],
    'gemini': ['gemini-2.5-flash', 'gemini-1.5-flash'],
    'huggingface': ['meta-llama/Llama-3.2-3B-Instruct'],
    'together': ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    'worker': ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
    'ollama': ['llama3.2', 'qwen2.5', 'deepseek-v3.1:671b'],
    'azure': ['model-router'],
    'audio': ['gpt-audio'],
    'api.airforce': ['gpt-4o', 'claude-sonnet-4.5', 'deepseek-v3.2']
};

async function loadG4FModule() {
    if (g4fModule) {
        return g4fModule;
    }
    if (g4fLoadPromise) {
        return g4fLoadPromise;
    }
    g4fLoadPromise = (async () => {
        try {
            const module = await import('@gpt4free/g4f.dev/providers');
            g4fModule = {
                providers: module.default,
                createClient: module.createClient
            };
            return g4fModule;
        } catch (e) {
            console.error('Failed to load G4F module:', e);
            return null;
        }
    })();
    return g4fLoadPromise;
}

export async function getG4FProvidersList() {
    const module = await loadG4FModule();
    if (!module || !module.providers) {
        return getBuiltinG4FProviders();
    }
    const result = [];
    const providers = module.providers;
    for (const key of Object.keys(providers)) {
        if (key === 'custom') continue;
        const provider = providers[key];
        result.push({
            id: `g4f-${key}`,
            key: key,
            name: provider.name || key,
            tags: provider.tags || '',
            requiresApiKey: provider.authType !== 'none' && !!provider.localStorageApiKey,
            localStorageApiKey: provider.localStorageApiKey || null
        });
    }
    return result.length > 0 ? result : getBuiltinG4FProviders();
}

function getBuiltinG4FProviders() {
    return [
        { id: 'g4f-default', key: 'default', name: 'G4F Auto', tags: '', requiresApiKey: false },
        { id: 'g4f-nectar', key: 'nectar', name: 'G4F Nectar', tags: '', requiresApiKey: false },
        { id: 'g4f-pollinations', key: 'pollinations', name: 'Pollinations AI', tags: '🎨 👓', requiresApiKey: false },
        { id: 'g4f-deepinfra', key: 'deepinfra', name: 'DeepInfra', tags: '🎨 👓', requiresApiKey: false },
        { id: 'g4f-groq', key: 'groq', name: 'Groq', tags: '', requiresApiKey: false },
        { id: 'g4f-openrouter', key: 'openrouter', name: 'OpenRouter', tags: '👓', requiresApiKey: false },
        { id: 'g4f-nvidia', key: 'nvidia', name: 'NVIDIA', tags: '📟', requiresApiKey: false },
        { id: 'g4f-puter', key: 'puter', name: 'Puter', tags: '👓', requiresApiKey: false },
        { id: 'g4f-gemini', key: 'gemini', name: 'Gemini', tags: '👓', requiresApiKey: false },
        { id: 'g4f-huggingface', key: 'huggingface', name: 'Hugging Face', tags: '🤗', requiresApiKey: true },
        { id: 'g4f-together', key: 'together', name: 'Together AI', tags: '👓', requiresApiKey: true },
        { id: 'g4f-worker', key: 'worker', name: 'Cloudflare Worker', tags: '🎨', requiresApiKey: false },
        { id: 'g4f-ollama', key: 'ollama', name: 'Ollama', tags: '🦙', requiresApiKey: false },
        { id: 'g4f-azure', key: 'azure', name: 'Azure', tags: '👓', requiresApiKey: false },
        { id: 'g4f-audio', key: 'audio', name: 'Audio', tags: '🎧', requiresApiKey: false },
        { id: 'g4f-api.airforce', key: 'api.airforce', name: 'API Airforce', tags: '🎨 👓', requiresApiKey: false }
    ];
}

export async function createG4FClient(providerId, options = {}) {
    const providerKey = providerId.replace('g4f-', '');
    const module = await loadG4FModule();
    if (!module || !module.createClient) {
        throw new Error('G4F SDK not loaded');
    }
    const clientOptions = {};
    if (options.apiKey) {
        clientOptions.apiKey = options.apiKey;
    }
    return module.createClient(providerKey, clientOptions);
}

export async function fetchG4FModels(providerId, options = {}) {
    const providerKey = providerId.replace('g4f-', '');
    try {
        const client = await createG4FClient(providerId, options);
        const models = await client.models.list();
        if (Array.isArray(models) && models.length > 0) {
            return models.map(m => {
                if (typeof m === 'string') return m;
                return m.id || m.name || String(m);
            }).filter(Boolean);
        }
        return G4F_DEFAULT_MODELS[providerKey] || G4F_DEFAULT_MODELS['default'];
    } catch (e) {
        console.error(`Failed to fetch G4F models for ${providerId}:`, e);
        return G4F_DEFAULT_MODELS[providerKey] || G4F_DEFAULT_MODELS['default'];
    }
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
    if (chunk.content !== undefined) {
        return String(chunk.content);
    }
    if (chunk.text !== undefined) {
        return String(chunk.text);
    }
    if (chunk.response !== undefined) {
        return String(chunk.response);
    }
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
        if (value.text !== undefined) {
            return extractTextContent(value.text);
        }
        if (value.content !== undefined) {
            return extractTextContent(value.content);
        }
        if (value.message !== undefined) {
            return extractTextContent(value.message);
        }
        if (value.response !== undefined) {
            return extractTextContent(value.response);
        }
        if (value.result !== undefined) {
            return extractTextContent(value.result);
        }
        if (value.output !== undefined) {
            return extractTextContent(value.output);
        }
    }
    return null;
}

function extractContentFromG4FResponse(result) {
    if (result === null || result === undefined) {
        return null;
    }
    if (typeof result === 'string') {
        return result;
    }
    if (typeof result === 'number' || typeof result === 'boolean') {
        return String(result);
    }
    if (typeof result !== 'object') {
        return String(result);
    }
    if (result.choices && Array.isArray(result.choices) && result.choices.length > 0) {
        const choice = result.choices[0];
        if (choice.message && choice.message.content !== undefined) {
            return extractTextContent(choice.message.content);
        }
        if (choice.text !== undefined) {
            return extractTextContent(choice.text);
        }
        if (choice.content !== undefined) {
            return extractTextContent(choice.content);
        }
        if (choice.delta && choice.delta.content !== undefined) {
            return extractTextContent(choice.delta.content);
        }
    }
    if (result.message !== undefined) {
        if (typeof result.message === 'string') {
            return result.message;
        }
        if (result.message && result.message.content !== undefined) {
            return extractTextContent(result.message.content);
        }
    }
    if (result.content !== undefined) {
        return extractTextContent(result.content);
    }
    if (result.response !== undefined) {
        return extractTextContent(result.response);
    }
    if (result.text !== undefined) {
        return extractTextContent(result.text);
    }
    if (result.output !== undefined) {
        return extractTextContent(result.output);
    }
    if (result.result !== undefined) {
        return extractTextContent(result.result);
    }
    if (result.data !== undefined) {
        return extractTextContent(result.data);
    }
    if (result.answer !== undefined) {
        return extractTextContent(result.answer);
    }
    if (result.reply !== undefined) {
        return extractTextContent(result.reply);
    }
    const keys = Object.keys(result);
    const ignoredKeys = ['id', 'object', 'created', 'model', 'usage', 'type', 'request', 'provider', 'status', 'code', 'error', 'finish_reason', 'index', 'logprobs'];
    for (const key of keys) {
        if (ignoredKeys.includes(key)) continue;
        const value = result[key];
        if (typeof value === 'string' && value.length > 0) {
            return value;
        }
    }
    for (const key of keys) {
        if (ignoredKeys.includes(key)) continue;
        const extracted = extractTextContent(result[key]);
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
            messages: messages,
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
                messages: messages,
                stream: false
            });
            const content = extractContentFromG4FResponse(result);
            if (content) {
                return content;
            }
        } catch (nonStreamError) {
            const errorMsg = nonStreamError.message || String(nonStreamError);
            if (errorMsg.includes('not valid JSON')) {
                const match = errorMsg.match(/"([^"]+)"/);
                if (match && match[1]) {
                    return match[1] + '...（响应被截断，请重试）';
                }
            }
            throw new Error('G4F 请求失败: ' + errorMsg);
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
            messages: messages,
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
                messages: messages,
                stream: false
            });
            
            const content = extractContentFromG4FResponse(result);
            if (content) {
                if (onChunk) {
                    const words = content.split('');
                    let accumulated = '';
                    for (const char of words) {
                        accumulated += char;
                        onChunk(char, accumulated);
                        await new Promise(resolve => setTimeout(resolve, 20));
                    }
                }
                return content;
            }
        } catch (nonStreamError) {
            const errorMsg = nonStreamError.message || String(nonStreamError);
            throw new Error('G4F 请求失败: ' + errorMsg);
        }
    }
    
    return fullContent || '未收到任何响应内容';
}

export function isG4FProvider(providerId) {
    return providerId && providerId.startsWith('g4f-');
}

export function getG4FDefaultModels(providerId) {
    const providerKey = providerId.replace('g4f-', '');
    return G4F_DEFAULT_MODELS[providerKey] || G4F_DEFAULT_MODELS['default'];
}

export { G4F_DEFAULT_MODELS };