import { describe, test, expect } from 'bun:test';
import {
    calculateLeaveDays,
    calculateOvertimeHours,
    calculateOvertimeMinutes,
    calculateRecordPay,
    estimateOvertime,
    filterRecordsByPeriod,
    getHourlyRate,
    getAnnualLeaveBalance,
    getLeaveMonthSummary,
    getLeaveYearSummary,
    getMonthSummary,
    groupRecordsByDay,
    inferOvertimeType,
    normalizeLeaveRecord,
    normalizeOvertimeConfig,
    normalizeOvertimeRecord,
    summarizeOvertimeRecords
} from '../src/lib/utils/overtime.js';

const CONFIG = {
    monthlySalary: 21750,
    workdaysPerMonth: 21.75,
    hoursPerDay: 8,
    weekdayMultiplier: 1.5,
    weekendMultiplier: 2,
    holidayMultiplier: 3
};

const record = (date, start, end, type = 'weekday', compensation = 'pay') => ({
    id: `${date}-${start}`,
    date,
    start,
    end,
    hours: calculateOvertimeHours(start, end),
    type,
    compensation
});

describe('overtime duration', () => {
    test('calculates a same-day shift', () => {
        expect(calculateOvertimeMinutes('18:30', '21:00')).toBe(150);
        expect(calculateOvertimeHours('18:30', '21:00')).toBe(2.5);
    });

    test('treats an earlier end time as crossing midnight', () => {
        expect(calculateOvertimeMinutes('22:00', '02:00')).toBe(240);
        expect(calculateOvertimeHours('22:00', '02:00')).toBe(4);
    });

    test('equal times are zero, not a full day', () => {
        expect(calculateOvertimeMinutes('18:00', '18:00')).toBe(0);
    });

    test('rejects malformed input', () => {
        expect(calculateOvertimeMinutes('25:00', '26:00')).toBe(0);
        expect(calculateOvertimeMinutes('', '20:00')).toBe(0);
    });
});

describe('overtime pay', () => {
    test('computes the hourly rate from monthly salary', () => {
        expect(getHourlyRate(CONFIG)).toBe(125);
    });

    test('applies weekday / weekend / holiday multipliers', () => {
        const base = record('2026-10-26', '18:00', '20:00');
        expect(calculateRecordPay({ ...base, type: 'weekday' }, CONFIG)).toBe(375);
        expect(calculateRecordPay({ ...base, type: 'weekend' }, CONFIG)).toBe(500);
        expect(calculateRecordPay({ ...base, type: 'holiday' }, CONFIG)).toBe(750);
    });

    test('time-off records count as hours but not pay', () => {
        const timeOff = record('2026-10-26', '18:00', '20:00', 'weekday', 'time_off');
        const summary = summarizeOvertimeRecords([timeOff], CONFIG);
        expect(summary.hours).toBe(2);
        expect(summary.payableHours).toBe(0);
        expect(summary.pay).toBe(0);
    });

    test('summarizes hours and pay by month', () => {
        const records = [
            record('2026-10-01', '18:00', '20:00', 'holiday'),
            record('2026-10-02', '18:00', '20:00', 'weekday'),
            record('2026-09-30', '18:00', '19:00', 'weekday')
        ];
        const summary = getMonthSummary(records, 2026, 10, CONFIG);
        expect(summary.hours).toBe(4);
        expect(summary.pay).toBe(750 + 375);
        expect(summary.byType.holiday).toBe(2);
    });

    test('clamps invalid salary configuration', () => {
        const config = normalizeOvertimeConfig({ monthlySalary: -5, workdaysPerMonth: 0 });
        expect(config.monthlySalary).toBe(0);
        expect(config.workdaysPerMonth).toBe(21.75);
    });
});

describe('overtime estimates', () => {
    test('uses last month payable hours and current salary for the projection', () => {
        const records = [
            record('2026-09-01', '18:00', '20:00', 'weekday'),
            record('2026-09-05', '10:00', '14:00', 'weekend')
        ];
        const estimate = estimateOvertime(records, new Date(2026, 9, 15), CONFIG);
        expect(estimate.basis).toBe('last_month');
        expect(estimate.lastMonth.payableHours).toBe(6);
        expect(estimate.expectedHours).toBe(6);
        // 2h weekday + 4h weekend => weighted multiplier 11/6
        expect(estimate.expectedPay).toBe(1375);
    });

    test('uses the current month projection when last month is empty', () => {
        const records = [record('2026-10-01', '18:00', '20:00', 'weekday')];
        const estimate = estimateOvertime(records, new Date(2026, 9, 10), CONFIG);
        expect(estimate.basis).toBe('current_month');
        expect(estimate.expectedHours).toBeGreaterThan(2);
    });

    test('returns zero when there is nothing to project', () => {
        const estimate = estimateOvertime([], new Date(2026, 9, 10), CONFIG);
        expect(estimate.basis).toBe('none');
        expect(estimate.expectedPay).toBe(0);
    });

    test('time-off hours do not skew the pay multiplier', () => {
        const records = [
            record('2026-09-01', '18:00', '20:00', 'weekday', 'pay'),
            record('2026-09-05', '10:00', '14:00', 'weekend', 'time_off')
        ];
        const estimate = estimateOvertime(records, new Date(2026, 9, 15), CONFIG);
        expect(estimate.lastMonth.hours).toBe(6);
        expect(estimate.lastMonth.payableHours).toBe(2);
        expect(estimate.expectedHours).toBe(2);
        expect(estimate.expectedPay).toBe(375);
    });
});

