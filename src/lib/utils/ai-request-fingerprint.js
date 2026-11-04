// Request fingerprints for OpenAI/Anthropic-compatible gateways.
//
// These presets only add client headers. They do not provide credentials and
// do not bypass authentication; use them only with endpoints you are allowed
// to access.

const MAX_HEADER_COUNT = 64;
const MAX_HEADER_VALUE = 2048;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const BLOCKED_HEADERS = new Set([
    'connection',
    'content-length',
    'expect',
    'host',
    'keep-alive',
    'proxy-connection',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade'
]);

export const REQUEST_FINGERPRINT_OPTIONS = [
    { value: 'default', labelKey: 'ai_settings_page.fingerprint_default' },
    { value: 'claude_code', labelKey: 'ai_settings_page.fingerprint_claude' },
    { value: 'codex', labelKey: 'ai_settings_page.fingerprint_codex' },
    { value: 'opencode', labelKey: 'ai_settings_page.fingerprint_opencode' },
    { value: 'custom', labelKey: 'ai_settings_page.fingerprint_custom' }
];

export const REQUEST_FINGERPRINT_PRESETS = {
    default: {},
    custom: {},
    claude_code: {
        'User-Agent': 'claude-cli/1.0.60 (external, cli)',
        'x-app': 'cli',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
        'anthropic-dangerous-direct-browser-access': 'true',
        'x-stainless-lang': 'js',
        'x-stainless-package-version': '0.60.0',
        'x-stainless-os': 'Windows',
        'x-stainless-arch': 'x64',
        'x-stainless-runtime': 'node',
        'x-stainless-runtime-version': 'v20.19.0'
    },
    codex: {
        'User-Agent': 'codex_cli_rs/0.42.0 (Windows 10.0.22631; x86_64)',
        'originator': 'codex_cli_rs',
        'OpenAI-Beta': 'responses=experimental'
    },
    opencode: {
        'User-Agent': 'opencode/0.15.0',
        'x-opencode-client': 'cli'
    }
};

function assertHeaderName(name) {
    const normalized = String(name || '').trim();
    if (!normalized || normalized.length > 128 || !HEADER_NAME.test(normalized)) {
        throw new Error(`无效的请求头名称：${name || '(空)'}`);
    }
    if (BLOCKED_HEADERS.has(normalized.toLowerCase())) {
        throw new Error(`请求头不允许覆盖：${normalized}`);
    }
    return normalized;
}

function assertHeaderValue(value) {
    const normalized = String(value ?? '').replace(/\r?\n[ \t]*/g, ' ').trim();
    if (normalized.length > MAX_HEADER_VALUE || /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw new Error('请求头值包含非法字符或过长');
    }
    return normalized;
}

/** Convert an object/array of header pairs into a safe, case-insensitive map. */
export function normalizeRequestHeaders(input = {}) {
    const entries = Array.isArray(input)
        ? input
        : Object.entries(input && typeof input === 'object' ? input : {});
    if (entries.length > MAX_HEADER_COUNT) {
        throw new Error('自定义请求头过多');
    }
    const headers = {};
    const seen = new Map();
    for (const [rawName, rawValue] of entries) {
        if (rawName === undefined || rawName === null) continue;
        const name = assertHeaderName(rawName);
        const value = assertHeaderValue(rawValue);
        const lower = name.toLowerCase();
        if (seen.has(lower)) {
            delete headers[seen.get(lower)];
        }
        seen.set(lower, name);
        headers[name] = value;
    }
    return headers;
}

/**
 * Resolve the headers that should be merged into an AI request.
 * Provider defaults are applied by the caller; this adds the fingerprint and
 * user-defined headers. Auth headers are applied by the caller afterwards.
 */
export function resolveRequestHeaders(config = {}) {
    const fingerprint = String(config.requestFingerprint || 'default');
    const preset = REQUEST_FINGERPRINT_PRESETS[fingerprint] || {};
    const headers = normalizeRequestHeaders(preset);
    for (const [name, value] of Object.entries(normalizeRequestHeaders(config.customHeaders || {}))) {
        const lower = name.toLowerCase();
        for (const existing of Object.keys(headers)) {
            if (existing.toLowerCase() === lower) delete headers[existing];
        }
        headers[name] = value;
    }
    return headers;
}

/** Parse the line-based editor format: `Header-Name: value`. */
export function parseRequestHeadersText(text = '') {
    const entries = [];
    for (const rawLine of String(text).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf(':');
        if (separator <= 0) {
            throw new Error(`请求头格式应为 Name: value：${line}`);
        }
        entries.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()]);
    }
    return normalizeRequestHeaders(entries);
}

export function serializeRequestHeaders(headers = {}) {
    return Object.entries(normalizeRequestHeaders(headers))
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n');
}
