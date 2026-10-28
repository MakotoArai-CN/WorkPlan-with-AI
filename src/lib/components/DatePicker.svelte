<script>
    import { _ } from 'svelte-i18n';
    import { tick } from 'svelte';
    import { formatLocalDate } from '../utils/datetime.js';

    export let value = '';
    export let accent = 'orange';
    export let onchange = () => {};

    let open = false;
    let container;
    let viewYear = new Date().getFullYear();
    let viewMonth = new Date().getMonth() + 1;

    const accentClasses = {
        orange: {
            button: 'hover:border-orange-300',
            selected: 'bg-orange-500 text-white',
            today: 'ring-1 ring-orange-300',
            nav: 'hover:text-orange-600'
        },
        rose: {
            button: 'hover:border-rose-300',
            selected: 'bg-rose-500 text-white',
            today: 'ring-1 ring-rose-300',
            nav: 'hover:text-rose-600'
        }
    };

    $: accentStyle = accentClasses[accent] || accentClasses.orange;
    $: if (value) {
        const parts = value.split('-').map(Number);
        if (parts.length === 3 && parts.every(Number.isFinite)) {
            viewYear = parts[0];
            viewMonth = parts[1];
        }
    }
    $: weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];
    $: firstWeekday = (new Date(viewYear, viewMonth - 1, 1).getDay() + 6) % 7;
    $: daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    $: cells = [
        ...Array.from({ length: firstWeekday }, () => null),
        ...Array.from({ length: daysInMonth }, (_, index) => index + 1)
    ];

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function dateValue(day) {
        return `${viewYear}-${pad(viewMonth)}-${pad(day)}`;
    }

    function select(day) {
        value = dateValue(day);
        open = false;
        onchange(value);
    }

    function shiftMonth(delta) {
        const next = new Date(viewYear, viewMonth - 1 + delta, 1);
        viewYear = next.getFullYear();
        viewMonth = next.getMonth() + 1;
    }

    function goToday() {
        const today = new Date();
        viewYear = today.getFullYear();
        viewMonth = today.getMonth() + 1;
        select(today.getDate());
    }

    async function toggle() {
        open = !open;
        if (open) await tick();
    }

    function handleWindowClick(event) {
        if (!open || container?.contains(event.target)) return;
        open = false;
    }
</script>

<svelte:window on:click={handleWindowClick} />

<div bind:this={container} class="relative">
    <button type="button" on:click={toggle}
        class="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-left text-slate-700 dark:text-slate-200 flex items-center justify-between gap-2 {accentStyle.button}">
        <span class={value ? '' : 'text-slate-400'}>{value || $_('date_picker.placeholder')}</span>
        <i class="ph ph-calendar-blank text-slate-400"></i>
    </button>

    {#if open}
        <div class="absolute z-50 mt-1 left-0 w-72 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-2xl p-3">
            <div class="flex items-center justify-between mb-2">
                <button type="button" aria-label="previous month" on:click={() => shiftMonth(-1)}
                    class="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center {accentStyle.nav}">
                    <i class="ph-bold ph-caret-left"></i>
                </button>
                <div class="text-xs font-bold text-slate-700 dark:text-slate-200">
                    {viewYear} / {viewMonth}
                </div>
                <button type="button" aria-label="next month" on:click={() => shiftMonth(1)}
                    class="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center {accentStyle.nav}">
                    <i class="ph-bold ph-caret-right"></i>
                </button>
            </div>
            <div class="grid grid-cols-7 gap-1 mb-1">
                {#each weekdayLabels as label}
                    <div class="h-9 flex items-center justify-center text-[10px] font-bold text-slate-400">{label}</div>
                {/each}
            </div>
            <div class="grid grid-cols-7 gap-1">
                {#each cells as day}
                    {#if day}
                        <button type="button" on:click={() => select(day)}
                            class={`h-9 rounded-lg text-xs font-bold flex items-center justify-center transition-colors
                                ${dateValue(day) === value ? accentStyle.selected : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}
                                ${dateValue(day) === formatLocalDate(new Date()) && dateValue(day) !== value ? accentStyle.today : ''}`}>
                            {day}
                        </button>
                    {:else}
                        <div class="h-9"></div>
                    {/if}
                {/each}
            </div>
            <div class="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
                <button type="button" on:click={goToday}
                    class="text-[10px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
                    {$_('date_picker.today')}
                </button>
                <button type="button" on:click={() => (open = false)}
                    class="text-[10px] font-bold text-slate-400 hover:text-slate-600">
                    {$_('common.cancel')}
                </button>
            </div>
        </div>
    {/if}
</div>
