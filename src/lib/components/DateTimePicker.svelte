<script>
    import DatePicker from './DatePicker.svelte';
    import TimeSelect from './TimeSelect.svelte';

    export let value = '';
    export let onchange = () => {};
    export let accent = 'orange';

    $: datePart = value ? value.slice(0, 10) : '';
    $: timePart = value && value.includes('T') ? value.slice(11, 16) : '09:00';

    function emit(date = datePart, time = timePart) {
        if (!date) {
            onchange('');
            return;
        }
        onchange(`${date}T${time || '09:00'}`);
    }
</script>

<div class="grid grid-cols-[minmax(0,1fr)_108px] gap-2">
    <DatePicker {accent} value={datePart} onchange={(date) => emit(date, timePart)} buttonClass="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-left text-slate-700 dark:text-slate-200 flex items-center justify-between gap-2" />
    <TimeSelect value={timePart} onchange={(time) => emit(datePart, time)} />
</div>
