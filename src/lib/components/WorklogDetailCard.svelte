<script>
    import { _ } from 'svelte-i18n';
    import SegmentedControl from './SegmentedControl.svelte';
    import WorklogRecordRow from './WorklogRecordRow.svelte';

    export let title = '';
    export let summary = '';
    export let rows = [];
    export let layout = 'list';
    export let showLayout = false;
    export let showView = false;
    export let viewMode = 'month';
    export let viewOptions = [];
    export let emptyTitle = '';
    export let emptyDesc = '';
    export let addLabel = '';
    export let onAdd = () => {};
    export let onEdit = () => {};
    export let onDelete = () => {};
    export let editLabel = '';
    export let deleteLabel = '';

    $: layoutOptions = [
        { value: 'list', label: $_('overtime.layout_list'), icon: 'ph-list-bullets' },
        { value: 'calendar', label: $_('overtime.layout_calendar'), icon: 'ph-calendar-blank' }
    ];
</script>

<div class="bg-white rounded-xl shadow-sm min-h-[284px] border border-slate-100 dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
    <div class="px-4 py-3 min-h-[54px] border-b border-slate-50 dark:border-slate-700 flex items-center justify-between gap-2 flex-wrap">
        <div class="font-bold text-sm text-slate-700 dark:text-slate-200">{title}</div>
        <div class="flex items-center gap-3">
            <div class="text-[10px] text-slate-500">{summary}</div>
            {#if showView}
                <SegmentedControl bind:value={viewMode} options={viewOptions} className="scale-95 origin-right" />
            {/if}
            {#if showLayout}
                <SegmentedControl bind:value={layout} options={layoutOptions} className="scale-95 origin-right" />
            {/if}
        </div>
    </div>

    {#if showLayout && layout === 'calendar'}
        <slot name="calendar" />
    {:else}
        <div class="divide-y divide-slate-50 dark:divide-slate-700/60">
            {#each rows as row}
                <WorklogRecordRow
                    {...row}
                    {editLabel}
                    {deleteLabel}
                    onEdit={() => onEdit(row.record)}
                    onDelete={() => onDelete(row.record)}
                />
            {/each}
            {#if rows.length === 0}
                <div class="py-12 text-center text-slate-400">
                    <i class="ph ph-clipboard-text text-4xl mb-2 opacity-40"></i>
                    <div class="text-sm font-bold">{emptyTitle}</div>
                    <div class="text-xs mt-1">{emptyDesc}</div>
                    {#if addLabel}
                        <button on:click={onAdd} class="mt-3 text-xs font-bold text-orange-600 hover:text-orange-700">
                            + {addLabel}
                        </button>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</div>
