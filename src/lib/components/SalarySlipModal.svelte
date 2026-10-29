<script>
    import { _ } from 'svelte-i18n';
    import AnimatedModal from './AnimatedModal.svelte';
    import { formatCycle } from '../utils/payroll.js';

    export let show = false;
    export let config = {};
    export let cycle = null;
    export let actual = null;
    export let onSave = () => {};
    export let onClose = () => {};

    const DEFAULT_COMPONENTS = [
        { id: 'base', name: '底薪', category: 'base', amount: 0 },
        { id: 'performance', name: '绩效', category: 'performance', amount: 0 },
        { id: 'meal', name: '餐补', category: 'meal', amount: 0 },
        { id: 'overtime', name: '加班费', category: 'overtime', amount: 0 },
        { id: 'holiday', name: '过节费', category: 'holiday', amount: 0 },
        { id: 'social', name: '社保补贴', category: 'social', amount: 0 }
    ];
    let components = [];
    let deductions = 0;
    let netInput = '';
    let note = '';
    let initializedFor = '';

    $: if (show && cycle && initializedFor !== cycle.end) {
        const saved = Array.isArray(actual?.components) && actual.components.length
            ? actual.components
            : DEFAULT_COMPONENTS;
        const byCategory = new Map(saved.map(component => [component.category, component.amount]));
        components = DEFAULT_COMPONENTS.map(component => ({
            ...component,
            amount: Number(byCategory.get(component.category) || 0)
        }));
        // Keep any custom component the user had previously entered.
        for (const component of saved) {
            if (!DEFAULT_COMPONENTS.some(item => item.category === component.category)) {
                components.push({ ...component });
            }
        }
        deductions = Number(actual?.deductions) || 0;
        netInput = actual?.amount !== undefined && actual?.amount !== null ? String(actual.amount) : '';
        note = actual?.note || '';
        initializedFor = cycle.end;
    }
    $: if (!show) initializedFor = '';

    $: gross = Math.round(components.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) * 100) / 100;
    $: social = components
        .filter(item => item.category === 'social' || /社保/.test(item.name))
        .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    $: overtime = components
        .filter(item => item.category === 'overtime' || /加班/.test(item.name))
        .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    $: computedNet = Math.round((gross - (Number(deductions) || 0)) * 100) / 100;
    $: finalNet = netInput === '' ? computedNet : Math.round((Number(netInput) || 0) * 100) / 100;

    function money(value) {
        return new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: config.currency || 'CNY',
            maximumFractionDigits: 2
        }).format(Number(value) || 0);
    }

    function addComponent() {
        components = [...components, {
            id: `salary_component_${Date.now()}`,
            name: '',
            category: 'other',
            amount: 0
        }];
    }

    function removeComponent(index) {
        components = components.filter((_, i) => i !== index);
    }

    function save() {
        onSave({
            amount: Math.max(0, finalNet),
            grossAmount: Math.max(0, gross),
            deductions: Math.max(0, Number(deductions) || 0),
            overtimePay: Math.max(0, overtime),
            socialInsurance: Math.max(0, social),
            components: components
                .filter(item => item.name.trim() || Number(item.amount) > 0)
                .map((item, index) => ({
                    ...item,
                    name: item.name.trim() || `项目 ${index + 1}`,
                    amount: Math.max(0, Number(item.amount) || 0)
                })),
            note: note.trim()
        });
        show = false;
        onClose();
    }
</script>

<AnimatedModal bind:show {onClose} zIndex={78} panelClass="max-w-2xl">
    <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-start justify-between gap-3">
        <div>
            <h3 class="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <i class="ph-fill ph-receipt text-orange-500"></i> {$_('payroll.slip_title')}
            </h3>
            <div class="text-[10px] text-slate-500 mt-0.5">
                {cycle ? formatCycle(cycle) + ' → ' + cycle.paydayDate : ''} · {$_('payroll.slip_desc')}
            </div>
        </div>
        <button on:click={() => { show = false; onClose(); }} aria-label={$_('common.close')}
            class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            <i class="ph ph-x text-lg"></i>
        </button>
    </div>

    <div class="flex-1 overflow-y-auto p-5 space-y-4">
        <div class="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px]">
            <span class="text-slate-400">{$_('payroll.gross_pay')}</span>
            <b class="text-slate-800 dark:text-slate-100">{money(gross)}</b>
            <span class="text-slate-400">{$_('payroll.overtime_pay')}</span>
            <b class="text-orange-600">{money(overtime)}</b>
            <span class="text-slate-400">{$_('payroll.social_insurance')}</span>
            <b class="text-sky-600">{money(social)}</b>
            <span class="ml-auto text-slate-400">{$_('payroll.net_pay')}</span>
            <b class="text-emerald-600 text-sm">{money(finalNet)}</b>
        </div>

        <div class="space-y-2">
            {#each components as component, index}
                <div class="grid grid-cols-[1fr_120px_auto] gap-2 items-center">
                    <input bind:value={component.name} placeholder={$_('payroll.component_name')}
                        class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200" />
                    <input type="number" min="0" step="0.01" bind:value={component.amount}
                        class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-right text-slate-700 dark:text-slate-200" />
                    <button on:click={() => removeComponent(index)} aria-label={$_('common.delete')}
                        class="w-8 h-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            {/each}
            <button on:click={addComponent}
                class="w-full rounded-lg border border-dashed border-slate-200 py-2 text-[11px] font-bold text-slate-400 hover:border-orange-300 hover:text-orange-600 dark:border-slate-600">
                + {$_('payroll.add_component')}
            </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label class="flex flex-col gap-1">
                <span class="text-[10px] font-bold text-slate-500">{$_('payroll.deductions')}</span>
                <input type="number" min="0" step="0.01" bind:value={deductions}
                    class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm" />
            </label>
            <label class="flex flex-col gap-1">
                <span class="text-[10px] font-bold text-slate-500">{$_('payroll.net_pay')}</span>
                <input type="number" min="0" step="0.01" bind:value={netInput}
                    placeholder={String(computedNet)}
                    class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm" />
                <span class="text-[9px] text-slate-400">{$_('payroll.net_auto_hint')} {money(computedNet)}</span>
            </label>
            <label class="flex flex-col gap-1">
                <span class="text-[10px] font-bold text-slate-500">{$_('payroll.note')}</span>
                <input bind:value={note} placeholder={$_('payroll.slip_note_placeholder')}
                    class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm" />
            </label>
        </div>

        <div class="rounded-xl border border-orange-100 bg-orange-50 dark:bg-orange-900/15 dark:border-orange-900/40 p-3 text-[10px] leading-relaxed text-orange-700 dark:text-orange-300">
            {$_('payroll.slip_hint')}
        </div>
    </div>

    <div class="px-5 py-4 border-t border-slate-100 dark:border-slate-700 flex gap-3">
        <button on:click={() => { show = false; onClose(); }}
            class="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-sm font-bold text-slate-600 dark:text-slate-200">
            {$_('common.cancel')}
        </button>
        <button on:click={save}
            class="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-sm font-bold text-white">
            {$_('common.save')}
        </button>
    </div>
</AnimatedModal>
