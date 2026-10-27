<script>
    export let embedded = false;
    import { taskStore } from '../stores/tasks.js';
    import { settingsStore } from '../stores/settings.js';
    import { showConfirm, showToast } from '../stores/modal.js';
    import { exportToCSV, exportToExcel, exportToJSON } from '../utils/export.js';
    import { _, locale } from 'svelte-i18n';
    import { toIntlLocale } from '../i18n/index.js';
    import { formatLocalDate } from '../utils/datetime.js';
    import {
        DEFAULT_OVERTIME_CONFIG,
        calculateOvertimeHours,
        calculateRecordPay,
        estimateOvertime,
        filterRecordsByPeriod,
        getMonthSummary,
        getYearSummary,
        groupRecordsByDay,
        inferOvertimeType,
        isValidDate,
        isValidTime,
        normalizeOvertimeRecord
    } from '../utils/overtime.js';

    const TYPE_STYLES = {
        weekday: 'bg-indigo-50 text-indigo-600 border-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800',
        weekend: 'bg-orange-50 text-orange-600 border-orange-100 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800',
        holiday: 'bg-rose-50 text-rose-600 border-rose-100 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800'
    };
    const COMP_STYLES = {
        pay: 'text-green-600 dark:text-green-400',
        time_off: 'text-sky-600 dark:text-sky-400',
        none: 'text-slate-400'
    };

    let viewMode = 'month';
    let cursor = new Date();
    let showForm = false;
    let editingId = null;
    let saving = false;
    let exportOpen = false;

    const now = new Date();
    let cursorYear = now.getFullYear();
    let cursorMonth = now.getMonth() + 1;
    let cursorDay = now.getDate();

    let form = createEmptyForm();

    $: config = { ...DEFAULT_OVERTIME_CONFIG, ...($settingsStore.overtimeConfig || {}) };
    $: records = ($taskStore.overtimeRecords || []).map(normalizeOvertimeRecord);
    $: localeCode = toIntlLocale($locale || 'zh');
    $: todayValue = formatLocalDate(new Date());
    $: estimate = estimateOvertime(records, new Date(), config);
    $: monthSummary = getMonthSummary(records, cursorYear, cursorMonth, config);
    $: yearSummary = getYearSummary(records, cursorYear, config);
    $: selectedDayRecords = filterRecordsByPeriod(records, {
        year: cursorYear,
        month: cursorMonth,
        day: cursorDay
    }).sort((a, b) => a.start.localeCompare(b.start));
    $: monthRecordsByDay = groupRecordsByDay(records, cursorYear, cursorMonth);
    $: monthDays = Array.from({ length: new Date(cursorYear, cursorMonth, 0).getDate() }, (_, index) => index + 1);
    $: yearMonths = Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        summary: getMonthSummary(records, cursorYear, index + 1, config)
    }));
    $: cursorLabel = (() => {
        if (viewMode === 'year') {
            return new Date(cursorYear, 0, 1).toLocaleDateString(localeCode, { year: 'numeric' });
        }
        if (viewMode === 'day') {
            return new Date(cursorYear, cursorMonth - 1, cursorDay).toLocaleDateString(localeCode, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'short'
            });
        }
        return new Date(cursorYear, cursorMonth - 1, 1).toLocaleDateString(localeCode, {
            year: 'numeric',
            month: 'long'
        });
    })();
    $: formHours = calculateOvertimeHours(form.start, form.end);
    $: formPay = config.monthlySalary > 0
        ? calculateRecordPay({ ...form, hours: formHours, type: form.type }, config)
        : 0;

    function createEmptyForm(date = formatLocalDate(new Date())) {
        return {
            date,
            start: '18:00',
            end: '20:00',
            type: inferOvertimeType(date),
            compensation: 'pay',
            note: '',
            aiLocked: false
        };
    }

    function money(value) {
        return new Intl.NumberFormat(localeCode, {
            style: 'currency',
            currency: config.currency || 'CNY',
            maximumFractionDigits: 2
        }).format(Number(value) || 0);
    }

    function hours(value) {
        return `${(Math.round((Number(value) || 0) * 100) / 100).toFixed(2)}h`;
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

    function openCreate() {
        const date = viewMode === 'day'
            ? `${cursorYear}-${String(cursorMonth).padStart(2, '0')}-${String(cursorDay).padStart(2, '0')}`
            : (cursorYear === new Date().getFullYear() && cursorMonth === new Date().getMonth() + 1
                ? todayValue
                : `${cursorYear}-${String(cursorMonth).padStart(2, '0')}-01`);
        editingId = null;
        form = createEmptyForm(date);
        showForm = true;
    }

    function openEdit(record) {
        editingId = record.id;
        form = {
            date: record.date,
            start: record.start,
            end: record.end,
            type: record.type,
            compensation: record.compensation || 'pay',
            note: record.note || '',
            aiLocked: record.aiLocked === true
        };
        showForm = true;
    }

    function closeForm() {
        showForm = false;
        saving = false;
    }

    function updateFormDate() {
        if (!editingId && isValidDate(form.date)) {
            form.type = inferOvertimeType(form.date);
        }
    }

    function saveRecord() {
        if (saving) return;
        if (!isValidDate(form.date)) {
            showToast({ message: $_('overtime.invalid_date'), type: 'error' });
            return;
        }
        if (!isValidTime(form.start) || !isValidTime(form.end)) {
            showToast({ message: $_('overtime.invalid_time'), type: 'error' });
            return;
        }
        if (formHours <= 0) {
            showToast({ message: $_('overtime.invalid_time'), type: 'error' });
            return;
        }
        saving = true;
        const existing = editingId ? records.find(record => record.id === editingId) : null;
        const record = normalizeOvertimeRecord({
            ...form,
            id: editingId || `ot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            hours: formHours,
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        if (editingId) {
            taskStore.updateOvertimeRecord(editingId, record);
        } else {
            taskStore.addOvertimeRecord(record);
        }
        cursorYear = Number(record.date.slice(0, 4));
        cursorMonth = Number(record.date.slice(5, 7));
        cursorDay = Number(record.date.slice(8, 10));
        showForm = false;
        saving = false;
        showToast({
            message: editingId ? $_('overtime.updated') : $_('overtime.saved'),
            type: 'success'
        });
    }

    async function deleteRecord(record) {
        const confirmed = await showConfirm({
            title: $_('overtime.delete_title'),
            message: $_('overtime.delete_confirm', { values: { date: record.date } }),
            confirmText: $_('overtime.delete'),
            cancelText: $_('overtime.cancel'),
            variant: 'danger'
        });
        if (!confirmed) return;
        taskStore.deleteOvertimeRecord(record.id);
        showToast({ message: $_('overtime.deleted'), type: 'success' });
    }

    function updateConfig(field, value) {
        settingsStore.updateOvertimeConfig({ [field]: Number(value) });
    }

    function basisLabel() {
        if (estimate.basis === 'last_month') return $_('overtime.basis_last_month');
        if (estimate.basis === 'current_month') return $_('overtime.basis_current_month');
        return $_('overtime.basis_none');
    }

    function exportRows(scope) {
        const list = (scope === 'year'
            ? filterRecordsByPeriod(records, { year: cursorYear })
            : records).slice().sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
        return list.map(record => ({
            [$_('overtime.export_date')]: record.date,
            [$_('overtime.export_start')]: record.start,
            [$_('overtime.export_end')]: record.end,
            [$_('overtime.export_hours')]: record.hours,
            [$_('overtime.export_type')]: $_('overtime.type_' + record.type),
            [$_('overtime.export_compensation')]: $_('overtime.comp_' + (record.compensation || 'pay')),
            [$_('overtime.export_pay')]: calculateRecordPay(record, config),
            [$_('overtime.export_note')]: record.note
        }));
    }

    async function exportData(format, scope) {
        exportOpen = false;
        const rows = exportRows(scope);
        if (rows.length === 0) {
            showToast({ message: $_('overtime.no_export'), type: 'warning' });
            return;
        }
        if (format === 'json') {
            return await exportToJSON({
                exportedAt: new Date().toISOString(),
                year: scope === 'year' ? cursorYear : 'all',
                overtimeRecords: rows
            }, `overtime_${scope === 'year' ? cursorYear : 'all'}.json`, { showToast });
        }
        if (format === 'xlsx') {
            return await exportToExcel(rows, `overtime_${scope === 'year' ? cursorYear : 'all'}.xlsx`, {
                showToast,
                sheetName: $_('overtime.title')
            });
        }
        return await exportToCSV(rows, `overtime_${scope === 'year' ? cursorYear : 'all'}.csv`, { showToast });
    }
</script>

<div class={`flex flex-col ${embedded ? 'h-full' : 'h-screen md:h-full'} overflow-hidden bg-slate-50`}>
    <header class="h-auto bg-white/90 backdrop-blur px-4 md:px-6 flex flex-col md:flex-row justify-between items-center z-10 sticky top-0 border-b border-slate-200 shrink-0 py-2 gap-2">
        {#if !embedded}
            <div class="w-full md:w-auto">
                <h2 class="text-lg font-bold text-orange-700 flex items-center gap-2">
                    <i class="ph-fill ph-clock-afternoon"></i> {$_('overtime.title')}
                </h2>
                <div class="text-[10px] md:text-xs text-slate-500">{$_('overtime.subtitle')}</div>
            </div>
        {/if}
        <div class={`flex items-center gap-2 w-full md:w-auto ${embedded ? 'md:ml-auto' : ''}`}>
            <div class="flex bg-slate-100 p-1 rounded-lg gap-1">
                {#each [
                    { key: 'year', label: $_('overtime.view_year') },
                    { key: 'month', label: $_('overtime.view_month') },
                    { key: 'day', label: $_('overtime.view_day') }
                ] as item}
                    <button on:click={() => viewMode = item.key}
                        class="px-2.5 py-1 text-[10px] rounded transition whitespace-nowrap"
                        class:bg-white={viewMode === item.key}
                        class:shadow-sm={viewMode === item.key}
                        class:font-bold={viewMode === item.key}
                        class:text-orange-600={viewMode === item.key}
                        class:text-slate-500={viewMode !== item.key}>
                        {item.label}
                    </button>
                {/each}
            </div>
            {#if !embedded}
            <details bind:open={exportOpen} class="relative">
                <summary class="list-none h-9 px-3 bg-white border border-orange-200 hover:bg-orange-50 text-orange-700 rounded-lg text-sm font-bold flex items-center gap-2 cursor-pointer">
                    <i class="ph ph-download-simple"></i>
                    <span class="hidden sm:inline">{$_('overtime.export')}</span>
                </summary>
                <div class="absolute right-0 mt-1 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-20 p-1">
                    <button on:click={() => exportData('csv', 'year')} class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-orange-50 dark:hover:bg-slate-700">{$_('overtime.export_csv_year')}</button>
                    <button on:click={() => exportData('csv', 'all')} class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-orange-50 dark:hover:bg-slate-700">{$_('overtime.export_csv_all')}</button>
                    <button on:click={() => exportData('xlsx', 'year')} class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-orange-50 dark:hover:bg-slate-700">{$_('overtime.export_excel_year')}</button>
                    <button on:click={() => exportData('xlsx', 'all')} class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-orange-50 dark:hover:bg-slate-700">{$_('overtime.export_excel_all')}</button>
                    <button on:click={() => exportData('json', 'year')} class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-orange-50 dark:hover:bg-slate-700">{$_('overtime.export_json_year')}</button>
                    <button on:click={() => exportData('json', 'all')} class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-orange-50 dark:hover:bg-slate-700">{$_('overtime.export_json_all')}</button>
                </div>
            </details>
            {/if}
            <button on:click={openCreate}
                class="h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-bold shadow-md shadow-orange-200 flex items-center gap-2">
                <i class="ph-bold ph-plus"></i>
                <span class="hidden sm:inline">{$_('overtime.add_record')}</span>
            </button>
        </div>
    </header>

    <div class="flex-1 overflow-y-auto overscroll-contain min-h-0" style="-webkit-overflow-scrolling: touch;">
        <div class="p-4 md:p-6 space-y-5 pb-32">
            <!-- Salary & rules -->
            <div class="bg-white rounded-xl shadow-sm border border-slate-100 dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
                <div class="p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4">
                    <div class="flex items-center gap-3 flex-1">
                        <div class="w-11 h-11 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                            <i class="ph-fill ph-currency-cny text-xl text-orange-600 dark:text-orange-300"></i>
                        </div>
                        <div class="flex-1">
                            <div class="text-[10px] md:text-xs font-bold text-slate-400 uppercase">{$_('overtime.salary')}</div>
                            <div class="flex items-center gap-2 mt-1">
                                <span class="text-sm text-slate-400">¥</span>
                                <input
                                    type="number"
                                    min="0"
                                    step="100"
                                    value={config.monthlySalary || ''}
                                    on:change={(event) => updateConfig('monthlySalary', event.currentTarget.value)}
                                    placeholder={$_('overtime.salary_placeholder')}
                                    class="w-40 text-xl font-black text-slate-800 dark:text-slate-100 bg-transparent border-b border-dashed border-slate-300 dark:border-slate-600 focus:border-orange-400 outline-none"
                                />
                            </div>
                            <div class="text-[10px] md:text-xs text-slate-500 mt-1">
                                {$_('overtime.hourly_rate')}: <span class="font-bold text-orange-600">{money(estimate.hourlyRate)}/h</span>
                            </div>
                        </div>
                    </div>
                    <details class="md:w-72">
                        <summary class="text-xs font-bold text-slate-500 cursor-pointer select-none">{$_('overtime.rules')}</summary>
                        <div class="grid grid-cols-2 gap-2 mt-3 text-[10px] text-slate-500">
                            <label class="flex flex-col gap-1">
                                <span>{$_('overtime.workdays')}</span>
                                <input type="number" min="1" max="31" step="0.25" value={config.workdaysPerMonth}
                                    on:change={(e) => updateConfig('workdaysPerMonth', e.currentTarget.value)}
                                    class="border border-slate-200 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200" />
                            </label>
                            <label class="flex flex-col gap-1">
                                <span>{$_('overtime.hours_per_day')}</span>
                                <input type="number" min="1" max="24" step="0.5" value={config.hoursPerDay}
                                    on:change={(e) => updateConfig('hoursPerDay', e.currentTarget.value)}
                                    class="border border-slate-200 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200" />
                            </label>
                            <label class="flex flex-col gap-1">
                                <span>{$_('overtime.weekday_rate')}</span>
                                <input type="number" min="1" max="5" step="0.5" value={config.weekdayMultiplier}
                                    on:change={(e) => updateConfig('weekdayMultiplier', e.currentTarget.value)}
                                    class="border border-slate-200 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200" />
                            </label>
                            <label class="flex flex-col gap-1">
                                <span>{$_('overtime.weekend_rate')}</span>
                                <input type="number" min="1" max="5" step="0.5" value={config.weekendMultiplier}
                                    on:change={(e) => updateConfig('weekendMultiplier', e.currentTarget.value)}
                                    class="border border-slate-200 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200" />
                            </label>
                            <label class="flex flex-col gap-1">
                                <span>{$_('overtime.holiday_rate')}</span>
                                <input type="number" min="1" max="5" step="0.5" value={config.holidayMultiplier}
                                    on:change={(e) => updateConfig('holidayMultiplier', e.currentTarget.value)}
                                    class="border border-slate-200 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200" />
                            </label>
                        </div>
                    </details>
                </div>
            </div>

            <!-- Summary cards -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                <div class="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
                    <div class="text-[10px] md:text-xs font-bold text-slate-400 uppercase mb-1">{$_('overtime.last_month_hours')}</div>
                    <div class="text-xl md:text-2xl font-black text-slate-700 dark:text-slate-100">{hours(estimate.lastMonth.hours)}</div>
                    <div class="text-[10px] text-slate-500 mt-1">{money(estimate.lastMonth.pay)}</div>
                </div>
                <div class="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
                    <div class="text-[10px] md:text-xs font-bold text-sky-500 uppercase mb-1">{$_('overtime.current_month_hours')}</div>
                    <div class="text-xl md:text-2xl font-black text-sky-600">{hours(estimate.currentMonth.hours)}</div>
                    <div class="text-[10px] text-slate-500 mt-1">{money(estimate.currentMonth.pay)}</div>
                </div>
                <div class="bg-gradient-to-br from-orange-500 to-amber-500 p-3 md:p-4 rounded-xl shadow-md shadow-orange-200 text-white">
                    <div class="text-[10px] md:text-xs font-bold text-orange-100 uppercase mb-1">{$_('overtime.expected_pay')}</div>
                    <div class="text-xl md:text-2xl font-black">{money(estimate.expectedPay)}</div>
                    <div class="text-[10px] text-orange-100 mt-1">{$_('overtime.expected_hours')}: {hours(estimate.expectedHours)}</div>
                </div>
                <div class="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
                    <div class="text-[10px] md:text-xs font-bold text-emerald-500 uppercase mb-1">{$_('overtime.year_hours')}</div>
                    <div class="text-xl md:text-2xl font-black text-emerald-600">{hours(yearSummary.hours)}</div>
                    <div class="text-[10px] text-slate-500 mt-1">{money(yearSummary.pay)}</div>
                </div>
            </div>

            <div class="text-[10px] md:text-xs text-slate-500 flex items-center gap-1.5 -mt-1">
                <i class="ph ph-magic-wand"></i>
                <span>{basisLabel()}</span>
                {#if estimate.basis === 'last_month'}
                    <span class="text-slate-400">· {$_('overtime.expected_note')}</span>
                {/if}
            </div>

            <!-- Period navigation -->
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1">
                    <button on:click={() => shiftCursor(-1)} aria-label={$_('overtime.previous')}
                        class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-orange-600 hover:border-orange-200 flex items-center justify-center dark:bg-slate-800 dark:border-slate-700">
                        <i class="ph-bold ph-caret-left"></i>
                    </button>
                    <button on:click={() => shiftCursor(1)} aria-label={$_('overtime.next')}
                        class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-orange-600 hover:border-orange-200 flex items-center justify-center dark:bg-slate-800 dark:border-slate-700">
                        <i class="ph-bold ph-caret-right"></i>
                    </button>
                    <div class="ml-2 text-sm md:text-base font-bold text-slate-700 dark:text-slate-200">{cursorLabel}</div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="text-[10px] md:text-xs text-slate-500">
                        {viewMode === 'year' ? $_('overtime.year_total') : $_('overtime.month_total')}: <span class="font-bold text-slate-700 dark:text-slate-200">{hours(viewMode === 'year' ? yearSummary.hours : monthSummary.hours)}</span>                        <span class="mx-1 text-slate-300">·</span>
                        <span class="font-bold text-orange-600">{money(viewMode === 'year' ? yearSummary.pay : monthSummary.pay)}</span>
                    </div>
                    <button on:click={goToday}
                        class="h-8 px-3 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-slate-500 hover:text-orange-600 dark:bg-slate-800 dark:border-slate-700">
                        {$_('overtime.today')}
                    </button>
                </div>
            </div>

            {#if viewMode === 'year'}
                <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                    {#each yearMonths as item}
                        <button on:click={() => selectMonth(item.month)}
                            class="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-left hover:border-orange-200 hover:shadow-md transition dark:bg-slate-800 dark:border-slate-700">
                            <div class="flex items-center justify-between">
                                <div class="font-bold text-slate-700 dark:text-slate-200">
                                    {new Date(cursorYear, item.month - 1, 1).toLocaleDateString(localeCode, { month: 'long' })}
                                </div>
                                <i class="ph ph-caret-right text-slate-300"></i>
                            </div>
                            <div class="text-2xl font-black text-orange-600 mt-3">{hours(item.summary.hours)}</div>
                            <div class="text-[10px] text-slate-500 mt-1">{money(item.summary.pay)}</div>
                        </button>
                    {/each}
                </div>
            {:else if viewMode === 'month'}
                <div class="bg-white rounded-xl shadow-sm border border-slate-100 dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
                    <div class="px-4 py-3 border-b border-slate-50 dark:border-slate-700 flex items-center justify-between">
                        <div class="font-bold text-sm text-slate-700 dark:text-slate-200">{$_('overtime.month_detail')}</div>
                        <div class="text-[10px] text-slate-500">
                            {$_('overtime.total_hours')}: <span class="font-bold">{hours(monthSummary.hours)}</span>
                            <span class="mx-1 text-slate-300">·</span>
                            {$_('overtime.total_pay')}: <span class="font-bold text-orange-600">{money(monthSummary.pay)}</span>
                        </div>
                    </div>
                    <div class="divide-y divide-slate-50 dark:divide-slate-700/60">
                        {#each monthDays as day}
                            {@const dayRecords = monthRecordsByDay.get(`${cursorYear}-${String(cursorMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`) || []}
                            <button on:click={() => selectDay(day)}
                                class="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-orange-50/40 dark:hover:bg-slate-700/40 transition">
                                <div class="w-10 text-center shrink-0">
                                    <div class="text-lg font-black {dayRecords.length ? 'text-orange-600' : 'text-slate-300'}">{String(day).padStart(2, '0')}</div>
                                    <div class="text-[9px] text-slate-400">
                                        {new Date(cursorYear, cursorMonth - 1, day).toLocaleDateString(localeCode, { weekday: 'short' })}
                                    </div>
                                </div>
                                <div class="flex-1 min-w-0">
                                    {#if dayRecords.length}
                                        <div class="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                                            {dayRecords.map(record => `${record.start}-${record.end}`).join(' / ')}
                                        </div>
                                        <div class="text-[10px] text-slate-500 mt-0.5">
                                            {hours(dayRecords.reduce((sum, record) => sum + record.hours, 0))}
                                            · {money(dayRecords.reduce((sum, record) => sum + calculateRecordPay(record, config), 0))}
                                        </div>
                                    {:else}
                                        <div class="text-xs text-slate-400">{$_('overtime.no_records')}</div>
                                    {/if}
                                </div>
                                <i class="ph-bold ph-caret-right text-slate-200"></i>
                            </button>
                        {/each}
                    </div>
                </div>
            {:else}
                <div class="bg-white rounded-xl shadow-sm border border-slate-100 dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
                    <div class="px-4 py-3 border-b border-slate-50 dark:border-slate-700 flex items-center justify-between">
                        <div class="font-bold text-sm text-slate-700 dark:text-slate-200">
                            {new Date(cursorYear, cursorMonth - 1, cursorDay).toLocaleDateString(localeCode, { month: 'long', day: 'numeric', weekday: 'short' })}
                        </div>
                        <div class="text-[10px] text-slate-500">
                            {hours(selectedDayRecords.reduce((sum, record) => sum + record.hours, 0))}
                            <span class="mx-1 text-slate-300">·</span>
                            <span class="font-bold text-orange-600">{money(selectedDayRecords.reduce((sum, record) => sum + calculateRecordPay(record, config), 0))}</span>
                        </div>
                    </div>
                    {#if selectedDayRecords.length}
                        <div class="divide-y divide-slate-50 dark:divide-slate-700/60">
                            {#each selectedDayRecords as record}
                                <div class="px-4 py-3 flex items-start gap-3">
                                    <div class="w-12 text-center shrink-0">
                                        <div class="text-xs font-black text-slate-700 dark:text-slate-200">{record.start}</div>
                                        <div class="text-[9px] text-slate-400">{record.end}</div>
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center gap-2 flex-wrap">
                                            <span class="px-1.5 py-0.5 text-[10px] rounded border {TYPE_STYLES[record.type] || TYPE_STYLES.weekday}">
                                                {$_('overtime.type_' + record.type)}
                                            </span>
                                            <span class="text-xs font-bold text-slate-700 dark:text-slate-200">{hours(record.hours)}</span>
                                            <span class="text-xs font-bold {COMP_STYLES[record.compensation] || COMP_STYLES.pay}">
                                                {money(calculateRecordPay(record, config))}
                                            </span>
                                            <span class="text-[10px] text-slate-400">{$_('overtime.comp_' + (record.compensation || 'pay'))}</span>
                                            {#if record.aiLocked}
                                                <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300" title={$_('overtime.ai_locked')}>
                                                    <i class="ph ph-lock-simple"></i>
                                                </span>
                                            {/if}
                                        </div>
                                        {#if record.note}
                                            <div class="text-[10px] text-slate-500 mt-1 truncate">{record.note}</div>
                                        {/if}
                                    </div>
                                    <div class="flex items-center gap-1 shrink-0">
                                        <button on:click={() => openEdit(record)} aria-label={$_('overtime.edit_record')}
                                            class="w-7 h-7 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-50 flex items-center justify-center">
                                            <i class="ph ph-pencil-simple"></i>
                                        </button>
                                        <button on:click={() => deleteRecord(record)} aria-label={$_('overtime.delete')}
                                            class="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center">
                                            <i class="ph ph-trash"></i>
                                        </button>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {:else}
                        <div class="py-12 text-center text-slate-400">
                            <i class="ph ph-clock-afternoon text-4xl mb-2 opacity-40"></i>
                            <div class="text-sm font-bold">{$_('overtime.empty')}</div>
                            <div class="text-xs mt-1">{$_('overtime.empty_desc')}</div>
                            <button on:click={openCreate} class="mt-3 text-xs font-bold text-orange-600 hover:text-orange-700">
                                + {$_('overtime.add_record')}
                            </button>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    </div>
</div>

{#if showForm}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
            class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            on:click={closeForm}
            on:keydown={(event) => event.key === 'Escape' && closeForm()}
            role="button"
            tabindex="0"
        ></div>
        <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg relative flex flex-col max-h-[90vh] overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40">
                <h3 class="font-bold text-lg text-slate-800 dark:text-slate-100">
                    {editingId ? $_('overtime.edit_record') : $_('overtime.add_record')}
                </h3>
                <button on:click={closeForm} aria-label={$_('overtime.cancel')}><i class="ph ph-x text-xl"></i></button>
            </div>
            <div class="flex-1 overflow-y-auto p-6 space-y-4">
                <div class="grid grid-cols-2 gap-3">
                    <label class="col-span-2 flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('overtime.date')}</span>
                        <input type="date" bind:value={form.date} on:change={updateFormDate}
                            class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200" />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('overtime.start_time')}</span>
                        <input type="time" bind:value={form.start}
                            class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200" />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('overtime.end_time')}</span>
                        <input type="time" bind:value={form.end}
                            class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200" />
                    </label>
                    <div class="col-span-2 flex items-center justify-between bg-orange-50 dark:bg-orange-900/20 rounded-xl px-4 py-3">
                        <div class="text-xs text-orange-700 dark:text-orange-300">
                            {$_('overtime.hours')}: <span class="font-black text-base">{hours(formHours)}</span>
                        </div>
                        <div class="text-xs text-orange-700 dark:text-orange-300">
                            {$_('overtime.estimated_pay')}: <span class="font-black text-base">{money(formPay)}</span>
                        </div>
                    </div>
                    <label class="flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('overtime.type')}</span>
                        <select bind:value={form.type}
                            class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200">
                            <option value="weekday">{$_('overtime.type_weekday')}</option>
                            <option value="weekend">{$_('overtime.type_weekend')}</option>
                            <option value="holiday">{$_('overtime.type_holiday')}</option>
                        </select>
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('overtime.compensation')}</span>
                        <select bind:value={form.compensation}
                            class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200">
                            <option value="pay">{$_('overtime.comp_pay')}</option>
                            <option value="time_off">{$_('overtime.comp_time_off')}</option>
                            <option value="none">{$_('overtime.comp_none')}</option>
                        </select>
                    </label>
                    <label class="col-span-2 flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('overtime.note')}</span>
                        <textarea bind:value={form.note} rows="2" placeholder={$_('overtime.note_placeholder')}
                            class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 resize-none"></textarea>
                    </label>
                    <label class="col-span-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 cursor-pointer">
                        <input type="checkbox" bind:checked={form.aiLocked}
                            class="rounded border-slate-300 text-orange-500 focus:ring-orange-400" />
                        <span class="text-xs font-bold text-slate-600 dark:text-slate-300">{$_('overtime.ai_locked')}</span>
                        <span class="text-[10px] text-slate-400">{$_('overtime.ai_locked_hint')}</span>
                    </label>
                </div>
            </div>
            <div class="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex gap-3">
                <button on:click={closeForm}
                    class="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 rounded-xl font-bold text-sm">
                    {$_('overtime.cancel')}
                </button>
                <button on:click={saveRecord} disabled={saving}
                    class="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-xl font-bold text-sm">
                    {editingId ? $_('overtime.save') : $_('overtime.add_record')}
                </button>
            </div>
        </div>
    </div>
{/if}
