<script>
    import { _ } from 'svelte-i18n';
    import { settingsStore } from '../stores/settings.js';
    import { getAnnualIncome, getPayrollEstimate, formatCycle } from '../utils/payroll.js';
    import { getAnnualLeaveBalance, getLeaveMonthSummary, getOvertimeCalibration } from '../utils/overtime.js';
    import SalarySettings from './SalarySettings.svelte';
    import SalaryHistory from './SalaryHistory.svelte';

    export let activeTab = 'overtime';
    export let config = {};
    export let overtimeRecords = [];
    export let leaveRecords = [];

    let showSalarySettings = false;
    let showSalaryHistory = false;

    $: payroll = getPayrollEstimate(overtimeRecords, leaveRecords, new Date(), config);
    $: annual = getAnnualIncome(config, overtimeRecords, new Date().getFullYear());
    $: balance = getAnnualLeaveBalance(leaveRecords, new Date().getFullYear(), config);
    $: monthLeave = getLeaveMonthSummary(leaveRecords, new Date().getFullYear(), new Date().getMonth() + 1, config);
    $: calibration = getOvertimeCalibration(overtimeRecords, config);

    function money(value) {
        return new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: config.currency || 'CNY',
            maximumFractionDigits: 2
        }).format(Number(value) || 0);
    }

    function hours(value) {
        return `${Math.round((Number(value) || 0) * 100) / 100}h`;
    }

    function saveSalaryConfig(next) {
        settingsStore.updateOvertimeConfig(next);
    }
</script>

<div class="px-4 md:px-6 pt-3">
    <div class={`rounded-2xl border bg-white dark:bg-slate-800 p-4 md:p-5 shadow-sm ${activeTab === 'leave' ? 'border-rose-100 dark:border-rose-900/40' : 'border-slate-100 dark:border-slate-700'}`}>
        <div class="flex flex-col xl:flex-row xl:items-center gap-4">
            <div class="min-w-0 xl:w-56">
                <div class="text-xs font-bold text-slate-400">{$_('payroll.last_cycle_actual')}</div>
                <div class="mt-1 flex items-end gap-2 flex-wrap">
                    <div class="text-3xl font-black text-emerald-600 leading-none">
                        {payroll.actual ? money(payroll.actual.amount) : '—'}
                    </div>
                    <button on:click={() => (showSalaryHistory = true)}
                        class="text-xs font-bold text-slate-500 hover:text-orange-600">
                        {payroll.actual ? $_('salary_history.entry') : $_('payroll.not_recorded')} →
                    </button>
                </div>
                <div class="text-xs text-slate-500 mt-2">
                    {formatCycle(payroll.previousCycle)} · {payroll.actual?.paydayDate || $_('payroll.not_recorded')}
                </div>
                {#if payroll.actual}
                    <div class="text-xs text-slate-500 mt-1">
                        {$_('payroll.overtime_pay')} <b class="text-orange-600">{money(payroll.actual.overtimePay)}</b>
                    </div>
                {/if}
            </div>

            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-1 min-w-0">
                <div class="rounded-xl bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
                    <div class="text-xs text-slate-400">{$_('payroll.annual_net')}</div>
                    <div class="text-lg font-black text-slate-800 dark:text-slate-100 mt-0.5">
                        {annual.monthsRecorded ? money(annual.totalNet) : '—'}
                    </div>
                    <div class="text-[11px] text-slate-400">{$_('payroll.months_recorded')}: {annual.monthsRecorded}</div>
                </div>
                <div class="rounded-xl bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
                    <div class="text-xs text-slate-400">{$_('payroll.annual_overtime')}</div>
                    <div class="text-lg font-black text-orange-600 mt-0.5">
                        {annual.monthsRecorded ? money(annual.estimatedOvertime) : '—'}
                    </div>
                    <div class="text-[11px] text-slate-400">
                        {$_('overtime.actual_label')}: {money(annual.totalOvertime)}
                    </div>
                </div>
                <div class="rounded-xl bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
                    <div class="text-xs text-slate-400">{$_('payroll.current_cycle')}</div>
                    <div class="text-lg font-black text-slate-800 dark:text-slate-100 mt-0.5">
                        {money(payroll.current.estimated)}
                    </div>
                    <div class="text-[11px] text-slate-400">{$_('payroll.estimated')}</div>
                </div>
                <div class="rounded-xl bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
                    <div class="text-xs text-slate-400">{$_('payroll.hourly_rate')}</div>
                    <div class="text-lg font-black text-indigo-600 mt-0.5">{money(payroll.hourlyRate)}</div>
                    <div class="text-[11px] text-slate-400">
                        {#if calibration.learnedRate > 0}
                            {$_('overtime.formula_learned_short', { values: { samples: calibration.samples } })}
                        {:else}
                            {$_('overtime.formula_standard_short')}
                        {/if}
                    </div>
                </div>
            </div>

            <div class="flex xl:flex-col gap-2 shrink-0">
                <button on:click={() => (showSalaryHistory = true)}
                    class="h-9 flex-1 xl:flex-none px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold">
                    {$_('salary_history.entry')}
                </button>
                <button on:click={() => (showSalarySettings = true)}
                    class="h-9 flex-1 xl:flex-none px-4 rounded-xl border border-slate-200 dark:border-slate-600 text-xs font-bold text-slate-600 dark:text-slate-300">
                    {$_('payroll.settings')}
                </button>
            </div>
        </div>

        <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
            {#if payroll.current.overtime.payableHours > 0 || payroll.current.overtimePay > 0}
                <span>
                    {$_('payroll.overtime_pay')}
                    <b class="text-slate-700 dark:text-slate-200">{hours(payroll.current.overtime.payableHours)}</b>
                    · <b class="text-orange-600">{money(payroll.current.overtimePay)}</b>
                </span>
            {/if}
            {#if monthLeave.days > 0}
                <span>
                    {$_('leave.month_leave')}
                    <b class="text-rose-500">{monthLeave.days}</b> {$_('leave.unit_day')}
                </span>
            {/if}
            {#if balance.quota > 0}
                <span>
                    {$_('leave.remaining')}
                    <b class="text-rose-500">{Math.max(0, balance.remaining)}</b> / {balance.quota} {$_('leave.unit_day')}
                </span>
            {:else}
                <span>{$_('leave.remaining')}: {$_('payroll.not_recorded')}</span>
            {/if}
            {#if payroll.salaryGrowth.first && payroll.salaryGrowth.latest && payroll.salaryGrowth.first.periodEnd !== payroll.salaryGrowth.latest.periodEnd}
                <span>
                    {$_('payroll.salary_growth')}
                    <b class={payroll.salaryGrowth.difference >= 0 ? 'text-emerald-600' : 'text-rose-500'}>
                        {payroll.salaryGrowth.difference >= 0 ? '+' : ''}{money(payroll.salaryGrowth.difference)}
                    </b>
                </span>
            {/if}
        </div>
    </div>
</div>

<SalarySettings bind:show={showSalarySettings} {config}
    onSave={saveSalaryConfig} onClose={() => (showSalarySettings = false)} />
<SalaryHistory bind:show={showSalaryHistory} {config} overtimeRecords={overtimeRecords}
    onUpdateConfig={saveSalaryConfig} onClose={() => (showSalaryHistory = false)} />
