<script>
    import { taskStore, viewDate, today, activeTasks, completedTasks, futurePreviews, activeTask } from '../stores/tasks.js';
    import { showAiPanel } from '../stores/ai.js';
    import TaskCard from './TaskCard.svelte';

    export let openModal;

    let isAllExpanded = false;

    $: dateInfo = (() => {
        const date = new Date($viewDate);
        return {
            date: date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }),
            week: date.toLocaleDateString('zh-CN', { weekday: 'long' })
        };
    })();

    function changeDate(offset) {
        const d = new Date($viewDate);
        d.setDate(d.getDate() + offset);
        viewDate.set(d.toISOString().split('T')[0]);
        activeTask.set(null);
    }

    function resetToToday() {
        viewDate.set($today);
        taskStore.checkScheduled();
    }

    function toggleAll() {
        isAllExpanded = !isAllExpanded;
        taskStore.update(s => ({
            ...s,
            tasks: s.tasks.map(t => ({ ...t, expanded: isAllExpanded }))
        }));
    }

    function toggleAiPanel() {
        showAiPanel.update(v => !v);
        if ($showAiPanel) {
            activeTask.set(null);
        }
    }

    function selectTask(task) {
        showAiPanel.set(false);
        activeTask.set(task);
    }

    function handleDateInput(e) {
        viewDate.set(e.target.value);
    }
</script>

<header class="h-16 bg-white/90 backdrop-blur px-2 md:px-6 flex justify-between items-center z-10 sticky top-0 border-b border-slate-200 shrink-0 gap-2">
    <div class="shrink-0">
        <h2 class="text-lg font-bold text-blue-800">今日看板</h2>
        <div class="text-[10px] text-slate-400 hidden md:block">管理您的每日待办</div>
    </div>

    <div class="flex items-center justify-center gap-1 md:gap-3 flex-1 min-w-0 overflow-hidden">
        <button on:click={() => changeDate(-1)}
            class="w-8 h-8 flex shrink-0 items-center justify-center rounded-lg hover:bg-slate-200 text-slate-600">
            <i class="ph-bold ph-caret-left"></i>
        </button>
        <div class="flex flex-col items-center">
            <div class="relative group w-full text-center">
                <input type="date" value={$viewDate} on:change={handleDateInput}
                    class="absolute inset-0 opacity-0 cursor-pointer z-10 w-full">
                <h2 class="text-xs md:text-lg font-bold text-slate-800 flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap">
                    {dateInfo.date} <i class="ph-fill ph-caret-down text-xs text-slate-400"></i>
                </h2>
            </div>
            <div class="text-[10px] md:text-xs text-slate-500 font-medium whitespace-nowrap">{dateInfo.week}</div>
        </div>
        <button on:click={() => changeDate(1)}
            class="w-8 h-8 flex shrink-0 items-center justify-center rounded-lg hover:bg-slate-200 text-slate-600">
            <i class="ph-bold ph-caret-right"></i>
        </button>
        {#if $viewDate !== $today}
            <button on:click={resetToToday}
                class="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-md font-bold whitespace-nowrap shrink-0">
                今
            </button>
        {/if}
    </div>

    <div class="flex items-center gap-1 shrink-0">
        <button on:click={toggleAll}
            class="h-8 w-8 md:h-9 md:w-auto md:px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-sm font-medium flex items-center justify-center gap-2 shrink-0">
            <i class={isAllExpanded ? 'ph ph-arrows-in-line-vertical' : 'ph ph-arrows-out-line-vertical'}></i>
            <span class="hidden md:inline">{isAllExpanded ? '收起' : '展开'}</span>
        </button>
        <button on:click={toggleAiPanel}
            class="h-9 px-3 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-sm font-bold flex items-center gap-1 border border-rose-100 transition-colors">
            <i class="ph-fill ph-sparkle"></i> <span class="hidden md:inline">AI</span>
        </button>
        <button on:click={() => openModal()}
            class="h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-md shadow-blue-200 flex items-center gap-2">
            <i class="ph ph-plus-bold"></i>新建
        </button>
    </div>
</header>

<div class="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth pb-32">
    {#if $futurePreviews.length > 0}
        <div class="mb-6">
            <h3 class="text-xs font-bold text-teal-600 uppercase tracking-wider mb-3 flex items-center gap-2">
                <i class="ph-fill ph-calendar-plus"></i> 待自动生成
                <div class="h-px bg-teal-100 flex-1"></div>
            </h3>
            {#each $futurePreviews as task (task.id)}
                <div on:click={() => selectTask(task)}
                    class="task-card future-card bg-slate-50 rounded-xl shadow-sm border border-slate-200 p-3 flex items-center gap-3 cursor-pointer border-dashed">
                    <div class="w-6 flex justify-center text-slate-300">
                        <i class="ph-bold ph-clock-countdown text-lg"></i>
                    </div>
                    <div class="font-bold text-slate-600 text-sm">{task.title}</div>
                </div>
            {/each}
        </div>
    {/if}

    {#if $activeTasks.length === 0 && $completedTasks.length === 0 && $futurePreviews.length === 0}
        <div class="flex flex-col items-center justify-center h-64 text-slate-400">
            <i class="ph ph-coffee text-4xl mb-2"></i>
            <p class="text-sm">今日无任务</p>
        </div>
    {/if}

    {#each $activeTasks as task (task.id)}
        <TaskCard {task} {openModal} onSelect={() => selectTask(task)} />
    {/each}

    {#if $completedTasks.length > 0}
        <div class="pt-8 pb-4">
            <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <i class="ph-bold ph-archive"></i> 已完成
                <div class="h-px bg-slate-200 flex-1"></div>
            </h3>
            <div class="space-y-2">
                {#each $completedTasks as task (task.id)}
                    <div on:click={() => selectTask(task)}
                        class="task-card bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center gap-3 cursor-pointer hover:bg-white transition-all opacity-60 grayscale"
                        class:active={$activeTask && $activeTask.id === task.id}
                        class:opacity-100={$activeTask && $activeTask.id === task.id}
                        class:grayscale-0={$activeTask && $activeTask.id === task.id}>
                        <button on:click|stopPropagation={() => {
                            taskStore.updateTask(task.id, { status: 'doing', completedDate: null });
                        }} class="text-green-600 hover:text-green-700">
                            <i class="ph-fill ph-check-circle text-xl"></i>
                        </button>
                        <div class="flex-1">
                            <div class="text-sm line-through text-slate-500 font-medium">{task.title}</div>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/if}
</div>

<style>
    .task-card {
        transition: all 0.2s ease;
        border-left-width: 4px;
        border-left-color: transparent;
    }
    .task-card.active {
        border-left-color: #2563eb;
        background-color: #eff6ff;
        border-color: #bfdbfe;
        transform: scale(1.005);
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .future-card {
        border-style: dashed;
        border-left-style: solid;
        opacity: 0.8;
    }
</style>