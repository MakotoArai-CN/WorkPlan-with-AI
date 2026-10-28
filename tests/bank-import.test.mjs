import { describe, expect, test } from 'bun:test';
import {
    detectPreset,
    getSalaryGrowth,
    isSalaryDescription,
    mapTransactions,
    parseCsv,
    suggestMapping
} from '../src/lib/utils/bank-import.js';

describe('bank CSV import', () => {
    test('parses quoted cells and finds the header after preamble rows', () => {
        const csv = '工商银行账户明细\n导出时间,2026-10-28\n交易日期,摘要,交易金额,余额\n2026-10-15,"代发工资, 10月",10500.00,"1,234.56"\n2026-10-20,消费,-25.00,1209.56\n';
        const parsed = parseCsv(csv);
        expect(parsed.headers).toEqual(['交易日期', '摘要', '交易金额', '余额']);
        expect(parsed.rows).toHaveLength(2);
        expect(parsed.rows[0][1]).toBe('代发工资, 10月');
    });

    test('detects Chinese bank presets and maps date/amount/description', () => {
        const headers = ['交易日期', '摘要', '交易金额', '余额'];
        expect(detectPreset(headers)).toBe('icbc');
        const mapping = suggestMapping(headers, 'icbc');
        expect(mapping).toMatchObject({ date: 0, amount: 2, description: 1 });
        const rows = [['2026/10/15', '工资代发', '10,500.00', '0']];
        expect(mapTransactions(rows, headers, mapping)).toEqual([{
            date: '2026-10-15',
            amount: 10500,
            description: '工资代发'
        }]);
    });

    test('supports separate income and expense columns', () => {
        const headers = ['交易日期', '交易类型', '收入', '支出', '备注'];
        expect(detectPreset(headers)).toBe('cmb');
        const mapping = suggestMapping(headers, 'cmb');
        const rows = [['20261015', '工资', '8000', '0', '10月工资']];
        expect(mapTransactions(rows, headers, mapping)[0]).toMatchObject({ date: '2026-10-15', amount: 8000 });
    });

    test('recognizes salary rows and computes growth', () => {
        expect(isSalaryDescription('代发工资')).toBe(true);
        expect(isSalaryDescription('超市消费')).toBe(false);
        const growth = getSalaryGrowth([
            { periodEnd: '2026-01-15', amount: 8000 },
            { periodEnd: '2026-06-15', amount: 9000 },
            { periodEnd: '2026-10-15', amount: 10500 }
        ]);
        expect(growth.difference).toBe(2500);
        expect(growth.percent).toBe(31.25);
        expect(growth.rows[2].change).toBe(1500);
        expect(growth.rows[2].changePercent).toBe(16.67);
    });
});
