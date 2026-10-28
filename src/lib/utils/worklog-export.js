// Shared, field-configurable export for worklog records.
//
// The "clean" preset intentionally excludes pay/compensation so a timesheet
// can be shared without exposing salary information. Custom mode lets the user
// pick exactly which columns go into CSV/Excel/JSON.

import { exportToCSV, exportToExcel, exportToJSON } from './export.js';
import { calculateRecordPay } from './overtime.js';

export const OVERTIME_FIELDS = ['date', 'start', 'end', 'hours', 'type', 'compensation', 'pay', 'note'];
export const LEAVE_FIELDS = ['startDate', 'endDate', 'duration', 'unit', 'type', 'paid', 'note'];
export const BOSS_FIELDS = ['date', 'hours', 'note'];
export const BOSS_LEAVE_FIELDS = ['startDate', 'endDate', 'duration', 'note'];

export const WORKLOG_PRESETS = ['boss', 'full', 'custom'];

export function getDefaultWorklogFields(kind) {
    return kind === 'leave' ? LEAVE_FIELDS : OVERTIME_FIELDS;
}

function overtimeValue(record, field, context) {
    const labels = context.labels || {};
    switch (field) {
        case 'date': return record.date;
        case 'start': return record.start;
        case 'end': return record.end;
        case 'hours': return record.hours;
        case 'type': return labels.type?.[record.type] || record.type;
        case 'compensation': return labels.compensation?.[record.compensation || 'pay'] || record.compensation;
        case 'pay': return calculateRecordPay(record, context.config);
        case 'note': return record.note || '';
        case 'kind': return context.kindLabel;
        default: return '';
    }
}

function leaveValue(record, field, context) {
    const labels = context.labels || {};
    switch (field) {
        case 'startDate': return record.startDate;
        case 'endDate': return record.endDate;
        case 'duration': return record.duration;
        case 'unit': return labels.unit?.[record.unit] || record.unit;
        case 'type': return labels.type?.[record.type] || record.type;
        case 'paid': return record.paid ? labels.paid : labels.unpaid;
        case 'note': return record.note || '';
        case 'kind': return context.kindLabel;
        default: return '';
    }
}

export function filterWorklogRecords(kind, records, scope, year, month) {
    const list = Array.isArray(records) ? records : [];
    if (scope === 'all') return list;
    if (scope === 'month') {
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        if (kind === 'leave') {
            const last = new Date(Number(year), Number(month), 0).getDate();
            const start = `${prefix}-01`;
            const end = `${prefix}-${String(last).padStart(2, '0')}`;
            return list.filter(record => record.startDate <= end && record.endDate >= start);
        }
        return list.filter(record => String(record.date || '').startsWith(prefix));
    }
    return list.filter(record => {
        if (kind === 'leave') {
            return String(record.startDate || '').slice(0, 4) <= String(year)
                && String(record.endDate || '').slice(0, 4) >= String(year);
        }
        return String(record.date || '').slice(0, 4) === String(year);
    });
}

export function buildWorklogRows(kind, records, fields, context = {}) {
    const value = kind === 'leave' ? leaveValue : overtimeValue;
    const labelMap = context.fieldLabels || {};
    return (Array.isArray(records) ? records : []).map(record => {
        const row = {};
        for (const field of fields) {
            row[labelMap[field] || field] = value(record, field, context);
        }
        return row;
    });
}

export async function exportWorklog({
    kind,
    records,
    fields,
    format,
    scope,
    year,
    month,
    fieldLabels,
    labels,
    config,
    kindLabel,
    sheetName,
    showToast
}) {
    const rows = buildWorklogRows(kind, records, fields, { fieldLabels, labels, config, kindLabel });
    if (rows.length === 0) {
        showToast?.({ message: labels?.noExport || '没有可导出的记录', type: 'warning' });
        return { success: false, empty: true };
    }
    const monthValue = String(Number(month) || 1).padStart(2, '0');
    const suffix = scope === 'year'
        ? String(year)
        : scope === 'month'
            ? `${year}-${monthValue}`
            : 'all';
    const filenameBase = `worklog_${kind}_${suffix}`;
    if (format === 'json') {
        return await exportToJSON({
            exportedAt: new Date().toISOString(),
            kind,
            year: scope === 'year' ? year : scope === 'month' ? `${year}-${monthValue}` : 'all',
            month: scope === 'month' ? Number(month) : null,
            fields,
            records: rows
        }, `${filenameBase}.json`, { showToast });
    }
    if (format === 'xlsx') {
        return await exportToExcel(rows, `${filenameBase}.xlsx`, {
            showToast,
            sheetName: sheetName || 'Worklog'
        });
    }
    return await exportToCSV(rows, `${filenameBase}.csv`, { showToast });
}
