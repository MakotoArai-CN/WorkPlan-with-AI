<script>
    import { _ } from 'svelte-i18n';
    import { settingsStore } from '../stores/settings.js';
    import { getAnnualIncome, getPayrollEstimate, formatCycle } from '../utils/payroll.js';
    import { getAnnualLeaveBalance, getLeaveMonthSummary } from '../utils/overtime.js';
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

    function money(value) {
        return new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: config.currency || 'CNY',
            maximumFractionDigits: 2
        }).format(Number(value) || 0);
    }

    function saveSalaryConfig(next) {
        settingsStore.updateOvertimeConfig(next);
    }
</script>

<div class="px-4 md:px-6 pt-4">
    <div class="md:hidden">
        {#if activeTab === 'overtime'}
            <div class="rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                <div class="flex items-center justify-between gap-2">
                    <div class="text-[10px] font-bold text-slate-400 uppercase">{$_('payroll.current_cycle')}</div>
                    <div class="flex gap-1">
                        <button on:click={() => (showSalaryHistory = true)} class="text-[10px] font-bold text-slate-500">{$_('salary_history.entry')}</button>
                        <button on:click={() => (showSalarySettings = true)} class="text-[10px] font-bold text-orange-600">{$_('payroll.settings')}</button>
                    </div>
                </div>
                <div class="mt-1 text-sm font-black text-slate-800 dark:text-slate-100">{formatCycle(payroll.cycle)}</div>
                <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div><span class="text-slate-400">{$_('payroll.fixed_salary')}</span><div class="font-black">{money(payroll.fixedTotal)}</div></div>
                    <div><span class="text-slate-400">{$_('payroll.estimated')}</span><div class="font-black text-orange-600">{money(payroll.current.estimated)}</div></div>
                    <div><span class="text-slate-400">{$_('payroll.annual_net')}</span><div class="font-black text-emerald-600">{annual.monthsRecorded ? money(annual.totalNet) : $_('payroll.not_recorded')}</div></div>
                    <div><span class="text-slate-400">{$_('payroll.annual_overtime')}</span><div class="font-black text-orange-600">{annual.monthsRecorded ? money(annual.totalOvertime) : '-'}</div></div>
                </div>
            </div>
        {:else}
            <div class="rounded-xl border border-rose-100 dark:border-rose-900/40 bg-white dark:bg-slate-800 p-4">
                <div class="text-[10px] font-bold text-slate-400 uppercase">{$_('leave.annual_quota')}</div>
                <div class="mt-1 flex items-end gap-2">
                    <span class="text-2xl font-black text-rose-600">{balance.remaining}</span>
                    <span class="text-xs text-slate-500">{$_('leave.remaining')} / {$_('leave.unit_day')}</span>
                </div>
                <div class="mt-2 text-[10px] text-slate-500">{$_('leave.used')}: {balance.used} · {$_('leave.month_leave')}: {monthLeave.days}</div>
            </div>
        {/if}
    </div>

    <div class="hidden md:block overflow-hidden px-1 -mx-1">
        <div class="flex w-[200%] items-stretch transition-transform duration-300 ease-linear"
            style={`transform:translate3d(${activeTab === 'leave' ? '-50%' : '0'},0,0)`}>
            <div class="w-1/2 pr-2 min-w-0">
                <div class="h-full min-h-[260px] rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm flex flex-col">
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <div class="w-9 h-9 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                                <i class="ph-fill ph-wallet text-lg text-orange-600 dark:text-orange-300"></i>
                            </div>
                            <div class="min-w-0">
                                <div class="text-[10px] font-bold text-slate-400 uppercase">{$_('payroll.current_cycle')}</div>
                                <div class="text-sm font-black text-slate-800 dark:text-slate-100 truncate">{formatCycle(payroll.cycle)}</div>
                            </div>
                        </div>
                        <div class="flex items-center gap-1 shrink-0">
                            <button on:click={() => (showSalaryHistory = true)}
                                class="h-7 px-2 rounded-md border border-slate-200 dark:border-slate-600 text-[10px] font-bold text-slate-500 dark:text-slate-300">
                                {$_('salary_history.entry')}
                            </button>
                            <button on:click={() => (showSalarySettings = true)}
                                class="h-7 px-2 rounded-md border border-slate-200 dark:border-slate-600 text-[10px] font-bold text-slate-500 dark:text-slate-300">
                                {$_('payroll.settings')}
                            </button>
                        </div>
                    </div>

                    <div class="mt-3 grid grid-cols-4 gap-2">
                        <div class="rounded-lg bg-slate-50 dark:bg-slate-900/40 px-2 py-1.5">
                            <div class="text-[9px] text-slate-400">{$_('payroll.fixed_salary')}</div>
                            <div class="text-xs font-black text-slate-700 dark:text-slate-100">{money(payroll.fixedTotal)}</div>
                        </div>
                        <div class="rounded-lg bg-slate-50 dark:bg-slate-900/40 px-2 py-1.5">
                            <div class="text-[9px] text-slate-400">{$_('payroll.overtime_pay')}</div>
                            <div class="text-xs font-black text-orange-600">{money(payroll.current.overtimePay)}</div>
                        </div>
                        <div class="rounded-lg bg-slate-50 dark:bg-slate-900/40 px-2 py-1.5">
                            <div class="text-[9px] text-slate-400">{$_('payroll.leave_deduction')}</div>
                            <div class="text-xs font-black text-rose-500">-{money(payroll.current.leaveDeduction)}</div>
                        </div>
                        <div class="rounded-lg bg-orange-500 text-white px-2 py-1.5">
                            <div class="text-[9px] text-orange-100">{$_('payroll.estimated')}</div>
                            <div class="text-xs font-black">{money(payroll.current.estimated)}</div>
                        </div>
                    </div>

                    <div class="mt-auto pt-2 flex flex-wrap items-center gap-1.5 text-[9px]">
                        <span class="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300 font-bold">
                            {$_('payroll.smart_estimate')}: {money(payroll.smart.estimated)}
                        </span>
                        <span class="text-slate-400">
                            {$_('payroll.hourly_rate')}: {money(payroll.hourlyRate)}
                        </span>
                        {#if payroll.salaryGrowth.first && payroll.salaryGrowth.latest && payroll.salaryGrowth.first.periodEnd !== payroll.salaryGrowth.latest.periodEnd}
                            <span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 font-bold">
                                {$_('payroll.salary_growth')}: {payroll.salaryGrowth.difference >= 0 ? '+' : ''}{money(payroll.salaryGrowth.difference)}
                            </span>
                        {/if}
                    </div>
                    <div class="mt-2 flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/30 px-2 py-1.5 text-[9px]">
                        <span class="text-slate-400">{$_('payroll.annual_net')}</span>
                        {#if annual.monthsRecorded}
                            <b class="text-emerald-600">{money(annual.totalNet)}</b>
                            <span class="text-slate-300">·</span>
                            <span class="text-slate-400">{$_('payroll.annual_overtime')}</span>
                            <b class="text-orange-600">{money(annual.totalOvertime)}</b>
                        {:else}
                            <b class="text-slate-400">{$_('payroll.not_recorded')}</b>
                        {/if}
                        <button on:click={() => (showSalaryHistory = true)} class="ml-auto font-bold text-slate-500 hover:text-orange-600">
                            {$_('salary_history.entry')} →
                        </button>
                    </div>
                </div>
            </div>

            <div class="w-1/2 pl-2 min-w-0">
                <div class="h-full min-h-[260px] rounded-xl border border-rose-100 dark:border-rose-900/40 bg-white dark:bg-slate-800 p-4 shadow-sm flex flex-col">
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex items-center gap-2.5">
                            <div class="w-9 h-9 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                                <i class="ph-fill ph-calendar-check text-lg text-rose-600 dark:text-rose-300"></i>
                            </div>
                            <div>
                                <div class="text-[10px] font-bold text-slate-400 uppercase">{$_('worklog.kind_leave')}</div>
                                <div class="text-sm font-black text-slate-800 dark:text-slate-100">{$_('leave.annual_quota')}</div>
                            </div>
                        </div>
                        <div class="text-right">
                            <div class="text-[10px] text-slate-400">{$_('leave.remaining')}</div>
                            <div class="text-lg font-black text-rose-600">{balance.remaining} <span class="text-[10px] font-bold">{$_('leave.unit_day')}</span></div>
                        </div>
                    </div>
                    <div class="mt-3 grid grid-cols-3 gap-2">
                        <div class="rounded-lg bg-slate-50 dark:bg-slate-900/40 px-2 py-1.5">
                            <div class="text-[9px] text-slate-400">{$_('leave.annual_quota')}</div>
                            <div class="text-xs font-black text-slate-700 dark:text-slate-100">{balance.quota} {$_('leave.unit_day')}</div>
                        </div>
                        <div class="rounded-lg bg-slate-50 dark:bg-slate-900/40 px-2 py-1.5">
                            <div class="text-[9px] text-slate-400">{$_('leave.used')}</div>
                            <div class="text-xs font-black text-slate-700 dark:text-slate-100">{balance.used} {$_('leave.unit_day')}</div>
                        </div>
                        <div class="rounded-lg bg-slate-50 dark:bg-slate-900/40 px-2 py-1.5">
                            <div class="text-[9px] text-slate-400">{$_('leave.month_leave')}</div>
                            <div class="text-xs font-black text-slate-700 dark:text-slate-100">{monthLeave.days} {$_('leave.unit_day')}</div>
                        </div>
                    </div>
                    <div class="mt-3">
                        <div class="flex items-center justify-between text-[9px] text-slate-400">
                            <span>{$_('leave.annual_used')}</span>
                            <span>{balance.used} / {balance.quota}</span>
                        </div>
                        <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                            <div class="h-full rounded-full bg-gradient-to-r from-rose-400 to-pink-500 transition-[width] duration-500"
                                style={`width:${Math.min(100, Math.max(0, (balance.used / Math.max(balance.quota, 1)) * 100))}%`}></div>
                        </div>
                    </div>
                    {#if Object.values(monthLeave.byType || {}).some(value => value > 0)}
                        <div class="mt-2 flex flex-wrap gap-1">
                            {#each Object.entries(monthLeave.byType).filter(([, value]) => value > 0) as [type, value]}
                                <span class="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:bg-rose-900/20 dark:text-rose-300">
                                    {$_('leave.type_' + type)} {value}
                                </span>
                            {/each}
                        </div>
                    {/if}
                    <div class="mt-auto pt-2 text-[10px] text-slate-400">
                        {$_('leave.unpaid_days')}: {monthLeave.unpaidDays} · {$_('leave.unit_day')}
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<SalarySettings bind:show={showSalarySettings} {config}
    onSave={saveSalaryConfig} onClose={() => (showSalarySettings = false)} />
<SalaryHistory bind:show={showSalaryHistory} {config} overtimeRecords={overtimeRecords}
    onUpdateConfig={saveSalaryConfig} onClose={() => (showSalaryHistory = false)} />
