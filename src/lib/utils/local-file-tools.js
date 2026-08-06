import { invoke } from '@tauri-apps/api/core';
import { isAndroidRuntime } from './runtime.js';

export const SUPPORTED_TEXT_FILE_EXTENSIONS = [
    'txt',
    'md',
    'markdown',
    'json',
    'json5',
    'js',
    'mjs',
    'cjs',
    'ts',
    'jsx',
    'tsx',
    'svelte',
    'html',
    'css',
    'scss',
    'sass',
    'less',
    'yml',
    'yaml',
    'toml',
    'xml',
    'csv',
    'log',
    'sql',
    'rs',
    'py',
    'java',
    'kt',
    'kts',
    'sh',
    'bat',
    'ps1',
    'env',
    'ini',
    'conf',
    'properties'
];

export const SUPPORTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'];
export const SUPPORTED_AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'];
export const SUPPORTED_VIDEO_EXTENSIONS = ['mp4', 'webm', 'avi', 'mov', 'mkv'];
export const SUPPORTED_MEDIA_EXTENSIONS = [
    ...SUPPORTED_IMAGE_EXTENSIONS,
    ...SUPPORTED_AUDIO_EXTENSIONS,
    ...SUPPORTED_VIDEO_EXTENSIONS
];

export function getDefaultLocalFileConfig() {
    return {
        enabled: true,
        requireConfirmation: true,
        trustedDirectories: []
    };
}

export function isContentUri(path = '') {
    return String(path || '').startsWith('content://');
}

function getAndroidBridge() {
    if (typeof window === 'undefined' || !isAndroidRuntime()) return null;
    return window.WorkPlanAndroid || null;
}

function parseAndroidBridgeResult(raw) {
    const result = JSON.parse(String(raw || '{}'));
    if (!result.ok) {
        throw new Error(result.error || 'Android file operation failed');
    }
    return result;
}

function contentTrustedDirectories(trustedDirectories = []) {
    return (trustedDirectories || []).filter(isContentUri);
}

