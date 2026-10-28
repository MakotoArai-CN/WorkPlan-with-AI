<script>
    import { _ } from 'svelte-i18n';
    import { SALARY_COMPONENT_TEMPLATE, normalizeOvertimeConfig } from '../utils/overtime.js';

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
        initialized = true;
    }
    $: if (!show) initialized = false;

    function applyTemplate() {
        const existingTotal = components.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
        components = SALARY_COMPONENT_TEMPLATE.map((item, index) => ({
            ...item,
            amount: index === 0 ? existingTotal : 0
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
                amount: Math.max(0, Number(item.amount) || 0)
            }));
        const total = cleaned.reduce((sum, item) => sum + item.amount, 0);
        onSave({
            ...config,
            monthlySalary: total,
            payday,
            salaryCycleMode,
            overtimeBaseMode,
            leaveDeductionMode,
            workdaysPerMonth,
            hoursPerDay,
            salaryComponents: cleaned
        });
        close();
    }

    function inputClass() {
        return 'w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:border-orange-400';
    }
</script>

{#if show}
    <div class="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div
            class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            on:click={close}
            on:keydown={(event) => event.key === 'Escape' && close()}
            role="button"
            tabindex="0"
        ></div>
        <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl relative flex flex-col max-h-[90vh] overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900/40">
                <div>
                    <h3 class="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <i class="ph-fill ph-wallet text-orange-500"></i> {$_('payroll.settings_title')}
                    </h3>
                    <div class="text-[10px] text-slate-500 mt-0.5">{$_('payroll.settings_desc')}</div>
                </div>
                <button on:click={close} aria-label={$_('common.cancel')}><i class="ph ph-x text-xl"></i></button>
            </div>

            <div class="flex-1 overflow-y-auto p-6 space-y-5">
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <label class="flex flex-col gap-1">
                        <span class="text-[11px] font-bold text-slate-500">{$_('payroll.payday')}</span>
                        <input type="number" min="1" max="31" bind:value={payday} class={inputClass()} />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-[11px] font-bold text-slate-500">{$_('payroll.cycle_mode')}</span>
                        <select bind:value={salaryCycleMode} class={inputClass()}>
                            <option value="payday">{$_('payroll.cycle_payday')}</option>
                            <option value="calendar">{$_('payroll.cycle_calendar')}</option>
                        </select>
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
                        <select bind:value={overtimeBaseMode} class={inputClass()}>
                            <option value="base">{$_('payroll.base_mode_base')}</option>
                            <option value="total">{$_('payroll.base_mode_total')}</option>
                        </select>
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-[11px] font-bold text-slate-500">{$_('payroll.leave_deduction_mode')}</span>
                        <select bind:value={leaveDeductionMode} class={inputClass()}>
                            <option value="fixed">{$_('payroll.leave_fixed')}</option>
                            <option value="base">{$_('payroll.leave_base')}</option>
                        </select>
                    </label>
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
                        <div class="grid grid-cols-[1fr_130px_auto_auto] gap-2 items-center">
                            <input bind:value={component.name} placeholder={$_('payroll.component_name')} class={inputClass()} />
                            <input type="number" min="0" step="100" bind:value={component.amount} placeholder="0" class={inputClass()} />
                            <label class="flex items-center gap-1 text-[10px] text-slate-500 whitespace-nowrap">
                                <input type="checkbox" bind:checked={component.inOvertimeBase}
                                    class="rounded border-slate-300 text-orange-500 focus:ring-orange-400" />
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
                    {$_('payroll.total_hint')}: {new Intl.NumberFormat('zh-CN', { style: 'currency', currency: config.currency || 'CNY' }).format(components.reduce((sum, item) => sum + (Number(item.amount) || 0), 0))}
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
        </div>
    </div>
{/if}
