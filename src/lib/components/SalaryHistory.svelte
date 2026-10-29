<script>
    import { _ } from 'svelte-i18n';
    import DatePicker from './DatePicker.svelte';
    import AnimatedModal from './AnimatedModal.svelte';
    import SelectMenu from './SelectMenu.svelte';
    import { getAnnualIncome, getPayCycle, parseDateValue, setActualSalary } from '../utils/payroll.js';
    import SalarySlipModal from './SalarySlipModal.svelte';
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
    import {
        calibrateOvertimeRate,
        getHourlyRate,
        getMonthSummary,
        getMonthlyOvertimeActual,
        getOvertimeBaseSalary,
        getOvertimeCalibration,
        getStandardHourlyRate
    } from '../utils/overtime.js';
    import { parsePdfBankStatement } from '../utils/pdf-import.js';

    export let show = false;
    export let config = {};
    export let onUpdateConfig = () => {};
    export let onClose = () => {};
    export let overtimeRecords = [];

    let tab = 'history';
    let backfillDate = formatLocalDate(new Date());
    let backfillAmount = '';
    let backfillNote = '';
    let message = '';
    let error = '';
    let showSlip = false;
    let slipCycle = null;
    let slipActual = null;

    let fileName = '';
    let pdfPassword = '';
    let parsingPdf = false;
    let encoding = 'utf-8';
    let headers = [];
    let rawRows = [];
    let presetId = 'generic';
    let mapping = { date: -1, amount: -1, income: -1, expense: -1, description: -1 };
    $: encodingOptions = [
        { value: 'utf-8', label: 'UTF-8' },
        { value: 'gb18030', label: 'GBK / GB18030' }
    ];
    $: presetOptions = BANK_PRESETS.map(preset => ({ value: preset.id, label: preset.name }));
    $: headerOptions = [{ value: -1, label: '—' }, ...headers.map((header, index) => ({ value: index, label: header }))];
    let transactions = [];
    let salaryOnly = true;
    let selected = {};
    let importMessage = '';
    let selectedYear = String(new Date().getFullYear());
    let actualMonth = (() => {
        const overrides = Array.isArray(config.overtimeMonthlyActuals) ? config.overtimeMonthlyActuals : [];
        const latest = overrides.slice().sort((a, b) => String(a.month).localeCompare(String(b.month))).at(-1);
        return latest?.month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    })();
    let monthActualInput = '';
    let loadedActualMonth = '';

    $: actuals = (Array.isArray(config.salaryActuals) ? config.salaryActuals : [])
        .slice()
        .sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)));
    $: availableYears = [...new Set(actuals.map(item => String(item.paydayDate || item.periodEnd || '').slice(0, 4)).filter(year => /^\d{4}$/.test(year)))]
        .sort((a, b) => b.localeCompare(a));
    $: if (availableYears.length && !availableYears.includes(selectedYear)) {
        selectedYear = availableYears.includes(String(new Date().getFullYear()))
            ? String(new Date().getFullYear())
            : availableYears[0];
    }
    $: yearOptions = availableYears.map(year => ({ value: year, label: year }));
    $: yearActuals = actuals.filter(item => String(item.paydayDate || item.periodEnd || '').startsWith(selectedYear));
    $: growth = getSalaryGrowth(yearActuals);
    $: annual = getAnnualIncome(config, overtimeRecords, selectedYear);
    $: previewRows = transactions.filter(item => !salaryOnly || isSalaryDescription(item.description));
    $: selectedCount = previewRows.filter(item => selected[item.key]).length;
    $: allSelected = previewRows.length > 0 && selectedCount === previewRows.length;

    $: actualYear = Number(actualMonth.slice(0, 4));
    $: actualMonthNumber = Number(actualMonth.slice(5, 7));
    $: monthSummary = getMonthSummary(overtimeRecords, actualYear, actualMonthNumber, config);
    $: monthlyOverride = getMonthlyOvertimeActual(config, actualMonth);
    $: if (actualMonth && actualMonth !== loadedActualMonth) {
        loadedActualMonth = actualMonth;
        monthActualInput = monthlyOverride ? String(monthlyOverride.amount) : '';
    }
    $: overtimeBase = getOvertimeBaseSalary(config);
    $: standardHourlyRate = getStandardHourlyRate(config);
    $: hourlyRate = getHourlyRate(config);
    $: calibration = getOvertimeCalibration(overtimeRecords, config);
    $: formulaBreakdown = (() => {
        const byType = monthSummary.payableByType || { weekday: 0, weekend: 0, holiday: 0 };
        const items = [
            { key: 'weekend', hours: byType.weekend, multiplier: config.weekendMultiplier || 2 },
            { key: 'weekday', hours: byType.weekday, multiplier: config.weekdayMultiplier || 1.5 },
            { key: 'holiday', hours: byType.holiday, multiplier: config.holidayMultiplier || 3 }
        ].filter(item => item.hours > 0).map(item => ({
            ...item,
            amount: Math.round(item.hours * item.multiplier * hourlyRate * 100) / 100
        }));
        return { items, total: Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100 };
    })();

    function saveMonthActual() {
        const raw = String(monthActualInput ?? '').trim();
        if (raw !== '' && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) return;
        const next = (config.overtimeMonthlyActuals || []).filter(item => item.month !== actualMonth);
        if (raw !== '') next.push({ month: actualMonth, amount: Math.round(Number(raw) * 100) / 100, updatedAt: new Date().toISOString() });
        const nextConfig = { ...config, overtimeMonthlyActuals: next };
        const learned = calibrateOvertimeRate(overtimeRecords, nextConfig);
        onUpdateConfig({
            overtimeMonthlyActuals: next,
            overtimeLearnedRate: learned.rate,
            overtimeCalibrationSamples: learned.samples
        });
        message = raw !== '' ? $_('salary_history.month_actual_saved') : $_('salary_history.month_actual_cleared');
    }

    function clearMonthActual() {
        monthActualInput = '';
        const next = (config.overtimeMonthlyActuals || []).filter(item => item.month !== actualMonth);
        const learned = calibrateOvertimeRate(overtimeRecords, { ...config, overtimeMonthlyActuals: next });
        onUpdateConfig({
            overtimeMonthlyActuals: next,
            overtimeLearnedRate: learned.rate,
            overtimeCalibrationSamples: learned.samples
        });
        message = $_('salary_history.month_actual_cleared');
    }

    $: trendRows = yearActuals.slice().reverse();
    $: trendValues = trendRows.map(item => Number(item.amount) || 0);
    $: trendMin = trendValues.length ? Math.min(...trendValues) : 0;
    $: trendMax = trendValues.length ? Math.max(...trendValues) : 0;
    $: trendRange = Math.max(1, trendMax - trendMin);
    $: trendPoints = trendRows.map((item, index) => {
        const x = trendRows.length <= 1 ? 300 : 20 + index * (560 / (trendRows.length - 1));
        const y = 92 - ((Number(item.amount) || 0) - trendMin) / trendRange * 70;
        return `${x},${y}`;
    }).join(' ');

    function money(value) {
        return new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: config.currency || 'CNY',
            maximumFractionDigits: 2
        }).format(Number(value) || 0);
    }

    function openSlip(cycle = null, actual = null) {
        slipCycle = cycle || getPayCycle(new Date(), config);
        slipActual = actual;
        showSlip = true;
    }

    function saveSlip(details) {
        if (!slipCycle) return;
        const next = setActualSalary(config, slipCycle, details);
        onUpdateConfig({ salaryActuals: next });
        message = $_('salary_history.backfill_saved');
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
        parsingPdf = false;
        try {
            const buffer = await file.arrayBuffer();
            let parsed;
            if (/\.pdf$/i.test(file.name)) {
                parsingPdf = true;
                if (!pdfPassword.trim()) {
                    error = $_('salary_history.pdf_password_required');
                    parsingPdf = false;
                    return;
                }
                try {
                    parsed = await parsePdfBankStatement(file, pdfPassword);
                } catch (pdfError) {
                    console.error('PDF import failed:', pdfError);
                    error = pdfError?.message === 'PDF_PASSWORD_REQUIRED'
                        ? $_('salary_history.pdf_password_wrong')
                        : $_('salary_history.pdf_parse_failed');
                    parsingPdf = false;
                    return;
                }
                if (!parsed.rows.length) {
                    error = $_('salary_history.pdf_empty');
                    parsingPdf = false;
                    return;
                }
            } else if (/\.xlsx$/i.test(file.name)) {
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
        } finally {
            parsingPdf = false;
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
                <div class="flex items-center gap-2">
                    <button on:click={() => openSlip()}
                        class="h-8 px-3 rounded-lg bg-orange-500 text-white text-[11px] font-bold">
                        + {$_('payroll.add_slip')}
                    </button>
                    <button on:click={close} aria-label={$_('common.cancel')}><i class="ph ph-x text-xl"></i></button>
                </div>
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
                    <div>
                        <div class="flex items-center justify-between gap-2 mb-2">
                            <div class="text-sm font-bold text-slate-700 dark:text-slate-200">{$_('salary_history.annual_summary')}</div>
                            {#if availableYears.length > 1}
                                <select bind:value={selectedYear}
                                    class="h-8 shrink-0 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                                    {#each availableYears as year}
                                        <option value={year}>{year}</option>
                                    {/each}
                                </select>
                            {:else}
                                <div class="text-xs font-bold text-slate-400">{annual.year}</div>
                            {/if}
                        </div>
                        <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
                            <div class="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 p-3">
                                <div class="text-[10px] text-emerald-700 dark:text-emerald-300">{$_('payroll.annual_net')}</div>
                                <div class="text-base font-black text-emerald-700 dark:text-emerald-300 mt-1">{money(annual.totalNet)}</div>
                                <div class="text-[9px] text-emerald-600/70 mt-0.5">{$_('payroll.months_recorded')}: {annual.monthsRecorded}</div>
                            </div>
                            <div class="rounded-xl bg-orange-50 dark:bg-orange-900/20 p-3">
                                <div class="text-[10px] text-orange-700 dark:text-orange-300">{$_('payroll.annual_overtime')}</div>
                                <div class="text-base font-black text-orange-700 dark:text-orange-300 mt-1">{money(annual.totalOvertime)}</div>
                            </div>
                            <div class="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3">
                                <div class="text-[10px] text-slate-400">{$_('payroll.monthly_average')}</div>
                                <div class="text-base font-black text-slate-800 dark:text-slate-100 mt-1">{money(annual.averageNet)}</div>
                            </div>
                            <div class="rounded-xl bg-sky-50 dark:bg-sky-900/20 p-3">
                                <div class="text-[10px] text-sky-700 dark:text-sky-300">
                                    {annual.socialPaidBySelf ? $_('payroll.self_social') : $_('payroll.social_insurance')}
                                </div>
                                <div class="text-base font-black text-sky-700 dark:text-sky-300 mt-1">{money(annual.totalSocial)}</div>
                            </div>
                            {#if annual.socialPaidBySelf}
                                <div class="rounded-xl bg-indigo-50 dark:bg-indigo-900/20 p-3">
                                    <div class="text-[10px] text-indigo-700 dark:text-indigo-300">{$_('payroll.disposable_income')}</div>
                                    <div class="text-base font-black text-indigo-700 dark:text-indigo-300 mt-1">{money(annual.totalDisposable)}</div>
                                    <div class="text-[9px] text-indigo-600/70 mt-0.5">{$_('payroll.self_social')}: {money(annual.totalSelfSocial)}</div>
                                </div>
                            {/if}
                        </div>
                    </div>

                    <div class="rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-3.5">
                        <div class="flex flex-wrap items-center gap-2">
                            <div class="mr-auto min-w-0">
                                <div class="text-sm font-bold text-slate-700 dark:text-slate-200">{$_('salary_history.month_actual_title')}</div>
                                <div class="text-[10px] text-slate-500 mt-0.5">{$_('salary_history.month_actual_desc')}</div>
                            </div>
                            <input type="month" bind:value={actualMonth}
                                class="h-8 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 text-xs text-slate-600 dark:text-slate-300" />
                            <input type="number" min="0" step="0.01" bind:value={monthActualInput}
                                placeholder={money(monthSummary.estimatedPay)}
                                class="h-8 w-28 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 text-xs" />
                            <button type="button" on:click={saveMonthActual}
                                class="h-8 px-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-bold">
                                {$_('common.save')}
                            </button>
                            {#if monthlyOverride}
                                <button type="button" on:click={clearMonthActual}
                                    class="h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-600 text-[10px] font-bold text-slate-500">
                                    {$_('salary_history.month_actual_clear')}
                                </button>
                            {/if}
                        </div>
                        <div class="mt-2 text-[10px] text-slate-500">
                            {$_(`overtime.month_total`)}: <b class="text-orange-600">{money(monthSummary.pay)}</b>
                            <span class="mx-1">·</span>{$_('overtime.formula_total')}: <b>{money(monthSummary.estimatedPay)}</b>
                            {#if monthlyOverride}<span class="ml-1 font-bold text-emerald-600">· {$_('overtime.actual_label')}</span>{/if}
                        </div>
                        <details class="mt-2 rounded-lg bg-slate-50 dark:bg-slate-900/40 px-2.5 py-2 text-[10px]">
                            <summary class="cursor-pointer font-bold text-slate-500">{$_('overtime.formula_title')}</summary>
                            <div class="mt-1 space-y-1 text-slate-500 dark:text-slate-400">
                                <div>{$_('overtime.formula_base')}: {money(overtimeBase)} ÷ {config.workdaysPerMonth || 21.75} ÷ {config.hoursPerDay || 8} = <b>{money(standardHourlyRate)}</b> / h</div>
                                {#if calibration.learnedRate > 0}
                                    <div class="font-bold text-indigo-600 dark:text-indigo-400">
                                        {$_('overtime.formula_learned', { values: { rate: money(calibration.effectiveRate), samples: calibration.samples } })}
                                        · {$_('overtime.formula_multiplier', { values: { value: calibration.impliedMultiplier } })}
                                    </div>
                                {/if}
                                {#each formulaBreakdown.items as item}
                                    <div>
                                        {item.key === 'weekend' ? $_('overtime.type_weekend') : item.key === 'holiday' ? $_('overtime.type_holiday') : $_('overtime.type_weekday')}
                                        {item.hours}h × {item.multiplier} × {money(hourlyRate)} = <b>{money(item.amount)}</b>
                                    </div>
                                {/each}
                                <div>{$_('overtime.formula_total')}: <b>{money(formulaBreakdown.total)}</b></div>
                            </div>
                        </details>
                        {#if message}<div class="text-[10px] text-emerald-600 mt-1">{message}</div>{/if}
                    </div>

                    <div class="rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-3.5">
                        <div class="flex items-center justify-between gap-2">
                            <div>
                                <div class="text-sm font-bold text-slate-700 dark:text-slate-200">{$_('salary_history.trend_title')}</div>
                                <div class="text-[9px] text-slate-400 mt-0.5">{$_('salary_history.trend_desc')} · {selectedYear}</div>
                            </div>
                            {#if trendRows.length > 1}
                                <div class="text-right">
                                    <div class="text-[9px] text-slate-400">{$_('salary_history.highest')}</div>
                                    <div class="text-xs font-black text-emerald-600">{money(trendMax)}</div>
                                </div>
                            {/if}
                        </div>
                        {#if trendRows.length > 1}
                            <svg viewBox="0 0 600 112" class="mt-2 w-full h-28" role="img" aria-label={$_('salary_history.trend_title')}>
                                <defs>
                                    <linearGradient id="salaryTrendFill" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stop-color="#f97316" stop-opacity="0.18" />
                                        <stop offset="100%" stop-color="#f97316" stop-opacity="0" />
                                    </linearGradient>
                                </defs>
                                <polyline points={`${trendPoints} 580,104 20,104`} fill="url(#salaryTrendFill)" stroke="none" />
                                <polyline points={trendPoints} fill="none" stroke="#f97316" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                                {#each trendRows as item, index}
                                    {@const point = trendPoints.split(' ')[index].split(',')}
                                    <circle cx={point[0]} cy={point[1]} r="3.2" fill="#fff" stroke="#f97316" stroke-width="2">
                                        <title>{item.periodEnd} · {money(item.amount)}</title>
                                    </circle>
                                {/each}
                            </svg>
                            <div class="flex justify-between text-[9px] text-slate-400">
                                <span>{trendRows[0]?.periodEnd || ''}</span>
                                <span>{trendRows.at(-1)?.periodEnd || ''}</span>
                            </div>
                        {:else}
                            <div class="py-6 text-center text-[10px] text-slate-400">{$_('salary_history.trend_empty')}</div>
                        {/if}
                    </div>

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
                        {#if yearActuals.length}
                            <div class="divide-y divide-slate-50 dark:divide-slate-700/60">
                                {#each yearActuals as item}
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
                                        <div class="hidden md:flex flex-wrap gap-1 flex-1 min-w-0">
                                            {#each (item.components || []).filter(component => component.amount) as component}
                                                <span class="rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[9px] text-slate-500 dark:text-slate-300">
                                                    {component.name} {money(component.amount)}
                                                </span>
                                            {/each}
                                        </div>
                                        <button on:click={() => openSlip(getPayCycle(parseDateValue(item.periodEnd) || new Date(), config), item)}
                                            class="shrink-0 text-[10px] font-bold text-orange-600 hover:text-orange-700">
                                            {$_('payroll.salary_slip')}
                                        </button>
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
                        <div class="grid grid-cols-1 md:grid-cols-4 gap-2">
                            <label class="flex flex-col gap-1 md:col-span-2">
                                <span class="text-[10px] font-bold text-slate-500">{$_('salary_history.bank_file')}</span>
                                <input type="file" accept=".csv,.txt,.xlsx,.pdf" on:change={handleFile}
                                    class="block w-full text-xs text-slate-500 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-orange-50 file:text-orange-700 file:text-xs file:font-bold" />
                            </label>
                            <label class="flex flex-col gap-1">
                                <span class="text-[10px] font-bold text-slate-500">{$_('salary_history.pdf_password')}</span>
                                <input type="password" bind:value={pdfPassword} autocomplete="off"
                                    placeholder={$_('salary_history.pdf_password_hint')}
                                    class="h-9 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 text-xs text-slate-700 dark:text-slate-200" />
                            </label>
                            <label class="flex flex-col gap-1">
                                <span class="text-[10px] font-bold text-slate-500">{$_('salary_history.encoding')}</span>
                                <SelectMenu bind:value={encoding} options={encodingOptions} className="w-full" />
                            </label>
                        </div>

                        {#if parsingPdf}
                            <div class="flex items-center gap-2 rounded-lg bg-orange-50 dark:bg-orange-900/20 px-3 py-2 text-[11px] font-bold text-orange-700 dark:text-orange-300">
                                <i class="ph ph-spinner-gap animate-spin"></i>
                                {$_('salary_history.pdf_parsing')}
                            </div>
                        {/if}

                        {#if fileName}
                            <div class="text-[10px] text-slate-500 break-all">{fileName} · {headers.length} {$_('salary_history.columns')}</div>
                            <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                                <label class="flex flex-col gap-1">
                                    <span class="text-[10px] font-bold text-slate-500">{$_('salary_history.bank_preset')}</span>
                                    <SelectMenu bind:value={presetId} options={presetOptions} onchange={applyPreset} className="w-full" />
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
                                        <SelectMenu bind:value={mapping[field]} options={headerOptions} onchange={rebuildTransactions} className="w-full" />
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

<SalarySlipModal
    bind:show={showSlip}
    {config}
    cycle={slipCycle}
    actual={slipActual}
    onSave={saveSlip}
    onClose={() => (showSlip = false)}
/>
