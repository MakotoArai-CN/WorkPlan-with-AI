<script>
    import { _ } from 'svelte-i18n';
    import { getAnnualIncome, getPayrollEstimate, formatCycle, setActualSalary } from '../utils/payroll.js';
    import SalaryHistory from './SalaryHistory.svelte';

    export let records = [];
    export let leaveRecords = [];
    export let config = {};
    export let onUpdateConfig = () => {};
    export let onOpenSettings = () => {};

    let actualInput = '';
    let actualNote = '';
    let initializedFor = '';
    let showHistory = false;

    $: payroll = getPayrollEstimate(records, leaveRecords, new Date(), config);
    $: cycle = payroll.cycle;
    $: previous = payroll.previousCycle;
    $: annual = getAnnualIncome(config, records, new Date().getFullYear());
    $: if (previous && initializedFor !== previous.end) {
        actualInput = payroll.actual ? String(payroll.actual.amount) : '';
        actualNote = payroll.actual?.note || '';
        initializedFor = previous.end;
    }

    function money(value) {
        return new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: config.currency || 'CNY',
            maximumFractionDigits: 2
        }).format(Number(value) || 0);
    }

    function saveActual() {
        const value = Number(actualInput);
        if (!Number.isFinite(value) || value < 0) return;
        const actuals = setActualSalary(config, previous, value, actualNote);
        onUpdateConfig({ salaryActuals: actuals });
    }
</script>

