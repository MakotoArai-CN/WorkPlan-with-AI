<script>
    import { activeTask, taskStore, currentView } from '../stores/tasks.js';
    import { showConfirm } from '../stores/modal.js';

    export let openModal;

    function formatDateTime(d) {
        return d ? d.replace('T', ' ') : '';
    }

    function isOverdue(t) {
        if (!t || !t.deadline) return false;
        const now = new Date().toISOString().slice(0, 16);
        return t.deadline < now && t.status !== 'done';
    }

    function close() {
        activeTask.set(null);
    }

    function markDone() {
        if (!$activeTask) return;
        const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        taskStore.updateTask($activeTask.id, {
            status: 'done',
            completedDate: now,
            subtasks: $activeTask.subtasks?.map(s => ({ ...s, status: 'done' }))
        });
        activeTask.set(null);
    }

    async function deleteTask() {
        if (!$activeTask) return;
        const confirmed = await showConfirm({
            title: '删除任务',
            message: `确定要删除 "${$activeTask.title}" 吗？`,
            confirmText: '删除',
            cancelText: '取消',
            variant: 'danger'
        });
        if (confirmed) {
            taskStore.deleteTask($activeTask.id);
            activeTask.set(null);
        }
    }

    function updateNote(e) {
        if (!$activeTask) return;
        taskStore.updateTask($activeTask.id, { note: e.target.value });
    }
</script>

{#if $activeTask}
    <div class="md:hidden fixed inset-0 z-50 bg-white flex flex-col" style="animation: slideInRight 0.25s ease-out">
        <div class="h-14 border-b border-slate-100 flex items-center justify-between px-4 bg-white shrink-0">
            <button on:click={close} class="text-slate-500 flex items-center gap-1 font-bold">
                <i class="ph-bold ph-caret-left text-lg"></i> 返回
            </button>
            <div class="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-1 rounded">
                ID: {$activeTask.id.slice(-4)}
            </div>
            <div class="flex gap-3">
                {#if $currentView !== 'scheduled'}
                    <button on:click={markDone} class="text-green-600">
                        <i class="ph-fill ph-check-circle text-2xl"></i>
                    </button>
                {/if}
                <button on:click={deleteTask} class="text-red-500">
                    <i class="ph-bold ph-trash text-xl"></i>
                </button>
            </div>
        </div>

        <div class="flex-1 overflow-y-auto p-5 space-y-6 pb-24 bg-slate-50/50">
            <div>
                <div class="flex items-center gap-2 mb-2">
                    {#if isOverdue($activeTask)}
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-600 border border-red-200">已超时</span>
                    {/if}
                    {#if $activeTask.priority === 'urgent'}
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-600">紧急</span>
                    {/if}
                    {#if $activeTask.priority === 'critical'}
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-600">特急</span>
                    {/if}
                </div>
                <h2 class="text-2xl font-black text-slate-800 leading-snug">{$activeTask.title}</h2>
            </div>

            <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <label class="text-xs font-bold text-slate-400 uppercase mb-2 block">备注 / 笔记</label>
                <textarea value={$activeTask.note || ''} on:input={updateNote} rows="5" placeholder="点击输入内容..."
                    class="w-full text-sm text-slate-700 leading-relaxed focus:outline-none resize-none font-mono placeholder-slate-300"></textarea>
            </div>

            <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <label class="text-xs font-bold text-slate-400 uppercase mb-3 block flex justify-between">
                    子任务清单
                    <span class="text-blue-500" on:click={() => openModal($activeTask)}>去编辑</span>
                </label>
                <ul class="space-y-3">
                    {#each $activeTask.subtasks || [] as sub}
                        <li class="text-sm flex items-start gap-3">
                            <i class={sub.status === 'done' ? 'ph-fill ph-check-circle text-green-500 text-lg' : 'ph ph-circle text-slate-300 text-lg'}></i>
                            <span class="flex-1 leading-snug"
                                class:line-through={sub.status === 'done'}
                                class:text-slate-400={sub.status === 'done'}
                                class:text-slate-700={sub.status !== 'done'}>
                                {sub.title}
                            </span>
                        </li>
                    {:else}
                        <li class="text-sm text-slate-400 italic text-center py-2">无子任务</li>
                    {/each}
                </ul>
            </div>

            <div class="grid grid-cols-2 gap-3">
                <div class="bg-white p-3 rounded-lg border border-slate-100">
                    <div class="text-xs text-slate-400 mb-1">计划日期</div>
                    <div class="font-bold text-slate-700">{formatDateTime($activeTask.date)}</div>
                </div>
                <div class="bg-white p-3 rounded-lg border border-slate-100">
                    <div class="text-xs text-slate-400 mb-1">截止时间</div>
                    <div class="font-bold" class:text-red-500={isOverdue($activeTask)} class:text-slate-700={!isOverdue($activeTask)}>
                        {formatDateTime($activeTask.deadline) || '无'}
                    </div>
                </div>
                <div class="bg-white p-3 rounded-lg border border-slate-100">
                    <div class="text-xs text-slate-400 mb-1">开始时间</div>
                    <div class="font-bold text-blue-600">{$activeTask.startTime ? formatDateTime($activeTask.startTime) : '-'}</div>
                </div>
                <div class="bg-white p-3 rounded-lg border border-slate-100">
                    <div class="text-xs text-slate-400 mb-1">完成时间</div>
                    <div class="font-bold text-green-600">{$activeTask.completedDate ? formatDateTime($activeTask.completedDate) : '-'}</div>
                </div>
            </div>
        </div>

        <div class="absolute bottom-6 right-6 z-10">
            <button on:click={() => openModal($activeTask)}
                class="w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg shadow-blue-300 flex items-center justify-center active:scale-90 transition-transform">
                <i class="ph-bold ph-pencil-simple text-2xl"></i>
            </button>
        </div>
    </div>
{/if}

<style>
    @keyframes slideInRight {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
    }
</style>