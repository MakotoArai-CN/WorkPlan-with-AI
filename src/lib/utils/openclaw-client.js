const OPENCLAW_PROTOCOL_VERSION = 3;
const DEFAULT_GATEWAY_TIMEOUT_MS = 180000;

function looksLikeGatewayHttpEndpoint(url) {
    return /\/v1\/(chat\/completions|responses|messages|models|embeddings)\/?$/i.test(String(url || '').split('?')[0]);
}

function createId(prefix = 'openclaw') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeGatewayBaseUrl(baseUrl) {
    const raw = String(baseUrl || getDefaultOpenClawConfig().baseUrl || '').trim();
    if (!raw) return '';
    try {
        const url = new URL(raw);
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
            throw new Error('OpenClaw Gateway 仅支持 http/https/ws/wss');
        }
        if (looksLikeGatewayHttpEndpoint(url.toString())) {
            url.pathname = '/';
            url.search = '';
            url.hash = '';
        }
        return url.toString().replace(/\/$/, '');
    } catch {
        return raw.replace(/\/+$/, '');
    }
}

export function getOpenClawGatewayEndpoint(config = {}) {
    return normalizeGatewayBaseUrl(config.baseUrl);
}

export function getOpenClawWebSocketUrl(config = {}) {
    const baseUrl = getOpenClawGatewayEndpoint(config);
    if (!baseUrl) return '';
    const url = new URL(baseUrl);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (!['ws:', 'wss:'].includes(url.protocol)) {
        throw new Error('OpenClaw Gateway WebSocket 地址无效');
    }
    return url.toString();
}

function extractTextContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map((part) => {
            if (typeof part === 'string') return part;
            if (typeof part?.text === 'string') return part.text;
            if (typeof part?.content === 'string') return part.content;
            return '';
        }).filter(Boolean).join('');
    }
    if (typeof content?.text === 'string') return content.text;
    return '';
}

function extractMessageText(message) {
    if (!message) return '';
    if (typeof message.text === 'string') return message.text;
    return extractTextContent(message.content);
}

function extractLatestUserText(messages = []) {
    const latest = [...messages].reverse().find((msg) => msg?.role === 'user');
    return extractTextContent(latest?.content || latest?.parts || '').trim();
}

function resolveOpenClawSessionKey(config = {}, hello = null) {
    return String(
        config.openclawSessionKey ||
        config.sessionKey ||
        hello?.snapshot?.sessionDefaults?.mainSessionKey ||
        hello?.snapshot?.sessionDefaults?.mainKey ||
        'main'
    ).trim();
}

function normalizeOpenClawModels(data) {
    const models = Array.isArray(data?.models) ? data.models : [];
    return models
        .map((item) => typeof item === 'string' ? item : (item?.id || item?.name))
        .filter(Boolean);
}

