import { invoke } from '@tauri-apps/api/core';

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
    maxResults = 40
} = {}) {
    return await invoke('search_local_files', {
        root: root || null,
        query,
        maxResults
    });
}

export async function readLocalFile({
    path,
    maxBytes = 16000
} = {}) {
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
    return await invoke('delete_local_file', {
        path,
        trustedDirs: trustedDirectories
    });
}

export async function pickTrustedDirectory({
    defaultPath = ''
} = {}) {
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
