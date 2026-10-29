import { describe, test, expect } from 'bun:test';
import {
    DEFAULT_OVERTIME_CONFIG,
    getFixedSalaryTotal,
    getOvertimeBaseSalary,
    calibrateOvertimeRate,
    getHourlyRate,
    getOvertimeCalibration,
    getMonthSummary,
    getRecordPay,
    getYearSummary,
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

describe('fixed salary vs variable salary components', () => {
    const example = {
        ...DEFAULT_OVERTIME_CONFIG,
        salaryComponents: [
            { name: '底薪', amount: 3400, inOvertimeBase: true },
            { name: '绩效', amount: 400, inOvertimeBase: true },
            { name: '餐补', amount: 300, inOvertimeBase: false },
            { name: '加班费', amount: 213, inOvertimeBase: true },
            { name: '过节费', amount: 200, inOvertimeBase: false },
            { name: '社保补贴', amount: 454.51, inOvertimeBase: false }
        ]
    };

    test('overtime/holiday/social are not part of the fixed salary estimate', () => {
        const normalized = normalizeOvertimeConfig(example);
        expect(getFixedSalaryTotal(normalized)).toBe(4100);
        expect(getOvertimeBaseSalary(normalized)).toBe(3800);
        expect(normalized.monthlySalary).toBe(4100);
    });

    test('explicit fixed flag wins over the name heuristic', () => {
        const withFixedHoliday = {
            ...example,
            salaryComponents: example.salaryComponents.map(item => (
                item.name === '过节费' ? { ...item, fixed: true } : item
            ))
        };
        expect(getFixedSalaryTotal(withFixedHoliday)).toBe(4300);
    });
});

describe('monthly actual overtime override', () => {
    const records = [
        { id: 'w', date: '2026-09-05', start: '10:00', end: '18:00', hours: 8, type: 'weekend', compensation: 'pay' },
        { id: 'd', date: '2026-09-07', start: '18:00', end: '21:30', hours: 3.5, type: 'weekday', compensation: 'pay' }
    ];

    test('uses 213 as September actual while preserving the formula estimate', () => {
        const withActual = {
            ...config,
            overtimeMonthlyActuals: [{ month: '2026-09', amount: 213 }]
        };
        const month = getMonthSummary(records, 2026, 9, withActual);
        expect(month.pay).toBe(213);
        expect(month.actualOverride).toBe(true);
        expect(month.estimatedPay).toBeGreaterThan(400);
        expect(month.hours).toBe(11.5);
        expect(getYearSummary(records, 2026, withActual).pay).toBe(213);
    });

    test('falls back to the formula when no monthly actual is set', () => {
        const month = getMonthSummary(records, 2026, 9, config);
        expect(month.actualOverride).toBe(false);
        expect(month.pay).toBe(month.estimatedPay);
        expect(month.pay).toBeGreaterThan(400);
    });
});

describe('smart overtime rate calibration', () => {
    const records = [
        { id: 'w', date: '2026-09-05', start: '10:00', end: '18:00', hours: 8, type: 'weekend', compensation: 'pay' },
        { id: 'd', date: '2026-09-07', start: '18:00', end: '21:30', hours: 3.5, type: 'weekday', compensation: 'pay' }
    ];
    const withActual = {
        ...config,
        overtimeMonthlyActuals: [{ month: '2026-09', amount: 213 }]
    };

    test('derives an implied hourly rate from actual pay and weighted hours', () => {
        const learned = calibrateOvertimeRate(records, withActual);
        expect(learned.samples).toBe(1);
        expect(learned.weightedHours).toBe(21.25);
        expect(learned.rate).toBe(10.02);
        const applied = { ...withActual, overtimeLearnedRate: learned.rate, overtimeCalibrationSamples: 1 };
        expect(getHourlyRate(applied)).toBe(10.02);
        const calibration = getOvertimeCalibration(records, applied);
        expect(calibration.impliedMultiplier).toBe(0.51);
    });

    test('learns from more months instead of only the first one', () => {
        const more = {
            ...withActual,
            overtimeMonthlyActuals: [
                { month: '2026-08', amount: 180 },
                { month: '2026-09', amount: 213 }
            ]
        };
        const learned = calibrateOvertimeRate([
            ...records,
            { id: 'w2', date: '2026-08-01', start: '10:00', end: '18:00', hours: 8, type: 'weekend', compensation: 'pay' }
        ], more);
        expect(learned.samples).toBe(2);
        expect(learned.weightedHours).toBe(37.25);
        expect(learned.rate).toBeGreaterThan(10);
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

    test('annual overtime includes a monthly override when the salary slip has none', () => {
        const noSlipOvertime = {
            ...config,
            salaryActuals: [{ ...config.salaryActuals[0], overtimePay: 0, components: config.salaryActuals[0].components.filter(component => !/加班/.test(component.name)) }],
            overtimeMonthlyActuals: [{ month: '2026-09', amount: 213 }]
        };
        const income = getAnnualIncome(noSlipOvertime, [], 2026);
        expect(income.totalOvertime).toBe(213);
        expect(income.overtimeOverrides).toBe(1);
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
