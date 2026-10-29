import { describe, test, expect } from 'bun:test';
import {
    DEFAULT_OVERTIME_CONFIG,
    getRecordPay,
    normalizeOvertimeConfig,
    summarizeOvertimeRecords
} from '../src/lib/utils/overtime.js';
import { getAnnualIncome, setActualSalary } from '../src/lib/utils/payroll.js';

const config = {
    ...DEFAULT_OVERTIME_CONFIG,
    workdaysPerMonth: 21.75,
    hoursPerDay: 8,
    salaryComponents: [{ id: 'base', name: '底薪', amount: 3400, inOvertimeBase: true }],
    salaryActuals: [{
        id: 'actual_2026-09-15',
        periodStart: '2026-08-16',
        periodEnd: '2026-09-15',
        paydayDate: '2026-09-15',
        amount: 4313,
        grossAmount: 4513,
        deductions: 200,
        components: [
            { id: 'base', name: '底薪', category: 'base', amount: 3400 },
            { id: 'performance', name: '绩效', category: 'performance', amount: 400 },
            { id: 'meal', name: '餐补', category: 'meal', amount: 300 },
            { id: 'overtime', name: '加班费', category: 'overtime', amount: 213 },
            { id: 'holiday', name: '过节费', category: 'holiday', amount: 200 }
        ],
        overtimePay: 213,
        socialInsurance: 454.51,
        note: '9月工资',
        source: 'manual',
        updatedAt: '2026-09-15T12:00:00.000Z'
    }]
};

describe('actual overtime pay', () => {
    test('uses manual actual pay instead of the configured estimate', () => {
        const record = {
            id: 'ot1', date: '2026-09-05', start: '09:00', end: '17:00', hours: 8,
            type: 'weekend', compensation: 'pay', actualPay: 500
        };
        const summary = summarizeOvertimeRecords([record], config);
        expect(getRecordPay(record, config)).toBe(500);
        expect(summary.pay).toBe(500);
        expect(summary.estimatedPay).toBeGreaterThan(0);
        expect(summary.actualPayCount).toBe(1);
    });

    test('empty actual pay is treated as absent', () => {
        const record = { id: 'ot-empty', date: '2026-09-07', start: '18:00', end: '21:30', hours: 3.5, type: 'weekday', compensation: 'pay', actualPay: '' };
        expect(getRecordPay(record, config)).toBeGreaterThan(0);
        expect(getRecordPay(record, config)).not.toBe(0);
    });

    test('falls back to the estimate when actual pay is absent', () => {
        const record = {
            id: 'ot2', date: '2026-09-07', start: '18:00', end: '21:30', hours: 3.5,
            type: 'weekday', compensation: 'pay'
        };
        expect(getRecordPay(record, config)).toBeGreaterThan(0);
        expect(getRecordPay(record, config)).toBe(Math.round(getRecordPay(record, config) * 100) / 100);
    });
});

describe('salary actuals and annual income', () => {
    test('keeps the salary components and computes annual totals', () => {
        const income = getAnnualIncome(config, [], 2026);
        expect(income.totalNet).toBe(4313);
        expect(income.totalGross).toBe(4513);
        expect(income.totalOvertime).toBe(213);
        expect(income.totalSocial).toBe(454.51);
        expect(income.monthsRecorded).toBe(1);
        expect(income.averageNet).toBe(4313);
    });

    test('setActualSalary preserves detailed components', () => {
        const cycle = { start: '2026-09-16', end: '2026-10-15', paydayDate: '2026-10-15' };
        const next = setActualSalary(config, cycle, {
            amount: 4200,
            grossAmount: 4500,
            deductions: 300,
            overtimePay: 180,
            socialInsurance: 454.51,
            components: [
                { name: '底薪', category: 'base', amount: 3400 },
                { name: '加班费', category: 'overtime', amount: 180 }
            ],
            note: '10月工资'
        });
        const saved = next.find(item => item.periodEnd === cycle.end);
        expect(saved.amount).toBe(4200);
        expect(saved.components.length).toBe(2);
        expect(saved.overtimePay).toBe(180);
        expect(saved.socialInsurance).toBe(454.51);
    });

    test('normalization strips malformed components but keeps valid amounts', () => {
        const normalized = normalizeOvertimeConfig(config);
        expect(normalized.salaryActuals[0].grossAmount).toBe(4513);
        expect(normalized.salaryActuals[0].components.length).toBe(5);
        expect(normalized.salaryActuals[0].socialInsurance).toBe(454.51);
    });
});
