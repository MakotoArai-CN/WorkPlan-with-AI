// Shared, field-configurable export for worklog records.
//
// The "boss" preset intentionally excludes pay/compensation so a timesheet can
// be shared without exposing salary information. Custom mode lets the user pick
// exactly which columns go into CSV/Excel/JSON.

import { exportToCSV, exportToExcel, exportToJSON } from './export.js';
import { calculateRecordPay } from './overtime.js';

export const OVERTIME_FIELDS = ['date', 'start', 'end', 'hours', 'type', 'compensation', 'pay', 'note'];
export const LEAVE_FIELDS = ['startDate', 'endDate', 'duration', 'unit', 'type', 'paid', 'note'];
export const BOSS_FIELDS = ['date', 'kind', 'hours', 'note'];
export const BOSS_LEAVE_FIELDS = ['startDate', 'endDate', 'kind', 'duration', 'note'];

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
    const suffix = scope === 'year' ? String(year) : 'all';
    const filenameBase = `worklog_${kind}_${suffix}`;
    if (format === 'json') {
        return await exportToJSON({
            exportedAt: new Date().toISOString(),
            kind,
            year: scope === 'year' ? year : 'all',
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
