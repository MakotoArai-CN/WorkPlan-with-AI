// 通用 Webhook / WebSocket 连接器客户端。
// 统一封装 nanobot WebSocket 适配与 OpenAI 兼容 HTTP（HTTP 路径由 ai-providers 处理），
// 使同一个 provider（webhook）既能走 WebSocket，也能走 HTTP。

const DEFAULT_CONNECTOR_TIMEOUT_MS = 180000;

export const CONNECTOR_PRESETS = ['nanobot', 'custom'];
export const CONNECTOR_TRANSPORTS = ['auto', 'ws', 'http'];

export function getDefaultConnectorConfig() {
    return {
        enabled: false,
        transport: 'auto',      // 'auto' | 'ws' | 'http'
        preset: 'nanobot',      // 'nanobot' | 'custom'
        baseUrl: 'http://127.0.0.1:18789',
        apiKey: '',
        sessionKey: '',
        clientId: '',
        timeoutMs: DEFAULT_CONNECTOR_TIMEOUT_MS,
        headers: {}
    };
}

function looksLikeHttpChatEndpoint(url) {
    return /\/v1\/(chat\/completions|responses|messages|models|embeddings)\/?$/i.test(
        String(url || '').split('?')[0]
    );
}

const ALLOWED_CONNECTOR_PROTOCOLS = ['http:', 'https:', 'ws:', 'wss:'];

// 用户可能只填了 `127.0.0.1:18789` 这类没有协议的地址，此时 new URL 会失败（或把
// `127.0.0.1:` 当成协议），要宽容处理；但如果地址明确带了一个不受支持的协议
// （javascript:、file: 等），必须拒绝而不是原样返回。
function hasDisallowedScheme(raw) {
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1];
    if (!scheme) return false;
    // `host:port` 会被误认成协议，端口是纯数字，据此区分。
    if (/^\d+/.test(raw.slice(scheme.length + 1))) return false;
    return !ALLOWED_CONNECTOR_PROTOCOLS.includes(`${scheme.toLowerCase()}:`);
}

// 归一化连接器基址：只接受 http/https/ws/wss，并把误填的 /v1/... 端点回退到根路径。
export function getConnectorBaseUrl(config = {}) {
    const raw = String(config.baseUrl ?? '').trim();
    if (!raw) return '';
    // 之前这个校验写在 try 里 throw，被下面的 catch 吞掉后又原样返回了 raw，
    // 等于完全没有校验。协议不合法和地址解析不了是两件事，分开处理。
    if (hasDisallowedScheme(raw)) return '';
    try {
        const url = new URL(raw);
        // 协议解析出来但不在白名单里，只会是 `localhost:18789` 这种被当成协议的
        // 无协议地址（真正危险的协议已经在上面挡掉了），沿用宽容分支。
        if (!ALLOWED_CONNECTOR_PROTOCOLS.includes(url.protocol)) {
            return raw.replace(/\/+$/, '');
        }
        if (looksLikeHttpChatEndpoint(url.toString())) {
            url.pathname = '/';
            url.search = '';
            url.hash = '';
        }
        return url.toString().replace(/\/$/, '');
    } catch {
        return raw.replace(/\/+$/, '');
    }
}

// 解析最终传输方式：显式设置优先，其次按地址协议推断。
export function resolveConnectorTransport(config = {}) {
    const explicit = String(config.transport || config.connectorTransport || 'auto').toLowerCase();
    if (explicit === 'ws' || explicit === 'http') return explicit;
    const raw = String(config.baseUrl || config.customEndpoint || '').trim().toLowerCase();
    if (raw.startsWith('ws:') || raw.startsWith('wss:')) return 'ws';
    return 'http';
}

