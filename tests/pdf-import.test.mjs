import { describe, expect, test } from 'bun:test';
import { parseIcbcStatementText } from '../src/lib/utils/pdf-import.js';
import { isSalaryDescription, mapTransactions, suggestMapping } from '../src/lib/utils/bank-import.js';

const sample = `中国工商银行借记账户历史明细（电子版）
2023-12-15
17:43:47   2502012001016208002   活期   00000   人民币   钞   工资   2502   +1,636.00   1,636.00   网上银行
2023-12-16
08:15:53   2502012001016208002   活期   00000   人民币   钞   消费   2502   -818.00   818.00   快捷支付
2026-10-15
18:00:00   2502012001016208002   活期   00000   人民币   钞   工资   2502   +4,313.00   9,999.00   网上银行
本页支出算术合计：4,072.00
`;

describe('ICBC PDF statement parser', () => {
    test('extracts dated transactions and signed amounts', () => {
        const parsed = parseIcbcStatementText(sample);
        expect(parsed.headers).toEqual(['交易日期', '摘要', '交易金额']);
        expect(parsed.rows).toHaveLength(3);
        expect(parsed.rows[0]).toEqual(['2023-12-15', '工资', '1636']);
        expect(parsed.rows[1]).toEqual(['2023-12-16', '消费', '-818']);
        expect(parsed.rows[2]).toEqual(['2026-10-15', '工资', '4313']);
    });

    test('plugs into the existing bank-import mapping/preview pipeline', () => {
        const parsed = parseIcbcStatementText(sample);
        const mapping = suggestMapping(parsed.headers, 'icbc');
        const transactions = mapTransactions(parsed.rows, parsed.headers, mapping);
        expect(transactions.length).toBe(3);
        expect(transactions.filter(item => isSalaryDescription(item.description))).toHaveLength(2);
        expect(transactions.find(item => item.date === '2026-10-15').amount).toBe(4313);
    });

    test('handles a date and time printed on the same line', () => {
        const parsed = parseIcbcStatementText(
            '2026-10-15 18:00:00   2502012001016208002   活期   00000   人民币   钞   工资   2502   +4,313.00   9,999.00   网上银行'
        );
        expect(parsed.rows).toEqual([['2026-10-15', '工资', '4313']]);
    });
});
