<script>
    import { activeTask, taskStore, currentView } from '../stores/tasks.js';
    import { showConfirm } from '../stores/modal.js';
    import { _ } from 'svelte-i18n';
    import { get } from 'svelte/store';

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
        const t = get(_);
        const confirmed = await showConfirm({
            title: t('task_detail.delete_title'),
            message: t('task.delete_confirm', { values: { title: $activeTask.title } }),
            confirmText: t('common.delete'),
            cancelText: t('common.cancel'),
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
    <div class="md:hidden fixed inset-0 z-50 bg-white flex flex-col safe-area-detail" style="animation: slideInRight 0.25s ease-out">
        <div class="h-14 border-b border-slate-100 flex items-center justify-between px-4 bg-white shrink-0 detail-header">
            <button on:click={close} class="text-slate-500 flex items-center gap-1 font-bold">
                <i class="ph-bold ph-caret-left text-lg"></i> {$_('common.back')}
            </button>
            <div class="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-1 rounded">
                ID: {$activeTask.id.slice(-4)}
            </div>
            <div class="flex gap-3">
                {#if $currentView !== 'scheduled'}
                    <button on:click={markDone} class="text-green-600" aria-label={$_('task_status.done')}>
                        <i class="ph-fill ph-check-circle text-2xl"></i>
                    </button>
                {/if}
                <button on:click={deleteTask} class="text-red-500" aria-label={$_('common.delete')}>
                    <i class="ph-bold ph-trash text-xl"></i>
                </button>
            </div>
        </div>

        <div class="flex-1 overflow-y-auto p-5 space-y-6 detail-content">
            <div>
                <div class="flex items-center gap-2 mb-2">
                    {#if isOverdue($activeTask)}
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-600 border border-red-200">{$_('task_detail.overdue')}</span>
                    {/if}
                    {#if $activeTask.priority === 'urgent'}
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-600">{$_('task_priority.urgent')}</span>
                    {/if}
                    {#if $activeTask.priority === 'critical'}
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-600">{$_('task_priority.critical')}</span>
                    {/if}
                </div>
                <h2 class="text-2xl font-black text-slate-800 leading-snug">{$activeTask.title}</h2>
            </div>

            <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <label for="mobile-task-note" class="text-xs font-bold text-slate-400 uppercase mb-2 block">{$_('task_detail.notes')}</label>
                <textarea id="mobile-task-note" value={$activeTask.note || ''} on:input={updateNote} rows="5" placeholder="..."
                    class="w-full text-sm text-slate-700 leading-relaxed focus:outline-none resize-none font-mono placeholder-slate-300"></textarea>
            </div>

            <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div class="text-xs font-bold text-slate-400 uppercase mb-3 flex justify-between items-center">
                    {$_('task_detail.subtasks')}
                    <button
                        type="button"
                        class="text-blue-500"
                        on:click={() => openModal($activeTask)}
                    >
                        {$_('task_detail.edit')}
                    </button>
                </div>
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
                        <li class="text-sm text-slate-400 italic text-center py-2">{$_('task_detail.no_subtasks')}</li>
                    {/each}
                </ul>
            </div>

            <div class="grid grid-cols-2 gap-3">
                <div class="bg-white p-3 rounded-lg border border-slate-100">
                    <div class="text-xs text-slate-400 mb-1">{$_('task_detail.plan_date')}</div>
                    <div class="font-bold text-slate-700">{formatDateTime($activeTask.date)}</div>
                </div>
                <div class="bg-white p-3 rounded-lg border border-slate-100">
                    <div class="text-xs text-slate-400 mb-1">{$_('task_detail.due_time')}</div>
                    <div class="font-bold" class:text-red-500={isOverdue($activeTask)} class:text-slate-700={!isOverdue($activeTask)}>
                        {formatDateTime($activeTask.deadline) || '-'}
                    </div>
                </div>
                <div class="bg-white p-3 rounded-lg border border-slate-100">
                    <div class="text-xs text-slate-400 mb-1">{$_('task_detail.start_time')}</div>
                    <div class="font-bold text-blue-600">{$activeTask.startTime ? formatDateTime($activeTask.startTime) : '-'}</div>
                </div>
                <div class="bg-white p-3 rounded-lg border border-slate-100">
                    <div class="text-xs text-slate-400 mb-1">{$_('task_detail.finish_time')}</div>
                    <div class="font-bold text-green-600">{$activeTask.completedDate ? formatDateTime($activeTask.completedDate) : '-'}</div>
                </div>
            </div>
        </div>

        <div class="absolute bottom-6 right-6 z-10 fab-button">
            <button on:click={() => openModal($activeTask)}
                aria-label={$_('task_detail.edit')}
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

    .safe-area-detail {
        padding-top: env(safe-area-inset-top);
    }

    .detail-header {
        margin-top: env(safe-area-inset-top);
    }

    .detail-content {
        padding-bottom: calc(6rem + env(safe-area-inset-bottom));
    }

    .fab-button {
        bottom: calc(1.5rem + env(safe-area-inset-bottom));
    }
</style>
