<script>
    import { _ } from 'svelte-i18n';
    import DatePicker from './DatePicker.svelte';
    import AnimatedModal from './AnimatedModal.svelte';
    import { getPayCycle, parseDateValue, setActualSalary } from '../utils/payroll.js';
    import {
        BANK_PRESETS,
        detectPreset,
        getSalaryGrowth,
        isSalaryDescription,
        mapTransactions,
        parseCsv,
        suggestMapping
    } from '../utils/bank-import.js';
    import { formatLocalDate } from '../utils/datetime.js';

    export let show = false;
    export let config = {};
    export let onUpdateConfig = () => {};
    export let onClose = () => {};

    let tab = 'history';
    let backfillDate = formatLocalDate(new Date());
    let backfillAmount = '';
    let backfillNote = '';
    let message = '';
    let error = '';

    let fileName = '';
    let encoding = 'utf-8';
    let headers = [];
    let rawRows = [];
    let presetId = 'generic';
    let mapping = { date: -1, amount: -1, income: -1, expense: -1, description: -1 };
    let transactions = [];
    let salaryOnly = true;
    let selected = {};
    let importMessage = '';

    $: actuals = (Array.isArray(config.salaryActuals) ? config.salaryActuals : [])
        .slice()
        .sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)));
    $: growth = getSalaryGrowth(actuals);
    $: previewRows = transactions.filter(item => !salaryOnly || isSalaryDescription(item.description));
    $: selectedCount = previewRows.filter(item => selected[item.key]).length;
    $: allSelected = previewRows.length > 0 && selectedCount === previewRows.length;

    function money(value) {
        return new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: config.currency || 'CNY',
            maximumFractionDigits: 2
        }).format(Number(value) || 0);
    }

    function close() {
        show = false;
        onClose();
    }

    function addBackfill() {
        error = '';
        message = '';
        const date = parseDateValue(backfillDate);
        const amount = Number(backfillAmount);
        if (!date) {
            error = $_('salary_history.invalid_date');
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            error = $_('salary_history.invalid_amount');
            return;
        }
        const cycle = getPayCycle(date, config);
        const next = setActualSalary(config, cycle, amount, backfillNote.trim(), 'manual');
        onUpdateConfig({ salaryActuals: next });
        message = $_('salary_history.backfill_saved');
        backfillAmount = '';
        backfillNote = '';
    }

    function transactionKey(item, index) {
        return `${index}|${item.date}|${item.amount}|${item.description}`;
    }

    function rebuildTransactions() {
        transactions = mapTransactions(rawRows, headers, mapping)
            .map((item, index) => ({ ...item, key: transactionKey(item, index) }));
        selected = {};
        for (const item of transactions) {
            if (isSalaryDescription(item.description) && item.amount > 0) selected[item.key] = true;
        }
        importMessage = '';
    }

    function applyPreset() {
        mapping = suggestMapping(headers, presetId);
        rebuildTransactions();
    }

    async function handleFile(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        fileName = file.name;
        error = '';
        importMessage = '';
        try {
            const buffer = await file.arrayBuffer();
            let parsed;
            if (/\.xlsx$/i.test(file.name)) {
                const ExcelJS = (await import('exceljs')).default;
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(buffer);
                const sheet = workbook.worksheets[0];
                const table = [];
                sheet.eachRow(row => {
                    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
                    table.push(values.map(value => value instanceof Date
                        ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
                        : (value ?? '')));
                });
                const csv = table
                    .map(cells => cells.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
                    .join('\n');
                parsed = parseCsv(csv);
            } else {
                const text = new TextDecoder(encoding).decode(buffer);
                parsed = parseCsv(text);
            }
            headers = parsed.headers;
            rawRows = parsed.rows;
            presetId = detectPreset(headers);
            mapping = suggestMapping(headers, presetId);
            rebuildTransactions();
        } catch (e) {
            error = e.message || String(e);
        }
    }

    function toggleAll() {
        if (allSelected) {
            selected = {};
            return;
        }
        selected = {};
        for (const item of previewRows) selected[item.key] = true;
    }

    function importSelected() {
        error = '';
        importMessage = '';
        const rows = previewRows.filter(item => selected[item.key] && item.amount > 0);
        if (!rows.length) {
            error = $_('salary_history.no_selected');
            return;
        }
        let next = Array.isArray(config.salaryActuals) ? [...config.salaryActuals] : [];
        let imported = 0;
        for (const item of rows) {
            const date = parseDateValue(item.date);
            if (!date) continue;
            const cycle = getPayCycle(date, config);
            next = setActualSalary({ ...config, salaryActuals: next }, cycle, item.amount, item.description, 'bank');
            imported += 1;
        }
        onUpdateConfig({ salaryActuals: next });
        importMessage = $_('salary_history.imported', { values: { count: imported } });
        selected = {};
    }
</script>

<AnimatedModal bind:show {onClose} zIndex={75} panelClass="max-w-3xl">

            <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-start justify-between gap-3">
                <div>
                    <h3 class="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <i class="ph-fill ph-chart-line-up text-orange-500"></i> {$_('salary_history.title')}
                    </h3>
                    <div class="text-[10px] text-slate-500 mt-0.5">{$_('salary_history.desc')}</div>
                </div>
                <button on:click={close} aria-label={$_('common.cancel')}><i class="ph ph-x text-xl"></i></button>
            </div>

            <div class="px-5 pt-3 flex gap-1 bg-slate-50/60 dark:bg-slate-900/20">
                <button on:click={() => (tab = 'history')}
                    class="px-3 py-2 text-xs font-bold rounded-t-lg {tab === 'history' ? 'bg-white dark:bg-slate-800 text-orange-600' : 'text-slate-500'}">
                    {$_('salary_history.history_tab')}
                </button>
                <button on:click={() => (tab = 'bank')}
                    class="px-3 py-2 text-xs font-bold rounded-t-lg {tab === 'bank' ? 'bg-white dark:bg-slate-800 text-orange-600' : 'text-slate-500'}">
                    {$_('salary_history.bank_tab')}
                </button>
            </div>

            <div class="flex-1 overflow-y-auto p-5 space-y-4">
                {#if tab === 'history'}
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div class="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3">
                            <div class="text-[10px] text-slate-400">{$_('salary_history.latest')}</div>
                            <div class="text-lg font-black text-slate-800 dark:text-slate-100 mt-1">{growth.latest ? money(growth.latest.amount) : '—'}</div>
                            <div class="text-[10px] text-slate-400 mt-0.5">{growth.latest?.periodEnd || ''}</div>
                        </div>
                        <div class="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3">
                            <div class="text-[10px] text-slate-400">{$_('salary_history.growth')}</div>
                            <div class={`text-lg font-black mt-1 ${growth.difference >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                {growth.difference >= 0 ? '+' : ''}{money(growth.difference)}
                            </div>
                            <div class="text-[10px] text-slate-400 mt-0.5">
                                {growth.first ? `${growth.first.periodEnd} → ${growth.latest.periodEnd}` : '—'}
                            </div>
                        </div>
                        <div class="rounded-xl bg-orange-500 p-3 text-white">
                            <div class="text-[10px] text-orange-100">{$_('salary_history.growth_percent')}</div>
                            <div class="text-lg font-black mt-1">{growth.percent >= 0 ? '+' : ''}{growth.percent}%</div>
                            <div class="text-[10px] text-orange-100 mt-0.5">{$_('salary_history.since_first')}</div>
                        </div>
                    </div>

                    <div class="rounded-xl border border-slate-100 dark:border-slate-700 p-3.5">
                        <div class="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">{$_('salary_history.backfill')}</div>
                        <div class="grid grid-cols-1 md:grid-cols-[1fr_1fr_1.5fr_auto] gap-2 items-end">
                            <label class="flex flex-col gap-1">
                                <span class="text-[10px] font-bold text-slate-500">{$_('salary_history.payment_date')}</span>
                                <DatePicker bind:value={backfillDate} />
                            </label>
                            <label class="flex flex-col gap-1">
                                <span class="text-[10px] font-bold text-slate-500">{$_('salary_history.amount')}</span>
                                <input type="number" min="0" step="100" bind:value={backfillAmount}
                                    class="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm" />
                            </label>
                            <label class="flex flex-col gap-1">
                                <span class="text-[10px] font-bold text-slate-500">{$_('salary_history.note')}</span>
                                <input bind:value={backfillNote}
                                    class="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm" />
                            </label>
                            <button on:click={addBackfill}
                                class="h-9 px-4 rounded-lg bg-slate-800 text-white text-xs font-bold dark:bg-slate-600">
                                {$_('salary_history.add')}
                            </button>
                        </div>
                        {#if error}<div class="text-[11px] text-red-500 mt-2">{error}</div>{/if}
                        {#if message}<div class="text-[11px] text-emerald-600 mt-2">{message}</div>{/if}
                    </div>

                    <div class="rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                        <div class="px-4 py-3 border-b border-slate-100 dark:border-slate-700 text-sm font-bold text-slate-700 dark:text-slate-200">
                            {$_('salary_history.records')}
                        </div>
                        {#if actuals.length}
                            <div class="divide-y divide-slate-50 dark:divide-slate-700/60">
                                {#each actuals as item}
                                    {@const change = growth.rows.find(row => row.id === item.id)}
                                    <div class="px-4 py-3 flex items-center gap-3">
                                        <div class="flex-1 min-w-0">
                                            <div class="text-xs font-bold text-slate-700 dark:text-slate-200">
                                                {item.periodStart || ''} → {item.periodEnd || ''}
                                            </div>
                                            <div class="text-[10px] text-slate-400 mt-0.5">
                                                {item.source === 'bank' ? $_('salary_history.source_bank') : $_('salary_history.source_manual')}
                                                {#if item.note}<span class="mx-1">·</span>{item.note}{/if}
                                            </div>
                                        </div>
                                        <div class="text-right shrink-0">
                                            <div class="text-sm font-black text-slate-700 dark:text-slate-100">{money(item.amount)}</div>
                                            {#if change?.change !== null && change?.change !== undefined}
                                                <div class={`text-[10px] font-bold ${change.change >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                                    {change.change >= 0 ? '+' : ''}{money(change.change)}
                                                    {#if change.changePercent !== null}
                                                        <span class="ml-1">({change.changePercent >= 0 ? '+' : ''}{change.changePercent}%)</span>
                                                    {/if}
                                                </div>
                                            {/if}
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {:else}
                            <div class="py-10 text-center text-slate-400 text-xs">{$_('salary_history.empty')}</div>
                        {/if}
                    </div>
                {:else}
                    <div class="rounded-xl border border-slate-100 dark:border-slate-700 p-3.5 space-y-3">
                        <div>
                            <div class="text-sm font-bold text-slate-700 dark:text-slate-200">{$_('salary_history.bank_title')}</div>
                            <div class="text-[10px] text-slate-500 mt-0.5">{$_('salary_history.bank_desc')}</div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <label class="flex flex-col gap-1 md:col-span-2">
                                <span class="text-[10px] font-bold text-slate-500">{$_('salary_history.bank_file')}</span>
                                <input type="file" accept=".csv,.txt,.xlsx" on:change={handleFile}
                                    class="block w-full text-xs text-slate-500 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-orange-50 file:text-orange-700 file:text-xs file:font-bold" />
                            </label>
                            <label class="flex flex-col gap-1">
                                <span class="text-[10px] font-bold text-slate-500">{$_('salary_history.encoding')}</span>
                                <select bind:value={encoding}
                                    class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm">
                                    <option value="utf-8">UTF-8</option>
                                    <option value="gb18030">GBK / GB18030</option>
                                </select>
                            </label>
                        </div>

                        {#if fileName}
                            <div class="text-[10px] text-slate-500 break-all">{fileName} · {headers.length} {$_('salary_history.columns')}</div>
                            <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                                <label class="flex flex-col gap-1">
                                    <span class="text-[10px] font-bold text-slate-500">{$_('salary_history.bank_preset')}</span>
                                    <select bind:value={presetId} on:change={applyPreset}
                                        class="border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-900 text-xs">
                                        {#each BANK_PRESETS as preset}
                                            <option value={preset.id}>{preset.name}</option>
                                        {/each}
                                    </select>
                                </label>
                                {#each [
                                    ['date', 'salary_history.column_date'],
                                    ['amount', 'salary_history.column_amount'],
                                    ['income', 'salary_history.column_income'],
                                    ['expense', 'salary_history.column_expense'],
                                    ['description', 'salary_history.column_description']
                                ] as [field, labelKey]}
                                    <label class="flex flex-col gap-1">
                                        <span class="text-[10px] font-bold text-slate-500">{$_(labelKey)}</span>
                                        <select bind:value={mapping[field]} on:change={rebuildTransactions}
                                            class="border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-900 text-xs">
                                            <option value={-1}>—</option>
                                            {#each headers as header, index}
                                                <option value={index}>{header}</option>
                                            {/each}
                                        </select>
                                    </label>
                                {/each}
                            </div>

                            <label class="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                                <input type="checkbox" bind:checked={salaryOnly} class="rounded border-slate-300 text-orange-500 focus:ring-orange-400" />
                                {$_('salary_history.salary_only')}
                            </label>

                            <div class="border border-slate-100 dark:border-slate-700 rounded-lg overflow-hidden">
                                <div class="px-3 py-2 bg-slate-50 dark:bg-slate-900/40 flex items-center justify-between">
                                    <div class="text-[10px] font-bold text-slate-500">
                                        {$_('salary_history.preview')}: {previewRows.length}
                                    </div>
                                    <button on:click={toggleAll} class="text-[10px] font-bold text-orange-600">
                                        {allSelected ? $_('salary_history.clear_all') : $_('salary_history.select_all')}
                                    </button>
                                </div>
                                <div class="max-h-56 overflow-y-auto divide-y divide-slate-50 dark:divide-slate-700/60">
                                    {#each previewRows.slice(0, 80) as item}
                                        <label class="px-3 py-2 flex items-center gap-2 text-[11px]">
                                            <input type="checkbox" bind:checked={selected[item.key]}
                                                class="rounded border-slate-300 text-orange-500 focus:ring-orange-400" />
                                            <span class="w-20 shrink-0 text-slate-500">{item.date}</span>
                                            <span class={`w-24 shrink-0 text-right font-bold ${item.amount >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                                {money(item.amount)}
                                            </span>
                                            <span class="flex-1 min-w-0 truncate text-slate-600 dark:text-slate-300">{item.description}</span>
                                        </label>
                                    {/each}
                                    {#if previewRows.length === 0}
                                        <div class="py-8 text-center text-xs text-slate-400">{$_('salary_history.no_salary_rows')}</div>
                                    {/if}
                                </div>
                            </div>

                            <div class="flex items-center justify-between gap-2">
                                <div class="text-[10px] text-slate-500">
                                    {$_('salary_history.selected_count', { values: { count: selectedCount } })}
                                </div>
                                <button on:click={importSelected} disabled={selectedCount === 0}
                                    class="px-4 py-2 rounded-lg bg-orange-500 disabled:opacity-50 text-white text-xs font-bold">
                                    {$_('salary_history.import_selected')}
                                </button>
                            </div>
                        {/if}

                        {#if error}<div class="text-[11px] text-red-500">{error}</div>{/if}
                        {#if importMessage}<div class="text-[11px] text-emerald-600">{importMessage}</div>{/if}
                    </div>
                {/if}
            </div>
</AnimatedModal>