<div class="bg-white rounded-xl shadow-sm border border-slate-100 dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
    <div class="p-4 md:p-5 flex flex-col xl:flex-row gap-5">
        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
                <div class="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                    <i class="ph-fill ph-wallet text-xl text-orange-600 dark:text-orange-300"></i>
                </div>
                <div>
                    <div class="text-[10px] md:text-xs font-bold text-slate-400 uppercase">{$_('payroll.current_cycle')}</div>
                    <div class="text-sm md:text-base font-black text-slate-800 dark:text-slate-100">
                        {formatCycle(cycle)}
                        <span class="text-xs font-bold text-slate-400 ml-1">→ {cycle.paydayDate}</span>
                    </div>
                </div>
                <div class="ml-auto flex items-center gap-1.5">
                    <button on:click={() => (showHistory = true)}
                        class="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-600 text-[11px] font-bold text-slate-500 dark:text-slate-300 hover:border-orange-200 hover:text-orange-600 flex items-center gap-1">
                        <i class="ph ph-chart-line-up"></i> {$_('salary_history.entry')}
                    </button>
                    <button on:click={onOpenSettings}
                        class="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-600 text-[11px] font-bold text-slate-500 dark:text-slate-300 hover:border-orange-200 hover:text-orange-600 flex items-center gap-1">
                        <i class="ph ph-gear"></i> {$_('payroll.settings')}
                    </button>
                </div>
            </div>

            <div class="mt-3 flex flex-wrap gap-1.5">
                {#each payroll.components as component}
                    <span class="px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-700/60 text-[10px] text-slate-600 dark:text-slate-300">
                        {component.name}
                        <b class="text-slate-800 dark:text-slate-100">{money(component.amount)}</b>
                        {#if component.inOvertimeBase}
                            <span class="text-orange-500" title={$_('payroll.in_overtime_base')}>·</span>
                        {/if}
                    </span>
                {/each}
                {#if payroll.components.length === 0}
                    <span class="text-xs text-slate-400">{$_('payroll.no_components')}</span>
                {/if}
            </div>

            <div class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                <div class="rounded-lg bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
                    <div class="text-[9px] text-slate-400 uppercase">{$_('payroll.fixed_salary')}</div>
                    <div class="text-sm font-black text-slate-700 dark:text-slate-100">{money(payroll.fixedTotal)}</div>
                </div>
                <div class="rounded-lg bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
                    <div class="text-[9px] text-slate-400 uppercase">{$_('payroll.overtime_pay')}</div>
                    <div class="text-sm font-black text-orange-600">{money(payroll.current.overtimePay)}</div>
                </div>
                <div class="rounded-lg bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
                    <div class="text-[9px] text-slate-400 uppercase">{$_('payroll.leave_deduction')}</div>
                    <div class="text-sm font-black text-rose-500">-{money(payroll.current.leaveDeduction)}</div>
                </div>
                <div class="rounded-lg bg-orange-500 text-white px-3 py-2">
                    <div class="text-[9px] text-orange-100 uppercase">{$_('payroll.estimated')}</div>
                    <div class="text-sm font-black">{money(payroll.current.estimated)}</div>
                </div>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span class="px-2 py-1 rounded-md bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300 font-bold">
                    {$_('payroll.smart_estimate')}: {money(payroll.smart.estimated)}
                </span>
                <span class="px-2 py-1 rounded-md bg-slate-50 dark:bg-slate-900/40 text-slate-500">
                    {$_('payroll.smart_hint', { values: { overtime: money(payroll.smart.overtimePay), leave: money(payroll.smart.leaveDeduction) } })}
                </span>
                {#if payroll.salaryGrowth.first && payroll.salaryGrowth.latest && payroll.salaryGrowth.first.periodEnd !== payroll.salaryGrowth.latest.periodEnd}
                    <span class="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 font-bold">
                        {$_('payroll.salary_growth')}: {payroll.salaryGrowth.difference >= 0 ? '+' : ''}{money(payroll.salaryGrowth.difference)} ({payroll.salaryGrowth.percent >= 0 ? '+' : ''}{payroll.salaryGrowth.percent}%)
                    </span>
                {/if}
            </div>

            <div class="text-[10px] text-slate-400 mt-2">
                {$_('payroll.hourly_base')}: {money(payroll.overtimeBase)} / {config.workdaysPerMonth || 21.75} / {config.hoursPerDay || 8}
                · {$_('payroll.hourly_rate')}: <b>{money(payroll.hourlyRate)}</b>
                · {$_('payroll.unpaid_days')}: {payroll.current.leave.unpaidDays}
            </div>

            <div class="mt-3 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/30 p-3">
                <div class="flex items-center justify-between gap-2 mb-2">
                    <div class="text-[10px] font-bold text-slate-400 uppercase">{$_('payroll.annual_income')} · {annual.year}</div>
                    <button on:click={() => (showHistory = true)} class="text-[10px] font-bold text-orange-600">{$_('salary_history.entry')} →</button>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div><div class="text-[9px] text-slate-400">{$_('payroll.annual_net')}</div><div class="text-sm font-black text-emerald-600">{money(annual.totalNet)}</div></div>
                    <div><div class="text-[9px] text-slate-400">{$_('payroll.annual_overtime')}</div><div class="text-sm font-black text-orange-600">{money(annual.totalOvertime)}</div></div>
                    <div><div class="text-[9px] text-slate-400">{$_('payroll.monthly_average')}</div><div class="text-sm font-black text-slate-700 dark:text-slate-100">{money(annual.averageNet)}</div></div>
                    <div><div class="text-[9px] text-slate-400">{$_('payroll.months_recorded')}</div><div class="text-sm font-black text-slate-700 dark:text-slate-100">{annual.monthsRecorded}</div></div>
                </div>
            </div>
        </div>

        <div class="xl:w-72 shrink-0 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/30 p-3">
            <div class="text-[10px] font-bold text-slate-400 uppercase">{$_('payroll.last_cycle_actual')}</div>
            <div class="text-[10px] text-slate-500 mt-1">{formatCycle(previous)} → {previous.paydayDate}</div>
            {#if payroll.actual}
                <div class="mt-2 flex items-baseline gap-2">
                    <span class="text-[9px] text-slate-400">{$_('payroll.net_pay')}</span>
                    <b class="text-lg font-black text-emerald-600">{money(payroll.actual.amount)}</b>
                    {#if payroll.actual.overtimePay > 0}
                        <span class="text-[9px] text-orange-600">{$_('payroll.overtime_pay')} {money(payroll.actual.overtimePay)}</span>
                    {/if}
                </div>
            {/if}
            <div class="mt-2 flex items-center gap-2">
                <input type="number" min="0" step="100" bind:value={actualInput} on:change={saveActual}
                    placeholder={$_('payroll.actual_placeholder')}
                    class="min-w-0 w-full border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200" />
                <button on:click={saveActual}
                    class="shrink-0 h-9 px-3 rounded-lg bg-slate-800 text-white text-[11px] font-bold dark:bg-slate-600">
                    {$_('common.save')}
                </button>
            </div>
            <div class="mt-2 text-[10px] text-slate-500">
                {$_('payroll.previous_estimated')}: <b>{money(payroll.previous.estimated)}</b>
                {#if payroll.actual}
                    <span class="mx-1 text-slate-300">·</span>
                    {$_('payroll.difference')}:
                    <b class={payroll.actualDifference >= 0 ? 'text-emerald-600' : 'text-rose-500'}>
                        {payroll.actualDifference >= 0 ? '+' : ''}{money(payroll.actualDifference)}
                    </b>
                {/if}
            </div>
        </div>
    </div>
</div>


<SalaryHistory
    bind:show={showHistory}
    {config}
    overtimeRecords={records}
    onUpdateConfig={(updates) => onUpdateConfig(updates)}
    onClose={() => (showHistory = false)}
/>
