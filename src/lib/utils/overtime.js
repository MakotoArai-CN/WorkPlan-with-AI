// Overtime time and pay calculations.
//
// Records are intentionally independent from tasks: overtime is payroll data,
// not work items. Dates are local calendar dates (`YYYY-MM-DD`), times are
// local wall-clock `HH:mm`, and a shift whose end is not after its start is
// treated as crossing midnight.

export const OVERTIME_TYPES = ['weekday', 'weekend', 'holiday'];
export const COMPENSATION_TYPES = ['pay', 'time_off', 'none'];
export const LEAVE_TYPES = ['annual', 'sick', 'personal', 'compensatory', 'maternity', 'marriage', 'bereavement', 'other'];
export const LEAVE_UNITS = ['day', 'hour'];

export const DEFAULT_OVERTIME_CONFIG = Object.freeze({
    monthlySalary: 0,
    currency: 'CNY',
    workdaysPerMonth: 21.75,
    hoursPerDay: 8,
    weekdayMultiplier: 1.5,
    weekendMultiplier: 2,
    holidayMultiplier: 3,
    annualLeaveQuota: 0,
    payday: 15,
    salaryCycleMode: 'payday',
    overtimeBaseMode: 'base',
    leaveDeductionMode: 'fixed',
    salaryComponents: [],
    salaryActuals: []
});

export const SALARY_COMPONENT_TEMPLATE = Object.freeze([
    { id: 'base', name: '底薪', amount: 0, inOvertimeBase: true },
    { id: 'performance', name: '绩效', amount: 0, inOvertimeBase: false },
    { id: 'transport', name: '交通补贴', amount: 0, inOvertimeBase: false },
    { id: 'social', name: '社保补贴', amount: 0, inOvertimeBase: false }
]);

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function normalizeSalaryComponents(components, monthlySalary) {
    const source = Array.isArray(components) && components.length > 0
        ? components
        : (monthlySalary > 0
            ? [{ id: 'base', name: '底薪', amount: monthlySalary, inOvertimeBase: true }]
            : []);
    return source
        .filter(item => item && typeof item === 'object')
        .map((item, index) => {
            const amount = Number(item.amount);
            return {
                id: typeof item.id === 'string' && item.id ? item.id : `component_${index + 1}`,
                name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `项目 ${index + 1}`,
                amount: Number.isFinite(amount) ? Math.min(100_000_000, Math.max(0, amount)) : 0,
                inOvertimeBase: item.inOvertimeBase === true
            };
        });
}

export function getSalaryComponents(config = DEFAULT_OVERTIME_CONFIG) {
    return normalizeOvertimeConfig(config).salaryComponents;
}

