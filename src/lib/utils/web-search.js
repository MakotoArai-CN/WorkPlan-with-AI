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
        '搜一搜',
        '搜一下',
        '搜搜',
        '帮我搜',
        '查一查',
        '查一下',
        '查询一下',
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
        '金价',
        '银价',
        '油价',
        '币价',
        '价格走势',
        '实时',
        '今日',
        '百科',
        '怎么回事',
        '什么情况',
        '访问网站',
        '打开网站',
        '打开网页',
        '看一下',
        '域名',
        'whois',
        '有没有注册',
        '注册了没',
        '是否注册',
        '备案',
        'search web',
        'web search',
        'online search',
        'look up',
        'search for',
        'google',
        'latest',
        'news',
        'official site',
        'current price',
        'weather today'
    ];

    if (keywords.some((keyword) => lowerText.includes(keyword))) {
        return true;
    }

    if (/https?:\/\/\S+/i.test(lowerText)) {
        return true;
    }

    // bare domain like ciy.cool, example.com, sub.example.org
    if (/\b[a-z0-9-]+\.(?:com|cn|net|org|io|cool|app|dev|ai|tech|xyz|info|me|so|gg|cc|tv|us|uk|de|jp|fr|co|club|store|shop|site|online|top|art|live|run)\b/i.test(lowerText)) {
        return true;
    }

    const searchPatterns = [
        /搜[一]?[搜下]/,
        /查[一]?[查下]/,
        /帮我[搜查找](?!索文件|找文件)/,
        /(访问|打开|查看|看看)\s*(网站|网页)/,
        /(域名|whois).*(注册|备案)/,
    ];
    return searchPatterns.some((pattern) => pattern.test(lowerText));
}

export async function fetchWebContent(url, maxChars = 4000) {
    try {
        return await invoke('fetch_web_content', { url, maxChars });
    } catch (error) {
        console.warn('fetchWebContent failed:', url, error);
        return null;
    }
}
