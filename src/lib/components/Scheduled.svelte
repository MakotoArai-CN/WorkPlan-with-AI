<script>
    import { taskStore, activeTask } from '../stores/tasks.js';
    import { showConfirm } from '../stores/modal.js';

    export let openModal;

    function selectTask(task) {
        activeTask.set(task);
    }

    async function deleteTask(id) {
        const confirmed = await showConfirm({
            title: '删除定时任务',
            message: '确定要删除这个定时任务吗？',
            confirmText: '删除',
            cancelText: '取消',
            variant: 'danger'
        });
        if (confirmed) {
            taskStore.deleteScheduledTask(id);
            if ($activeTask?.id === id) {
                activeTask.set(null);
            }
        }
    }

    function toggleEnabled(task) {
        taskStore.updateScheduledTask(task.id, { enabled: !task.enabled });
    }

    function formatRepeatDays(days) {
        if (!days || !days.length) return ['无'];
        const map = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 0: '日' };
        return days
            .sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b))
            .map(x => '周' + map[x]);
    }
</script>

<header class="h-16 bg-white/90 backdrop-blur px-6 flex justify-between items-center z-10 sticky top-0 border-b border-slate-200 shrink-0">
    <div>
        <h2 class="text-lg font-bold text-teal-800">定时任务</h2>
        <div class="text-xs text-slate-500">自动重复生成的任务</div>
    </div>
    <button on:click={() => openModal()}
        class="h-9 px-4 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-bold shadow-md shadow-teal-200 flex items-center gap-2">
        <i class="ph ph-plus-bold"></i>新建
    </button>
</header>

<div class="flex-1 overflow-y-auto p-4 space-y-3 pb-20">
    {#if $taskStore.scheduledTasks.length === 0}
        <div class="flex flex-col items-center justify-center h-64 text-slate-400">
            <i class="ph ph-clock-countdown text-4xl mb-2 text-teal-200"></i>
            <p class="text-sm">暂无定时任务</p>
        </div>
    {/if}

    {#each $taskStore.scheduledTasks as sch (sch.id)}
        <div on:click={() => selectTask(sch)}
            class="task-card scheduled-card bg-white rounded-xl shadow-sm border border-slate-200 p-3 flex items-center gap-3 cursor-pointer"
            class:active={$activeTask && $activeTask.id === sch.id}
            class:disabled={!sch.enabled}>
            <label class="relative inline-flex items-center cursor-pointer shrink-0" on:click|stopPropagation>
                <input type="checkbox" checked={sch.enabled} on:change={() => toggleEnabled(sch)} class="sr-only peer">
                <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
            </label>
            <div class="font-bold text-slate-800 text-sm flex-1"
                class:text-slate-400={!sch.enabled}>
                {sch.title}
            </div>
            <div class="flex gap-1">
                {#each formatRepeatDays(sch.repeatDays) as d}
                    <span class="bg-teal-50 text-teal-600 text-[10px] px-1.5 py-0.5 rounded font-bold border border-teal-100">
                        {d}
                    </span>
                {/each}
            </div>
            <button on:click|stopPropagation={() => openModal(sch)}
                class="p-1.5 text-slate-300 hover:text-teal-600 rounded">
                <i class="ph ph-pencil-simple text-lg"></i>
            </button>
            <button on:click|stopPropagation={() => deleteTask(sch.id)}
                class="p-1.5 text-slate-300 hover:text-red-600 rounded">
                <i class="ph ph-trash text-lg"></i>
            </button>
        </div>
    {/each}
</div>

<style>
    .task-card {
        transition: all 0.2s ease;
        border-left-width: 4px;
        border-left-color: transparent;
    }
    .scheduled-card.active {
        border-left-color: #0d9488;
        background-color: #f0fdfa;
        border-color: #ccfbf1;
    }
    .scheduled-card.disabled {
        opacity: 0.6;
        background-color: #f8fafc;
        border-left-color: #cbd5e1;
    }
</style>