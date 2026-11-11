import { PROVIDER_CONFIGS } from './ai-providers.js';
import { isTauriRuntime } from './runtime.js';
import { boundedNumber, providerHttpError, throwIfAborted } from './ai-transport.js';

async function fetchWithTauri(url, options = {}) {
    throwIfAborted(options.signal);
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid media API endpoint');
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
        headers,
        ...(options.signal ? { signal: options.signal } : {})
    };
    const deadline = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(150000) : null;
    if (deadline) fetchOptions.signal = options.signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([options.signal, deadline]) : options.signal || deadline;
    if (options.body) {
        fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }
    const fetcher = isTauriRuntime ? (await import('@tauri-apps/plugin-http')).fetch : globalThis.fetch;
    return await fetcher(parsed.href, fetchOptions);
}

function mediaEndpoint(base, suffix) {
    const url = new URL(base);
    const root = url.pathname.replace(/\/(?:chat\/completions|images\/generations|audio\/speech)\/?$/, '').replace(/\/$/, '');
    url.pathname = (root || '/v1') + suffix;
    return url.href;
}

export async function generateImage({ provider, apiKey, prompt, size = '1024x1024', style = 'vivid', model, customEndpoint, signal }) {
    throwIfAborted(signal);
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000) throw new Error('Invalid image prompt');
    const providerConfig = PROVIDER_CONFIGS[provider];
    const baseUrl = customEndpoint || providerConfig?.endpoint || '';

    if (provider === 'openai' || providerConfig?.bodyFormat === 'openai') {
        const endpoint = mediaEndpoint(baseUrl, '/images/generations');
        const response = await fetchWithTauri(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            signal,
            body: JSON.stringify({
                model: model || 'dall-e-3',
                prompt,
                n: 1,
                size,
                style,
                response_format: 'b64_json'
            })
        });

        if (!response.ok) {
            throw providerHttpError(response.status, await response.text(), [apiKey]);
        }

        const data = await response.json();
        throwIfAborted(signal);
        const imageData = data?.data?.[0];
        if (!imageData) throw new Error('未返回图片数据');

        return {
            type: 'image',
            base64Data: imageData.b64_json || '',
            url: imageData.url || '',
            mimeType: 'image/png',
            prompt,
            revisedPrompt: imageData.revised_prompt || prompt,
            size,
            provider
        };
    }

    throw new Error(`当前提供商 ${provider} 不支持图片生成`);
}

export async function generateAudio({ provider, apiKey, text, voice = 'alloy', model, customEndpoint, speed = 1.0, signal }) {
    throwIfAborted(signal);
    if (typeof text !== 'string' || !text.trim() || text.length > 32000) throw new Error('Invalid speech text');
    const providerConfig = PROVIDER_CONFIGS[provider];
    const baseUrl = customEndpoint || providerConfig?.endpoint || '';

    if (provider === 'openai' || providerConfig?.bodyFormat === 'openai') {
        const endpoint = mediaEndpoint(baseUrl, '/audio/speech');
        const response = await fetchWithTauri(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            signal,
            body: JSON.stringify({
                model: model || 'tts-1',
                input: text,
                voice,
                speed: boundedNumber(speed, 1, 0.25, 4),
                response_format: 'mp3'
            })
        });

        if (!response.ok) {
            throw providerHttpError(response.status, await response.text(), [apiKey]);
        }

        const arrayBuffer = await response.arrayBuffer();
        throwIfAborted(signal);
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 32768) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        }
        const base64Data = btoa(binary);

        return {
            type: 'audio',
            base64Data,
            mimeType: 'audio/mpeg',
            text,
            voice,
            provider
        };
    }

    throw new Error(`当前提供商 ${provider} 不支持语音生成`);
}

export function getImageGenerationModels(provider) {
    if (provider === 'openai') return ['dall-e-3', 'dall-e-2'];
    const config = PROVIDER_CONFIGS[provider];
    if (config?.bodyFormat === 'openai') return ['dall-e-3', 'dall-e-2'];
    return [];
}

export function getTTSModels(provider) {
    if (provider === 'openai') return ['tts-1', 'tts-1-hd'];
    const config = PROVIDER_CONFIGS[provider];
    if (config?.bodyFormat === 'openai') return ['tts-1', 'tts-1-hd'];
    return [];
}

export function getTTSVoices() {
    return ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
}

export function supportsImageGeneration(provider) {
    return getImageGenerationModels(provider).length > 0;
}

export function supportsTTS(provider) {
    return getTTSModels(provider).length > 0;
}