function normalizeRelativePath(path = '') {
    return String(path || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .trim();
}

function decodeUriPart(value = '') {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function getAndroidTreeDocumentId(rootUri = '') {
    const match = String(rootUri || '').match(/\/tree\/([^/?#]+)/);
    return match ? decodeUriPart(match[1]) : '';
}

function getAndroidTreeRootPath(rootUri = '') {
    const documentId = getAndroidTreeDocumentId(rootUri);
    if (!documentId) return '';

    if (documentId.startsWith('primary:')) {
        return normalizeRelativePath(documentId.slice('primary:'.length));
    }

    if (documentId.startsWith('home:')) {
        return normalizeRelativePath(`Documents/${documentId.slice('home:'.length)}`);
    }

    const colonIndex = documentId.indexOf(':');
    return normalizeRelativePath(colonIndex >= 0 ? documentId.slice(colonIndex + 1) : documentId);
}

function stripAndroidExternalStoragePrefix(path = '') {
    const normalized = normalizeRelativePath(path);
    const lower = normalized.toLowerCase();
    const prefixes = [
        'storage/emulated/0/',
        'storage/self/primary/',
        'mnt/sdcard/',
        'sdcard/'
    ];

    for (const prefix of prefixes) {
        if (lower.startsWith(prefix)) {
            return normalized.slice(prefix.length);
        }
    }

    if (lower === 'storage/emulated/0' || lower === 'storage/self/primary' || lower === 'mnt/sdcard' || lower === 'sdcard') {
        return '';
    }

    return normalized;
}

function stripAuthorizedTreeRoot(path = '', rootUri = '') {
    const normalized = normalizeRelativePath(path);
    const treeRoot = getAndroidTreeRootPath(rootUri);
    if (!treeRoot) return normalized;

    const lowerPath = normalized.toLowerCase();
    const lowerRoot = treeRoot.toLowerCase();
    if (lowerPath === lowerRoot) return '';
    if (lowerPath.startsWith(`${lowerRoot}/`)) {
        return normalized.slice(treeRoot.length + 1);
    }

    return normalized;
}

function androidTreeRelativePathCandidates(path = '', rootUri = '', { includeEmpty = false } = {}) {
    const candidates = [];
    const add = (value) => {
        const normalized = normalizeRelativePath(value);
        if (!normalized && !includeEmpty) return;
        if (!candidates.includes(normalized)) {
            candidates.push(normalized);
        }
    };

    const strippedExternalPath = stripAndroidExternalStoragePrefix(path);
    add(stripAuthorizedTreeRoot(strippedExternalPath, rootUri));
    add(stripAuthorizedTreeRoot(path, rootUri));
    add(strippedExternalPath);
    add(path);

    return candidates;
}

export function isPathCoveredByContentTree(path = '', rootUri = '') {
    if (!isContentUri(rootUri) || isContentUri(path)) return false;

    const treeRoot = getAndroidTreeRootPath(rootUri);
    const normalizedPath = stripAndroidExternalStoragePrefix(path);
    if (!treeRoot) {
        return Boolean(normalizedPath || String(path || '').trim());
    }

    const lowerPath = normalizedPath.toLowerCase();
    const lowerRoot = treeRoot.toLowerCase();
    return lowerPath === lowerRoot || lowerPath.startsWith(`${lowerRoot}/`);
}

export async function requestAndroidStoragePermissions() {
    const bridge = getAndroidBridge();
    if (!bridge?.requestStoragePermissions) return false;
    bridge.requestStoragePermissions();
    return true;
}

export async function getAndroidStoragePermissionStatus() {
    const bridge = getAndroidBridge();
    if (!bridge?.getStoragePermissionStatus) {
        return { available: false, granted: false, missing: [] };
    }

    try {
        const result = parseAndroidBridgeResult(bridge.getStoragePermissionStatus());
        return {
            available: true,
            granted: Boolean(result.granted),
            partial: Boolean(result.partial),
            missing: Array.isArray(result.missing) ? result.missing : []
        };
    } catch {
        return { available: false, granted: false, missing: [] };
    }
}

export async function getWorkspaceRoot() {
    try {
        return await invoke('get_workspace_root');
    } catch (error) {
        console.warn('Failed to resolve workspace root:', error);
        return '';
    }
}

export async function searchLocalFiles({
    root = '',
    query = '',
    maxResults = 40,
    trustedDirectories = []
} = {}) {
    const bridge = getAndroidBridge();
    const contentRoots = root
        ? (isContentUri(root) ? [root] : [])
        : contentTrustedDirectories(trustedDirectories);

    if (bridge?.searchTree && contentRoots.length > 0) {
        const entries = [];
        for (const contentRoot of contentRoots) {
            const relativeRoots = root && !isContentUri(root)
                ? androidTreeRelativePathCandidates(root, contentRoot, { includeEmpty: true })
                : [''];

            for (const relativeRoot of relativeRoots) {
                try {
                    const result = parseAndroidBridgeResult(
                        relativeRoot && bridge.searchTreeInTree
                            ? bridge.searchTreeInTree(contentRoot, relativeRoot, query || '', maxResults)
                            : bridge.searchTree(contentRoot, query || '', maxResults)
                    );
                    entries.push(...(result.entries || []));
                    break;
                } catch {
                    // Try the next relative root form for this authorized tree.
                }
            }

            if (entries.length >= maxResults) break;
        }
        return entries.slice(0, maxResults);
    }

    return await invoke('search_local_files', {
        root: root || null,
        query,
        maxResults,
        trustedDirs: trustedDirectories
    });
}

export async function readLocalFile({
    path,
    maxBytes = 16000,
    trustedDirectories = []
} = {}) {
    const bridge = getAndroidBridge();
    if (bridge?.readTextFile && isContentUri(path)) {
        return parseAndroidBridgeResult(bridge.readTextFile(path, maxBytes));
    }

    if (bridge?.readTextFileInTree) {
        for (const root of contentTrustedDirectories(trustedDirectories)) {
            for (const relativePath of androidTreeRelativePathCandidates(path, root)) {
                try {
                    return parseAndroidBridgeResult(
                        bridge.readTextFileInTree(root, relativePath, maxBytes)
                    );
                } catch {
                    // Try the next path form or authorized tree.
                }
            }
        }
    }

    return await invoke('read_local_file', {
        path,
        maxBytes,
        trustedDirs: trustedDirectories
    });
}

export async function writeLocalFile({
    path,
    content,
    trustedDirectories = []
} = {}) {
    const bridge = getAndroidBridge();
    if (bridge?.writeTextFile && isContentUri(path)) {
        return parseAndroidBridgeResult(bridge.writeTextFile(path, content || ''));
    }

    if (bridge?.writeTextFileInTree) {
        for (const root of contentTrustedDirectories(trustedDirectories)) {
            for (const relativePath of androidTreeRelativePathCandidates(path, root)) {
                if (!relativePath) continue;
                try {
                    return parseAndroidBridgeResult(
                        bridge.writeTextFileInTree(root, relativePath, content || '')
                    );
                } catch {
                    // Try the next path form or authorized tree.
                }
            }
        }
    }

    return await invoke('write_local_file', {
        path,
        content,
        trustedDirs: trustedDirectories
    });
}

export async function deleteLocalFile({
    path,
    trustedDirectories = []
} = {}) {
    const bridge = getAndroidBridge();
    if (bridge?.deleteDocument && isContentUri(path)) {
        return parseAndroidBridgeResult(bridge.deleteDocument(path));
    }

    if (bridge?.deleteDocumentInTree) {
        for (const root of contentTrustedDirectories(trustedDirectories)) {
            for (const relativePath of androidTreeRelativePathCandidates(path, root)) {
                try {
                    return parseAndroidBridgeResult(
                        bridge.deleteDocumentInTree(root, relativePath)
                    );
                } catch {
                    // Try the next path form or authorized tree.
                }
            }
        }
    }

    return await invoke('delete_local_file', {
        path,
        trustedDirs: trustedDirectories
    });
}

export async function pickTrustedDirectory({
    defaultPath = ''
} = {}) {
    const bridge = getAndroidBridge();
    if (bridge?.openDirectoryPicker) {
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error('Directory authorization timed out'));
            }, 120000);
            const cleanup = () => {
                clearTimeout(timer);
                window.removeEventListener('workplan-android-directory-picked', onPicked);
            };
            const onPicked = (event) => {
                cleanup();
                resolve(event.detail?.uri || '');
            };
            window.addEventListener('workplan-android-directory-picked', onPicked, { once: true });
            bridge.openDirectoryPicker();
        });
    }

    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
        directory: true,
        multiple: false,
        recursive: true,
        defaultPath: defaultPath || undefined
    });
    return typeof selected === 'string' ? selected : '';
}

