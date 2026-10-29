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
    getYearSummary,
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

export function setActualSalary(config, cycle, amountOrDetails, note = '', source = 'manual') {
    const normalized = normalizeOvertimeConfig(config);
    const details = amountOrDetails && typeof amountOrDetails === 'object'
        ? amountOrDetails
        : { amount: amountOrDetails, note };
    const value = Number(details.amount);
    if (!Number.isFinite(value) || value < 0) return normalized.salaryActuals;
    const components = (Array.isArray(details.components) ? details.components : [])
        .filter(item => item && typeof item === 'object')
        .map((item, index) => ({
            id: typeof item.id === 'string' && item.id ? item.id : `salary_component_${index + 1}`,
            name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `项目 ${index + 1}`,
            amount: Math.max(0, Number(item.amount) || 0),
            category: typeof item.category === 'string' ? item.category : 'other'
        }));
    const grossAmount = Number(details.grossAmount);
    const deductions = Number(details.deductions);
    const next = (normalized.salaryActuals || []).filter(item => item.periodEnd !== cycle.end);
    next.push({
        id: `actual_${cycle.end}`,
        periodStart: cycle.start,
        periodEnd: cycle.end,
        paydayDate: cycle.paydayDate,
        amount: Math.round(value * 100) / 100,
        grossAmount: Number.isFinite(grossAmount) && grossAmount >= 0
            ? Math.round(grossAmount * 100) / 100
            : Math.round(components.reduce((sum, item) => sum + item.amount, 0) * 100) / 100,
        deductions: Number.isFinite(deductions) && deductions >= 0
            ? Math.round(deductions * 100) / 100
            : 0,
        components,
        overtimePay: Math.max(0, Number(details.overtimePay) || 0),
        socialInsurance: Math.max(0, Number(details.socialInsurance) || 0),
        note: typeof details.note === 'string' ? details.note : String(note || ''),
        source,
        updatedAt: new Date().toISOString()
    });
    return next;
}

/** Actual salary rows for a calendar year, newest first. */
export function getSalaryActualsForYear(config, year) {
    const normalized = normalizeOvertimeConfig(config);
    const prefix = String(year);
    return (normalized.salaryActuals || [])
        .filter(item => String(item.paydayDate || item.periodEnd || '').startsWith(prefix)
            || String(item.periodEnd || '').startsWith(prefix))
        .sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)));
}

/**
 * Annual take-home / composition. Actual rows are the source of truth for
 * income already paid; overtime records only fill the "estimated" helper.
 */
export function getAnnualIncome(config, overtimeRecords = [], year) {
    const normalized = normalizeOvertimeConfig(config);
    const actuals = getSalaryActualsForYear(normalized, year);
    const months = new Map();
    let totalNet = 0;
    let totalGross = 0;
    let totalOvertime = 0;
    let totalSocial = 0;
    let totalDeductions = 0;
    for (const item of actuals) {
        const gross = Number(item.grossAmount) || Number(item.amount) || 0;
        const overtime = Number(item.overtimePay) || (item.components || [])
            .filter(component => /加班/.test(component.name))
            .reduce((sum, component) => sum + component.amount, 0);
        const social = Number(item.socialInsurance) || (item.components || [])
            .filter(component => /社保/.test(component.name))
            .reduce((sum, component) => sum + component.amount, 0);
        totalNet += Number(item.amount) || 0;
        totalGross += gross;
        totalOvertime += overtime;
        totalSocial += social;
        totalDeductions += Number(item.deductions) || 0;
        const key = String(item.paydayDate || item.periodEnd || '').slice(0, 7);
        if (!months.has(key)) {
            months.set(key, { key, net: 0, gross: 0, overtime: 0, count: 0, components: [] });
        }
        const month = months.get(key);
        month.net += Number(item.amount) || 0;
        month.gross += gross;
        month.overtime += overtime;
        month.count += 1;
        month.components.push(...(item.components || []));
    }
    const withActual = actuals.length;
    const round = value => Math.round(value * 100) / 100;
    return {
        year,
        monthsRecorded: withActual,
        totalNet: round(totalNet),
        totalGross: round(totalGross),
        totalOvertime: round(totalOvertime),
        totalSocial: round(totalSocial),
        totalDeductions: round(totalDeductions),
        averageNet: withActual ? round(totalNet / withActual) : 0,
        estimatedOvertime: round(getYearSummary(overtimeRecords || [], year, normalized).pay),
        byMonth: [...months.values()]
            .map(month => ({ ...month, net: round(month.net), gross: round(month.gross), overtime: round(month.overtime) }))
            .sort((a, b) => b.key.localeCompare(a.key))
    };
}
