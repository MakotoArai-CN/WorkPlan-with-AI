// Regression tests for the AI intent router. Task prompts used to be hijacked
// by the web-search branch ("生成今日任务" hit the 今日 keyword), and even when
// the router explicitly answered "no search needed" the code fell back to a
// web search. Pin both directions: task authoring stays in the task router,
// real online lookups still search.
import { describe, test, expect } from 'bun:test';
import {
    isExplicitWebSearchRequest,
    looksLikeTaskAuthoringIntent,
    looksLikeWebSearchIntent,
    mentionsUrlOrDomain,
    shouldSkipWebSearchForTaskText
} from '../src/lib/utils/intent-heuristics.js';

describe('looksLikeTaskAuthoringIntent', () => {
    test('detects task generation and planning prompts', () => {
        const prompts = [
            '帮我生成今天的任务',
            '生成今日任务清单',
            '根据这段会议纪要生成任务',
            '创建几个待办',
            '把下周的任务整理一下',
            '添加一个任务：周五提交周报',
            '规划一下本周的日程'
        ];
        for (const prompt of prompts) {
            expect(looksLikeTaskAuthoringIntent(prompt)).toBe(true);
        }
    });

    test('does not fire on unrelated chat', () => {
        expect(looksLikeTaskAuthoringIntent('今天天气怎么样')).toBe(false);
        expect(looksLikeTaskAuthoringIntent('帮我写一段代码')).toBe(false);
    });

    test('detects English task authoring prompts', () => {
        expect(looksLikeTaskAuthoringIntent('generate tasks for today')).toBe(true);
        expect(looksLikeTaskAuthoringIntent('create a todo for the meeting')).toBe(true);
        expect(looksLikeTaskAuthoringIntent('what is the weather today')).toBe(false);
    });
});

describe('web search intent', () => {
    test('task authoring is not treated as a web search', () => {
        const prompts = [
            '帮我生成今天的任务',
            '生成今日任务清单',
            '整理一下最新任务'
        ];
        for (const prompt of prompts) {
            expect(looksLikeWebSearchIntent(prompt)).toBe(false);
            expect(shouldSkipWebSearchForTaskText(prompt)).toBe(true);
        }
    });

    test('task status questions are not web searches either', () => {
        for (const prompt of ['任务进度什么情况', '我的任务怎么回事']) {
            expect(looksLikeWebSearchIntent(prompt)).toBe(false);
        }
    });

    test('explicit online lookups still search', () => {
        const prompts = [
            '搜索一下最新的 AI 新闻',
            '帮我查一下今天上海的天气',
            '访问网站 example.com 看看',
            'https://g4f.dev 是什么',
            '今天股价行情怎么样',
            '联网搜索任务管理最佳实践',
            "what's the latest AI news",
            'search the web for the latest AI news'
        ];
        for (const prompt of prompts) {
            expect(looksLikeWebSearchIntent(prompt)).toBe(true);
            expect(shouldSkipWebSearchForTaskText(prompt)).toBe(false);
        }
    });

    test('task text with an explicit URL is not blocked', () => {
        const prompt = '参考 https://example.com/spec 生成任务';
        expect(mentionsUrlOrDomain(prompt)).toBe(true);
        expect(shouldSkipWebSearchForTaskText(prompt)).toBe(false);
    });

    test('task text asking for a latest external resource is not blocked', () => {
        const prompt = '搜索一下任务模板的最新版本';
        expect(looksLikeWebSearchIntent(prompt)).toBe(true);
        expect(shouldSkipWebSearchForTaskText(prompt)).toBe(false);
    });

    test('explicit search detection needs a concrete signal', () => {
        expect(isExplicitWebSearchRequest('查一下我的任务')).toBe(true);
        expect(isExplicitWebSearchRequest('帮我生成今天的任务')).toBe(false);
        expect(isExplicitWebSearchRequest('生成今日任务清单')).toBe(false);
        expect(isExplicitWebSearchRequest('search the web for the latest AI news')).toBe(true);
        expect(isExplicitWebSearchRequest('generate tasks for today')).toBe(false);
    });
});
