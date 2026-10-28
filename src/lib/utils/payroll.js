// Payroll period and salary estimation built on top of the overtime module.
//
// The default cycle is payday-based: a payday of the 15th means the period
// runs from the 16th of the previous month through the 15th of the pay month.
// This is the common "attendance period" in Chinese payroll and avoids the
// wrong calendar-month estimate when the employee is paid mid-month.

import {
    DEFAULT_OVERTIME_CONFIG,
    calculateRecordPay,
    getFixedSalaryTotal,
    getOvertimeBaseSalary,
    getHourlyRate,
    isValidDate,
    normalizeLeaveRecord,
    normalizeOvertimeConfig,
    normalizeOvertimeRecord,
    summarizeLeaveRecords,
    summarizeOvertimeRecords
} from './overtime.js';
import { getSalaryGrowth } from './bank-import.js';

const pad = value => String(value).padStart(2, '0');

export function toDateValue(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateValue(value) {
    if (!isValidDate(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
}

export function addDays(value, delta) {
    const date = value instanceof Date ? new Date(value) : parseDateValue(value);
    if (!date) return null;
    date.setDate(date.getDate() + delta);
    return date;
}

export function clampPayday(year, month, payday) {
    const last = new Date(year, month, 0).getDate();
    return Math.min(Math.max(1, Number(payday) || 1), last);
}

export function formatCycle(cycle) {
    if (!cycle) return '';
    return `${cycle.start.slice(5).replace('-', '/')} - ${cycle.end.slice(5).replace('-', '/')}`;
}

/**
 * Return the attendance period that contains `referenceDate`.
 * `payday` is the day salary is paid and also the last day of the period.
 */
export function getPayCycle(referenceDate = new Date(), config = DEFAULT_OVERTIME_CONFIG) {
    const normalized = normalizeOvertimeConfig(config);
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth() + 1;
    const day = referenceDate.getDate();

    if (normalized.salaryCycleMode === 'calendar') {
        const start = `${year}-${pad(month)}-01`;
        const last = new Date(year, month, 0).getDate();
        const end = `${year}-${pad(month)}-${pad(last)}`;
        const payMonth = new Date(year, month, 1);
        const paydayDate = `${payMonth.getFullYear()}-${pad(payMonth.getMonth() + 1)}-${pad(clampPayday(payMonth.getFullYear(), payMonth.getMonth() + 1, normalized.payday))}`;
        return { start, end, paydayDate, mode: 'calendar' };
    }

    const thisPayday = clampPayday(year, month, normalized.payday);
    let end;
    if (day <= thisPayday) {
        end = `${year}-${pad(month)}-${pad(thisPayday)}`;
    } else {
        const next = new Date(year, month, 1);
        const nextYear = next.getFullYear();
        const nextMonth = next.getMonth() + 1;
        end = `${nextYear}-${pad(nextMonth)}-${pad(clampPayday(nextYear, nextMonth, normalized.payday))}`;
    }
    const endDate = parseDateValue(end);
    const previousMonth = new Date(endDate.getFullYear(), endDate.getMonth() - 1, 1);
    const previousPayday = clampPayday(
        previousMonth.getFullYear(),
        previousMonth.getMonth() + 1,
        normalized.payday
    );
    const startDate = new Date(
        previousMonth.getFullYear(),
        previousMonth.getMonth(),
        previousPayday + 1
    );
    const start = toDateValue(startDate);
    return { start, end, paydayDate: end, mode: 'payday' };
}

function recordsInRange(records, start, end) {
    return (Array.isArray(records) ? records : []).filter(record => (
        isValidDate(record?.date) && record.date >= start && record.date <= end
    ));
}

function leaveInRange(records, start, end) {
    return (Array.isArray(records) ? records : []).filter(record => {
        const normalized = normalizeLeaveRecord(record);
        return normalized.startDate && normalized.endDate
            && normalized.startDate <= end && normalized.endDate >= start;
    });
}

function cycleEstimate(records, leaveRecords, cycle, config) {
    const overtime = summarizeOvertimeRecords(recordsInRange(records, cycle.start, cycle.end), config);
    const leave = summarizeLeaveRecords(leaveInRange(leaveRecords, cycle.start, cycle.end), config, {
        startDate: cycle.start,
        endDate: cycle.end
    });
    const fixed = getFixedSalaryTotal(config);
    const dailyBasis = config.leaveDeductionMode === 'base'
        ? getOvertimeBaseSalary(config)
        : fixed;
    const dailyRate = config.workdaysPerMonth > 0 ? dailyBasis / config.workdaysPerMonth : 0;
    const deduction = Math.round(dailyRate * leave.unpaidDays * 100) / 100;
    const estimated = Math.round((fixed + overtime.pay - deduction) * 100) / 100;
    return {
        overtime,
        leave,
        fixed,
        overtimePay: overtime.pay,
        dailyRate: Math.round(dailyRate * 100) / 100,
        leaveDeduction: deduction,
        estimated
    };
}

export function getPayrollEstimate(records = [], leaveRecords = [], referenceDate = new Date(), config = DEFAULT_OVERTIME_CONFIG) {
    const normalized = normalizeOvertimeConfig(config);
    const cycle = getPayCycle(referenceDate, normalized);
    const previousCycle = getPayCycle(addDays(cycle.start, -1), normalized);
    const current = cycleEstimate(records, leaveRecords, cycle, normalized);
    const previous = cycleEstimate(records, leaveRecords, previousCycle, normalized);

    const recent = [];
    let historyCursor = previousCycle;
    for (let index = 0; index < 3; index += 1) {
        const estimate = cycleEstimate(records, leaveRecords, historyCursor, normalized);
        recent.push({
            cycle: historyCursor,
            overtimePay: estimate.overtimePay,
            leaveDeduction: estimate.leaveDeduction,
            estimated: estimate.estimated,
            actual: (normalized.salaryActuals || []).find(item => item.periodEnd === historyCursor.end) || null
        });
        historyCursor = getPayCycle(addDays(historyCursor.start, -1), normalized);
    }
    const average = values => values.length
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100
        : 0;
    const averageOvertimePay = average(recent.map(item => item.overtimePay));
    const averageLeaveDeduction = average(recent.map(item => item.leaveDeduction));
    const hasHistory = recent.some(item => item.overtimePay > 0 || item.leaveDeduction > 0);
    // Blend the current cycle with the trailing average. When there is no
    // overtime/leave history yet, the current records are the only signal.
    const smartOvertimePay = hasHistory
        ? Math.round(((current.overtimePay * 2 + averageOvertimePay) / 3) * 100) / 100
        : current.overtimePay;
    const smartLeaveDeduction = hasHistory
        ? Math.round(((current.leaveDeduction * 2 + averageLeaveDeduction) / 3) * 100) / 100
        : current.leaveDeduction;
    const smart = {
        sample: recent.length,
        averageOvertimePay,
        averageLeaveDeduction,
        overtimePay: smartOvertimePay,
        leaveDeduction: smartLeaveDeduction,
        estimated: Math.round((current.fixed + smartOvertimePay - smartLeaveDeduction) * 100) / 100,
        history: recent
    };

    const actual = (normalized.salaryActuals || [])
        .filter(item => item.periodEnd === previousCycle.end)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
    return {
        cycle,
        previousCycle,
        current,
        previous,
        actual,
        smart,
        salaryGrowth: getSalaryGrowth(normalized.salaryActuals || []),
        actualDifference: actual ? Math.round((actual.amount - previous.estimated) * 100) / 100 : 0,
        fixedTotal: current.fixed,
        overtimeBase: getOvertimeBaseSalary(normalized),
        hourlyRate: Math.round(getHourlyRate(normalized) * 100) / 100,
        components: normalized.salaryComponents,
        payday: normalized.payday
    };
}

export function setActualSalary(config, cycle, amount, note = '', source = 'manual') {
    const normalized = normalizeOvertimeConfig(config);
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) return normalized.salaryActuals;
    const next = (normalized.salaryActuals || []).filter(item => item.periodEnd !== cycle.end);
    next.push({
        id: `actual_${cycle.end}`,
        periodStart: cycle.start,
        periodEnd: cycle.end,
        paydayDate: cycle.paydayDate,
        amount: Math.round(value * 100) / 100,
        note,
        source,
        updatedAt: new Date().toISOString()
    });
    return next;
}
