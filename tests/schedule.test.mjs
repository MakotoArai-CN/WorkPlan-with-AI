import { describe, test, expect } from 'bun:test';
import {
    addLocalDays,
    formatLocalDate,
    formatLocalDateTime,
    parseLocalDate,
    startOfLocalDay
} from '../src/lib/utils/datetime.js';
import {
    MAX_CATCH_UP_DAYS,
    buildScheduledInstances,
    normalizeRepeatDays
} from '../src/lib/utils/schedule.js';

describe('local date helpers', () => {
    test('format local date uses the local calendar day', () => {
        expect(formatLocalDate(new Date(2026, 9, 26, 0, 30))).toBe('2026-10-26');
        expect(formatLocalDate(new Date(2026, 9, 26, 23, 59))).toBe('2026-10-26');
        expect(formatLocalDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
    });

    test('format local datetime keeps wall-clock time', () => {
        expect(formatLocalDateTime(new Date(2026, 9, 26, 8, 5))).toBe('2026-10-26T08:05');
        expect(formatLocalDateTime(new Date(2026, 9, 26, 0, 0))).toBe('2026-10-26T00:00');
    });

    test('parseLocalDate does not shift through UTC', () => {
        const date = parseLocalDate('2026-10-26');
        expect(date.getFullYear()).toBe(2026);
        expect(date.getMonth()).toBe(9);
        expect(date.getDate()).toBe(26);
        expect(date.getHours()).toBe(0);

        const withTime = parseLocalDate('2026-10-26T09:30');
        expect(withTime.getHours()).toBe(9);
        expect(withTime.getMinutes()).toBe(30);
        expect(Number.isNaN(parseLocalDate('not-a-date').getTime())).toBe(true);
    });

    test('addLocalDays crosses month and year boundaries', () => {
        expect(formatLocalDate(addLocalDays('2026-12-31', 1))).toBe('2027-01-01');
        expect(formatLocalDate(addLocalDays('2026-03-01', -1))).toBe('2026-02-28');
        expect(formatLocalDate(addLocalDays('2026-10-26', 7))).toBe('2026-11-02');
    });

    test('startOfLocalDay strips the time part', () => {
        expect(formatLocalDateTime(startOfLocalDay(new Date(2026, 9, 26, 18, 45)))).toBe('2026-10-26T00:00');
    });
});

describe('normalizeRepeatDays', () => {
    test('maps legacy Sunday=7 to 0 and deduplicates', () => {
        expect(normalizeRepeatDays([1, 7, 0, 1, 2])).toEqual([0, 1, 2]);
        expect(normalizeRepeatDays(['3', '6'])).toEqual([3, 6]);
        expect(normalizeRepeatDays(null)).toEqual([]);
        expect(normalizeRepeatDays([8, -1, 'x'])).toEqual([]);
    });
});

describe('buildScheduledInstances', () => {
    const monday = new Date(2026, 9, 26, 10, 0); // 2026-10-26 is a Monday

    test('generates an instance for a matching weekday', () => {
        const result = buildScheduledInstances({
            scheduledTasks: [{ id: 's1', title: '周会', enabled: true, repeatDays: [1], priority: 'urgent' }]
        }, monday);
        expect(result.instances).toHaveLength(1);
        expect(result.instances[0]).toMatchObject({
            title: '周会',
            priority: 'urgent',
            date: '2026-10-26T09:00',
            isFromSchedule: true
        });
        expect(result.scheduledTasks[0].lastGeneratedDate).toBe('2026-10-26');
    });

    test('does not duplicate when run again the same day', () => {
        const first = buildScheduledInstances({
            scheduledTasks: [{ id: 's1', title: '周会', enabled: true, repeatDays: [1] }]
        }, monday);
        const second = buildScheduledInstances({
            scheduledTasks: first.scheduledTasks
        }, monday);
        expect(second.instances).toHaveLength(0);
        expect(second.changed).toBe(false);
    });

    test('catches up missed days since the last run', () => {
        const result = buildScheduledInstances({
            scheduledTasks: [{
                id: 's1',
                title: '日报',
                enabled: true,
                repeatDays: [1, 2, 3, 4, 5],
                lastGeneratedDate: '2026-10-22' // Thursday
            }]
        }, monday);
        expect(result.instances.map(item => item.date)).toEqual([
            '2026-10-23T09:00',
            '2026-10-26T09:00'
        ]);
    });

    test('caps catch-up windows so a long absence cannot flood the board', () => {
        const result = buildScheduledInstances({
            scheduledTasks: [{
                id: 's1',
                title: '每日站会',
                enabled: true,
                repeatDays: [0, 1, 2, 3, 4, 5, 6],
                lastGeneratedDate: '2024-01-01'
            }]
        }, monday);
        expect(result.instances.length).toBeLessThanOrEqual(MAX_CATCH_UP_DAYS + 1);
        expect(result.instances.at(-1).date).toBe('2026-10-26T09:00');
    });

    test('Sunday is matched with 0 (and legacy 7)', () => {
        const sunday = new Date(2026, 9, 25, 12, 0);
        const result = buildScheduledInstances({
            scheduledTasks: [
                { id: 's1', title: '周末复盘', enabled: true, repeatDays: [0] },
                { id: 's2', title: '旧数据', enabled: true, repeatDays: [7] }
            ]
        }, sunday);
        expect(result.instances.map(item => item.title)).toEqual(['周末复盘', '旧数据']);
        expect(result.instances.every(item => item.date === '2026-10-25T09:00')).toBe(true);
    });

    test('disabled or empty schedules generate nothing but advance the watermark', () => {
        const result = buildScheduledInstances({
            scheduledTasks: [
                { id: 's1', title: '停用', enabled: false, repeatDays: [1] },
                { id: 's2', title: '没选日期', enabled: true, repeatDays: [] }
            ]
        }, monday);
        expect(result.instances).toHaveLength(0);
        expect(result.scheduledTasks.map(item => item.lastGeneratedDate)).toEqual(['2026-10-26', '2026-10-26']);
        expect(result.changed).toBe(true);
    });
});
