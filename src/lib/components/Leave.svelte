<script>
    export let embedded = false;
    export let hideSummary = false;
    import { taskStore } from '../stores/tasks.js';
    import { settingsStore } from '../stores/settings.js';
    import { showConfirm, showToast } from '../stores/modal.js';
    import { exportToCSV, exportToExcel, exportToJSON } from '../utils/export.js';
    import DatePicker from './DatePicker.svelte';
    import AnimatedModal from './AnimatedModal.svelte';
    import SegmentedControl from './SegmentedControl.svelte';
    import SelectMenu from './SelectMenu.svelte';
    import WorklogDetailCard from './WorklogDetailCard.svelte';
    import WorklogCalendar from './WorklogCalendar.svelte';
    import WorklogRecordRow from './WorklogRecordRow.svelte';
    import { _, locale } from 'svelte-i18n';
    import { toIntlLocale } from '../i18n/index.js';
    import { formatLocalDate } from '../utils/datetime.js';
    import {
        DEFAULT_OVERTIME_CONFIG,
        LEAVE_TYPES,
        calculateLeaveDays,
        getAnnualLeaveBalance,
        getFixedSalaryTotal,
        getLeaveMonthSummary,
        getLeaveYearSummary,
        summarizeLeaveRecords,
        isValidDate,
        normalizeLeaveRecord
    } from '../utils/overtime.js';

    const TYPE_STYLES = {
        annual: 'bg-rose-50 text-rose-600 border-rose-100 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800',
        sick: 'bg-sky-50 text-sky-600 border-sky-100 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800',
        personal: 'bg-orange-50 text-orange-600 border-orange-100 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800',
        compensatory: 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
        maternity: 'bg-purple-50 text-purple-600 border-purple-100 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
        marriage: 'bg-pink-50 text-pink-600 border-pink-100 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-800',
        bereavement: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600',
        other: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600'
    };

    export let viewMode = 'month';
    let showForm = false;
    let editingId = null;
    let saving = false;
    let exportOpen = false;
    let detailLayout = 'list';
    let form = createEmptyForm();

    const now = new Date();
    let cursorYear = now.getFullYear();
    let cursorMonth = now.getMonth() + 1;
    let cursorDay = now.getDate();

    $: config = { ...DEFAULT_OVERTIME_CONFIG, ...($settingsStore.overtimeConfig || {}) };
    $: leaveRecords = ($taskStore.leaveRecords || []).map(normalizeLeaveRecord);
    $: localeCode = toIntlLocale($locale || 'zh');
    $: todayValue = formatLocalDate(new Date());
    $: monthSummary = getLeaveMonthSummary(leaveRecords, cursorYear, cursorMonth, config);
    $: yearSummary = getLeaveYearSummary(leaveRecords, cursorYear, config);
    $: daySummary = summarizeLeaveRecords(leaveRecords, config, { year: cursorYear, month: cursorMonth, day: cursorDay });
    $: balance = getAnnualLeaveBalance(leaveRecords, cursorYear, config);
    $: monthRecords = leaveRecords
        .filter(record => overlapsMonth(record, cursorYear, cursorMonth))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    $: dayRecords = leaveRecords
        .filter(record => record.startDate <= selectedDayValue() && record.endDate >= selectedDayValue())
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    $: detailOptions = [
        { value: 'list', label: $_('overtime.layout_list'), icon: 'ph-list-bullets' },
        { value: 'calendar', label: $_('overtime.layout_calendar'), icon: 'ph-calendar-blank' }
    ];
    $: calendarCells = (() => {
        const firstWeekday = (new Date(cursorYear, cursorMonth - 1, 1).getDay() + 6) % 7;
        const days = new Date(cursorYear, cursorMonth, 0).getDate();
        return [...Array(firstWeekday).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
    })();
    $: leaveByDay = (() => {
        const map = new Map();
        const { start, end } = monthBounds(cursorYear, cursorMonth);
        for (const record of monthRecords) {
            const from = record.startDate > start ? record.startDate : start;
            const to = record.endDate < end ? record.endDate : end;
            let cursor = new Date(`${from}T00:00:00`);
            const last = new Date(`${to}T00:00:00`);
            while (cursor <= last) {
                const key = formatLocalDate(cursor);
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(record);
                cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
            }
        }
        return map;
    })();
    $: leaveCalendarDays = calendarCells.map(day => {
        if (!day) return null;
        const dayKey = `${cursorYear}-${String(cursorMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayLeave = leaveByDay.get(dayKey) || [];
        const daySummary = summarizeLeaveRecords(dayLeave, config, { year: cursorYear, month: cursorMonth, day });
        return {
            day,
            primary: dayLeave.length ? formatLeave(daySummary) : '',
            secondary: dayLeave.length ? dayLeave.map(record => $_(`leave.type_${record.type}`)).slice(0, 2).join(' / ') : '',
            dots: dayLeave.map(record => record.type === 'annual' ? 'bg-rose-500' : record.type === 'sick' ? 'bg-sky-400' : 'bg-orange-400')
        };
    });

    $: yearMonths = Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        summary: getLeaveMonthSummary(leaveRecords, cursorYear, index + 1, config)
    }));
    $: unitOptions = [
        { value: 'day', label: $_('leave.unit_day') },
        { value: 'hour', label: $_('leave.unit_hour') }
    ];
    $: leaveTypeOptions = LEAVE_TYPES.map(type => ({ value: type, label: $_('leave.type_' + type) }));
    $: paidOptions = [
        { value: true, label: $_('leave.paid') },
        { value: false, label: $_('leave.unpaid') }
    ];
    $: viewOptions = [
        { value: 'year', label: $_('leave.view_year') },
        { value: 'month', label: $_('leave.view_month') },
        { value: 'day', label: $_('leave.view_day') }
    ];
    $: cursorLabel = (() => {
        if (viewMode === 'year') {
            return new Date(cursorYear, 0, 1).toLocaleDateString(localeCode, { year: 'numeric' });
        }
        if (viewMode === 'day') {
            return new Date(cursorYear, cursorMonth - 1, cursorDay).toLocaleDateString(localeCode, {
                year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
            });
        }
        return new Date(cursorYear, cursorMonth - 1, 1).toLocaleDateString(localeCode, {
            year: 'numeric', month: 'long'
        });
    })();
    $: formDays = form.unit === 'day'
        ? calculateLeaveDays(form.startDate, form.endDate)
        : 0;

    function createEmptyForm() {
        const value = formatLocalDate(new Date());
        return {
            startDate: value,
            endDate: value,
            unit: 'day',
            duration: 1,
            type: 'annual',
            paid: true,
            note: '',
            aiLocked: false
        };
    }

    function selectedDayValue() {
        return `${cursorYear}-${String(cursorMonth).padStart(2, '0')}-${String(cursorDay).padStart(2, '0')}`;
    }

    function monthBounds(year, month) {
        const last = new Date(year, month, 0).getDate();
        return {
            start: `${year}-${String(month).padStart(2, '0')}-01`,
            end: `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`
        };
    }

    function overlapsMonth(record, year, month) {
        const { start, end } = monthBounds(year, month);
        return record.startDate <= end && record.endDate >= start;
    }

    function formatLeave(summary) {
        if (summary.hours > 0 && summary.days > 0) return `${summary.days} ${$_('leave.unit_day')} + ${summary.hours} ${$_('leave.unit_hour')}`;
        if (summary.hours > 0) return `${summary.hours} ${$_('leave.unit_hour')}`;
        return `${summary.days} ${$_('leave.unit_day')}`;
    }

    function money(value) {
        return new Intl.NumberFormat(localeCode, {
            style: 'currency',
            currency: config.currency || 'CNY',
            maximumFractionDigits: 2
        }).format(Number(value) || 0);
    }

    function leaveDeduction(record) {
        if (record.paid) return 0;
        const dailyRate = getFixedSalaryTotal(config) / (Number(config.workdaysPerMonth) || 21.75);
        return record.unit === 'day'
            ? record.duration * dailyRate
            : record.duration * dailyRate / (Number(config.hoursPerDay) || 8);
    }

    function makeLeaveRow(record) {
        return {
            record,
            dateMain: record.startDate.slice(8, 10),
            dateSub: new Date(`${record.startDate}T00:00:00`).toLocaleDateString(localeCode, { weekday: 'short' }),
            badge: $_('leave.type_' + record.type),
            badgeClass: TYPE_STYLES[record.type] || TYPE_STYLES.other,
            title: formatRecord(record),
            detail: `${record.startDate}${record.endDate === record.startDate ? '' : ` → ${record.endDate}`} · ${record.paid ? $_('leave.paid') : $_('leave.unpaid')}`,
            note: record.note || '',
            metric: formatRecord(record),
            amount: record.paid ? $_('leave.paid') : `-${money(leaveDeduction(record))}`,
            amountClass: record.paid ? 'text-emerald-600' : 'text-rose-500'
        };
    }

    function formatRecord(record) {
        if (record.unit === 'hour') return `${record.duration} ${$_('leave.unit_hour')}`;
        return `${record.duration} ${$_('leave.unit_day')}`;
    }

    function shiftCursor(delta) {
        if (viewMode === 'year') {
            cursorYear += delta;
            return;
        }
        if (viewMode === 'day') {
            const next = new Date(cursorYear, cursorMonth - 1, cursorDay + delta);
            cursorYear = next.getFullYear();
            cursorMonth = next.getMonth() + 1;
            cursorDay = next.getDate();
            return;
        }
        const next = new Date(cursorYear, cursorMonth - 1 + delta, 1);
        cursorYear = next.getFullYear();
        cursorMonth = next.getMonth() + 1;
        cursorDay = Math.min(cursorDay, new Date(cursorYear, cursorMonth, 0).getDate());
    }

    function goToday() {
        const date = new Date();
        cursorYear = date.getFullYear();
        cursorMonth = date.getMonth() + 1;
        cursorDay = date.getDate();
    }

    function selectMonth(month) {
        cursorMonth = month;
        cursorDay = 1;
        viewMode = 'month';
    }

    function selectDay(day) {
        cursorDay = day;
        viewMode = 'day';
    }

    function openCreateInternal() {
        editingId = null;
        form = createEmptyForm();
        if (viewMode !== 'day' && !(cursorYear === now.getFullYear() && cursorMonth === now.getMonth() + 1)) {
            form.startDate = `${cursorYear}-${String(cursorMonth).padStart(2, '0')}-01`;
            form.endDate = form.startDate;
        }
        form.duration = form.unit === 'day' ? calculateLeaveDays(form.startDate, form.endDate) : 1;
        showForm = true;
    }

    export function openCreate() {
        openCreateInternal();
    }

    function openEdit(record) {
        editingId = record.id;
        form = {
            startDate: record.startDate,
            endDate: record.endDate,
            unit: record.unit,
            duration: record.duration,
            type: record.type,
            paid: record.paid,
            note: record.note || '',
            aiLocked: record.aiLocked === true
        };
        showForm = true;
    }

    function closeForm() {
        showForm = false;
        saving = false;
    }

    function syncDurationFromDates() {
        if (!editingId && form.unit === 'day') {
            form.duration = calculateLeaveDays(form.startDate, form.endDate);
        }
    }

    function changeUnit() {
        if (!editingId) {
            form.duration = form.unit === 'day' ? calculateLeaveDays(form.startDate, form.endDate) : 1;
        }
    }

    function saveRecord() {
        if (saving) return;
        if (!isValidDate(form.startDate) || !isValidDate(form.endDate) || form.endDate < form.startDate) {
            showToast({ message: $_('leave.invalid_date'), type: 'error' });
            return;
        }
        if (!(Number(form.duration) > 0)) {
            showToast({ message: $_('leave.invalid_duration'), type: 'error' });
            return;
        }
        saving = true;
        const existing = editingId ? leaveRecords.find(record => record.id === editingId) : null;
        const record = normalizeLeaveRecord({
            ...form,
            duration: Number(form.duration),
            id: editingId || `leave_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        if (editingId) {
            taskStore.updateLeaveRecord(editingId, record);
        } else {
            taskStore.addLeaveRecord(record);
        }
        cursorYear = Number(record.startDate.slice(0, 4));
        cursorMonth = Number(record.startDate.slice(5, 7));
        cursorDay = Number(record.startDate.slice(8, 10));
        showForm = false;
        saving = false;
        showToast({
            message: editingId ? $_('leave.updated') : $_('leave.saved'),
            type: 'success'
        });
    }

    async function deleteRecord(record) {
        const confirmed = await showConfirm({
            title: $_('leave.delete_title'),
            message: $_('leave.delete_confirm', { values: { date: record.startDate } }),
            confirmText: $_('leave.delete'),
            cancelText: $_('leave.cancel'),
            variant: 'danger'
        });
        if (!confirmed) return;
        taskStore.deleteLeaveRecord(record.id);
        showToast({ message: $_('leave.deleted'), type: 'success' });
    }

    function updateQuota(value) {
        settingsStore.updateOvertimeConfig({ annualLeaveQuota: Number(value) || 0 });
    }

    function exportRows(scope) {
        const records = scope === 'year'
            ? leaveRecords.filter(record => record.startDate.slice(0, 4) === String(cursorYear))
            : leaveRecords.slice();
        return records.map(record => ({
            [$_('leave.export_start')]: record.startDate,
            [$_('leave.export_end')]: record.endDate,
            [$_('leave.export_duration')]: record.duration,
            [$_('leave.export_unit')]: record.unit === 'hour' ? $_('leave.unit_hour') : $_('leave.unit_day'),
            [$_('leave.export_type')]: $_('leave.type_' + record.type),
            [$_('leave.export_paid')]: record.paid ? $_('leave.paid') : $_('leave.unpaid'),
            [$_('leave.export_note')]: record.note
        }));
    }

    async function exportData(format, scope) {
        exportOpen = false;
        const rows = exportRows(scope);
        if (rows.length === 0) {
            showToast({ message: $_('leave.no_export'), type: 'warning' });
            return;
        }
        if (format === 'json') {
            const result = await exportToJSON({
                exportedAt: new Date().toISOString(),
                year: scope === 'year' ? cursorYear : 'all',
                leaveRecords: rows
            }, `leave_${scope === 'year' ? cursorYear : 'all'}.json`, { showToast });
            return result;
        }
        if (format === 'xlsx') {
            return await exportToExcel(rows, `leave_${scope === 'year' ? cursorYear : 'all'}.xlsx`, {
                showToast,
                sheetName: $_('leave.title')
            });
        }
        return await exportToCSV(rows, `leave_${scope === 'year' ? cursorYear : 'all'}.csv`, { showToast });
    }
</script>

<div class={`flex flex-col ${embedded ? 'h-full' : 'h-screen md:h-full'} overflow-hidden bg-slate-50`}>
    {#if !embedded}
    <header class="h-auto bg-white/90 backdrop-blur px-4 md:px-6 flex flex-col md:flex-row justify-between items-center z-10 sticky top-0 border-b border-slate-200 shrink-0 py-2 gap-2">
        {#if !embedded}
            <div class="w-full md:w-auto">
                <h2 class="text-lg font-bold text-rose-700 flex items-center gap-2">
                    <i class="ph-fill ph-calendar-check"></i> {$_('leave.title')}
                </h2>
                <div class="text-[10px] md:text-xs text-slate-500">{$_('leave.subtitle')}</div>
            </div>
        {/if}
        <div class={`flex items-center gap-2 w-full md:w-auto flex-wrap ${embedded ? 'md:ml-auto' : ''}`}>
            <SegmentedControl bind:value={viewMode} options={viewOptions} />
            {#if !embedded}
            <details bind:open={exportOpen} class="relative">
                <summary class="list-none h-9 px-3 bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 rounded-lg text-sm font-bold flex items-center gap-2 cursor-pointer">
                    <i class="ph ph-download-simple"></i>
                    <span class="hidden sm:inline">{$_('leave.export')}</span>
                </summary>
                <div class="absolute right-0 mt-1 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-20 p-1">
                    <button on:click={() => exportData('csv', 'year')} class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-rose-50 dark:hover:bg-slate-700">{$_('leave.export_csv_year')}</button>
                    <button on:click={() => exportData('csv', 'all')} class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-rose-50 dark:hover:bg-slate-700">{$_('leave.export_csv_all')}</button>
                    <button on:click={() => exportData('xlsx', 'year')} class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-rose-50 dark:hover:bg-slate-700">{$_('leave.export_excel_year')}</button>
                    <button on:click={() => exportData('xlsx', 'all')} class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-rose-50 dark:hover:bg-slate-700">{$_('leave.export_excel_all')}</button>
                    <button on:click={() => exportData('json', 'year')} class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-rose-50 dark:hover:bg-slate-700">{$_('leave.export_json_year')}</button>
                    <button on:click={() => exportData('json', 'all')} class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-rose-50 dark:hover:bg-slate-700">{$_('leave.export_json_all')}</button>
                </div>
            </details>
            {/if}
            {#if !embedded}
                <button on:click={openCreate}
                    class="h-9 px-4 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-sm font-bold shadow-md shadow-rose-200 flex items-center gap-2">
                    <i class="ph-bold ph-plus"></i>
                    <span class="hidden sm:inline">{$_('leave.add_record')}</span>
                </button>
            {/if}
        </div>
    </header>
    {/if}

    <div class="flex-1 overflow-y-auto overscroll-contain min-h-0" style="-webkit-overflow-scrolling: touch; scrollbar-gutter: stable;">
        <div class="p-4 md:p-6 space-y-5 pb-32">
            {#if !hideSummary}
            <div class="bg-white rounded-xl shadow-sm border border-slate-100 dark:bg-slate-800 dark:border-slate-700 p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4">
                <div class="flex items-center gap-3 flex-1">
                    <div class="w-11 h-11 rounded-xl bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                        <i class="ph-fill ph-calendar-check text-xl text-rose-600 dark:text-rose-300"></i>
                    </div>
                    <div>
                        <div class="text-[10px] md:text-xs font-bold text-slate-400 uppercase">{$_('leave.annual_quota')}</div>
                        <div class="flex items-center gap-2 mt-1">
                            <input type="number" min="0" max="365" step="0.5" value={config.annualLeaveQuota}
                                on:change={(event) => updateQuota(event.currentTarget.value)}
                                class="w-24 text-xl font-black text-slate-800 dark:text-slate-100 bg-transparent border-b border-dashed border-slate-300 dark:border-slate-600 focus:border-rose-400 outline-none" />
                            <span class="text-xs text-slate-500">{$_('leave.unit_day')}</span>
                        </div>
                    </div>
                </div>
                <div class="text-xs text-slate-500">
                    {$_('leave.used')}: <span class="font-bold text-slate-700 dark:text-slate-200">{balance.used}</span>
                    <span class="mx-2 text-slate-300">·</span>
                    {$_('leave.remaining')}: <span class="font-bold text-rose-600">{balance.remaining}</span>
                </div>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                <div class="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
                    <div class="text-[10px] md:text-xs font-bold text-slate-400 uppercase mb-1">{$_('leave.month_leave')}</div>
                    <div class="text-xl md:text-2xl font-black text-slate-700 dark:text-slate-100">{formatLeave(monthSummary)}</div>
                    <div class="text-[10px] text-slate-500 mt-1">{$_('leave.paid_days')}: {monthSummary.paidDays}</div>
                </div>
                <div class="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
                    <div class="text-[10px] md:text-xs font-bold text-rose-500 uppercase mb-1">{$_('leave.year_leave')}</div>
                    <div class="text-xl md:text-2xl font-black text-rose-600">{formatLeave(yearSummary)}</div>
                    <div class="text-[10px] text-slate-500 mt-1">{$_('leave.unpaid_days')}: {yearSummary.unpaidDays}</div>
                </div>
                <div class="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
                    <div class="text-[10px] md:text-xs font-bold text-sky-500 uppercase mb-1">{$_('leave.annual_used')}</div>
                    <div class="text-xl md:text-2xl font-black text-sky-600">{balance.used}</div>
                    <div class="text-[10px] text-slate-500 mt-1">{$_('leave.unit_day')}</div>
                </div>
                <div class="bg-gradient-to-br from-rose-500 to-pink-500 p-3 md:p-4 rounded-xl shadow-md shadow-rose-200 text-white">
                    <div class="text-[10px] md:text-xs font-bold text-rose-100 uppercase mb-1">{$_('leave.annual_remaining')}</div>
                    <div class="text-xl md:text-2xl font-black">{balance.remaining}</div>
                    <div class="text-[10px] text-rose-100 mt-1">{$_('leave.unit_day')}</div>
                </div>
            </div>

            {/if}

            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1">
                    <button on:click={() => shiftCursor(-1)} aria-label={$_('leave.previous')}
                        class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200 flex items-center justify-center dark:bg-slate-800 dark:border-slate-700">
                        <i class="ph-bold ph-caret-left"></i>
                    </button>
                    <button on:click={() => shiftCursor(1)} aria-label={$_('leave.next')}
                        class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200 flex items-center justify-center dark:bg-slate-800 dark:border-slate-700">
                        <i class="ph-bold ph-caret-right"></i>
                    </button>
                    <div class="ml-2 text-sm md:text-base font-bold text-slate-700 dark:text-slate-200">{cursorLabel}</div>
                </div>
                <button on:click={goToday}
                    class="h-8 px-3 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-slate-500 hover:text-rose-600 dark:bg-slate-800 dark:border-slate-700">
                    {$_('leave.today')}
                </button>
            </div>

            {#if viewMode === 'year'}
                <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                    {#each yearMonths as item}
                        <button on:click={() => selectMonth(item.month)}
                            class="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-left hover:border-rose-200 hover:shadow-md transition dark:bg-slate-800 dark:border-slate-700">
                            <div class="flex items-center justify-between">
                                <div class="font-bold text-slate-700 dark:text-slate-200">
                                    {new Date(cursorYear, item.month - 1, 1).toLocaleDateString(localeCode, { month: 'long' })}
                                </div>
                                <i class="ph ph-caret-right text-slate-300"></i>
                            </div>
                            <div class="text-2xl font-black text-rose-600 mt-3">{formatLeave(item.summary)}</div>
                            <div class="text-[10px] text-slate-500 mt-1">{$_('leave.paid_days')}: {item.summary.paidDays}</div>
                        </button>
                    {/each}
                </div>
            {:else}
                {@const visibleRecords = viewMode === 'day' ? dayRecords : monthRecords}
                <WorklogDetailCard
                    title={viewMode === 'day' ? $_('leave.day_detail') : $_('leave.month_detail')}
                    summary={formatLeave(viewMode === 'day' ? daySummary : monthSummary)}
                    rows={visibleRecords.map(makeLeaveRow)}
                    showLayout={viewMode === 'month'}
                    bind:layout={detailLayout}
                    emptyTitle={$_('leave.empty')}
                    emptyDesc={$_('leave.empty_desc')}
                    addLabel={$_('leave.add_record')}
                    onAdd={openCreate}
                    onEdit={openEdit}
                    onDelete={deleteRecord}
                    editLabel={$_('leave.edit_record')}
                    deleteLabel={$_('leave.delete')}
                >
                    <div slot="calendar">
                        <WorklogCalendar days={leaveCalendarDays} onSelectDay={selectDay} />
                    </div>
                </WorklogDetailCard>
            {/if}
        </div>
    </div>
</div>

<AnimatedModal bind:show={showForm} onClose={closeForm} zIndex={50} panelClass="max-w-lg">
            <div class="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40">
                <h3 class="font-bold text-lg text-slate-800 dark:text-slate-100">
                    {editingId ? $_('leave.edit_record') : $_('leave.add_record')}
                </h3>
                <button on:click={closeForm} aria-label={$_('leave.cancel')}><i class="ph ph-x text-xl"></i></button>
            </div>
            <div class="flex-1 overflow-y-auto p-6 space-y-4">
                <div class="grid grid-cols-2 gap-3">
                    <label class="flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('leave.start_date')}</span>
                        <DatePicker accent="rose" bind:value={form.startDate} onchange={syncDurationFromDates} />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('leave.end_date')}</span>
                        <DatePicker accent="rose" bind:value={form.endDate} onchange={syncDurationFromDates} />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('leave.unit')}</span>
                        <SelectMenu bind:value={form.unit} options={unitOptions} onchange={changeUnit} />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('leave.duration')}</span>
                        <input type="number" min="0.5" step="0.5" bind:value={form.duration}
                            class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200" />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('leave.type')}</span>
                        <SelectMenu bind:value={form.type} options={leaveTypeOptions} />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('leave.paid')}</span>
                        <SelectMenu bind:value={form.paid} options={paidOptions} />
                    </label>
                    <label class="col-span-2 flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('leave.note')}</span>
                        <textarea bind:value={form.note} rows="2" placeholder={$_('leave.note_placeholder')}
                            class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 resize-none"></textarea>
                    </label>
                    <label class="col-span-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 cursor-pointer">
                        <input type="checkbox" bind:checked={form.aiLocked}
                            class="rounded border-slate-300 text-rose-500 focus:ring-rose-400" />
                        <span class="text-xs font-bold text-slate-600 dark:text-slate-300">{$_('leave.ai_locked')}</span>
                        <span class="text-[10px] text-slate-400">{$_('leave.ai_locked_hint')}</span>
                    </label>
                </div>
                {#if form.unit === 'day'}
                    <div class="text-[10px] text-slate-500">
                        {$_('leave.auto_days')}: {formDays}
                    </div>
                {/if}
            </div>
            <div class="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex gap-3">
                <button on:click={closeForm}
                    class="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 rounded-xl font-bold text-sm">
                    {$_('leave.cancel')}
                </button>
                <button on:click={saveRecord} disabled={saving}
                    class="flex-1 py-2.5 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white rounded-xl font-bold text-sm">
                    {editingId ? $_('leave.save') : $_('leave.add_record')}
                </button>
            </div>
</AnimatedModal>
