<script>
    import { _ } from 'svelte-i18n';
    import { showToast } from '../stores/modal.js';
    import AnimatedModal from './AnimatedModal.svelte';
    import {
        BOSS_FIELDS,
        BOSS_LEAVE_FIELDS,
        LEAVE_FIELDS,
        OVERTIME_FIELDS,
        exportWorklog,
        filterWorklogRecords
    } from '../utils/worklog-export.js';

    export let show = false;
    export let kind = 'overtime';
    export let records = [];
    export let year = new Date().getFullYear();
    export let config = {};
    export let onClose = () => {};

    let format = 'xlsx';
    let scope = 'year';
    let month = new Date().getMonth() + 1;
    let preset = 'boss';
    let customFields = new Set(kind === 'leave' ? LEAVE_FIELDS : OVERTIME_FIELDS);
    let exporting = false;

    $: allFields = kind === 'leave' ? LEAVE_FIELDS : OVERTIME_FIELDS;
    $: bossFields = kind === 'leave' ? BOSS_LEAVE_FIELDS : BOSS_FIELDS;
    $: activeFields = preset === 'boss'
        ? bossFields
        : preset === 'full'
            ? allFields
            : allFields.filter(field => customFields.has(field));
    $: kindLabel = $_('worklog.kind_' + kind);
    $: monthLabels = Array.from({ length: 12 }, (_, index) =>
        new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(2026, index, 1))
    );
    $: fieldLabels = {
        date: $_('worklog.field_date'),
        start: $_('worklog.field_start'),
        end: $_('worklog.field_end'),
        hours: $_('worklog.field_hours'),
        type: $_('worklog.field_type'),
        compensation: $_('worklog.field_compensation'),
        pay: $_('worklog.field_pay'),
        note: $_('worklog.field_note'),
        startDate: $_('worklog.field_start_date'),
        endDate: $_('worklog.field_end_date'),
        duration: $_('worklog.field_duration'),
        unit: $_('worklog.field_unit'),
        paid: $_('worklog.field_paid'),
        kind: $_('worklog.field_kind')
    };
    $: typeLabels = {
        weekday: $_('overtime.type_weekday'),
        weekend: $_('overtime.type_weekend'),
        holiday: $_('overtime.type_holiday'),
        annual: $_('leave.type_annual'),
        sick: $_('leave.type_sick'),
        personal: $_('leave.type_personal'),
        compensatory: $_('leave.type_compensatory'),
        maternity: $_('leave.type_maternity'),
        marriage: $_('leave.type_marriage'),
        bereavement: $_('leave.type_bereavement'),
        other: $_('leave.type_other')
    };
    $: compensationLabels = {
        pay: $_('overtime.comp_pay'),
        time_off: $_('overtime.comp_time_off'),
        none: $_('overtime.comp_none')
    };
    $: unitLabels = {
        day: $_('leave.unit_day'),
        hour: $_('leave.unit_hour')
    };

    function toggleField(field) {
        if (customFields.has(field)) customFields.delete(field);
        else customFields.add(field);
        customFields = customFields;
        preset = 'custom';
    }

    function chooseAll(checked) {
        customFields = new Set(checked ? allFields : []);
        preset = checked ? 'full' : 'custom';
    }

    async function doExport() {
        if (exporting) return;
        if (activeFields.length === 0) {
            showToast({ message: $_('worklog.select_one_field'), type: 'warning' });
            return;
        }
        const scopedRecords = filterWorklogRecords(kind, records, scope, year, month);
        exporting = true;
        const result = await exportWorklog({
            kind,
            records: scopedRecords,
            fields: activeFields,
            format,
            scope,
            year,
            month,
            fieldLabels,
            labels: {
                type: typeLabels,
                compensation: compensationLabels,
                unit: unitLabels,
                paid: $_('leave.paid'),
                unpaid: $_('leave.unpaid'),
                noExport: $_('worklog.no_export')
            },
            config,
            kindLabel,
            sheetName: kind === 'leave' ? $_('leave.title') : $_('overtime.title'),
            showToast
        });
        exporting = false;
        if (result?.success !== false) {
            show = false;
            onClose();
        }
    }
</script>

