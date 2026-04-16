import { invoke } from '@tauri-apps/api/core';

export async function searchWeb({
    query,
    maxResults = 6
} = {}) {
    return await invoke('search_web', {
        query,
        maxResults
    });
}

export function looksLikeWebSearchIntent(text = '') {
    const lowerText = String(text).toLowerCase();
    const keywords = [
        '联网搜索',
        '网页搜索',
        '搜索网页',
        '搜索一下',
        '网上',
        '互联网',
        '最新',
        '新闻',
        '官网',
        '资料',
        '行情',
        '天气',
        '汇率',
        '股价',
        'search web',
        'web search',
        'online search',
        'latest',
        'news',
        'official site'
    ];

    return keywords.some((keyword) => lowerText.includes(keyword));
}