describe('overtime records', () => {
    test('infers weekday/weekend from the local date', () => {
        expect(inferOvertimeType('2026-10-26')).toBe('weekday');
        expect(inferOvertimeType('2026-10-25')).toBe('weekend');
    });

    test('normalizes unsafe values', () => {
        const normalized = normalizeOvertimeRecord({
            date: '2026-10-26',
            start: '18:00',
            end: '20:00',
            type: 'unknown',
            compensation: 'unknown',
            hours: 999
        });
        expect(normalized.type).toBe('weekday');
        expect(normalized.compensation).toBe('pay');
        expect(normalized.hours).toBe(24);
    });

    test('filters and groups by year/month/day', () => {
        const records = [
            record('2026-10-01', '18:00', '20:00'),
            record('2026-10-02', '18:00', '20:00'),
            record('2026-09-30', '18:00', '20:00'),
            record('2025-10-01', '18:00', '20:00')
        ];
        expect(filterRecordsByPeriod(records, { year: 2026 })).toHaveLength(3);
        expect(filterRecordsByPeriod(records, { year: 2026, month: 10 })).toHaveLength(2);
        expect(filterRecordsByPeriod(records, { year: 2026, month: 10, day: 2 })).toHaveLength(1);
        expect(groupRecordsByDay(records, 2026, 10).size).toBe(2);
    });
});


describe('leave records', () => {
    const leave = (startDate, endDate, type = 'annual', duration = null, unit = 'day') => ({
        id: `leave-${startDate}`,
        startDate,
        endDate,
        type,
        unit,
        duration: duration ?? calculateLeaveDays(startDate, endDate),
        paid: true
    });

    test('counts inclusive calendar days', () => {
        expect(calculateLeaveDays('2026-10-01', '2026-10-01')).toBe(1);
        expect(calculateLeaveDays('2026-10-01', '2026-10-07')).toBe(7);
        expect(calculateLeaveDays('2026-10-07', '2026-10-01')).toBe(0);
    });

    test('keeps AI access flags on overtime and leave', () => {
        expect(normalizeOvertimeRecord({ date: '2026-10-27', aiLocked: true }).aiLocked).toBe(true);
        expect(normalizeOvertimeRecord({ date: '2026-10-27' }).aiLocked).toBe(false);
        expect(normalizeLeaveRecord({ startDate: '2026-10-27', aiLocked: true }).aiLocked).toBe(true);
        expect(normalizeLeaveRecord({ startDate: '2026-10-27' }).aiLocked).toBe(false);
    });

    test('keeps a manually entered half day', () => {
        const record = normalizeLeaveRecord({ startDate: '2026-10-01', endDate: '2026-10-01', duration: 0.5 });
        expect(record.duration).toBe(0.5);
        expect(getLeaveMonthSummary([record], 2026, 10).days).toBe(0.5);
    });

    test('splits a leave across month boundaries', () => {
        const records = [leave('2026-09-28', '2026-10-03')];
        expect(getLeaveMonthSummary(records, 2026, 9).days).toBe(3);
        expect(getLeaveMonthSummary(records, 2026, 10).days).toBe(3);
        expect(getLeaveYearSummary(records, 2026).days).toBe(6);
    });

    test('counts hourly leave separately and converts to days for balances', () => {
        const records = [
            leave('2026-10-08', '2026-10-08', 'personal', 4, 'hour'),
            leave('2026-10-09', '2026-10-09', 'annual', 1, 'day')
        ];
        const summary = getLeaveMonthSummary(records, 2026, 10, CONFIG);
        expect(summary.days).toBe(1);
        expect(summary.hours).toBe(4);
        expect(summary.byType.personal).toBe(0.5);
    });

    test('computes annual leave balance', () => {
        const records = [leave('2026-02-01', '2026-02-03', 'annual')];
        const balance = getAnnualLeaveBalance(records, 2026, { ...CONFIG, annualLeaveQuota: 10 });
        expect(balance.used).toBe(3);
        expect(balance.remaining).toBe(7);
    });
});
