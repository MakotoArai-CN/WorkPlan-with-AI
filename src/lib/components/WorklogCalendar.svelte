<script>
    export let days = [];
    export let onSelectDay = () => {};

    const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
</script>

<div class="p-3">
    <div class="grid grid-cols-7 gap-1 mb-1">
        {#each weekdays as label}
            <div class="h-7 flex items-center justify-center text-[11px] font-bold text-slate-400">{label}</div>
        {/each}
    </div>
    <div class="grid grid-cols-7 gap-1">
        {#each days as item}
            {#if item}
                <button type="button" on:click={() => onSelectDay(item.day)}
                    class={`min-h-20 md:min-h-24 rounded-lg border p-1.5 text-left transition
                        ${item.dots?.length
                            ? 'border-orange-200 bg-orange-50/70 dark:border-orange-800 dark:bg-orange-900/20'
                            : 'border-slate-100 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/20 hover:border-orange-200'}`}>
                    <div class={`text-[12px] font-black ${item.dots?.length ? 'text-orange-600' : 'text-slate-400'}`}>{item.day}</div>
                    {#if item.dots?.length}
                        <div class="mt-1 text-[11px] font-bold text-slate-600 dark:text-slate-300">{item.primary}</div>
                        {#if item.secondary}
                            <div class="text-[10px] text-orange-600 truncate">{item.secondary}</div>
                        {/if}
                        <div class="mt-1 flex flex-wrap gap-0.5">
                            {#each item.dots.slice(0, 4) as dot}
                                <span class={`w-1.5 h-1.5 rounded-full ${dot}`}></span>
                            {/each}
                        </div>
                    {:else}
                        <div class="mt-2 text-[10px] text-slate-300 dark:text-slate-600">—</div>
                    {/if}
                </button>
            {:else}
                <div></div>
            {/if}
        {/each}
    </div>
</div>