<AnimatedModal bind:show {onClose} zIndex={60} panelClass="max-w-lg">
            <div class="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40">
                <div>
                    <h3 class="font-bold text-lg text-slate-800 dark:text-slate-100">{$_('worklog.export_title')}</h3>
                    <div class="text-[10px] text-slate-500 mt-0.5">{$_('worklog.export_desc')}</div>
                </div>
                <button on:click={onClose} aria-label={$_('worklog.cancel')}><i class="ph ph-x text-xl"></i></button>
            </div>

            <div class="flex-1 overflow-y-auto p-6 space-y-5">
                <div>
                    <div class="text-xs font-bold text-slate-500 mb-2">{$_('worklog.format')}</div>
                    <div class="flex bg-slate-100 p-1 rounded-lg gap-1">
                        {#each [
                            { key: 'xlsx', label: 'Excel' },
                            { key: 'csv', label: 'CSV' },
                            { key: 'json', label: 'JSON' }
                        ] as item}
                            <button on:click={() => format = item.key}
                                class="flex-1 py-1.5 text-[11px] rounded-md transition"
                                class:bg-white={format === item.key}
                                class:shadow-sm={format === item.key}
                                class:font-bold={format === item.key}
                                class:text-indigo-600={format === item.key}
                                class:text-slate-500={format !== item.key}>
                                {item.label}
                            </button>
                        {/each}
                    </div>
                </div>

                <div>
                    <div class="text-xs font-bold text-slate-500 mb-2">{$_('worklog.scope')}</div>
                    <div class="flex bg-slate-100 p-1 rounded-lg gap-1">
                        <button on:click={() => scope = 'year'}
                            class="flex-1 py-1.5 text-[11px] rounded-md transition"
                            class:bg-white={scope === 'year'} class:shadow-sm={scope === 'year'}
                            class:font-bold={scope === 'year'} class:text-indigo-600={scope === 'year'}
                            class:text-slate-500={scope !== 'year'}>
                            {$_('worklog.this_year')} ({year})
                        </button>
                        <button on:click={() => scope = 'month'}
                            class="flex-1 py-1.5 text-[11px] rounded-md transition"
                            class:bg-white={scope === 'month'} class:shadow-sm={scope === 'month'}
                            class:font-bold={scope === 'month'} class:text-indigo-600={scope === 'month'}
                            class:text-slate-500={scope !== 'month'}>
                            {$_('worklog.this_month')}
                        </button>
                        <button on:click={() => scope = 'all'}
                            class="flex-1 py-1.5 text-[11px] rounded-md transition"
                            class:bg-white={scope === 'all'} class:shadow-sm={scope === 'all'}
                            class:font-bold={scope === 'all'} class:text-indigo-600={scope === 'all'}
                            class:text-slate-500={scope !== 'all'}>
                            {$_('worklog.all')}
                        </button>
                    </div>
                    {#if scope === 'month'}
                        <div class="mt-2 flex items-center gap-2">
                            <span class="text-[10px] text-slate-500">{$_('worklog.month')}</span>
                            <select bind:value={month}
                                class="border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-900 text-xs text-slate-600 dark:text-slate-300">
                                {#each monthLabels as label, index}
                                    <option value={index + 1}>{label}</option>
                                {/each}
                            </select>
                        </div>
                    {/if}
                </div>

                <div>
                    <div class="text-xs font-bold text-slate-500 mb-2">{$_('worklog.preset')}</div>
                    <div class="grid grid-cols-1 gap-2">
                        <button on:click={() => preset = 'boss'}
                            class={`text-left p-3 rounded-xl border transition ${preset === 'boss' ? 'border-orange-300 bg-orange-50 dark:bg-orange-900/20' : 'border-slate-200 dark:border-slate-700'}`}>
                            <div class="flex items-center justify-between">
                                <div class="font-bold text-sm text-slate-700 dark:text-slate-200">{$_('worklog.preset_boss')}</div>
                                {#if preset === 'boss'}<i class="ph-fill ph-check-circle text-orange-500"></i>{/if}
                            </div>
                            <div class="text-[10px] text-slate-500 mt-1">{$_('worklog.preset_boss_desc')}</div>
                        </button>
                        <button on:click={() => preset = 'full'}
                            class={`text-left p-3 rounded-xl border transition ${preset === 'full' ? 'border-orange-300 bg-orange-50 dark:bg-orange-900/20' : 'border-slate-200 dark:border-slate-700'}`}>
                            <div class="flex items-center justify-between">
                                <div class="font-bold text-sm text-slate-700 dark:text-slate-200">{$_('worklog.preset_full')}</div>
                                {#if preset === 'full'}<i class="ph-fill ph-check-circle text-orange-500"></i>{/if}
                            </div>
                            <div class="text-[10px] text-slate-500 mt-1">{$_('worklog.preset_full_desc')}</div>
                        </button>
                        <button on:click={() => preset = 'custom'}
                            class={`text-left p-3 rounded-xl border transition ${preset === 'custom' ? 'border-orange-300 bg-orange-50 dark:bg-orange-900/20' : 'border-slate-200 dark:border-slate-700'}`}>
                            <div class="flex items-center justify-between">
                                <div class="font-bold text-sm text-slate-700 dark:text-slate-200">{$_('worklog.preset_custom')}</div>
                                {#if preset === 'custom'}<i class="ph-fill ph-check-circle text-orange-500"></i>{/if}
                            </div>
                            <div class="text-[10px] text-slate-500 mt-1">{$_('worklog.preset_custom_desc')}</div>
                        </button>
                    </div>
                </div>

                {#if preset === 'custom'}
                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <div class="text-xs font-bold text-slate-500">{$_('worklog.fields')}</div>
                            <button on:click={() => chooseAll(customFields.size !== allFields.length)}
                                class="text-[10px] font-bold text-indigo-600">
                                {customFields.size === allFields.length ? $_('worklog.clear_all') : $_('worklog.select_all')}
                            </button>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            {#each allFields as field}
                                <label class="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer">
                                    <input type="checkbox" checked={customFields.has(field)} on:change={() => toggleField(field)}
                                        class="rounded border-slate-300 text-orange-500 focus:ring-orange-400" />
                                    <span class="text-xs text-slate-600 dark:text-slate-300">{fieldLabels[field]}</span>
                                </label>
                            {/each}
                        </div>
                    </div>
                {/if}

                <div class="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 text-[10px] text-slate-500">
                    {$_('worklog.summary', { values: { count: activeFields.length } })}
                </div>
            </div>

            <div class="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex gap-3">
                <button on:click={onClose}
                    class="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 rounded-xl font-bold text-sm">
                    {$_('worklog.cancel')}
                </button>
                <button on:click={doExport} disabled={exporting}
                    class="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-xl font-bold text-sm">
                    {exporting ? $_('worklog.exporting') : $_('worklog.export')}
                </button>
            </div>
</AnimatedModal>
