<script>
    export let dateMain = '';
    export let dateSub = '';
    export let badge = '';
    export let badgeClass = '';
    export let title = '';
    export let detail = '';
    export let note = '';
    export let metric = '';
    export let amount = '';
    export let amountClass = 'text-slate-500';
    export let editLabel = '';
    export let deleteLabel = '';
    export let onEdit = () => {};
    export let onDelete = () => {};
</script>

<div class="group flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors">
    <div class="w-14 shrink-0 rounded-xl bg-slate-50 dark:bg-slate-900/40 py-1.5 text-center">
        <div class="text-base font-black text-slate-700 dark:text-slate-100 leading-5">{dateMain}</div>
        <div class="text-[9px] font-bold text-slate-400 leading-4">{dateSub}</div>
    </div>

    <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
            <span class="px-1.5 py-0.5 text-[10px] rounded border {badgeClass}">{badge}</span>
            <span class="text-xs font-bold text-slate-700 dark:text-slate-200">{title}</span>
        </div>
        <div class="text-[10px] text-slate-500 dark:text-slate-400 mt-1 truncate">{detail}</div>
        {#if note}
            <div class="text-[10px] text-slate-400 mt-0.5 truncate">{note}</div>
        {/if}
    </div>

    <div class="shrink-0 text-right">
        <div class="text-xs font-black {amountClass}">{metric}</div>
        {#if amount}
            <div class="text-[10px] font-bold {amountClass} mt-0.5">{amount}</div>
        {/if}
        <div class="mt-1 flex justify-end gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
            <button type="button" on:click={onEdit} aria-label={editLabel}
                class="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center">
                <i class="ph ph-pencil-simple"></i>
            </button>
            <button type="button" on:click={onDelete} aria-label={deleteLabel}
                class="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 flex items-center justify-center">
                <i class="ph ph-trash"></i>
            </button>
        </div>
    </div>
</div>
