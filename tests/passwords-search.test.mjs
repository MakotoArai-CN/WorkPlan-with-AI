import { describe, test, expect } from 'bun:test';
import { matchesSearchQuery, toSearchText } from '../src/lib/utils/search-text.js';
import { filterPasswordEntries, PASSWORD_CATEGORY_ALL } from '../src/lib/utils/passwords-search.js';

describe('search text helpers', () => {
    test('treats missing values as empty strings', () => {
        expect(toSearchText(undefined)).toBe('');
        expect(toSearchText(null)).toBe('');
        expect(toSearchText(123)).toBe('123');
        expect(toSearchText('Vault')).toBe('Vault');
    });

    test('matches any candidate value and ignores an empty query', () => {
        expect(matchesSearchQuery([undefined, 'admin', undefined], 'ADM')).toBe(true);
        expect(matchesSearchQuery([undefined, undefined], 'adm')).toBe(false);
        expect(matchesSearchQuery([undefined, undefined], '')).toBe(true);
        expect(matchesSearchQuery(['GitHub'], '   ')).toBe(true);
    });
});

describe('password entry filtering', () => {
    // Regression: entries whose readable fields still live in the encrypted
    // `meta` blob have no title/username/url, and the old filter called
    // `.toLowerCase()` on them, throwing during render and freezing the app on
    // the previous view (reported as "密码管理器打不开，显示的是 AI 聊天").
    const entries = [
        { id: '1', title: 'GitHub', username: 'octocat', url: 'https://github.com', category: '工作' },
        { id: '2', meta: 'encrypted-blob', category: '工作' },
        { id: '3', title: 'Mail' },
        { id: '4', username: 'root', category: '服务器' },
        null
    ];

    test('does not throw on entries missing fields', () => {
        expect(() => filterPasswordEntries(entries, { query: 'git', category: PASSWORD_CATEGORY_ALL })).not.toThrow();
        expect(filterPasswordEntries(entries, { query: '', category: PASSWORD_CATEGORY_ALL })).toHaveLength(4);
    });

    test('searches title, username and url', () => {
        const ids = (query) => filterPasswordEntries(entries, { query }).map((entry) => entry.id);
        expect(ids('git')).toEqual(['1']);
        expect(ids('ROOT')).toEqual(['4']);
        expect(ids('github.com')).toEqual(['1']);
        expect(ids('nothing')).toEqual([]);
    });

    test('filters by category and tolerates bad input', () => {
        expect(filterPasswordEntries(entries, { category: '工作' }).map((entry) => entry.id)).toEqual(['1', '2']);
        expect(filterPasswordEntries(undefined, {})).toEqual([]);
        expect(filterPasswordEntries('nope', { query: 'x' })).toEqual([]);
    });
});