export async function connectOpenClawGateway({
    baseUrl,
    apiKey = '',
    timeoutMs = 10000,
    onEvent = null
} = {}) {
    if (typeof WebSocket !== 'function') {
        throw new Error('当前环境不支持 OpenClaw Gateway WebSocket');
    }

    const url = getOpenClawWebSocketUrl({ baseUrl });
    if (!url) throw new Error('未配置 OpenClaw Gateway 地址');

    return await new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const pending = new Map();
        let hello = null;
        let connected = false;
        let connectSent = false;
        let settled = false;

        const failTimer = setTimeout(() => {
            rejectOnce(new Error('连接 OpenClaw Gateway 超时'));
            try { ws.close(); } catch {}
        }, timeoutMs);

        function rejectOnce(error) {
            if (settled) return;
            settled = true;
            clearTimeout(failTimer);
            reject(error);
        }

        function sendFrame(frame) {
            ws.send(JSON.stringify(frame));
        }

        function rejectPending(error) {
            for (const item of pending.values()) {
                clearTimeout(item.timer);
                item.reject(error);
            }
            pending.clear();
        }

        function buildClient() {
            return {
                get hello() { return hello; },
                get connected() { return connected && ws.readyState === WebSocket.OPEN; },
                request(method, params = {}, opts = {}) {
                    if (ws.readyState !== WebSocket.OPEN) {
                        return Promise.reject(new Error('OpenClaw Gateway WebSocket 已断开'));
                    }
                    const id = createId('req');
                    const requestTimeout = opts.timeoutMs ?? 30000;
                    return new Promise((requestResolve, requestReject) => {
                        const timer = requestTimeout === null ? null : setTimeout(() => {
                            pending.delete(id);
                            requestReject(new Error(`OpenClaw Gateway 请求超时: ${method}`));
                        }, requestTimeout);
                        pending.set(id, {
                            resolve: requestResolve,
                            reject: requestReject,
                            timer
                        });
                        sendFrame({ type: 'req', id, method, params });
                    });
                },
                close() {
                    try { ws.close(); } catch {}
                    rejectPending(new Error('OpenClaw Gateway WebSocket 已关闭'));
                }
            };
        }

        const client = buildClient();

        function sendConnect() {
            if (connectSent || ws.readyState !== WebSocket.OPEN) return;
            connectSent = true;
            const id = createId('connect');
            pending.set(id, {
                resolve: (payload) => {
                    hello = payload;
                    connected = true;
                    if (!settled) {
                        settled = true;
                        clearTimeout(failTimer);
                        resolve(client);
                    }
                },
                reject: rejectOnce,
                timer: null
            });
            const auth = apiKey ? { token: apiKey } : undefined;
            sendFrame({
                type: 'req',
                id,
                method: 'connect',
                params: {
                    minProtocol: OPENCLAW_PROTOCOL_VERSION,
                    maxProtocol: OPENCLAW_PROTOCOL_VERSION,
                    client: {
                        id: 'webchat-ui',
                        displayName: 'WorkPlan AI Chat',
                        version: 'workplan',
                        platform: typeof navigator !== 'undefined' ? navigator.platform || 'desktop' : 'desktop',
                        mode: 'webchat'
                    },
                    role: 'operator',
                    scopes: ['operator.read', 'operator.write'],
                    caps: [],
                    commands: [],
                    permissions: {},
                    ...(auth ? { auth } : {}),
                    locale: typeof navigator !== 'undefined' ? navigator.language : 'zh-CN',
                    userAgent: 'workplan/openclaw-gateway'
                }
            });
        }

        ws.onopen = () => {
            setTimeout(sendConnect, 200);
        };

        ws.onmessage = (event) => {
            let frame;
            try {
                frame = JSON.parse(event.data);
            } catch {
                return;
            }

            if (frame?.type === 'event') {
                if (frame.event === 'connect.challenge') {
                    sendConnect();
                    return;
                }
                onEvent?.(frame);
                return;
            }

            if (frame?.type !== 'res' || !frame.id) return;
            const waiter = pending.get(frame.id);
            if (!waiter) return;
            pending.delete(frame.id);
            if (waiter.timer) clearTimeout(waiter.timer);
            if (frame.ok) {
                waiter.resolve(frame.payload);
            } else {
                const message = frame.error?.message || frame.error?.code || 'OpenClaw Gateway 请求失败';
                const err = new Error(message);
                err.details = frame.error;
                waiter.reject(err);
            }
        };

        ws.onerror = () => {
            rejectOnce(new Error('OpenClaw Gateway WebSocket 连接失败'));
        };

        ws.onclose = () => {
            connected = false;
            if (!settled) rejectOnce(new Error('OpenClaw Gateway WebSocket 已关闭'));
            rejectPending(new Error('OpenClaw Gateway WebSocket 已关闭'));
        };
    });
}

export async function checkGateway({ baseUrl, apiKey } = {}) {
    const client = await connectOpenClawGateway({ baseUrl, apiKey });
    try {
        try {
            return await client.request('health', {}, { timeoutMs: 15000 });
        } catch {
            return { ok: true, hello: client.hello };
        }
    } finally {
        client.close();
    }
}

export async function fetchOpenClawGatewayModels({ baseUrl, apiKey } = {}) {
    const client = await connectOpenClawGateway({ baseUrl, apiKey });
    try {
        const data = await client.request('models.list', {}, { timeoutMs: 15000 });
        return normalizeOpenClawModels(data);
    } finally {
        client.close();
    }
}

