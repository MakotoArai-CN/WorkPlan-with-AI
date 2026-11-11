const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']);
const AUDIO_MIMES = new Set(['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/flac', 'audio/aac']);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[character]);
}

export function safeLinkUrl(value) {
    const input = String(value ?? '').trim();
    if (!input || CONTROL_CHARACTERS.test(input) || input.includes('\\')) return '';
    if (input.startsWith('#')) return input;
    try {
        const url = new URL(input, 'https://workplan.invalid/');
        return LINK_PROTOCOLS.has(url.protocol) && !url.username && !url.password ? input : '';
    } catch { return ''; }
}

export function safeMediaDataUrl(mime, base64, kind = 'image') {
    const type = String(mime ?? '').toLowerCase();
    const content = String(base64 ?? '');
    const allowed = kind === 'audio' ? AUDIO_MIMES : IMAGE_MIMES;
    if (!allowed.has(type) || !content || !/^[a-zA-Z0-9+/\r\n]*={0,2}$/.test(content)) return '';
    return `data:${type};base64,${content}`;
}

export function safeImageUrl(value) {
    const input = String(value ?? '').trim();
    if (!input || CONTROL_CHARACTERS.test(input) || input.includes('\\')) return '';
    const data = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(input);
    if (data) return safeMediaDataUrl(data[1], data[2]);
    // App-owned vector avatars are allowed; arbitrary SVG/data documents are not.
    if (/^\/avatars\/(?:assistant|user)-orbit-[1-4]\.svg$/.test(input)) return input;
    try {
        const url = new URL(input);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
}

const LENGTH_STYLE_PROPERTIES = new Set([
    'height', 'width', 'min-width', 'max-width', 'min-height', 'max-height',
    'top', 'left', 'right', 'bottom', 'vertical-align', 'margin-left', 'margin-right',
    'padding-left', 'padding-right', 'border-bottom-width', 'border-top-width',
    'font-size', 'line-height', 'letter-spacing'
]);

// KaTeX needs numeric inline layout, not arbitrary CSS, URLs or fixed overlays.
export function safeInlineStyle(value) {
    return String(value ?? '').split(';').flatMap(declaration => {
        const separator = declaration.indexOf(':');
        if (separator < 0) return [];
        const property = declaration.slice(0, separator).trim().toLowerCase();
        const content = declaration.slice(separator + 1).trim();
        if (LENGTH_STYLE_PROPERTIES.has(property) && /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:em|ex|px|pt|%|rem)?$/i.test(content)) {
            return [`${property}:${content}`];
        }
        if (['color', 'background-color', 'border-color'].includes(property)
            && /^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\))$/i.test(content)) return [`${property}:${content}`];
        if (property === 'text-align' && /^(left|right|center|start|end)$/.test(content)) return [`${property}:${content}`];
        return [];
    }).join(';');
}
