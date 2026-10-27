// Pure intent heuristics shared by the AI router and the web-search client.
// Kept dependency-free so the routing rules can be unit tested without Tauri.

export const URL_PATTERN = /https?:\/\/\S+/i;

// Bare domain like ciy.cool, example.com, sub.example.org
export const BARE_DOMAIN_PATTERN = /\b[a-z0-9-]+\.(?:com|cn|net|org|io|cool|app|dev|ai|tech|xyz|info|me|so|gg|cc|tv|us|uk|de|jp|fr|co|club|store|shop|site|online|top|art|live|run)\b/i;

// Keywords that unambiguously point at external, real-time or online information.
// Deliberately excludes generic words such as 今日 / 最新 / 资料 / 看一下 /
// 什么情况 — they appear all the time in task prompts ("生成今日任务",
// "看一下我的任务") and used to route task creation into web search.
const EXTERNAL_INFO_KEYWORDS = [
    '天气',
    '新闻',
    '官网',
    '行情',
    '汇率',
    '股价',
    '金价',
    '银价',
    '油价',
    '币价',
    '价格走势',
    '最新版本',
    '最新消息',
    '最新新闻',
    '最新价格',
    '最新资讯',
    '实时',
    '百科',
    'whois',
    'news',
    'weather',
    'exchange rate',
    'stock price',
    'latest news',
    'latest version',
    'current price'
];

// Explicit "go search the web" phrasing.
const EXPLICIT_SEARCH_KEYWORDS = [
    '联网搜索',
    '网页搜索',
    '搜索网页',
    '网上搜索',
    '在线搜索',
    '上网查',
    '网上查',
    '搜索一下',
    '搜一搜',
    '搜一下',
    '搜搜',
    '帮我搜',
    '查一查',
    '查一下',
    '查询一下',
    '访问网站',
    '打开网站',
    '打开网页',
    '有没有注册',
    '注册了没',
    '是否注册',
    '备案',
    'search web',
    'web search',
    'search the web',
    'search online',
    'online search',
    'look up',
    'search for',
    'google',
    'official site',
    'current price',
    'weather today'
];

export function mentionsUrlOrDomain(text = '') {
    const value = String(text || '');
    return URL_PATTERN.test(value) || BARE_DOMAIN_PATTERN.test(value);
}

export function hasExternalInfoKeyword(text = '') {
    const lowerText = String(text || '').toLowerCase();
    return EXTERNAL_INFO_KEYWORDS.some((keyword) => lowerText.includes(keyword));
}

/**
 * True when the user explicitly asks for an online lookup (search verb, URL,
 * domain, or a "联网/网上搜索" phrase). Used to allow web search to win over
 * project intent, and as the safe fallback when the AI router is unavailable.
 */
export function isExplicitWebSearchRequest(text = '') {
    const lowerText = String(text || '').toLowerCase();

    if (EXPLICIT_SEARCH_KEYWORDS.some((keyword) => lowerText.includes(keyword))) {
        return true;
    }
    if (mentionsUrlOrDomain(text)) {
        return true;
    }

    const searchPatterns = [
        /搜[一]?[搜下]/,
        /查[一]?[查下]/,
        /帮我[搜查找](?!索文件|找文件)/,
        /(访问|打开|查看|看看)\s*(网站|网页|网址)/,
        /(域名|whois).*(注册|备案)/
    ];
    return searchPatterns.some((pattern) => pattern.test(lowerText));
}

export function looksLikeWebSearchIntent(text = '') {
    const value = String(text || '');
    if (isExplicitWebSearchRequest(value)) {
        return true;
    }
    if (hasExternalInfoKeyword(value)) {
        return true;
    }
    return false;
}

const TASK_NOUN_PATTERN = /(任务|待办|看板|模板|定时|日程|子任务|清单|todo|task|kanban|template|checklist)/i;
const TASK_AUTHORING_VERB_PATTERN = /(生成|创建|新建|新增|添加|加入|安排|记录|补录|补充|录入|拆分|分解|规划|制定|整理|更新|修改|删除|完成|标记|归档|排期|重排|挪到|改到)|\b(generate|create|add|plan|organize|schedule|update|modify|delete|remove|complete|finish|mark)\b/i;

/**
 * Task creation / planning text such as "帮我生成今天的任务" or
 * "把下周的会议任务整理一下". These must reach the project router instead of
 * the web-search branch, even when they contain a search-ish word.
 */
export function looksLikeTaskAuthoringIntent(text = '') {
    const value = String(text || '');
    return TASK_NOUN_PATTERN.test(value) && TASK_AUTHORING_VERB_PATTERN.test(value);
}

/**
 * Web search must not hijack task generation. Explicit online lookups
 * (a URL, "联网搜索", weather/news/price queries) still take precedence.
 */
export function shouldSkipWebSearchForTaskText(text = '') {
    const value = String(text || '');
    if (!looksLikeTaskAuthoringIntent(value)) {
        return false;
    }
    if (mentionsUrlOrDomain(value)) {
        return false;
    }
    if (/(联网|网页搜索|网上搜索|在线搜索|上网|互联网|web\s*search|online\s*search|search\s+(the\s+)?web)/i.test(value)) {
        return false;
    }
    if (hasExternalInfoKeyword(value)) {
        return false;
    }
    return true;
}
