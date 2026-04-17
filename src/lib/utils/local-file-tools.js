import { invoke } from '@tauri-apps/api/core';

export function getDefaultLocalFileConfig() {
    return {
        enabled: true,
        requireConfirmation: true,
        trustedDirectories: []
    };
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
