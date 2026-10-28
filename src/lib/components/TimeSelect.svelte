<script>
    import { tick } from 'svelte';
    import { _ } from 'svelte-i18n';

    export let value = '18:00';
    export let disabled = false;
    export let onchange = () => {};

    const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
    const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
    let trigger;
    let menu;
    let open = false;
    let menuStyle = '';
    let hourList;
    let minuteList;

    $: [selectedHour, selectedMinute] = String(value || '00:00').split(':');

    function portal(node) {
        document.body.appendChild(node);
        return { destroy() { node.remove(); } };
    }

    async function toggle() {
        if (disabled) return;
        if (open) {
            open = false;
            return;
        }
        open = true;
        await tick();
        position();
        scrollSelected();
        if (!document.documentElement.classList.contains('reduce-animations') && !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
            menu?.animate([
                { opacity: 0, transform: 'translateY(-4px) scale(0.97)' },
                { opacity: 1, transform: 'translateY(0) scale(1)' }
            ], { duration: 160, easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)' });
        }
    }

    function position() {
        if (!trigger || !menu) return;
        const rect = trigger.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        let top = rect.bottom + 6;
        if (top + menuRect.height > window.innerHeight - 8) top = Math.max(8, rect.top - menuRect.height - 6);
        let left = rect.left;
        if (left + menuRect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - menuRect.width - 8);
        menuStyle = `left:${left}px;top:${top}px;width:${Math.max(rect.width, 196)}px;`;
    }

    function scrollSelected() {
        for (const [list, value] of [[hourList, selectedHour], [minuteList, selectedMinute]]) {
            const node = list?.querySelector(`[data-value="${value}"]`);
            if (node) node.scrollIntoView({ block: 'center' });
        }
    }

    function choose(hour, minute) {
        value = `${hour}:${minute}`;
        onchange(value);
        open = false;
    }

    function outside(event) {
        if (!open) return;
        if (trigger?.contains(event.target) || menu?.contains(event.target)) return;
        open = false;
    }

    function key(event) {
        if (event.key === 'Escape' && open) {
            event.preventDefault();
            open = false;
        }
    }
</script>

<svelte:window on:click={outside} on:keydown={key} on:resize={() => (open = false)} on:scroll={() => (open = false)} />

<button bind:this={trigger} type="button" disabled={disabled} on:click={toggle}
    class="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 flex items-center justify-between gap-2 disabled:opacity-50">
    <span class="tabular-nums">{value || '--:--'}</span>
    <i class="ph ph-clock text-slate-400"></i>
</button>

{#if open}
    <div use:portal bind:this={menu} style={menuStyle}
        class="fixed z-[230] rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-2xl overflow-hidden">
        <div class="grid grid-cols-2 text-[10px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100 dark:border-slate-700">
            <div class="px-3 py-2">{$_('overtime.field_hours')}</div>
            <div class="px-3 py-2">{$_('overtime.field_minutes')}</div>
        </div>
        <div class="grid grid-cols-2 h-56">
            <div bind:this={hourList} class="overflow-y-auto p-1 border-r border-slate-100 dark:border-slate-700">
                {#each hours as hour}
                    <button type="button" data-value={hour}
                        on:click={() => choose(hour, selectedMinute || '00')}
                        class={`w-full text-center px-2 py-1.5 rounded-md text-xs tabular-nums ${hour === selectedHour ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200 font-bold' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                        {hour}
                    </button>
                {/each}
            </div>
            <div bind:this={minuteList} class="overflow-y-auto p-1">
                {#each minutes as minute}
                    <button type="button" data-value={minute}
                        on:click={() => choose(selectedHour || '00', minute)}
                        class={`w-full text-center px-2 py-1.5 rounded-md text-xs tabular-nums ${minute === selectedMinute ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200 font-bold' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                        {minute}
                    </button>
                {/each}
            </div>
        </div>
    </div>
{/if}
