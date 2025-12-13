<script>
    import { taskStore, activeTask } from '../stores/tasks.js';
    import { showConfirm } from '../stores/modal.js';

    export let task;
    export let openModal;
    export let onSelect;

    $: isOverdue = task.deadline && task.deadline < new Date().toISOString().slice(0, 16);

    function getStatusStyle(status) {
        const styles = {
            todo: 'bg-slate-100 text-slate-500',
            doing: 'bg-blue-50 text-blue-600',
            done: 'bg-green-50 text-green-600'
        };
        return styles[status] || styles.todo;
    }

    function getPriorityStyle(priority) {
        const styles = {
            normal: 'text-blue-500',
            urgent: 'text-orange-500',
            critical: 'text-red-500'
        };
        return styles[priority] || styles.normal;
    }

    function updateStatus(e) {
        const newStatus = e.target.value;
        const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        const updates = { status: newStatus };
        if (newStatus === 'doing') {
            if (!task.startTime) updates.startTime = now;
            updates.completedDate = null;
        } else if (newStatus === 'done') {
            updates.completedDate = now;
            updates.subtasks = task.subtasks?.map(s => ({ ...s, status: 'done' }));
        } else {
            updates.startTime = null;
            updates.completedDate = null;
        }
        taskStore.updateTask(task.id, updates);
    }

    function updatePriority(e) {
        taskStore.updateTask(task.id, { priority: e.target.value });
    }

    function toggleExpanded() {
        taskStore.updateTask(task.id, { expanded: !task.expanded });
    }

    function toggleSubtask(sub) {
        const newStatus = sub.status === 'done' ? 'todo' : 'done';
        const subtasks = task.subtasks.map(s =>
            s.title === sub.title ? { ...s, status: newStatus } : s
        );
        const updates = { subtasks };
        if (newStatus === 'done' && task.status === 'todo') {
            updates.status = 'doing';
            const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
            if (!task.startTime) updates.startTime = now;
        }
        taskStore.updateTask(task.id, updates);
    }

    function addInlineSubtask(e) {
        if (e.key === 'Enter' && e.target.value.trim()) {
            const subtasks = [...(task.subtasks || []), { title: e.target.value.trim(), status: 'todo' }];
            taskStore.updateTask(task.id, { subtasks });
            e.target.value = '';
        }
    }

    function removeSubtask(index) {
        const subtasks = task.subtasks.filter((_, i) => i !== index);
        taskStore.updateTask(task.id, { subtasks });
    }

    async function deleteTask() {
        const confirmed = await showConfirm({
            title: '删除任务',
            message: `确定要删除任务 "${task.title}" 吗？`,
            confirmText: '删除',
            cancelText: '取消',
            variant: 'danger'
        });
        if (confirmed) {
            taskStore.deleteTask(task.id);
            if ($activeTask?.id === task.id) {
                activeTask.set(null);
            }
        }
    }

    function formatTimeOnly(date) {
        return date && date.includes('T') ? date.split('T')[1] : '';
    }

    function getLatestNoteLine(note) {
        return note ? note.split('\n').filter(l => l.trim()).pop() : '';
    }
</script>

<div on:click={onSelect}
    class="task-card bg-white rounded-xl shadow-sm border border-slate-200 relative overflow-hidden cursor-pointer group"
    class:active={$activeTask && $activeTask.id === task.id}>
    {#if isOverdue}
        <div class="absolute top-0 left-0 right-0 h-1 bg-red-500 z-10"></div>
    {/if}

    <div class="p-3 flex items-center gap-2 md:gap-3 relative z-0 min-h-[4rem]">
        <button on:click|stopPropagation={toggleExpanded}
            class="shrink-0 text-slate-400 w-5 md:w-6 transition-transform"
            class:rotate-90={task.expanded}>
            <i class="ph-bold ph-caret-right text-lg"></i>
        </button>

        <div class="relative w-14 md:w-24 shrink-0" on:click|stopPropagation>
            <select value={task.priority} on:change={updatePriority}
                class="w-full appearance-none px-1 md:pl-7 md:pr-2 py-1.5 rounded-lg text-xs font-bold border bg-white focus:outline-none text-center md:text-left {getPriorityStyle(task.priority)}">
                <option value="normal">普通</option>
                <option value="urgent">紧急</option>
                <option value="critical">特急</option>
            </select>
            <div class="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none hidden md:block">
                <i class="ph-fill ph-flag {getPriorityStyle(task.priority)}"></i>
            </div>
        </div>

        <div class="relative w-16 md:w-28 shrink-0" on:click|stopPropagation>
            <select value={task.status} on:change={updateStatus}
                class="w-full appearance-none px-1 md:pl-7 md:pr-2 py-1.5 rounded-lg text-xs font-bold border bg-white focus:outline-none text-center md:text-left {getStatusStyle(task.status)}">
                <option value="todo">未开始</option>
                <option value="doing">进行中</option>
                <option value="done">已完成</option>
            </select>
            <div class="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none hidden md:block">
                {#if task.status === 'todo'}
                    <i class="ph ph-circle text-slate-400"></i>
                {:else if task.status === 'doing'}
                    <i class="ph ph-spinner animate-spin text-blue-600"></i>
                {:else}
                    <i class="ph ph-check-circle text-green-600"></i>
                {/if}
            </div>
        </div>

        <div class="flex-1 w-0 min-w-0 font-bold text-slate-800 text-sm flex items-center gap-2">
            <span class="truncate block">{task.title}</span>
            <span class="text-[10px] font-normal text-slate-400 font-mono bg-slate-100 px-1 rounded hidden md:inline shrink-0">
                {formatTimeOnly(task.date)}
            </span>
        </div>

        <div class="flex-1 min-w-0 border-l border-slate-200 pl-3 ml-1 hidden md:block">
            {#if task.note}
                <div class="text-xs text-slate-400 truncate font-mono">{getLatestNoteLine(task.note)}</div>
            {/if}
        </div>

        <div class="flex items-center gap-1 shrink-0 ml-1">
            <button on:click|stopPropagation={() => openModal(task)}
                class="p-1.5 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded">
                <i class="ph ph-pencil-simple text-lg"></i>
            </button>
            <button on:click|stopPropagation={deleteTask}
                class="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded">
                <i class="ph ph-trash text-lg"></i>
            </button>
        </div>
    </div>

    {#if task.expanded}
        <div class="bg-slate-50 border-t border-slate-100 px-4 py-3 ml-0 md:ml-14" on:click|stopPropagation>
            <div class="space-y-2">
                {#each task.subtasks || [] as sub, idx}
                    <div class="flex items-start gap-2">
                        <label class="flex items-center gap-2 cursor-pointer select-none flex-1">
                            <input type="checkbox" checked={sub.status === 'done'} on:change={() => toggleSubtask(sub)}
                                class="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500">
                            <span class="text-sm text-slate-700 transition-all"
                                class:line-through={sub.status === 'done'}
                                class:text-slate-400={sub.status === 'done'}>
                                {sub.title}
                            </span>
                        </label>
                        <button on:click={() => removeSubtask(idx)} class="text-slate-300 hover:text-red-500">
                            <i class="ph ph-x"></i>
                        </button>
                    </div>
                {/each}
                <div class="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200 border-dashed">
                    <i class="ph ph-plus text-slate-400 text-xs"></i>
                    <input type="text" placeholder="添加子步骤..." on:keydown={addInlineSubtask}
                        class="bg-transparent text-xs w-full focus:outline-none text-slate-600 placeholder-slate-400">
                </div>
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
</style>