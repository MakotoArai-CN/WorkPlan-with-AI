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
        maxResults
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
        maxBytes
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

export async function pickLocalTextFiles() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
        multiple: true,
        filters: [
            {
                name: 'Text and code files',
                extensions: SUPPORTED_TEXT_FILE_EXTENSIONS
            }
        ]
    });

    if (!selected) return [];
    return Array.isArray(selected) ? selected : [selected];
}

export async function readSelectedTextFiles({
    paths = [],
    maxBytes = 128000
} = {}) {
    if (!Array.isArray(paths) || paths.length === 0) {
        return [];
    }
    return await invoke('read_selected_text_files', {
        paths,
        maxBytes
    });
}

export function looksLikeFileIntent(text = '') {
    const lowerText = String(text).toLowerCase();
    const keywords = [
        '文件',
        '目录',
        '文件夹',
        '路径',
        '读取',
        '打开文件',
        '扫描',
        '查找文件',
        '搜索文件',
        '列出',
        '写入',
        '写到',
        '保存到',
        '创建文件',
        '修改文件',
        '删除文件',
        '检查目录',
        '检查文件',
        '查看文件',
        '查看目录',
        '有什么文件',
        '有哪些文件',
        '文件内容',
        '文件列表',
        '当前目录',
        '工作目录',
        '写个文件',
        '写一个文件',
        '文本文件',
        '.txt',
        '.json',
        '.md',
        '.csv',
        '.log',
        'read file',
        'scan folder',
        'scan directory',
        'search file',
        'open file',
        'write file',
        'delete file',
        'list files',
        'list directory',
        'check directory',
        'file content',
        'workspace'
    ];

    if (keywords.some((keyword) => lowerText.includes(keyword))) {
        return true;
    }

    const pathPatterns = [
        /[a-z]:\\[^\s]+/i,
        /(?:^|\s)[.~]?\/[^\s]+/,
        /\w+\.\w{1,5}$/,
    ];
    return pathPatterns.some((pattern) => pattern.test(lowerText));
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

export async function pickMediaFiles() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
        multiple: true,
        filters: [
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
            },
            {
                name: 'All media',
                extensions: SUPPORTED_MEDIA_EXTENSIONS
            }
        ]
    });

    if (!selected) return [];
    return Array.isArray(selected) ? selected : [selected];
}

export async function readSelectedMediaFiles({
    paths = [],
    maxBytes = 10_000_000
} = {}) {
    if (!Array.isArray(paths) || paths.length === 0) {
        return [];
    }
    return await invoke('read_binary_files', {
        paths,
        maxBytes
    });
}

export async function pickAndReadMediaFiles({
    maxBytes = 10_000_000
} = {}) {
    const paths = await pickMediaFiles();
    if (paths.length === 0) return [];
    return await readSelectedMediaFiles({ paths, maxBytes });
}