export function getFixedSalaryTotal(config = DEFAULT_OVERTIME_CONFIG) {
    const components = getSalaryComponents(config);
    return Math.round(components.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
}

export function getOvertimeBaseSalary(config = DEFAULT_OVERTIME_CONFIG) {
    const normalized = normalizeOvertimeConfig(config);
    if (normalized.overtimeBaseMode === 'total') return getFixedSalaryTotal(normalized);
    const components = normalized.salaryComponents;
    const selected = components.filter(item => item.inOvertimeBase);
    if (selected.length > 0) {
        return Math.round(selected.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
    }
    return normalized.monthlySalary;
}

export function normalizeOvertimeConfig(config = {}) {
    const merged = { ...DEFAULT_OVERTIME_CONFIG, ...(config || {}) };
    const number = (value, fallback, min, max, positive = false) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        if (positive && parsed <= 0) return fallback;
        return Math.min(max, Math.max(min, parsed));
    };
    const monthlySalary = number(merged.monthlySalary, 0, 0, 100_000_000);
    const salaryComponents = normalizeSalaryComponents(merged.salaryComponents, monthlySalary);
    const componentTotal = Math.round(salaryComponents.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
    const payday = Math.round(number(merged.payday, 15, 1, 31, true));
    const salaryActuals = (Array.isArray(merged.salaryActuals) ? merged.salaryActuals : [])
        .filter(item => item && typeof item === 'object')
        .map(item => {
            const components = (Array.isArray(item.components) ? item.components : [])
                .filter(component => component && typeof component === 'object')
                .map((component, index) => ({
                    id: typeof component.id === 'string' && component.id ? component.id : `salary_component_${index + 1}`,
                    name: typeof component.name === 'string' && component.name.trim() ? component.name.trim() : `项目 ${index + 1}`,
                    amount: number(component.amount, 0, 0, 100_000_000),
                    category: typeof component.category === 'string' ? component.category : 'other'
                }));
            const componentTotal = Math.round(components.reduce((sum, component) => sum + component.amount, 0) * 100) / 100;
            const deductions = number(item.deductions, 0, 0, 100_000_000);
            const grossAmount = number(item.grossAmount, componentTotal || 0, 0, 100_000_000);
            const amount = number(item.amount, Math.max(0, grossAmount - deductions), 0, 100_000_000);
            return {
                id: typeof item.id === 'string' && item.id ? item.id : `actual_${item.periodEnd || ''}`,
                periodStart: isValidDate(item.periodStart) ? item.periodStart : '',
                periodEnd: isValidDate(item.periodEnd) ? item.periodEnd : '',
                paydayDate: isValidDate(item.paydayDate) ? item.paydayDate : '',
                amount,
                grossAmount,
                deductions,
                components,
                overtimePay: number(item.overtimePay, 0, 0, 100_000_000),
                socialInsurance: number(item.socialInsurance, 0, 0, 100_000_000),
                note: typeof item.note === 'string' ? item.note : '',
                source: item.source === 'bank' ? 'bank' : 'manual',
                updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : ''
            };
        });
    return {
        monthlySalary: componentTotal > 0 ? componentTotal : monthlySalary,
        currency: typeof merged.currency === 'string' && merged.currency ? merged.currency : 'CNY',
        workdaysPerMonth: number(merged.workdaysPerMonth, 21.75, 1, 31, true),
        hoursPerDay: number(merged.hoursPerDay, 8, 1, 24, true),
        weekdayMultiplier: number(merged.weekdayMultiplier, 1.5, 1, 5),
        weekendMultiplier: number(merged.weekendMultiplier, 2, 1, 5),
        holidayMultiplier: number(merged.holidayMultiplier, 3, 1, 5),
        annualLeaveQuota: number(merged.annualLeaveQuota, 0, 0, 365),
        payday,
        salaryCycleMode: merged.salaryCycleMode === 'calendar' ? 'calendar' : 'payday',
        overtimeBaseMode: merged.overtimeBaseMode === 'total' ? 'total' : 'base',
        leaveDeductionMode: merged.leaveDeductionMode === 'base' ? 'base' : 'fixed',
        salaryComponents,
        salaryActuals
    };
}

export function isValidDate(value) {
    const match = String(value || '').match(DATE_PATTERN);
    if (!match) return false;
    const [, year, month, day] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return date.getFullYear() === Number(year)
        && date.getMonth() === Number(month) - 1
        && date.getDate() === Number(day);
}

export function isValidTime(value) {
    const match = String(value || '').match(TIME_PATTERN);
    if (!match) return false;
    const [, hours, minutes] = match;
    return Number(hours) >= 0 && Number(hours) <= 23
        && Number(minutes) >= 0 && Number(minutes) <= 59;
}

/** Minutes between two local wall-clock times; end <= start crosses midnight. */
export function calculateOvertimeMinutes(start, end) {
    if (!isValidTime(start) || !isValidTime(end)) return 0;
    const [startHour, startMinute] = start.split(':').map(Number);
    const [endHour, endMinute] = end.split(':').map(Number);
    const startTotal = startHour * 60 + startMinute;
    const endTotal = endHour * 60 + endMinute;
    if (endTotal === startTotal) return 0;
    const minutes = endTotal > startTotal ? endTotal - startTotal : endTotal + 24 * 60 - startTotal;
    return Math.min(minutes, 24 * 60);
}

export function calculateOvertimeHours(start, end) {
    return Math.round((calculateOvertimeMinutes(start, end) / 60) * 100) / 100;
}

export function getOvertimeMultiplier(type, config = DEFAULT_OVERTIME_CONFIG) {
    const normalized = normalizeOvertimeConfig(config);
    if (type === 'weekend') return normalized.weekendMultiplier;
    if (type === 'holiday') return normalized.holidayMultiplier;
    return normalized.weekdayMultiplier;
}

export function getHourlyRate(config = DEFAULT_OVERTIME_CONFIG) {
    const normalized = normalizeOvertimeConfig(config);
    const monthlyHours = normalized.workdaysPerMonth * normalized.hoursPerDay;
    if (!(monthlyHours > 0)) return 0;
    return getOvertimeBaseSalary(normalized) / monthlyHours;
}

/** Suggested type from a local date: weekends default to the weekend rate. */
export function inferOvertimeType(date) {
    if (!isValidDate(date)) return 'weekday';
    const [year, month, day] = date.split('-').map(Number);
    const weekday = new Date(year, month - 1, day).getDay();
    return weekday === 0 || weekday === 6 ? 'weekend' : 'weekday';
}

export function normalizeOvertimeRecord(record = {}) {
    const hours = Number.isFinite(Number(record.hours))
        ? Number(record.hours)
        : calculateOvertimeHours(record.start, record.end);
    return {
        id: typeof record.id === 'string' && record.id ? record.id : '',
        date: isValidDate(record.date) ? record.date : '',
        start: isValidTime(record.start) ? record.start : '18:00',
        end: isValidTime(record.end) ? record.end : '20:00',
        hours: Math.min(24, Math.max(0, Math.round(hours * 100) / 100)),
        type: OVERTIME_TYPES.includes(record.type) ? record.type : 'weekday',
        compensation: COMPENSATION_TYPES.includes(record.compensation) ? record.compensation : 'pay',
        note: typeof record.note === 'string' ? record.note : '',
        actualPay: record.actualPay !== null && record.actualPay !== undefined && record.actualPay !== ''
            && Number.isFinite(Number(record.actualPay)) && Number(record.actualPay) >= 0
            ? Math.round(Number(record.actualPay) * 100) / 100
            : null,
        aiLocked: record.aiLocked === true,
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : ''
    };
}

export function calculateRecordPay(record, config = DEFAULT_OVERTIME_CONFIG) {
    const normalizedRecord = normalizeOvertimeRecord(record);
    if (normalizedRecord.compensation !== 'pay') return 0;
    const rate = getHourlyRate(config) * getOvertimeMultiplier(normalizedRecord.type, config);
    return Math.round(rate * normalizedRecord.hours * 100) / 100;
}

/** Actual paid amount wins over the configured estimate when present. */
export function getRecordPay(record, config = DEFAULT_OVERTIME_CONFIG) {
    const normalizedRecord = normalizeOvertimeRecord(record);
    if (normalizedRecord.compensation !== 'pay') return 0;
    if (normalizedRecord.actualPay !== null) return normalizedRecord.actualPay;
    return calculateRecordPay(normalizedRecord, config);
}

export function getMonthKey(date) {
    return isValidDate(date) ? String(date).slice(0, 7) : '';
}

export function getYearKey(date) {
    return isValidDate(date) ? String(date).slice(0, 4) : '';
}

export function summarizeOvertimeRecords(records = [], config = DEFAULT_OVERTIME_CONFIG) {
    const summary = {
        hours: 0,
        payableHours: 0,
        pay: 0,
        estimatedPay: 0,
        actualPayCount: 0,
        count: 0,
        byType: { weekday: 0, weekend: 0, holiday: 0 },
        payableByType: { weekday: 0, weekend: 0, holiday: 0 }
    };
    for (const record of Array.isArray(records) ? records : []) {
        const normalized = normalizeOvertimeRecord(record);
        if (!normalized.date || normalized.hours <= 0) continue;
        summary.count += 1;
        summary.hours += normalized.hours;
        summary.byType[normalized.type] += normalized.hours;
        if (normalized.compensation === 'pay') {
            summary.payableHours += normalized.hours;
            summary.payableByType[normalized.type] += normalized.hours;
            summary.pay += getRecordPay(normalized, config);
            summary.estimatedPay += calculateRecordPay(normalized, config);
            if (normalized.actualPay !== null) summary.actualPayCount += 1;
        }
    }
    summary.hours = Math.round(summary.hours * 100) / 100;
    summary.payableHours = Math.round(summary.payableHours * 100) / 100;
    summary.pay = Math.round(summary.pay * 100) / 100;
    summary.estimatedPay = Math.round(summary.estimatedPay * 100) / 100;
    for (const key of OVERTIME_TYPES) {
        summary.byType[key] = Math.round(summary.byType[key] * 100) / 100;
        summary.payableByType[key] = Math.round(summary.payableByType[key] * 100) / 100;
    }
    return summary;
}

export function filterRecordsByPeriod(records = [], { year, month, day } = {}) {
    return (Array.isArray(records) ? records : []).filter(record => {
        if (!isValidDate(record?.date)) return false;
        if (year && getYearKey(record.date) !== String(year)) return false;
        if (month && getMonthKey(record.date) !== `${year}-${String(month).padStart(2, '0')}`) return false;
        if (day && record.date !== `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`) return false;
        return true;
    });
}

export function getMonthSummary(records = [], year, month, config = DEFAULT_OVERTIME_CONFIG) {
    return summarizeOvertimeRecords(filterRecordsByPeriod(records, { year, month }), config);
}

export function getYearSummary(records = [], year, config = DEFAULT_OVERTIME_CONFIG) {
    return summarizeOvertimeRecords(filterRecordsByPeriod(records, { year }), config);
}

export function groupRecordsByMonth(records = [], year) {
    const groups = new Map();
    for (const record of filterRecordsByPeriod(records, { year })) {
        const key = getMonthKey(record.date);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(record);
    }
    return groups;
}

export function groupRecordsByDay(records = [], year, month) {
    const groups = new Map();
    for (const record of filterRecordsByPeriod(records, { year, month })) {
        if (!groups.has(record.date)) groups.set(record.date, []);
        groups.get(record.date).push(record);
    }
    return groups;
}

function shiftMonth(year, month, delta) {
    const date = new Date(year, month - 1 + delta, 1);
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/**
 * Estimate the current month from last month's payable overtime.
 *
 * - `lastMonthHours` / `lastMonthPay`: what was actually recorded last month.
 * - `expectedHours`: last month's payable hours (the explicit "推测" basis).
 * - `expectedPay`: those hours re-priced with the *current* salary and last
 *   month's type mix, so a salary change is reflected immediately.
 * - If last month has no payable records, fall back to projecting the current
 *   month's hours over the elapsed days (`basis: 'current_month'`).
 */
export function estimateOvertime(records = [], referenceDate = new Date(), config = DEFAULT_OVERTIME_CONFIG) {
    const normalizedConfig = normalizeOvertimeConfig(config);
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth() + 1;
    const previous = shiftMonth(year, month, -1);
    const lastMonthSummary = getMonthSummary(records, previous.year, previous.month, normalizedConfig);
    const currentSummary = getMonthSummary(records, year, month, normalizedConfig);
    const rate = getHourlyRate(normalizedConfig);

    let expectedHours = 0;
    let weightedMultiplier = 0;
    let basis = 'none';

    if (lastMonthSummary.payableHours > 0) {
        expectedHours = lastMonthSummary.payableHours;
        const mix = lastMonthSummary.payableByType;
        const total = mix.weekday + mix.weekend + mix.holiday;
        weightedMultiplier = total > 0
            ? (mix.weekday * normalizedConfig.weekdayMultiplier
                + mix.weekend * normalizedConfig.weekendMultiplier
                + mix.holiday * normalizedConfig.holidayMultiplier) / total
            : normalizedConfig.weekdayMultiplier;
        basis = 'last_month';
    } else if (currentSummary.payableHours > 0) {
        const elapsedDays = Math.max(1, referenceDate.getDate());
        const daysInMonth = new Date(year, month, 0).getDate();
        expectedHours = Math.round(currentSummary.payableHours / elapsedDays * daysInMonth * 100) / 100;
        const mix = currentSummary.payableByType;
        const total = mix.weekday + mix.weekend + mix.holiday;
        weightedMultiplier = total > 0
            ? (mix.weekday * normalizedConfig.weekdayMultiplier
                + mix.weekend * normalizedConfig.weekendMultiplier
                + mix.holiday * normalizedConfig.holidayMultiplier) / total
            : normalizedConfig.weekdayMultiplier;
        basis = 'current_month';
    }

    return {
        lastMonth: { ...previous, ...lastMonthSummary },
        currentMonth: { year, month, ...currentSummary },
        hourlyRate: Math.round(rate * 100) / 100,
        expectedHours: Math.round(expectedHours * 100) / 100,
        expectedPay: Math.round(expectedHours * rate * weightedMultiplier * 100) / 100,
        weightedMultiplier: Math.round(weightedMultiplier * 100) / 100,
        basis
    };
}


// --- Leave records -----------------------------------------------------------

function dateToUtcDay(value) {
    if (!isValidDate(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** Inclusive calendar days between two local dates. */
export function calculateLeaveDays(startDate, endDate) {
    const start = dateToUtcDay(startDate);
    const end = dateToUtcDay(endDate);
    if (start === null || end === null || end < start) return 0;
    return Math.round(end - start + 1);
}

/** Overlap between a leave range and a period (inclusive UTC day numbers). */
function overlapDays(startDay, endDay, periodStartDay, periodEndDay) {
    const from = Math.max(startDay, periodStartDay);
    const to = Math.min(endDay, periodEndDay);
    return to >= from ? to - from + 1 : 0;
}

function periodRange(period = {}) {
    const { year, month, day } = period;
    if (isValidDate(period.startDate) && isValidDate(period.endDate)) {
        return {
            from: dateToUtcDay(period.startDate),
            to: dateToUtcDay(period.endDate)
        };
    }
    if (year && month && day) {
        const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayNumber = dateToUtcDay(value);
        return { from: dayNumber, to: dayNumber };
    }
    if (year && month) {
        return {
            from: Date.UTC(year, month - 1, 1) / 86_400_000,
            to: Date.UTC(year, month, 0) / 86_400_000
        };
    }
    if (year) {
        return {
            from: Date.UTC(year, 0, 1) / 86_400_000,
            to: Date.UTC(year, 11, 31) / 86_400_000
        };
    }
    return null;
}

export function normalizeLeaveRecord(record = {}) {
    const startDate = isValidDate(record.startDate) ? record.startDate : '';
    let endDate = isValidDate(record.endDate) ? record.endDate : startDate;
    if (startDate && endDate && endDate < startDate) endDate = startDate;
    const unit = LEAVE_UNITS.includes(record.unit) ? record.unit : 'day';
    const calculated = unit === 'day' ? calculateLeaveDays(startDate, endDate) : 0;
    const provided = Number(record.duration);
    const duration = Number.isFinite(provided) && provided > 0
        ? Math.round(provided * 100) / 100
        : (calculated || (unit === 'hour' ? 1 : 0));
    return {
        id: typeof record.id === 'string' && record.id ? record.id : '',
        startDate,
        endDate,
        unit,
        duration,
        type: LEAVE_TYPES.includes(record.type) ? record.type : 'annual',
        paid: record.paid !== false,
        note: typeof record.note === 'string' ? record.note : '',
        aiLocked: record.aiLocked === true,
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : ''
    };
}

export function getLeaveRecordDays(record) {
    const normalized = normalizeLeaveRecord(record);
    if (normalized.unit === 'day') return normalized.duration;
    return normalized.duration / 8;
}

export function summarizeLeaveRecords(records = [], config = DEFAULT_OVERTIME_CONFIG, period = null) {
    const normalizedConfig = normalizeOvertimeConfig(config);
    const range = periodRange(period || {});
    const summary = {
        days: 0,
        hours: 0,
        paidDays: 0,
        unpaidDays: 0,
        count: 0,
        byType: Object.fromEntries(LEAVE_TYPES.map(type => [type, 0]))
    };

    for (const raw of Array.isArray(records) ? records : []) {
        const record = normalizeLeaveRecord(raw);
        if (!record.startDate || record.duration <= 0) continue;
        let dayAmount = 0;
        let hourAmount = 0;
        if (record.unit === 'day') {
            if (range) {
                const start = dateToUtcDay(record.startDate);
                const end = dateToUtcDay(record.endDate) ?? start;
                const overlap = overlapDays(start, end, range.from, range.to);
                if (overlap <= 0) continue;
                const fullDays = calculateLeaveDays(record.startDate, record.endDate) || 1;
                dayAmount = overlap * (record.duration / fullDays);
            } else {
                dayAmount = record.duration;
            }
        } else {
            if (range) {
                const start = dateToUtcDay(record.startDate);
                if (start === null || start < range.from || start > range.to) continue;
            }
            hourAmount = record.duration;
        }
        summary.count += 1;
        summary.days += dayAmount;
        summary.hours += hourAmount;
        const dayEquivalent = dayAmount + hourAmount / normalizedConfig.hoursPerDay;
        summary.byType[record.type] += dayEquivalent;
        if (record.paid) summary.paidDays += dayEquivalent;
        else summary.unpaidDays += dayEquivalent;
    }

    summary.days = Math.round(summary.days * 100) / 100;
    summary.hours = Math.round(summary.hours * 100) / 100;
    summary.paidDays = Math.round(summary.paidDays * 100) / 100;
    summary.unpaidDays = Math.round(summary.unpaidDays * 100) / 100;
    for (const type of LEAVE_TYPES) {
        summary.byType[type] = Math.round(summary.byType[type] * 100) / 100;
    }
    return summary;
}

export function getLeaveMonthSummary(records = [], year, month, config = DEFAULT_OVERTIME_CONFIG) {
    return summarizeLeaveRecords(records, config, { year, month });
}

export function getLeaveYearSummary(records = [], year, config = DEFAULT_OVERTIME_CONFIG) {
    return summarizeLeaveRecords(records, config, { year });
}

export function getAnnualLeaveBalance(records = [], year, config = DEFAULT_OVERTIME_CONFIG) {
    const normalized = normalizeOvertimeConfig(config);
    const used = getLeaveYearSummary(records, year, normalized).byType.annual || 0;
    return {
        quota: normalized.annualLeaveQuota,
        used: Math.round(used * 100) / 100,
        remaining: Math.round((normalized.annualLeaveQuota - used) * 100) / 100
    };
}