// HTTP 传输下推导出的 OpenAI 兼容 chat 端点（nanobot / custom 用）。
export function getConnectorHttpChatEndpoint(config = {}) {
    const raw = String(config.baseUrl || config.customEndpoint || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    // 这里不能走 getConnectorBaseUrl —— 它会把 /v1/chat/completions 收敛回根路径，
    // 而下面第一条分支正是要保留用户填的完整端点。只复用协议校验。
    if (hasDisallowedScheme(raw)) return '';
    if (/\/(chat\/completions|responses|messages)$/i.test(raw)) return raw;
    if (/\/v\d+$/i.test(raw)) return `${raw}/chat/completions`;
    return `${raw}/v1/chat/completions`;
}

export function getConnectorHttpModelsEndpoint(config = {}) {
    const chat = getConnectorHttpChatEndpoint(config);
    if (!chat) return '';
    return chat.replace(/\/(chat\/completions|responses|messages)$/i, '/models');
}

export function getConnectorWebSocketUrl(config = {}) {
    const baseUrl = getConnectorBaseUrl({ baseUrl: config.baseUrl || config.customEndpoint });
    if (!baseUrl) return '';
    const url = new URL(baseUrl);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (!['ws:', 'wss:'].includes(url.protocol)) {
        throw new Error('连接器 WebSocket 地址无效');
    }
    return url.toString();
}

function extractTextContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (typeof part?.text === 'string') return part.text;
                if (typeof part?.content === 'string') return part.content;
                return '';
            })
            .filter(Boolean)
            .join('');
    }
    if (typeof content?.text === 'string') return content.text;
    return '';
}

function extractLatestUserText(messages = []) {
    const latest = [...messages].reverse().find((msg) => msg?.role === 'user');
    return extractTextContent(latest?.content || latest?.parts || '').trim();
}

function buildNanobotWebSocketUrl(config = {}) {
    const wsBase = getConnectorWebSocketUrl(config);
    if (!wsBase) throw new Error('未配置 nanobot WebSocket 地址');
    const url = new URL(wsBase);
    if (config.clientId) url.searchParams.set('client_id', String(config.clientId));
    const token = config.apiKey || config.sessionKey || '';
    if (token) url.searchParams.set('token', String(token));
    return url.toString();
}

// nanobot WebSocket channel 适配器。
// 协议（见 HKUDS/nanobot docs/chat-apps）：
//   服务器先推 {event:'ready',chat_id}；客户端发 {type:'message',chat_id,content} 或 {content}；
//   服务器流式推 {event:'delta',text,stream_id}，最终推 {event:'message',text}；错误为 {event:'error',detail}。
export async function chatWithNanobotWebSocket(config = {}, messages = [], onChunk = null, { signal } = {}) {
    if (typeof WebSocket !== 'function') {
        throw new Error('当前环境不支持 nanobot WebSocket');
    }
    const userMessage = extractLatestUserText(messages);
    if (!userMessage) throw new Error('nanobot 消息内容为空');

    const url = buildNanobotWebSocketUrl(config);
    const timeoutMs = Math.max(
        30000,
        Number(config.connectorTimeoutMs ?? config.timeoutMs) || DEFAULT_CONNECTOR_TIMEOUT_MS
    );

    return await new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        let fullContent = '';
        let settled = false;
        let sent = false;
        let sawDelta = false;
        let chatId = null;

        const finalTimer = setTimeout(
            () => finish(null, new Error('等待 nanobot 回复超时')),
            timeoutMs + 5000
        );
        // 兜底：连接打开后若迟迟未收到 ready，则直接以默认会话发送。
        let openFallbackTimer = null;

        function cleanup() {
            clearTimeout(finalTimer);
            if (openFallbackTimer) clearTimeout(openFallbackTimer);
            signal?.removeEventListener('abort', onAbort);
            try { ws.close(); } catch {}
        }
        function finish(text, err) {
            if (settled) return;
            settled = true;
            cleanup();
            if (err) reject(err);
            else resolve(text ?? fullContent);
        }
        function onAbort() { finish(fullContent); }
        function update(delta) {
            const piece = String(delta || '');
            if (!piece) return;
            fullContent += piece;
            onChunk?.(piece, fullContent);
        }
        function sendUserMessage() {
            if (sent || ws.readyState !== WebSocket.OPEN) return;
            sent = true;
            const frame = chatId
                ? { type: 'message', chat_id: chatId, content: userMessage }
                : { content: userMessage };
            try { ws.send(JSON.stringify(frame)); }
            catch (e) { finish(null, e instanceof Error ? e : new Error(String(e))); }
        }

        if (signal?.aborted) { finish(fullContent); return; }
        signal?.addEventListener('abort', onAbort, { once: true });

        ws.onopen = () => {
            openFallbackTimer = setTimeout(sendUserMessage, 800);
        };

        ws.onmessage = (event) => {
            let frame;
            try { frame = JSON.parse(event.data); }
            catch { return; }

            // 纯字符串/无 event 的回复，按完整文本处理。
            if (typeof frame === 'string') {
                if (!sawDelta) fullContent = frame;
                finish(fullContent || frame);
                return;
            }

            const ev = frame?.event;
            if (ev === 'ready') {
                chatId = frame.chat_id || null;
                sendUserMessage();
                return;
            }
            if (ev === 'delta') {
                sawDelta = true;
                update(typeof frame.text === 'string' ? frame.text : '');
                return;
            }
            if (ev === 'stream_end') {
                return;
            }
            if (ev === 'message') {
                const text = typeof frame.text === 'string' ? frame.text : '';
                if (!sawDelta) {
                    fullContent = text;
                    onChunk?.(text, text);
                } else if (text && text !== fullContent) {
                    const tail = text.startsWith(fullContent) ? text.slice(fullContent.length) : '';
                    if (tail) update(tail);
                    else fullContent = text;
                }
                finish(fullContent || text);
                return;
            }
            if (ev === 'error') {
                finish(null, new Error(frame.detail || 'nanobot 返回错误'));
                return;
            }
            // 其余事件（reasoning_delta / reasoning_end / attached / runtime_model_updated）忽略。
        };

        ws.onerror = () => finish(null, new Error('nanobot WebSocket 连接失败'));
        ws.onclose = () => {
            if (settled) return;
            if (fullContent) finish(fullContent);
            else finish(null, new Error('nanobot WebSocket 已关闭'));
        };
    });
}

