import { describe, expect, test } from 'bun:test';
import {
    getFixedSalaryTotal,
    getHourlyRate,
    getOvertimeBaseSalary,
    normalizeOvertimeConfig
} from '../src/lib/utils/overtime.js';
import { formatCycle, getPayCycle, getPayrollEstimate, setActualSalary } from '../src/lib/utils/payroll.js';

const CONFIG = {
    monthlySalary: 10500,
    payday: 15,
    workdaysPerMonth: 21.75,
    hoursPerDay: 8,
    salaryComponents: [
        { id: 'base', name: '底薪', amount: 8000, inOvertimeBase: true },
        { id: 'performance', name: '绩效', amount: 2000, inOvertimeBase: false },
        { id: 'transport', name: '交通补贴', amount: 500, inOvertimeBase: false }
    ]
};

describe('payday cycle', () => {
    test('a mid-month payday creates a 16th-to-15th cycle', () => {
        const cycle = getPayCycle(new Date(2026, 9, 28), CONFIG);
        expect(cycle.start).toBe('2026-10-16');
        expect(cycle.end).toBe('2026-11-15');
        expect(cycle.paydayDate).toBe('2026-11-15');
        expect(formatCycle(cycle)).toBe('10/16 - 11/15');
    });

    test('on payday the cycle ends today', () => {
        const cycle = getPayCycle(new Date(2026, 9, 15), CONFIG);
        expect(cycle.start).toBe('2026-09-16');
        expect(cycle.end).toBe('2026-10-15');
    });

    test('month-end payday clamps to the short month', () => {
        const cycle = getPayCycle(new Date(2026, 2, 31), { ...CONFIG, payday: 15 });
        expect(cycle.start).toBe('2026-03-16');
        expect(cycle.end).toBe('2026-04-15');
    });
});

describe('salary components', () => {
    test('fixed pay sums all components and overtime uses checked components', () => {
        expect(getFixedSalaryTotal(CONFIG)).toBe(10500);
        expect(getOvertimeBaseSalary(CONFIG)).toBe(8000);
        expect(getHourlyRate(CONFIG)).toBeCloseTo(8000 / (21.75 * 8), 2);
    });

    test('total mode uses all fixed pay as the overtime base', () => {
        const config = normalizeOvertimeConfig({ ...CONFIG, overtimeBaseMode: 'total' });
        expect(getOvertimeBaseSalary(config)).toBe(10500);
    });

    test('legacy monthlySalary becomes one base component', () => {
        const config = normalizeOvertimeConfig({ monthlySalary: 21750 });
        expect(config.salaryComponents).toHaveLength(1);
        expect(config.salaryComponents[0].amount).toBe(21750);
        expect(config.salaryComponents[0].inOvertimeBase).toBe(true);
    });
});

describe('payroll estimate', () => {
    test('adds fixed pay and overtime and deducts unpaid leave in the cycle', () => {
        const records = [
            { id: 'ot1', date: '2026-10-20', start: '18:00', end: '20:00', hours: 2, type: 'weekday', compensation: 'pay' }
        ];
        const leave = [
            { id: 'lv1', startDate: '2026-10-21', endDate: '2026-10-21', unit: 'day', duration: 1, type: 'personal', paid: false }
        ];
        const payroll = getPayrollEstimate(records, leave, new Date(2026, 9, 28), CONFIG);
        const dailyRate = 10500 / 21.75;
        expect(payroll.current.overtimePay).toBeCloseTo(2 * 8000 / 174 * 1.5, 2);
        expect(payroll.current.leaveDeduction).toBeCloseTo(dailyRate, 2);
        expect(payroll.current.estimated).toBeCloseTo(10500 + 2 * 8000 / 174 * 1.5 - dailyRate, 2);
    });

    test('stores and reads the actual salary for the previous cycle', () => {
        const payroll = getPayrollEstimate([], [], new Date(2026, 9, 28), CONFIG);
        expect(payroll.previousCycle.end).toBe('2026-10-15');
        const actuals = setActualSalary(CONFIG, payroll.previousCycle, 10000, 'test');
        const next = getPayrollEstimate([], [], new Date(2026, 9, 28), { ...CONFIG, salaryActuals: actuals });
        expect(next.actual.amount).toBe(10000);
        expect(next.actualDifference).toBe(10000 - next.previous.estimated);
    });
});
