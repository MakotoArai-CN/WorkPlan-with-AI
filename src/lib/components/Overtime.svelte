<script>
    export let embedded = false;
    export let hideSummary = false;
    import { taskStore } from '../stores/tasks.js';
    import { settingsStore } from '../stores/settings.js';
    import { showConfirm, showToast } from '../stores/modal.js';
    import { exportToCSV, exportToExcel, exportToJSON } from '../utils/export.js';
    import PayrollPanel from './PayrollPanel.svelte';
    import SalarySettings from './SalarySettings.svelte';
    import DatePicker from './DatePicker.svelte';
    import AnimatedModal from './AnimatedModal.svelte';
    import TimeSelect from './TimeSelect.svelte';
    import SegmentedControl from './SegmentedControl.svelte';
    import SelectMenu from './SelectMenu.svelte';
    import WorklogRecordRow from './WorklogRecordRow.svelte';
    import WorklogDetailCard from './WorklogDetailCard.svelte';
    import { _, locale } from 'svelte-i18n';
    import { toIntlLocale } from '../i18n/index.js';
    import { formatLocalDate } from '../utils/datetime.js';
    import {
        DEFAULT_OVERTIME_CONFIG,
        calculateOvertimeHours,
        calculateRecordPay,
        getRecordPay,
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

    export let viewMode = 'month';
    let cursor = new Date();
    let showForm = false;
    let editingId = null;
    let saving = false;
    let exportOpen = false;
    let showSalarySettings = false;
    let detailLayout = 'list';

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
    $: firstWeekday = (new Date(cursorYear, cursorMonth - 1, 1).getDay() + 6) % 7;
    $: calendarCells = [...Array.from({ length: firstWeekday }, () => null), ...monthDays];
    $: monthRows = records
        .filter(record => record.date?.startsWith(`${cursorYear}-${String(cursorMonth).padStart(2, '0')}`))
        .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
        .map(record => ({
            record,
            dateMain: record.date.slice(8, 10),
            dateSub: new Date(`${record.date}T00:00:00`).toLocaleDateString(localeCode, { weekday: 'short' }),
            badge: $_('overtime.type_' + record.type),
            badgeClass: TYPE_STYLES[record.type] || TYPE_STYLES.weekday,
            title: `${record.start} - ${record.end}`,
            detail: `${hours(record.hours)} · ${$_('overtime.comp_' + (record.compensation || 'pay'))} · ${record.actualPay !== null && record.actualPay !== undefined ? $_('overtime.actual_label') : $_('overtime.estimated_label')}`,
            note: record.note || '',
            metric: hours(record.hours),
            amount: money(getRecordPay(record, config)),
            amountClass: 'text-orange-600'
        }));
    $: yearMonths = Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        summary: getMonthSummary(records, cursorYear, index + 1, config)
    }));
    $: overtimeTypeOptions = [
        { value: 'weekday', label: $_('overtime.type_weekday') },
        { value: 'weekend', label: $_('overtime.type_weekend') },
        { value: 'holiday', label: $_('overtime.type_holiday') }
    ];
    $: compensationOptions = [
        { value: 'pay', label: $_('overtime.comp_pay') },
        { value: 'time_off', label: $_('overtime.comp_time_off') },
        { value: 'none', label: $_('overtime.comp_none') }
    ];
    $: viewOptions = [
        { value: 'year', label: $_('overtime.view_year') },
        { value: 'month', label: $_('overtime.view_month') },
        { value: 'day', label: $_('overtime.view_day') }
    ];
    $: detailOptions = [
        { value: 'list', label: $_('overtime.layout_list'), icon: 'ph-list-bullets' },
        { value: 'calendar', label: $_('overtime.layout_calendar'), icon: 'ph-calendar-blank' }
    ];
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
    $: formActualPay = form.actualPay !== null && form.actualPay !== undefined && form.actualPay !== ''
        && Number.isFinite(Number(form.actualPay)) && Number(form.actualPay) >= 0
        ? Math.round(Number(form.actualPay) * 100) / 100
        : null;

    function makeOvertimeRow(record) {
        return {
            record,
            dateMain: record.date.slice(8, 10),
            dateSub: new Date(`${record.date}T00:00:00`).toLocaleDateString(localeCode, { weekday: 'short' }),
            badge: $_('overtime.type_' + record.type),
            badgeClass: TYPE_STYLES[record.type] || TYPE_STYLES.weekday,
            title: `${record.start} - ${record.end}`,
            detail: `${hours(record.hours)} · ${$_('overtime.comp_' + (record.compensation || 'pay'))} · ${record.actualPay !== null && record.actualPay !== undefined ? $_('overtime.actual_label') : $_('overtime.estimated_label')}`,
            note: record.note || '',
            metric: hours(record.hours),
            amount: money(getRecordPay(record, config)),
            amountClass: 'text-orange-600'
        };
    }

    function createEmptyForm(date = formatLocalDate(new Date())) {
        return {
            date,
            start: '18:00',
            end: '20:00',
            type: inferOvertimeType(date),
            compensation: 'pay',
            actualPay: null,
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

    function openCreateInternal() {
        const date = viewMode === 'day'
            ? `${cursorYear}-${String(cursorMonth).padStart(2, '0')}-${String(cursorDay).padStart(2, '0')}`
            : (cursorYear === new Date().getFullYear() && cursorMonth === new Date().getMonth() + 1
                ? todayValue
                : `${cursorYear}-${String(cursorMonth).padStart(2, '0')}-01`);
        editingId = null;
        form = createEmptyForm(date);
        showForm = true;
    }

    export function openCreate() {
        openCreateInternal();
    }

    function openEdit(record) {
        editingId = record.id;
        form = {
            date: record.date,
            start: record.start,
            end: record.end,
            type: record.type,
            compensation: record.compensation || 'pay',
            actualPay: record.actualPay ?? null,
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
            actualPay: form.compensation === 'pay' ? formActualPay : null,
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
            [$_('overtime.export_pay')]: getRecordPay(record, config),
            [$_('overtime.export_actual_pay')]: record.actualPay ?? '',
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
    {#if !embedded}
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
            <SegmentedControl bind:value={viewMode} options={viewOptions} />
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
            {#if !embedded}
                <button on:click={openCreate}
                    class="h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-bold shadow-md shadow-orange-200 flex items-center gap-2">
                    <i class="ph-bold ph-plus"></i>
                    <span class="hidden sm:inline">{$_('overtime.add_record')}</span>
                </button>
            {/if}
        </div>
    </header>
    {/if}

    <div class="flex-1 overflow-y-auto overscroll-contain min-h-0" style="-webkit-overflow-scrolling: touch; scrollbar-gutter: stable;">
        <div class="p-4 md:p-6 space-y-5 pb-32">
            {#if !hideSummary}
                <PayrollPanel
                    records={records}
                    leaveRecords={$taskStore.leaveRecords || []}
                    {config}
                    onUpdateConfig={(updates) => settingsStore.updateOvertimeConfig(updates)}
                    onOpenSettings={() => (showSalarySettings = true)}
                />
            {/if}

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
                <WorklogDetailCard
                    title={$_('overtime.month_detail')}
                    summary={`${$_('overtime.total_hours')}: ${hours(monthSummary.hours)} · ${$_('overtime.total_pay')}: ${money(monthSummary.pay)}`}
                    rows={monthRows}
                    bind:layout={detailLayout}
                    showLayout
                    emptyTitle={$_('overtime.empty')}
                    emptyDesc={$_('overtime.empty_desc')}
                    addLabel={$_('overtime.add_record')}
                    onAdd={openCreate}
                    onEdit={openEdit}
                    onDelete={deleteRecord}
                    editLabel={$_('overtime.edit_record')}
                    deleteLabel={$_('overtime.delete')}
                >
                    <div slot="calendar" class="p-3">
                            <div class="grid grid-cols-7 gap-1 mb-1">
                                {#each ['一', '二', '三', '四', '五', '六', '日'] as label}
                                    <div class="h-7 flex items-center justify-center text-[10px] font-bold text-slate-400">{label}</div>
                                {/each}
                            </div>
                            <div class="grid grid-cols-7 gap-1">
                                {#each calendarCells as day}
                                    {#if day}
                                        {@const dayKey = `${cursorYear}-${String(cursorMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`}
                                        {@const dayRecords = monthRecordsByDay.get(dayKey) || []}
                                        {@const dayHours = dayRecords.reduce((sum, record) => sum + record.hours, 0)}
                                        {@const dayPay = dayRecords.reduce((sum, record) => sum + getRecordPay(record, config), 0)}
                                        <button on:click={() => selectDay(day)}
                                            class={`min-h-20 md:min-h-24 rounded-lg border p-1.5 text-left transition
                                                ${dayRecords.length
                                                    ? 'border-orange-200 bg-orange-50/70 dark:border-orange-800 dark:bg-orange-900/20'
                                                    : 'border-slate-100 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/20 hover:border-orange-200'}`}>
                                            <div class="text-[11px] font-black ${dayRecords.length ? 'text-orange-600' : 'text-slate-400'}">{day}</div>
                                            {#if dayRecords.length}
                                                <div class="mt-1 text-[9px] font-bold text-slate-600 dark:text-slate-300">{hours(dayHours)}</div>
                                                <div class="text-[9px] text-orange-600 truncate">{money(dayPay)}</div>
                                                <div class="mt-1 flex flex-wrap gap-0.5">
                                                    {#each dayRecords.slice(0, 3) as record}
                                                        <span class="w-1.5 h-1.5 rounded-full ${record.type === 'holiday' ? 'bg-rose-500' : record.type === 'weekend' ? 'bg-orange-400' : 'bg-indigo-400'}"></span>
                                                    {/each}
                                                </div>
                                            {:else}
                                                <div class="mt-2 text-[9px] text-slate-300 dark:text-slate-600">{$_('overtime.no_records')}</div>
                                            {/if}
                                        </button>
                                    {:else}
                                        <div></div>
                                    {/if}
                                {/each}
                            </div>
                        </div>
                </WorklogDetailCard>
            {:else}
                <WorklogDetailCard
                    title={new Date(cursorYear, cursorMonth - 1, cursorDay).toLocaleDateString(localeCode, { month: 'long', day: 'numeric', weekday: 'short' })}
                    summary={`${hours(selectedDayRecords.reduce((sum, record) => sum + record.hours, 0))} · ${money(selectedDayRecords.reduce((sum, record) => sum + getRecordPay(record, config), 0))}`}
                    rows={selectedDayRecords.map(makeOvertimeRow)}
                    emptyTitle={$_('overtime.empty')}
                    emptyDesc={$_('overtime.empty_desc')}
                    addLabel={$_('overtime.add_record')}
                    onAdd={openCreate}
                    onEdit={openEdit}
                    onDelete={deleteRecord}
                    editLabel={$_('overtime.edit_record')}
                    deleteLabel={$_('overtime.delete')}
                />
            {/if}
        </div>
    </div>
</div>

<AnimatedModal bind:show={showForm} onClose={closeForm} zIndex={50} panelClass="max-w-lg">
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
                        <DatePicker bind:value={form.date} onchange={updateFormDate} />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('overtime.start_time')}</span>
                        <TimeSelect bind:value={form.start} />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('overtime.end_time')}</span>
                        <TimeSelect bind:value={form.end} />
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
                        <SelectMenu bind:value={form.type} options={overtimeTypeOptions} />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-xs font-bold text-slate-500">{$_('overtime.compensation')}</span>
                        <SelectMenu bind:value={form.compensation} options={compensationOptions} />
                    </label>
                    {#if form.compensation === 'pay'}
                        <label class="col-span-2 flex flex-col gap-1">
                            <span class="text-xs font-bold text-slate-500">{$_('overtime.actual_pay')}
                                <span class="font-normal text-slate-400">（{$_('overtime.actual_pay_hint')} {money(formPay)}）</span>
                            </span>
                            <div class="flex items-center gap-2">
                                <input type="number" min="0" step="0.01" bind:value={form.actualPay}
                                    placeholder={String(formPay)}
                                    class="flex-1 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200" />
                                <button type="button" on:click={() => (form.actualPay = null)}
                                    class="h-9 px-3 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-500">
                                    {$_('overtime.use_estimate')}
                                </button>
                            </div>
                        </label>
                    {/if}
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
</AnimatedModal>

<SalarySettings
    bind:show={showSalarySettings}
    {config}
    onSave={(next) => settingsStore.updateOvertimeConfig(next)}
    onClose={() => (showSalarySettings = false)}
/>
