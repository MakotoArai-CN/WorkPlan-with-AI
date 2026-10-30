<script>
    import { taskStore } from '../stores/tasks.js';
    import { showConfirm, showToast } from '../stores/modal.js';
    import WorklogCalendar from './WorklogCalendar.svelte';
    import DatePicker from './DatePicker.svelte';
    import TimeSelect from './TimeSelect.svelte';
    import SegmentedControl from './SegmentedControl.svelte';
    import SelectMenu from './SelectMenu.svelte';
    import AnimatedModal from './AnimatedModal.svelte';
    import { _, locale } from 'svelte-i18n';
    import { toIntlLocale } from '../i18n/index.js';
    import { formatLocalDate } from '../utils/datetime.js';
    import {
        DEFAULT_OVERTIME_CONFIG,
        LEAVE_TYPES,
        calculateLeaveDays,
        calculateOvertimeHours,
        filterRecordsByPeriod,
        getLeaveMonthSummary,
        getMonthSummary,
        getRecordPay,
        getYearSummary,
        groupRecordsByDay,
        inferOvertimeType,
        isValidDate,
        isValidTime,
        normalizeLeaveRecord,
        normalizeOvertimeRecord,
        summarizeLeaveRecords
    } from '../utils/overtime.js';

    export let activeTab = 'overtime';
    export let config = {};
    export let viewMode = 'month';

    let cursorYear = new Date().getFullYear();
    let cursorMonth = new Date().getMonth() + 1;
    let cursorDay = new Date().getDate();
    const viewOptions = [{ value: 'month', label: '月' }, { value: 'year', label: '年' }];
    let showForm = false;
    let editingId = null;
    let saving = false;
    let form = {};
    let localeCode = toIntlLocale($locale || 'zh');

    $: normalizedConfig = { ...DEFAULT_OVERTIME_CONFIG, ...(config || {}) };
    $: overtimeRecords = $taskStore.overtimeRecords || [];
    $: leaveRecords = $taskStore.leaveRecords || [];
    $: monthSummary = activeTab === 'overtime'
        ? getMonthSummary(overtimeRecords, cursorYear, cursorMonth, normalizedConfig)
        : getLeaveMonthSummary(leaveRecords, cursorYear, cursorMonth, normalizedConfig);
    $: monthRows = activeTab === 'overtime' ? makeOvertimeRows() : makeLeaveRows();
    $: monthDays = Array.from({ length: new Date(cursorYear, cursorMonth, 0).getDate() }, (_, index) => index + 1);
    $: firstWeekday = (new Date(cursorYear, cursorMonth - 1, 1).getDay() + 6) % 7;
    $: calendarCells = [...Array.from({ length: firstWeekday }, () => null), ...monthDays];
    $: overtimeByDay = groupRecordsByDay(overtimeRecords, cursorYear, cursorMonth);
    $: leaveByDay = buildLeaveByDay(leaveRecords, cursorYear, cursorMonth);
    $: calendarDays = calendarCells.map(day => buildCalendarDay(day));
    $: yearMonths = (cursorYear, overtimeRecords, leaveRecords, normalizedConfig, Array.from({ length: 12 }, (_, index) => buildYearMonth(index + 1)));
    $: yearTotals = yearMonths.reduce((total, item) => ({
        hours: total.hours + (Number(item.overtime.hours) || 0),
        pay: total.pay + (Number(item.overtime.pay) || 0),
        leaveDays: total.leaveDays + (Number(item.leave.days) || 0),
        paidDays: total.paidDays + (Number(item.leave.paidDays) || 0),
        salary: total.salary + (Number(item.salary) || 0)
    }), { hours: 0, pay: 0, leaveDays: 0, paidDays: 0, salary: 0 });

    function money(value) {
        return new Intl.NumberFormat(localeCode === 'zh' ? 'zh-CN' : localeCode, {
            style: 'currency',
            currency: normalizedConfig.currency || 'CNY',
            maximumFractionDigits: 2
        }).format(Number(value) || 0);
    }

    function hours(value) {
        return `${Math.round((Number(value) || 0) * 100) / 100}h`;
    }

    function makeOvertimeRows() {
        return overtimeRecords
            .filter(record => record.date?.startsWith(`${cursorYear}-${String(cursorMonth).padStart(2, '0')}`))
            .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
            .map(record => ({
                record,
                dateMain: record.date.slice(8, 10),
                dateSub: new Date(`${record.date}T00:00:00`).toLocaleDateString(localeCode, { weekday: 'short' }),
                badge: $_('overtime.type_' + record.type),
                badgeClass: record.type === 'weekend'
                    ? 'bg-orange-50 text-orange-600 border-orange-100'
                    : record.type === 'holiday'
                        ? 'bg-rose-50 text-rose-600 border-rose-100'
                        : 'bg-indigo-50 text-indigo-600 border-indigo-100',
                title: `${record.start} - ${record.end}`,
                detail: `${hours(record.hours)} · ${$_('overtime.comp_' + (record.compensation || 'pay'))}`,
                note: record.note || '',
                metric: hours(record.hours),
                amount: money(getRecordPay(record, normalizedConfig)),
                amountClass: 'text-orange-600'
            }));
    }

    function monthStartEnd() {
        const prefix = `${cursorYear}-${String(cursorMonth).padStart(2, '0')}`;
        return { start: `${prefix}-01`, end: `${prefix}-${String(new Date(cursorYear, cursorMonth, 0).getDate()).padStart(2, '0')}` };
    }

    function makeLeaveRows() {
        const { start, end } = monthStartEnd();
        return leaveRecords
            .filter(record => record.startDate && record.endDate && record.startDate <= end && record.endDate >= start)
            .sort((a, b) => a.startDate.localeCompare(b.startDate))
            .map(record => ({
                record,
                dateMain: record.startDate.slice(8, 10),
                dateSub: new Date(`${record.startDate}T00:00:00`).toLocaleDateString(localeCode, { weekday: 'short' }),
                badge: $_('leave.type_' + record.type),
                badgeClass: 'bg-rose-50 text-rose-600 border-rose-100',
                title: record.startDate === record.endDate ? record.startDate : `${record.startDate} - ${record.endDate}`,
                detail: `${record.duration} ${record.unit === 'hour' ? $_('leave.unit_hour') : $_('leave.unit_day')} · ${record.paid ? $_('leave.paid') : $_('leave.unpaid')}`,
                note: record.note || '',
                metric: `${record.duration}${record.unit === 'hour' ? 'h' : '天'}`,
                amount: '',
                amountClass: 'text-rose-500'
            }));
    }

    function buildLeaveByDay(records, year, month) {
        const map = new Map();
        const { start, end } = monthStartEnd();
        for (const record of records) {
            if (!record.startDate || !record.endDate) continue;
            const from = record.startDate > start ? record.startDate : start;
            const to = record.endDate < end ? record.endDate : end;
            if (from > to) continue;
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
    }

    function buildCalendarDay(day) {
        if (!day) return null;
        const key = `${cursorYear}-${String(cursorMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (activeTab === 'overtime') {
            const rows = overtimeByDay.get(key) || [];
            const totalHours = rows.reduce((sum, record) => sum + record.hours, 0);
            const pay = rows.reduce((sum, record) => sum + getRecordPay(record, normalizedConfig), 0);
            return {
                day,
                primary: rows.length ? hours(totalHours) : '',
                secondary: rows.length ? money(pay) : '',
                dots: rows.map(record => record.type === 'holiday' ? 'bg-rose-500' : record.type === 'weekend' ? 'bg-orange-400' : 'bg-indigo-400')
            };
        }
        const rows = leaveByDay.get(key) || [];
        const summary = summarizeLeaveRecords(rows, normalizedConfig, { year: cursorYear, month: cursorMonth, day });
        return {
            day,
            primary: rows.length ? `${summary.days}${$_('leave.unit_day')}` : '',
            secondary: rows.length ? rows.map(record => $_('leave.type_' + record.type)).slice(0, 2).join(' / ') : '',
            dots: rows.map(record => record.type === 'annual' ? 'bg-rose-500' : record.type === 'sick' ? 'bg-sky-400' : 'bg-orange-400')
        };
    }

    function buildYearMonth(month) {
        const monthKey = `${cursorYear}-${String(month).padStart(2, '0')}`;
        const salary = (normalizedConfig.salaryActuals || [])
            .filter(item => String(item.paydayDate || item.periodEnd || '').startsWith(monthKey))
            .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
        return {
            month,
            overtime: getMonthSummary(overtimeRecords, cursorYear, month, normalizedConfig),
            leave: getLeaveMonthSummary(leaveRecords, cursorYear, month, normalizedConfig),
            salary
        };
    }

    function shiftMonth(delta) {
        const date = new Date(cursorYear, cursorMonth - 1 + delta, 1);
        cursorYear = date.getFullYear();
        cursorMonth = date.getMonth() + 1;
    }

    function shiftCursor(delta) {
        if (viewMode === 'year') {
            cursorYear += delta;
            return;
        }
        shiftMonth(delta);
    }

    function goToday() {
        const now = new Date();
        cursorYear = now.getFullYear();
        cursorMonth = now.getMonth() + 1;
        cursorDay = now.getDate();
    }

    export function openCreate() {
        editingId = null;
        form = activeTab === 'overtime'
            ? { date: formatLocalDate(new Date()), start: '18:00', end: '20:00', type: 'weekday', compensation: 'pay', actualPay: null, note: '' }
            : { startDate: formatLocalDate(new Date()), endDate: formatLocalDate(new Date()), unit: 'day', duration: 1, type: 'annual', paid: true, note: '' };
        showForm = true;
    }

    function openEdit(record) {
        editingId = record.id;
        form = activeTab === 'overtime'
            ? { date: record.date, start: record.start, end: record.end, type: record.type, compensation: record.compensation || 'pay', actualPay: record.actualPay ?? null, note: record.note || '' }
            : { startDate: record.startDate, endDate: record.endDate, unit: record.unit || 'day', duration: record.duration || 1, type: record.type || 'annual', paid: record.paid !== false, note: record.note || '' };
        showForm = true;
    }

    function closeForm() { showForm = false; saving = false; }

    function saveRecord() {
        if (saving) return;
        if (activeTab === 'overtime') {
            const hoursValue = calculateOvertimeHours(form.start, form.end);
            if (!isValidDate(form.date) || !isValidTime(form.start) || !isValidTime(form.end) || hoursValue <= 0) {
                showToast({ message: $_('overtime.invalid_time'), type: 'error' });
                return;
            }
            const record = normalizeOvertimeRecord({
                ...form,
                id: editingId || `ot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                hours: hoursValue,
                actualPay: form.compensation === 'pay' ? form.actualPay : null,
                updatedAt: new Date().toISOString()
            });
            if (editingId) taskStore.updateOvertimeRecord(editingId, record);
            else taskStore.addOvertimeRecord(record);
            cursorYear = Number(record.date.slice(0, 4));
            cursorMonth = Number(record.date.slice(5, 7));
            cursorDay = Number(record.date.slice(8, 10));
        } else {
            if (!isValidDate(form.startDate) || !isValidDate(form.endDate) || form.endDate < form.startDate) {
                showToast({ message: $_('leave.invalid_date'), type: 'error' });
                return;
            }
            const duration = form.unit === 'day' ? calculateLeaveDays(form.startDate, form.endDate) : Number(form.duration);
            if (!(duration > 0)) {
                showToast({ message: $_('leave.invalid_duration'), type: 'error' });
                return;
            }
            const record = normalizeLeaveRecord({
                ...form,
                duration,
                id: editingId || `leave_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                updatedAt: new Date().toISOString()
            });
            if (editingId) taskStore.updateLeaveRecord(editingId, record);
            else taskStore.addLeaveRecord(record);
            cursorYear = Number(record.startDate.slice(0, 4));
            cursorMonth = Number(record.startDate.slice(5, 7));
            cursorDay = Number(record.startDate.slice(8, 10));
        }
        saving = true;
        showForm = false;
        showToast({ message: $_('common.save'), type: 'success' });
    }

    async function deleteRecord(record) {
        const confirmed = await showConfirm({
            title: $_('overtime.delete'),
            message: activeTab === 'overtime' ? `${record.date} ${record.start}-${record.end}` : `${record.startDate} - ${record.endDate}`,
            confirmText: $_('common.delete'),
            cancelText: $_('common.cancel'),
            variant: 'danger'
        });
        if (!confirmed) return;
        if (activeTab === 'overtime') taskStore.deleteOvertimeRecord(record.id);
        else taskStore.deleteLeaveRecord(record.id);
    }

    $: summaryText = activeTab === 'overtime'
        ? `${$_('overtime.total_hours')}: ${hours(monthSummary.hours)} · ${$_('overtime.total_pay')}: ${money(monthSummary.pay)}`
        : `${$_('leave.month_leave')}: ${monthSummary.days} ${$_('leave.unit_day')} · ${$_('leave.paid_days')}: ${monthSummary.paidDays}`;
    $: yearSummaryText = activeTab === 'overtime'
        ? `${$_('overtime.total_hours')}: ${hours(yearTotals.hours)} · ${$_('overtime.total_pay')}: ${money(yearTotals.pay)}`
        : `${$_('leave.month_leave')}: ${yearTotals.leaveDays} ${$_('leave.unit_day')} · ${$_('leave.paid_days')}: ${yearTotals.paidDays}`;
</script>

<div class="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-24 pt-2">
    <div class="flex items-center justify-between gap-2 mb-3">
        <div class="flex items-center gap-1">
            <button on:click={() => shiftCursor(-1)} class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 flex items-center justify-center" aria-label={$_('overtime.previous')}>
                <i class="ph-bold ph-caret-left"></i>
            </button>
            <button on:click={() => shiftCursor(1)} class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 flex items-center justify-center" aria-label={$_('overtime.next')}>
                <i class="ph-bold ph-caret-right"></i>
            </button>
            <div class="ml-2 text-sm font-bold text-slate-700 dark:text-slate-200">
                {viewMode === 'year' ? `${cursorYear}${$_('overtime.view_year')}` : new Date(cursorYear, cursorMonth - 1, 1).toLocaleDateString(localeCode, { year: 'numeric', month: 'long' })}
            </div>
        </div>
        <button on:click={goToday} class="h-8 px-3 rounded-lg bg-white border border-slate-200 text-[11px] font-bold">{$_('overtime.today')}</button>
    </div>

    <div class="bg-white rounded-xl shadow-sm border border-slate-100 dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
        <div class="px-4 py-3 min-h-[54px] border-b border-slate-50 dark:border-slate-700 flex items-center justify-between gap-2 flex-wrap">
            <div class="font-bold text-sm text-slate-700 dark:text-slate-200">
                {viewMode === 'year' ? $_('overtime.year_detail') : $_('overtime.month_detail')}
            </div>
            <div class="flex items-center gap-3">
                <div class="text-[11px] text-slate-500">{viewMode === 'year' ? yearSummaryText : summaryText}</div>
                <SegmentedControl bind:value={viewMode} options={viewOptions} className="scale-95 origin-right" />
            </div>
        </div>

        {#if viewMode === 'year'}
            <div class="p-3 md:p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
                {#each yearMonths as item}
                    <button on:click={() => { cursorMonth = item.month; viewMode = 'month'; }}
                        class="bg-slate-50/70 rounded-lg border border-slate-100 p-3 text-left hover:border-orange-200 hover:bg-white transition dark:bg-slate-900/30 dark:border-slate-700">
                        <div class="flex items-center justify-between">
                            <div class="font-bold text-slate-700 dark:text-slate-200">{new Date(cursorYear, item.month - 1, 1).toLocaleDateString(localeCode, { month: 'long' })}</div>
                            <i class="ph ph-caret-right text-slate-300"></i>
                        </div>
                        <div class="mt-2 space-y-0.5 text-[11px]">
                            <div class="flex justify-between"><span class="text-slate-400">{$_('worklog.kind_overtime')}</span><b>{hours(item.overtime.hours)} · {money(item.overtime.pay)}</b></div>
                            <div class="flex justify-between"><span class="text-slate-400">{$_('worklog.kind_leave')}</span><b class="text-rose-500">{item.leave.days} {$_('leave.unit_day')}</b></div>
                            <div class="flex justify-between"><span class="text-slate-400">{$_('payroll.net_pay')}</span><b class={item.salary > 0 ? 'text-emerald-600' : 'text-slate-400'}>{item.salary > 0 ? money(item.salary) : $_('payroll.not_recorded')}</b></div>
                        </div>
                    </button>
                {/each}
            </div>
        {:else}
            <WorklogCalendar days={calendarDays} onSelectDay={(day) => { cursorDay = day; }} />
        {/if}
    </div>
</div>

<AnimatedModal bind:show={showForm} onClose={closeForm} zIndex={50} panelClass="max-w-lg">
    <div class="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40">
        <h3 class="font-bold text-lg text-slate-800 dark:text-slate-100">
            {editingId ? $_('common.edit') : (activeTab === 'overtime' ? $_('overtime.add_record') : $_('leave.add_record'))}
        </h3>
        <button on:click={closeForm} aria-label={$_('common.cancel')}><i class="ph ph-x text-xl"></i></button>
    </div>
    <div class="flex-1 overflow-y-auto p-6 space-y-4">
        {#if activeTab === 'overtime'}
            <div class="grid grid-cols-2 gap-3">
                <label class="flex flex-col gap-1 col-span-2">
                    <span class="text-xs font-bold text-slate-500">{$_('overtime.date')}</span>
                    <DatePicker bind:value={form.date} onchange={() => { form.type = inferOvertimeType(form.date); }} />
                </label>
                <label class="flex flex-col gap-1"><span class="text-xs font-bold text-slate-500">{$_('overtime.start_time')}</span><TimeSelect bind:value={form.start} /></label>
                <label class="flex flex-col gap-1"><span class="text-xs font-bold text-slate-500">{$_('overtime.end_time')}</span><TimeSelect bind:value={form.end} /></label>
                <label class="flex flex-col gap-1"><span class="text-xs font-bold text-slate-500">{$_('overtime.type')}</span>
                    <SelectMenu bind:value={form.type} options={[
                        { value: 'weekday', label: $_('overtime.type_weekday') },
                        { value: 'weekend', label: $_('overtime.type_weekend') },
                        { value: 'holiday', label: $_('overtime.type_holiday') }
                    ]} />
                </label>
                <label class="flex flex-col gap-1"><span class="text-xs font-bold text-slate-500">{$_('overtime.compensation')}</span>
                    <SelectMenu bind:value={form.compensation} options={[
                        { value: 'pay', label: $_('overtime.comp_pay') },
                        { value: 'time_off', label: $_('overtime.comp_time_off') },
                        { value: 'none', label: $_('overtime.comp_none') }
                    ]} />
                </label>
                <label class="flex flex-col gap-1 col-span-2"><span class="text-xs font-bold text-slate-500">{$_('overtime.actual_pay')}</span>
                    <input type="number" min="0" step="0.01" bind:value={form.actualPay} placeholder={$_('overtime.actual_pay_hint')}
                        class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm" />
                </label>
            </div>
        {:else}
            <div class="grid grid-cols-2 gap-3">
                <label class="flex flex-col gap-1"><span class="text-xs font-bold text-slate-500">{$_('leave.start_date')}</span><DatePicker bind:value={form.startDate} /></label>
                <label class="flex flex-col gap-1"><span class="text-xs font-bold text-slate-500">{$_('leave.end_date')}</span><DatePicker bind:value={form.endDate} /></label>
                <label class="flex flex-col gap-1"><span class="text-xs font-bold text-slate-500">{$_('leave.unit')}</span>
                    <SelectMenu bind:value={form.unit} options={[{ value: 'day', label: $_('leave.unit_day') }, { value: 'hour', label: $_('leave.unit_hour') }]} />
                </label>
                <label class="flex flex-col gap-1"><span class="text-xs font-bold text-slate-500">{$_('leave.duration')}</span>
                    <input type="number" min="0.5" step="0.5" bind:value={form.duration} class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm" />
                </label>
                <label class="flex flex-col gap-1"><span class="text-xs font-bold text-slate-500">{$_('leave.type')}</span>
                    <SelectMenu bind:value={form.type} options={LEAVE_TYPES.map(type => ({ value: type, label: $_('leave.type_' + type) }))} />
                </label>
                <label class="flex flex-col gap-1"><span class="text-xs font-bold text-slate-500">{$_('leave.paid')}</span>
                    <SelectMenu bind:value={form.paid} options={[{ value: true, label: $_('leave.paid') }, { value: false, label: $_('leave.unpaid') }]} />
                </label>
            </div>
        {/if}
        <label class="flex flex-col gap-1"><span class="text-xs font-bold text-slate-500">{$_('overtime.note')}</span>
            <textarea bind:value={form.note} rows="2" class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm resize-none"></textarea>
        </label>
    </div>
    <div class="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex gap-3">
        <button on:click={closeForm} class="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 rounded-xl font-bold text-sm">{$_('common.cancel')}</button>
        <button on:click={saveRecord} disabled={saving} class="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-xl font-bold text-sm">{$_('common.save')}</button>
    </div>
</AnimatedModal>
