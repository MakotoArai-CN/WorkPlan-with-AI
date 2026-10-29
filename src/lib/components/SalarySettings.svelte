<script>
    import { _ } from 'svelte-i18n';
    import { SALARY_COMPONENT_TEMPLATE, normalizeOvertimeConfig } from '../utils/overtime.js';
    import AnimatedModal from './AnimatedModal.svelte';
    import SelectMenu from './SelectMenu.svelte';

    export let show = false;
    export let config = {};
    export let onSave = () => {};
    export let onClose = () => {};

    let components = [];
    let payday = 15;
    let salaryCycleMode = 'payday';
    let overtimeBaseMode = 'base';
    let leaveDeductionMode = 'fixed';
    let workdaysPerMonth = 21.75;
    let hoursPerDay = 8;
    let socialPaidBySelf = false;
    let initialized = false;

    $: if (show && !initialized) {
        const normalized = normalizeOvertimeConfig(config);
        components = normalized.salaryComponents.map(item => ({ ...item }));
        payday = normalized.payday;
        salaryCycleMode = normalized.salaryCycleMode;
        overtimeBaseMode = normalized.overtimeBaseMode;
        leaveDeductionMode = normalized.leaveDeductionMode;
        workdaysPerMonth = normalized.workdaysPerMonth;
        hoursPerDay = normalized.hoursPerDay;
        socialPaidBySelf = normalized.socialPaidBySelf === true;
        initialized = true;
    }
    $: cycleModeOptions = [
        { value: 'payday', label: $_('payroll.cycle_payday') },
        { value: 'calendar', label: $_('payroll.cycle_calendar') }
    ];
    $: overtimeBaseOptions = [
        { value: 'base', label: $_('payroll.base_mode_base') },
        { value: 'total', label: $_('payroll.base_mode_total') }
    ];
    $: leaveDeductionOptions = [
        { value: 'fixed', label: $_('payroll.leave_fixed') },
        { value: 'base', label: $_('payroll.leave_base') }
    ];
    $: if (!show) initialized = false;

    function applyTemplate() {
        const existingTotal = components.filter(item => item.fixed !== false).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
        components = SALARY_COMPONENT_TEMPLATE.map((item, index) => ({
            ...item,
            amount: index === 0 ? existingTotal : 0,
            fixed: true
        }));
    }

    function addComponent() {
        components = [...components, {
            id: `component_${Date.now()}`,
            name: '',
            amount: 0,
            inOvertimeBase: false
        }];
    }

    function removeComponent(index) {
        components = components.filter((_, i) => i !== index);
    }

    function close() {
        show = false;
        onClose();
    }

    function save() {
        const cleaned = components
            .filter(item => item.name.trim() || Number(item.amount) > 0)
            .map((item, index) => ({
                ...item,
                name: item.name.trim() || `项目 ${index + 1}`,
                amount: Math.max(0, Number(item.amount) || 0),
                fixed: item.fixed !== false,
                inOvertimeBase: item.fixed !== false && item.inOvertimeBase === true
            }));
        const total = cleaned
            .filter(item => item.fixed !== false)
            .reduce((sum, item) => sum + item.amount, 0);
        onSave({
            ...config,
            monthlySalary: total,
            payday,
            salaryCycleMode,
            overtimeBaseMode,
            leaveDeductionMode,
            workdaysPerMonth,
            hoursPerDay,
            socialPaidBySelf,
            salaryComponents: cleaned,
            salaryActuals: config.salaryActuals || []
        });
        close();
    }

    function inputClass() {
        return 'w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:border-orange-400';
    }
</script>