async function readLatestAssistantFromHistory(client, sessionKey) {
    try {
        const data = await client.request('chat.history', { sessionKey, limit: 20, maxChars: 20000 }, { timeoutMs: 15000 });
        const messages = Array.isArray(data?.messages) ? data.messages : [];
        const latestAssistant = [...messages].reverse().find((msg) => msg?.role === 'assistant');
        return extractMessageText(latestAssistant).trim();
    } catch {
        return '';
    }
}

export async function chatWithOpenClawGateway(config = {}, messages = [], onChunk = null, { signal } = {}) {
    const userMessage = extractLatestUserText(messages);
    if (!userMessage) throw new Error('OpenClaw 消息内容为空');

    let fullContent = '';
    let settled = false;
    let runId = createId('workplan_chat');
    let sessionKey = '';
    let client = null;
    let finish;
    let fail;

    const finalPromise = new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
    });

    const timeoutMs = Math.max(30000, Number(config.openclawTimeoutMs) || DEFAULT_GATEWAY_TIMEOUT_MS);
    const finalTimer = setTimeout(() => {
        if (!settled) {
            settled = true;
            fail(new Error('等待 OpenClaw 回复超时'));
        }
    }, timeoutMs + 5000);

    function settleWithText(text) {
        if (settled) return;
        settled = true;
        clearTimeout(finalTimer);
        finish(text || fullContent);
    }

    function settleWithError(error) {
        if (settled) return;
        settled = true;
        clearTimeout(finalTimer);
        fail(error);
    }

    function updateContent(nextText) {
        const text = String(nextText || '');
        if (!text || text === fullContent) return;
        const delta = text.startsWith(fullContent) ? text.slice(fullContent.length) : text;
        fullContent = text;
        onChunk?.(delta, fullContent);
    }

    const abortHandler = () => {
        if (client && sessionKey && runId) {
            client.request('chat.abort', { sessionKey, runId }, { timeoutMs: 5000 }).catch(() => {});
        }
        settleWithText(fullContent);
    };

    try {
        client = await connectOpenClawGateway({
            baseUrl: config.openclawGatewayUrl || config.customEndpoint || config.baseUrl,
            apiKey: config.apiKey || '',
            onEvent: (frame) => {
                if (frame.event !== 'chat') return;
                const payload = frame.payload || {};
                if (payload.runId !== runId || payload.sessionKey !== sessionKey) return;
                if (payload.state === 'delta') {
                    updateContent(extractMessageText(payload.message));
                } else if (payload.state === 'final') {
                    const finalText = extractMessageText(payload.message) || fullContent;
                    updateContent(finalText);
                    settleWithText(finalText);
                } else if (payload.state === 'error') {
                    settleWithError(new Error(payload.errorMessage || 'OpenClaw 回复失败'));
                } else if (payload.state === 'aborted') {
                    settleWithText(fullContent);
                }
            }
        });
        sessionKey = resolveOpenClawSessionKey(config, client.hello);
        if (signal?.aborted) {
            abortHandler();
        } else {
            signal?.addEventListener('abort', abortHandler, { once: true });
            const sendResult = await client.request('chat.send', {
                sessionKey,
                message: userMessage,
                timeoutMs,
                idempotencyKey: runId
            }, { timeoutMs: 30000 });
            if (sendResult?.runId) runId = sendResult.runId;
            if (sendResult?.status === 'ok' && !fullContent) {
                const historyText = await readLatestAssistantFromHistory(client, sessionKey);
                if (historyText) settleWithText(historyText);
            }
        }
        return await finalPromise;
    } finally {
        clearTimeout(finalTimer);
        signal?.removeEventListener('abort', abortHandler);
        client?.close();
    }
}

export function getDefaultOpenClawConfig() {
    return {
        enabled: false,
        baseUrl: 'http://127.0.0.1:18789',
        apiKey: '',
        sessionKey: '',
        timeoutMs: DEFAULT_GATEWAY_TIMEOUT_MS
    };
}