const WS_UNSUPPORTED_MESSAGE =
    '当前预设没有 WebSocket 协议实现，请在连接器设置里把传输方式改为 HTTP（OpenAI 兼容），或改用 nanobot 预设。';

// 统一 WebSocket 聊天入口：nanobot 是目前唯一有 WebSocket 协议实现的预设。
export async function chatViaWebSocketConnector(config = {}, messages = [], onChunk = null, { signal } = {}) {
    const preset = String(config.connectorPreset || config.preset || 'nanobot').toLowerCase();
    if (preset === 'nanobot') {
        return await chatWithNanobotWebSocket(config, messages, onChunk, { signal });
    }
    throw new Error(WS_UNSUPPORTED_MESSAGE);
}

// 连接测试（仅 WebSocket 传输）。HTTP 传输由调用方通过模型列表/标准请求验证。
export async function checkConnector(config = {}) {
    const preset = String(config.preset || config.connectorPreset || 'nanobot').toLowerCase();
    if (preset === 'nanobot') {
        return await checkNanobotWebSocket(config);
    }
    throw new Error(WS_UNSUPPORTED_MESSAGE);
}

async function checkNanobotWebSocket(config = {}) {
    if (typeof WebSocket !== 'function') {
        throw new Error('当前环境不支持 nanobot WebSocket');
    }
    const url = buildNanobotWebSocketUrl(config);
    return await new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        let settled = false;
        const timer = setTimeout(() => done(null, new Error('连接 nanobot 超时')), 10000);
        function done(payload, err) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { ws.close(); } catch {}
            if (err) reject(err);
            else resolve(payload);
        }
        ws.onopen = () => { /* 等待 ready；部分配置不发 ready 时由 onmessage/超时兜底 */ };
        ws.onmessage = (event) => {
            let frame;
            try { frame = JSON.parse(event.data); } catch { done({ ok: true }); return; }
            if (frame?.event === 'ready') done({ ok: true, hello: frame });
            else if (frame?.event === 'error') done(null, new Error(frame.detail || 'nanobot 握手失败'));
            else done({ ok: true, hello: frame });
        };
        ws.onerror = () => done(null, new Error('nanobot WebSocket 连接失败'));
        ws.onclose = () => done(null, new Error('nanobot WebSocket 已关闭'));
    });
}
