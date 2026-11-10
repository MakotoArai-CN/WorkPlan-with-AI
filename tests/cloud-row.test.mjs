import { describe, test, expect } from 'bun:test';
import { firstRow, rowCount } from '../src/lib/utils/cloud-row.js';

describe('cloud row selection', () => {
    // Regression: `.maybeSingle()` still errors with
    // "JSON object requested, multiple (or no) rows returned" when the table
    // holds 0 or >1 rows, which is exactly what users hit when enabling
    // password cloud sync. Queries now ask for an array.
    test('no remote record yet yields null, not an error', () => {
        expect(firstRow([])).toBeNull();
        expect(firstRow(null)).toBeNull();
        expect(firstRow(undefined)).toBeNull();
        expect(rowCount([])).toBe(0);
    });

    test('a single row is unwrapped', () => {
        const row = { id: 'r1', content: '{}' };
        expect(firstRow([row])).toBe(row);
        expect(firstRow(row)).toBe(row);
        expect(rowCount([row])).toBe(1);
    });

    test('duplicated rows are tolerated instead of throwing', () => {
        const rows = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
        expect(firstRow(rows)).toEqual({ id: 'r1' });
        expect(rowCount(rows)).toBe(3);
    });
});
