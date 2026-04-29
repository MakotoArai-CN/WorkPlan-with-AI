import { PROVIDER_CONFIGS } from './ai-providers.js';

async function fetchWithTauri(url, options = {}) {
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
        headers
    };
    if (options.body) {
        fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }
    return await tauriFetch(url, fetchOptions);
}

export async function generateImage({ provider, apiKey, prompt, size = '1024x1024', style = 'vivid', model, customEndpoint }) {
    const providerConfig = PROVIDER_CONFIGS[provider];
    const baseUrl = customEndpoint || providerConfig?.endpoint || '';

    if (provider === 'openai' || providerConfig?.bodyFormat === 'openai') {
        const endpoint = baseUrl.replace(/\/chat\/completions\/?$/, '/images/generations');
        const response = await fetchWithTauri(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
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
            const error = await response.json().catch(() => ({}));
            throw new Error(error?.error?.message || `图片生成失败: HTTP ${response.status}`);
        }

        const data = await response.json();
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

export async function generateAudio({ provider, apiKey, text, voice = 'alloy', model, customEndpoint, speed = 1.0 }) {
    const providerConfig = PROVIDER_CONFIGS[provider];
    const baseUrl = customEndpoint || providerConfig?.endpoint || '';

    if (provider === 'openai' || providerConfig?.bodyFormat === 'openai') {
        const endpoint = baseUrl.replace(/\/chat\/completions\/?$/, '/audio/speech');
        const response = await fetchWithTauri(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model || 'tts-1',
                input: text,
                voice,
                speed,
                response_format: 'mp3'
            })
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`语音生成失败: HTTP ${response.status} ${errorText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
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
