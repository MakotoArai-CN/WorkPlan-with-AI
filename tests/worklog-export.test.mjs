import { describe, expect, mock, test } from 'bun:test';

mock.module('../src/lib/utils/export.js', () => ({
    exportToCSV: async () => ({ success: true }),
    exportToExcel: async () => ({ success: true }),
    exportToJSON: async () => ({ success: true })
}));

const {
    BOSS_FIELDS,
    BOSS_LEAVE_FIELDS,
    buildWorklogRows,
    filterWorklogRecords
} = await import('../src/lib/utils/worklog-export.js');

describe('worklog export scopes', () => {
    const overtime = [
        { date: '2026-09-30', start: '18:00', end: '20:00', hours: 2, type: 'weekday', compensation: 'pay' },
        { date: '2026-10-20', start: '18:00', end: '21:00', hours: 3, type: 'weekday', compensation: 'pay' },
        { date: '2026-11-01', start: '09:00', end: '12:00', hours: 3, type: 'weekend', compensation: 'pay' }
    ];

    test('filters overtime by month or year', () => {
        expect(filterWorklogRecords('overtime', overtime, 'month', 2026, 10)).toHaveLength(1);
        expect(filterWorklogRecords('overtime', overtime, 'year', 2026)).toHaveLength(3);
        expect(filterWorklogRecords('overtime', overtime, 'all', 2026, 10)).toHaveLength(3);
    });

    test('includes leave records that overlap the selected month', () => {
        const leave = [
            { startDate: '2026-09-29', endDate: '2026-10-02', duration: 4, type: 'annual', paid: true },
            { startDate: '2026-11-03', endDate: '2026-11-03', duration: 1, type: 'personal', paid: false }
        ];
        expect(filterWorklogRecords('leave', leave, 'month', 2026, 10)).toHaveLength(1);
        expect(filterWorklogRecords('leave', leave, 'month', 2026, 11)).toHaveLength(1);
    });

    test('clean preset excludes salary and kind columns', () => {
        expect(BOSS_FIELDS).toEqual(['date', 'hours', 'note']);
        expect(BOSS_LEAVE_FIELDS).toEqual(['startDate', 'endDate', 'duration', 'note']);
        expect(BOSS_FIELDS).not.toContain('pay');
        expect(BOSS_FIELDS).not.toContain('kind');
    });

    test('builds rows with the selected clean fields', () => {
        const rows = buildWorklogRows('overtime', overtime.slice(1, 2), BOSS_FIELDS, {
            fieldLabels: { date: '日期', hours: '工时', note: '说明' },
            labels: {},
            config: {},
            kindLabel: '加班'
        });
        expect(rows).toEqual([{ 日期: '2026-10-20', 工时: 3, 说明: '' }]);
    });
});