<AnimatedModal bind:show {onClose} zIndex={70} panelClass="max-w-2xl">

            <div class="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900/40">
                <div>
                    <h3 class="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <i class="ph-fill ph-wallet text-orange-500"></i> {$_('payroll.settings_title')}
                    </h3>
                    <div class="text-[10px] text-slate-500 mt-0.5">{$_('payroll.settings_desc')}</div>
                </div>
                <button on:click={close} aria-label={$_('common.cancel')}><i class="ph ph-x text-xl"></i></button>
            </div>

            <div class="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label class="flex flex-col gap-1">
                        <span class="text-[11px] font-bold text-slate-500">{$_('payroll.payday')}</span>
                        <input type="number" min="1" max="31" bind:value={payday} class={inputClass()} />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-[11px] font-bold text-slate-500">{$_('payroll.cycle_mode')}</span>
                        <SelectMenu bind:value={salaryCycleMode} options={cycleModeOptions} className="w-full" />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-[11px] font-bold text-slate-500">{$_('payroll.workdays')}</span>
                        <input type="number" min="1" max="31" step="0.25" bind:value={workdaysPerMonth} class={inputClass()} />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-[11px] font-bold text-slate-500">{$_('payroll.hours_per_day')}</span>
                        <input type="number" min="1" max="24" step="0.5" bind:value={hoursPerDay} class={inputClass()} />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-[11px] font-bold text-slate-500">{$_('payroll.overtime_base_mode')}</span>
                        <SelectMenu bind:value={overtimeBaseMode} options={overtimeBaseOptions} className="w-full" />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-[11px] font-bold text-slate-500">{$_('payroll.leave_deduction_mode')}</span>
                        <SelectMenu bind:value={leaveDeductionMode} options={leaveDeductionOptions} className="w-full" />
                    </label>
                </div>

                <label class="flex items-start gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/30 px-3 py-2 cursor-pointer">
                    <input type="checkbox" bind:checked={socialPaidBySelf}
                        class="mt-0.5 rounded border-slate-300 text-sky-500 focus:ring-sky-400" />
                    <span>
                        <span class="block text-[11px] font-bold text-slate-700 dark:text-slate-200">{$_('payroll.social_self_pay')}</span>
                        <span class="block text-[9px] text-slate-500 mt-0.5">{$_('payroll.social_self_pay_hint')}</span>
                    </span>
                </label>

                <div class="rounded-xl border border-amber-200 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-900/10 px-3 py-2 text-[10px] leading-relaxed text-amber-800 dark:text-amber-200">
                    <i class="ph-fill ph-info mr-1"></i>
                    {$_('payroll.components_scope_note')}
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <div class="text-sm font-bold text-slate-700 dark:text-slate-200">{$_('payroll.components')}</div>
                        <div class="text-[10px] text-slate-500">{$_('payroll.components_desc')}</div>
                    </div>
                    <div class="flex gap-2">
                        <button type="button" on:click={applyTemplate}
                            class="px-3 py-1.5 rounded-lg border border-orange-200 bg-orange-50 text-orange-700 text-[11px] font-bold">
                            {$_('payroll.load_template')}
                        </button>
                        <button type="button" on:click={addComponent}
                            class="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 text-[11px] font-bold">
                            + {$_('payroll.add_component')}
                        </button>
                    </div>
                </div>

                <div class="space-y-2">
                    {#each components as component, index}
                        <div class="grid grid-cols-1 sm:grid-cols-[1fr_110px_auto_auto_auto] gap-2 items-center">
                            <input bind:value={component.name} placeholder={$_('payroll.component_name')} class={inputClass()} />
                            <input type="number" min="0" step="100" bind:value={component.amount} placeholder="0" class={inputClass()} />
                            <label class="flex items-center gap-1 text-[10px] text-slate-500 whitespace-nowrap">
                                <input type="checkbox" bind:checked={component.fixed}
                                    on:change={() => { if (!component.fixed) component.inOvertimeBase = false; }}
                                    class="rounded border-slate-300 text-emerald-500 focus:ring-emerald-400" />
                                {$_('payroll.fixed_item')}
                            </label>
                            <label class="flex items-center gap-1 text-[10px] text-slate-500 whitespace-nowrap">
                                <input type="checkbox" bind:checked={component.inOvertimeBase}
                                    disabled={component.fixed === false}
                                    class="rounded border-slate-300 text-orange-500 focus:ring-orange-400 disabled:opacity-40" />
                                {$_('payroll.in_overtime_base')}
                            </label>
                            <button type="button" on:click={() => removeComponent(index)}
                                class="w-8 h-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"
                                aria-label={$_('common.delete')}>
                                <i class="ph ph-trash"></i>
                            </button>
                        </div>
                    {/each}
                    {#if components.length === 0}
                        <div class="text-xs text-slate-400 py-3 text-center">{$_('payroll.no_components')}</div>
                    {/if}
                </div>

                <div class="text-[10px] text-slate-400">
                    {$_('payroll.fixed_total_hint')}: {new Intl.NumberFormat('zh-CN', { style: 'currency', currency: config.currency || 'CNY' }).format(components.filter(item => item.fixed !== false).reduce((sum, item) => sum + (Number(item.amount) || 0), 0))}
                </div>
            </div>

            <div class="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex gap-3">
                <button on:click={close} class="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 rounded-xl font-bold text-sm">
                    {$_('common.cancel')}
                </button>
                <button on:click={save} class="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold text-sm">
                    {$_('common.save')}
                </button>
            </div>
</AnimatedModal>

