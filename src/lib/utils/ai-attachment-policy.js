const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const GOOGLE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/mpeg']);
const MAX_BINARY_BYTES = 5000000;
const MAX_TOTAL_BYTES = 12000000;
const TEXT_EXTENSIONS = new Set('txt md markdown json json5 js mjs cjs ts jsx tsx svelte html css scss sass less yml yaml toml xml csv log sql rs py java kt kts sh bat ps1 env ini conf properties svg'.split(' '));

export function attachmentCapabilities(config = {}) {
    const provider = config.provider || 'openai';
    const model = String(config.customModel || config.model || '').toLowerCase();
    if (provider === 'google' && /^gemini-(?:1\.5|2|3)/.test(model)) return { image: true, audio: true, video: true };
    if (provider === 'anthropic' && /claude-(?:3|4|sonnet|opus|haiku)/.test(model)) return { image: true, audio: false, video: false };
    const compatible = ['openai', 'custom', 'lmstudio', 'ollama', 'openrouter', 'qwen', 'mistral', 'xai', 'zhipu', 'kimi'].includes(provider);
    const vision = /gpt-(?:4o|4\.1|4-turbo|5|6)|(?:^|\/)o[134](?:-|$)|grok-(?:2-vision|3|4)|qwen[^\s/]*vl|qwen-vl|llava|vision|pixtral|glm-4v|moonshot-v1-.*vision|kimi-k2\.5/.test(model);
    return { image: compatible && vision, audio: false, video: false };
}

export function assertChatAttachments(config, attachments = []) {
    if (!Array.isArray(attachments) || attachments.length > 8) throw new Error('每次最多发送8个附件。');
    const caps = attachmentCapabilities(config);
    let total = 0;
    let textSize = 0;
    for (const item of attachments) {
        const name = String(item?.name || '附件').slice(0, 120);
        if (!item || typeof item !== 'object') throw new Error('附件格式无效。');
        const kind = item.mediaType || 'text';
        const mime = String(item.mimeType || '').toLowerCase().split(';')[0];
        if (kind === 'file') throw new Error(`${name} 无法转换成文本，当前聊天接口不接收原始文档或压缩包。请先转为 TXT/Markdown 或复制文本。`);
        if (kind === 'text') {
            const extension = name.split('.').at(-1).toLowerCase();
            if ((!mime.startsWith('text/') && !TEXT_EXTENSIONS.has(extension) && !['application/json', 'application/xml', 'application/yaml', 'image/svg+xml'].includes(mime))
                || typeof item.content !== 'string' || item.content.includes('\u0000')) throw new Error(`${name} 不是可发送的文本文件，请先转换为文本。`);
            textSize += new TextEncoder().encode(item.content).length;
            if (textSize > 200000) throw new Error('附件文本总量超过200KB，请拆分后发送。');
            continue;
        }
        if (!['image', 'audio', 'video'].includes(kind) || !caps[kind]) {
            throw new Error(`${name}：当前提供商/模型未确认支持${kind === 'image' ? '图片' : kind === 'audio' ? '音频' : '视频'}输入。请切换支持的模型，或先转录/提取文本。未发送请求。`);
        }
        const allowed = kind === 'image' ? config.provider === 'google' ? GOOGLE_IMAGE_TYPES : IMAGE_TYPES : kind === 'audio' ? AUDIO_TYPES : VIDEO_TYPES;
        if (!allowed.has(mime) || typeof item.base64Data !== 'string' || !item.base64Data
            || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.base64Data) || item.base64Data.length % 4 !== 0 || item.truncated) {
            throw new Error(`${name}：文件类型、编码或大小不符合当前API要求，请转换格式后发送。`);
        }
        const bytes = item.base64Data.length * 3 / 4 - (item.base64Data.endsWith('==') ? 2 : item.base64Data.endsWith('=') ? 1 : 0);
        if (bytes > MAX_BINARY_BYTES || Number(item.size || 0) > MAX_BINARY_BYTES) throw new Error(`${name} 超过5MB，请压缩或拆分后发送。`);
        total += bytes;
        if (total > MAX_TOTAL_BYTES) throw new Error('二进制附件总量超过12MB，请拆分后发送。');
    }
}

// The provider boundary also validates multipart inputs supplied by callers
// outside the composer; unsupported data must never become a silent text stub.
export function assertProviderMessages(config, messages = []) {
    const attachments = [];
    for (const message of messages) {
        const parts = message.parts || message.content;
        if (!Array.isArray(parts)) continue;
        for (const part of parts) {
            if (part?.type === 'text' || typeof part?.text === 'string') continue;
            const google = config.provider === 'google';
            const anthropic = config.provider === 'anthropic';
            if (google ? !part?.inlineData : anthropic ? part?.type !== 'image' : part?.type !== 'image_url') {
                throw new Error('附件格式与当前API协议不匹配，请重新附加文件。');
            }
            if (part?.type === 'image_url') {
                const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(part.image_url?.url || '');
                if (!match) throw new Error('当前附件只允许已读取并验证的本地图片，不接受远程或未知图片地址。');
                attachments.push({ mediaType: 'image', mimeType: match[1], base64Data: match[2], name: 'image.png' });
            } else if (part?.type === 'image' && part.source?.type === 'base64') {
                attachments.push({ mediaType: 'image', mimeType: part.source.media_type, base64Data: part.source.data, name: 'image.png' });
            } else if (part?.inlineData) {
                const mime = String(part.inlineData.mimeType || '');
                attachments.push({ mediaType: mime.split('/')[0], mimeType: mime, base64Data: part.inlineData.data, name: 'media' });
            } else {
                throw new Error('当前API不支持此附件请求格式，请转换为文本或选择支持的模型。');
            }
        }
    }
    assertChatAttachments(config, attachments);
}