// The picker runs in the Rust backend so that the user's selection is recorded there
// as the read authorization. Picking in the webview and handing paths back would let
// any caller of read_selected_text_files (including AI-generated execution plans)
// read arbitrary files.
export async function pickLocalTextFiles() {
    return await invoke('pick_files_for_read', {
        filters: [
            {
                name: 'Text and code files',
                extensions: SUPPORTED_TEXT_FILE_EXTENSIONS
            }
        ]
    });
}

export async function readSelectedTextFiles({
    paths = [],
    maxBytes = 128000,
    trustedDirectories = []
} = {}) {
    if (!Array.isArray(paths) || paths.length === 0) {
        return [];
    }
    return await invoke('read_selected_text_files', {
        paths,
        maxBytes,
        trustedDirs: trustedDirectories
    });
}

// 已知文件扩展名白名单（文本 + 媒体 + 常见文档/压缩），用于"强信号"文件意图判定。
const KNOWN_FILE_EXTENSIONS = [
    ...SUPPORTED_TEXT_FILE_EXTENSIONS,
    ...SUPPORTED_MEDIA_EXTENSIONS,
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'gz', 'tar'
];
// 匹配 ".md" / ".json" 等真实扩展名，且后面不接更多字母数字，避免 "v1.2"、"等3.0" 之类误判。
const KNOWN_FILE_EXTENSION_PATTERN = new RegExp(
    '\\.(?:' + KNOWN_FILE_EXTENSIONS.join('|') + ')(?![a-z0-9])',
    'i'
);
const FILE_ACTION_VERBS_ZH = '读取|读一下|读出|打开|写入|写到|保存到|保存为|新建|创建|修改|覆盖|追加|删除|移除|扫描|列出|查找|搜索|查看|检查';
const FILE_NOUNS_ZH = '文件|文件夹|目录|路径';
// "操作动词 + (≤4 个非标点字符) + 文件名词" 紧邻搭配，如「读取文件」「打开这个目录」；
// 像「修改**错别字/文件」这类动词与名词间隔过远的描述句不会命中。
const FILE_VERB_NOUN_PATTERN_ZH = new RegExp(
    '(?:' + FILE_ACTION_VERBS_ZH + ')[^，。；、\\s]{0,4}(?:' + FILE_NOUNS_ZH + ')'
);
const FILE_VERB_NOUN_PATTERN_EN = /\b(?:read|open|write|save|create|modify|edit|delete|remove|scan|list|search|view|check)\b[^.,;\n]{0,12}\b(?:files?|folders?|director(?:y|ies)|paths?)\b/i;
// 必须包含分隔符的路径 token：Windows 盘符路径、含多级的 POSIX 路径、./ 或 ../ 相对路径。
const STRICT_PATH_PATTERNS = [
    /[a-z]:[\\/][^\s"'`，。；、]+/i,
    /(?:^|[\s(])[.~]?\/[^\s"'`，。；、)]+\/[^\s"'`，。；、)]*/,
    /(?:^|[\s(])\.{1,2}\/[^\s"'`，。；、)]+/
];
const WORKSPACE_HINT_PATTERN = /(?:工作目录|工作区|当前目录|workspace)/i;
const WORKSPACE_ACTION_PATTERN = new RegExp(
    '(?:' + FILE_ACTION_VERBS_ZH + '|read|open|write|save|create|scan|list|search)',
    'i'
);

function extractQuotedFileSegment(text = '') {
    const patterns = [/`([^`]+)`/, /“([^”]+)”/, /"([^"]+)"/, /'([^']+)'/];
    for (const pattern of patterns) {
        const match = String(text).match(pattern);
        if (match?.[1]?.trim()) return match[1].trim();
    }
    return '';
}

// 仅当出现"强信号"时才判定为本地文件意图，避免「需要修改错别字/文件」这类描述句被误判。
export function looksLikeFileIntent(text = '') {
    const raw = String(text || '');
    const lowerText = raw.toLowerCase();

    // 1) 明确的路径 token（必须含分隔符）
    if (STRICT_PATH_PATTERNS.some((pattern) => pattern.test(raw))) {
        return true;
    }

    // 2) 带已知扩展名的文件名，如 report.md、data.json
    if (KNOWN_FILE_EXTENSION_PATTERN.test(raw)) {
        return true;
    }

    // 3) 引号包裹且内含路径分隔符或已知扩展名
    const quoted = extractQuotedFileSegment(raw);
    if (quoted && (/[\\/]/.test(quoted) || KNOWN_FILE_EXTENSION_PATTERN.test(quoted))) {
        return true;
    }

    // 4) "操作动词 + 文件名词"紧邻搭配（中/英）
    if (FILE_VERB_NOUN_PATTERN_ZH.test(raw) || FILE_VERB_NOUN_PATTERN_EN.test(lowerText)) {
        return true;
    }

    // 5) 明确的工作目录/工作区 + 操作动词
    if (WORKSPACE_HINT_PATTERN.test(raw) && WORKSPACE_ACTION_PATTERN.test(raw)) {
        return true;
    }

    return false;
}

export function getMediaType(ext = '') {
    const lower = ext.toLowerCase().replace(/^\./, '');
    if (SUPPORTED_IMAGE_EXTENSIONS.includes(lower)) return 'image';
    if (SUPPORTED_AUDIO_EXTENSIONS.includes(lower)) return 'audio';
    if (SUPPORTED_VIDEO_EXTENSIONS.includes(lower)) return 'video';
    return null;
}

export function getFileExtension(path = '') {
    const name = String(path).split(/[/\\]/).pop() || '';
    const dotIndex = name.lastIndexOf('.');
    return dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : '';
}

const TEXT_MIME_TYPES = new Set([
    'application/json',
    'application/ld+json',
    'application/xml',
    'application/x-sh',
    'application/x-shellscript',
    'application/x-yaml',
    'application/yaml',
    'image/svg+xml'
]);

function guessExtensionFromMimeType(mimeType = '') {
    const normalized = String(mimeType || '').toLowerCase();
    if (!normalized) return '';
    if (normalized === 'image/jpeg') return 'jpg';
    if (normalized === 'image/png') return 'png';
    if (normalized === 'image/gif') return 'gif';
    if (normalized === 'image/webp') return 'webp';
    if (normalized === 'image/bmp') return 'bmp';
    if (normalized === 'image/svg+xml') return 'svg';
    if (normalized === 'audio/mpeg') return 'mp3';
    if (normalized === 'audio/wav') return 'wav';
    if (normalized === 'audio/ogg') return 'ogg';
    if (normalized === 'video/mp4') return 'mp4';
    if (normalized === 'video/webm') return 'webm';
    if (normalized === 'application/json') return 'json';
    if (normalized === 'text/markdown') return 'md';
    if (normalized.startsWith('text/')) return 'txt';
    return '';
}

function getSafePastedFileName(file, index = 0) {
    const rawName = String(file?.name || '').trim();
    if (rawName) return rawName;

    const ext = guessExtensionFromMimeType(file?.type) || 'bin';
    return `pasted-file-${index + 1}.${ext}`;
}

function isPastedTextFile(file, name = '') {
    const mimeType = String(file?.type || '').toLowerCase();
    const ext = getFileExtension(name);
    return SUPPORTED_TEXT_FILE_EXTENSIONS.includes(ext) ||
        mimeType.startsWith('text/') ||
        TEXT_MIME_TYPES.has(mimeType);
}

function getPastedMediaType(file, name = '') {
    const mimeType = String(file?.type || '').toLowerCase();
    const ext = getFileExtension(name);
    return getMediaType(ext) ||
        (mimeType.startsWith('image/') ? 'image' : null) ||
        (mimeType.startsWith('audio/') ? 'audio' : null) ||
        (mimeType.startsWith('video/') ? 'video' : null);
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

function getPastedAttachmentPath(file, name, index = 0) {
    const encodedName = encodeURIComponent(name || `file-${index + 1}`);
    const size = Number(file?.size || 0);
    const modified = Number(file?.lastModified || Date.now());
    return `clipboard://${encodedName}?size=${size}&modified=${modified}&index=${index}`;
}

export async function readPastedFilesAsAttachments(fileList, {
    textMaxBytes = 96000,
    mediaMaxBytes = 10_000_000
} = {}) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length === 0) {
        return [];
    }

    const attachments = [];
    for (const [index, file] of files.entries()) {
        const name = getSafePastedFileName(file, index);
        const mimeType = String(file.type || '');
        const size = Number(file.size || 0);
        const path = getPastedAttachmentPath(file, name, index);
        const base = {
            path,
            name,
            size,
            mimeType,
            truncated: false
        };

        if (isPastedTextFile(file, name)) {
            const limit = Math.max(1024, Number(textMaxBytes || 96000));
            const truncated = size > limit;
            const blob = truncated ? file.slice(0, limit) : file;
            attachments.push({
                ...base,
                content: await blob.text(),
                truncated,
                mediaType: 'text'
            });
            continue;
        }

        const mediaType = getPastedMediaType(file, name);
        if (mediaType) {
            const limit = Math.max(1024, Number(mediaMaxBytes || 10_000_000));
            const truncated = size > limit;
            let base64Data = '';
            let thumbnailUrl = '';
            if (!truncated) {
                base64Data = arrayBufferToBase64(await file.arrayBuffer());
                if (mediaType === 'image' && base64Data) {
                    thumbnailUrl = `data:${mimeType || 'application/octet-stream'};base64,${base64Data}`;
                }
            }
            attachments.push({
                ...base,
                content: truncated ? '（文件过大，未读取二进制内容）' : '',
                truncated,
                mediaType,
                base64Data,
                thumbnailUrl
            });
            continue;
        }

        attachments.push({
            ...base,
            content: '（此文件类型无法自动读取内容，仅作为文件附件接收。）',
            mediaType: 'file'
        });
    }

    return attachments;
}

export async function pickMediaFiles() {
    return await invoke('pick_files_for_read', {
        filters: [
            {
                name: 'All media',
                extensions: SUPPORTED_MEDIA_EXTENSIONS
            },
            {
                name: 'Images',
                extensions: SUPPORTED_IMAGE_EXTENSIONS
            },
            {
                name: 'Audio',
                extensions: SUPPORTED_AUDIO_EXTENSIONS
            },
            {
                name: 'Video',
                extensions: SUPPORTED_VIDEO_EXTENSIONS
            }
        ]
    });
}

export async function readSelectedMediaFiles({
    paths = [],
    maxBytes = 10_000_000,
    trustedDirectories = []
} = {}) {
    if (!Array.isArray(paths) || paths.length === 0) {
        return [];
    }
    return await invoke('read_binary_files', {
        paths,
        maxBytes,
        trustedDirs: trustedDirectories
    });
}

export async function pickAndReadMediaFiles({
    maxBytes = 10_000_000
} = {}) {
    const paths = await pickMediaFiles();
    if (paths.length === 0) return [];
    return await readSelectedMediaFiles({ paths, maxBytes });
}
