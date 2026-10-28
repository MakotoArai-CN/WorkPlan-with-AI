<script>
    import { taskStore } from '../stores/tasks.js';
    import { settingsStore } from '../stores/settings.js';
    import { _ } from 'svelte-i18n';
    import Overtime from './Overtime.svelte';
    import Leave from './Leave.svelte';
    import WorklogExportModal from './WorklogExportModal.svelte';
    import SegmentedControl from './SegmentedControl.svelte';
    import CareerAnalysis from './CareerAnalysis.svelte';
    import { getLeaveYearSummary, getMonthSummary, getYearSummary } from '../utils/overtime.js';
    import { tick } from 'svelte';
    import { fly } from 'svelte/transition';
    import { linear } from 'svelte/easing';

    let activeTab = 'overtime';
    let showExport = false;
    let showCareer = false;
    let overtimeRef;
    let leaveRef;

    $: config = { ...($settingsStore.overtimeConfig || {}) };
    $: year = new Date().getFullYear();
    $: records = activeTab === 'leave'
        ? ($taskStore.leaveRecords || [])
        : ($taskStore.overtimeRecords || []);
    $: overtimeRecords = $taskStore.overtimeRecords || [];
    $: leaveRecords = $taskStore.leaveRecords || [];
    $: overtimeYear = getYearSummary(overtimeRecords, year, config);
    $: overtimeMonth = getMonthSummary(overtimeRecords, year, new Date().getMonth() + 1, config);
    $: leaveYear = getLeaveYearSummary(leaveRecords, year, config);
    $: tasks = $taskStore.tasks || [];
    $: careerStats = {
        overtimeHours: overtimeYear.hours,
        overtimePay: overtimeYear.pay,
        lastMonthHours: overtimeMonth.hours,
        leaveDays: leaveYear.days,
        annualLeaveDays: leaveYear.byType?.annual || 0,
        taskTotal: tasks.length,
        taskDone: tasks.filter(task => task.status === 'done' || task.completedDate).length,
        scheduledCount: ($taskStore.scheduledTasks || []).length
    };

    async function addFromActiveTab() {
        await tick();
        const target = activeTab === 'leave' ? leaveRef : overtimeRef;
        target?.openCreate();
    }

    function slideDuration() {
        if (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-animations')) return 0;
        if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return 0;
        return 280;
    }

    $: tabOptions = [
        { value: 'overtime', label: $_('worklog.kind_overtime'), icon: 'ph-clock-afternoon', activeClass: 'font-bold text-orange-600' },
        { value: 'leave', label: $_('worklog.kind_leave'), icon: 'ph-calendar-check', activeClass: 'font-bold text-rose-600' }
    ];
</script>

<div class="flex flex-col h-screen md:h-full overflow-hidden bg-slate-50">
    <header class="bg-white/90 backdrop-blur px-4 md:px-6 py-2 border-b border-slate-200 shrink-0 z-10">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-2">
            <div class="flex items-center gap-3">
                <div>
                    <h1 class="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <i class="ph-fill ph-clipboard-text text-orange-500"></i> {$_('worklog.title')}
                    </h1>
                    <div class="text-[10px] md:text-xs text-slate-500">{$_('worklog.subtitle')}</div>
                </div>
                <SegmentedControl bind:value={activeTab} options={tabOptions} className="ml-1" />
            </div>
            <div class="flex items-center gap-2 self-start md:self-auto">
                <button on:click={() => showCareer = true}
                    class="h-9 px-4 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-300 rounded-lg text-sm font-bold flex items-center justify-center gap-2">
                    <i class="ph ph-sparkle"></i>
                    <span class="hidden sm:inline">{$_('career.entry')}</span>
                </button>
                <button on:click={addFromActiveTab}
                    class="h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2">
                    <i class="ph-bold ph-plus"></i> {$_('common.new')}
                </button>
                <button on:click={() => showExport = true}
                    class="h-9 px-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 rounded-lg text-sm font-bold flex items-center justify-center gap-2">
                    <i class="ph ph-download-simple"></i>
                    {$_('worklog.export')}
                </button>
            </div>
        </div>
    </header>

    <div class="flex-1 min-h-0 overflow-hidden">
        {#key activeTab}
            <div class="h-full"
                in:fly={{ x: activeTab === 'leave' ? 72 : -72, duration: slideDuration(), easing: linear }}
                out:fly={{ x: activeTab === 'leave' ? -72 : 72, duration: slideDuration(), easing: linear }}>
                {#if activeTab === 'overtime'}
                    <Overtime bind:this={overtimeRef} embedded />
                {:else}
                    <Leave bind:this={leaveRef} embedded />
                {/if}
            </div>
        {/key}
    </div>
</div>



<CareerAnalysis
    bind:show={showCareer}
    {year}
    stats={careerStats}
    defaultSalary={config.monthlySalary || 0}
    onClose={() => showCareer = false}
/>

<WorklogExportModal
    bind:show={showExport}
    kind={activeTab}
    {records}
    {year}
    {config}
    onClose={() => showExport = false}
/>
