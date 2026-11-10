import { describe, test, expect } from 'bun:test';
import { isSeparatorRow, isTableRowLine, tableFromRow } from '../src/lib/utils/markdown-table.js';

describe('table row detection', () => {
    test('accepts typed rows', () => {
        expect(isTableRowLine('| 名称 | 数量 |')).toBe(true);
        expect(isTableRowLine('|a|b|')).toBe(true);
        expect(isTableRowLine('| a | b | c |')).toBe(true);
    });

    test('rejects separators, single cells and plain text', () => {
        expect(isTableRowLine('| --- | --- |')).toBe(false);
        expect(isTableRowLine('| :---: | ---: |')).toBe(false);
        expect(isTableRowLine('| 只有一列 |')).toBe(false);
        expect(isTableRowLine('普通文本')).toBe(false);
        expect(isTableRowLine('')).toBe(false);
    });

    test('separator detection is independent', () => {
        expect(isSeparatorRow('| --- | --- |')).toBe(true);
        expect(isSeparatorRow('| 名称 | 数量 |')).toBe(false);
    });
});

describe('tableFromRow', () => {
    test('expands into header, divider and body', () => {
        const lines = tableFromRow('| 名称 | 数量 |').split('\n');
        expect(lines).toHaveLength(3);
        expect(lines[0]).toBe('| 名称 | 数量 |');
        expect(lines[1]).toBe('| --- | --- |');
        expect(lines[2]).toBe('|    |    |');
    });

    test('trims padding and keeps three columns', () => {
        const lines = tableFromRow('|  任务  |  负责人  |  状态  |').split('\n');
        expect(lines[0]).toBe('| 任务 | 负责人 | 状态 |');
        expect(lines[1]).toBe('| --- | --- | --- |');
    });

    test('returns empty for non-rows', () => {
        expect(tableFromRow('')).toBe('');
        expect(tableFromRow('普通文本')).toBe('');
        expect(tableFromRow('| 单列 |')).toBe('');
    });
});
