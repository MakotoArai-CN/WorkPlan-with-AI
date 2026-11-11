export const MAX_AI_RESPONSE_CHARS = 4 * 1024 * 1024;
export const MAX_AI_STREAM_FRAME_CHARS = 256 * 1024;

export function abortError() {
    return new DOMException('The request was cancelled', 'AbortError');
}

export function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
}

// Some third-party clients do not accept AbortSignal. Stop awaiting or publishing
// their output anyway; an already issued request may still finish remotely.
export function abortable(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) {
        Promise.resolve(promise).catch(() => {});
        return Promise.reject(abortError());
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}

export function boundedNumber(value, fallback, min, max) {
    const number = Number(value);
    return value === undefined || value === null || !Number.isFinite(number)
        ? fallback : Math.max(min, Math.min(max, number));
}

export function safeProviderError(value, secrets = []) {
    let message = String(value?.message || value || 'AI request failed');
    for (const secret of secrets) {
        if (typeof secret === 'string' && secret.length >= 4) message = message.split(secret).join('[REDACTED]');
    }
    return message
        .replace(/([?&](?:key|api_key|access_token|token|secret)=)[^\s&#]+/gi, '$1[REDACTED]')
        .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
        .replace(/\b(?:sk-[\w-]{12,}|sb_secret_[\w-]+|gh[pousr]_[\w]+)\b/g, '[REDACTED]')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .slice(0, 300);
}

export function providerHttpError(status, body, secrets = []) {
    let detail = '';
    try {
        const parsed = JSON.parse(body);
        detail = parsed.error?.message || parsed.error_description || parsed.message || '';
    } catch {
        // HTML proxy errors can contain headers, tokens and complete prompts.
        // Show the status instead of rendering unstructured response bodies.
    }
    const error = new Error(`HTTP ${status}${detail ? `: ${safeProviderError(detail, secrets)}` : ': AI request failed'}`);
    error.status = Number(status);
    return error;
}

export function addEndpointQuery(endpoint, name, value) {
    const url = new URL(endpoint);
    url.searchParams.set(name, value);
    return url.toString();
}

export async function readAiResponseText(response) {
    if (!response.body?.getReader) {
        const text = await response.text();
        if (text.length > MAX_AI_RESPONSE_CHARS) throw new Error('AI response exceeds the supported size');
        return text;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            if (text.length > MAX_AI_RESPONSE_CHARS) throw new Error('AI response exceeds the supported size');
        }
        text += decoder.decode();
        if (text.length > MAX_AI_RESPONSE_CHARS) throw new Error('AI response exceeds the supported size');
        return text;
    } finally {
        try { await reader.cancel(); } catch { /* The connection may already be closed. */ }
        reader.releaseLock();
    }
}

export async function readAiResponseJson(response) {
    const text = await readAiResponseText(response);
    try { return JSON.parse(text); } catch { throw new Error('AI returned an invalid JSON response'); }
}

// Keep JSONL separate from SSE: Ollama does not prefix its JSON lines with data:.
// SSE may split one JSON object across multiple data lines and UTF-8 chunks.
export function createAiStreamParser(onPayload, { jsonLines = false } = {}) {
    let buffer = '';
    let data = [];
    let dataChars = 0;
    let ended = false;
    const dispatch = () => {
        if (!data.length) return;
        const payload = data.join('\n');
        data = [];
        dataChars = 0;
        if (payload.trim() === '[DONE]') { ended = true; return; }
        onPayload(payload);
    };
    const line = value => {
        if (ended) return;
        if (value.length > MAX_AI_STREAM_FRAME_CHARS) throw new Error('AI stream frame exceeds the supported size');
        if (jsonLines) {
            if (value.trim()) onPayload(value.trim());
            return;
        }
        if (!value) { dispatch(); return; }
        if (value.startsWith(':')) return;
        if (value.startsWith('data:')) {
            let content = value.slice(5);
            if (content.startsWith(' ')) content = content.slice(1);
            if (content.trim() === '[DONE]') { dispatch(); ended = true; return; }
            data.push(content);
            dataChars += content.length + 1;
            if (dataChars > MAX_AI_STREAM_FRAME_CHARS || data.length > 4096) {
                throw new Error('AI stream frame exceeds the supported size');
            }
        }
    };
    return {
        feed(text) {
            if (ended) return;
            buffer += text;
            let boundary;
            while ((boundary = buffer.indexOf('\n')) >= 0) {
                const value = buffer.slice(0, boundary).replace(/\r$/, '');
                buffer = buffer.slice(boundary + 1);
                line(value);
            }
            if (buffer.length > MAX_AI_STREAM_FRAME_CHARS) throw new Error('AI stream frame exceeds the supported size');
        },
        finish() {
            if (buffer) line(buffer.replace(/\r$/, ''));
            buffer = '';
            dispatch();
        },
        get ended() { return ended; }
    };
}
