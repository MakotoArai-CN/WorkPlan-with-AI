<script>
    import { activeTask, taskStore, currentView } from '../stores/tasks.js';
    import { showAiPanel } from '../stores/ai.js';
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
            if ($currentView === 'dashboard') {
                taskStore.deleteTask($activeTask.id);
            } else if ($currentView === 'templates') {
                taskStore.deleteTemplate($activeTask.id);
            } else if ($currentView === 'scheduled') {
                taskStore.deleteScheduledTask($activeTask.id);
            }
            activeTask.set(null);
        }
    }

    function updateNote(e) {
        if (!$activeTask) return;
        if ($currentView === 'dashboard') {
            taskStore.updateTask($activeTask.id, { note: e.target.value });
        } else if ($currentView === 'templates') {
            taskStore.updateTemplate($activeTask.id, { note: e.target.value });
        } else if ($currentView === 'scheduled') {
            taskStore.updateScheduledTask($activeTask.id, { note: e.target.value });
        }
    }
</script>

<aside class="hidden md:flex w-[350px] bg-white border-l border-slate-200 flex-col z-10 shrink-0 h-full shadow-[-4px_0_15px_rgba(0,0,0,0.02)]">
    {#if $showAiPanel}
        <slot name="ai-panel"></slot>
    {:else if $activeTask}
        <div class="h-16 border-b border-slate-100 flex items-center px-6 bg-slate-50/80">
            <h3 class="font-bold text-slate-700 flex items-center gap-2">
                <i class="ph ph-sliders-horizontal"></i> {$_('task_detail.title')}
            </h3>
        </div>

        <div class="flex-1 overflow-y-auto p-6 flex flex-col h-full">
            <div class="mb-6">
                <div class="flex items-center gap-2 mb-2">
                    <span class="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                        {$activeTask.id.slice(-4)}
                    </span>
                    {#if isOverdue($activeTask) && $currentView === 'dashboard'}
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-600">{$_('task_detail.overdue')}</span>
                    {/if}
                </div>
                <h2 class="text-2xl font-black text-slate-800 leading-snug">{$activeTask.title}</h2>
            </div>

            <div class="flex-1 flex flex-col mb-6 min-h-[150px]">
                <label class="text-xs font-bold text-slate-500 uppercase mb-2">{$_('task_detail.notes')}</label>
                <textarea value={$activeTask.note || ''} on:input={updateNote} placeholder="..."
                    class="flex-1 w-full bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-slate-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-yellow-300 resize-none font-mono"></textarea>
            </div>

            <div class="mb-6 bg-slate-50 rounded-xl p-4 border border-slate-100">
                <div class="text-xs font-bold text-slate-500 uppercase mb-2">{$_('task_detail.subtasks')}</div>
                <ul class="space-y-1">
                    {#each $activeTask.subtasks || [] as sub}
                        <li class="text-xs flex items-center gap-2">
                            <i class={sub.status === 'done' ? 'ph-fill ph-check-circle text-green-500' : 'ph ph-circle text-slate-300'}></i>
                            <span class:line-through={sub.status === 'done'} class:text-slate-400={sub.status === 'done'} class:text-slate-600={sub.status !== 'done'}>
                                {sub.title}
                            </span>
                        </li>
                    {:else}
                        <li class="text-xs text-slate-400 italic">{$_('task_detail.no_subtasks')}</li>
                    {/each}
                </ul>
            </div>

            <div class="border-t border-slate-100 pt-4 grid grid-cols-2 gap-4 text-xs">
                <div>
                    <div class="text-slate-400 mb-1">{$_('task_detail.plan_date')}</div>
                    <div class="font-bold text-slate-700">{formatDateTime($activeTask.date)}</div>
                </div>
                <div>
                    <div class="text-slate-400 mb-1">{$_('task_detail.due_time')}</div>
                    <div class="font-bold" class:text-red-500={isOverdue($activeTask)} class:text-slate-700={!isOverdue($activeTask)}>
                        {formatDateTime($activeTask.deadline) || '-'}
                    </div>
                </div>
                <div>
                    <div class="text-slate-400 mb-1">{$_('task_detail.start_time')}</div>
                    <div class="font-bold text-blue-600">{$activeTask.startTime ? formatDateTime($activeTask.startTime) : '-'}</div>
                </div>
                <div>
                    <div class="text-slate-400 mb-1">{$_('task_detail.finish_time')}</div>
                    <div class="font-bold text-green-600">{$activeTask.completedDate ? formatDateTime($activeTask.completedDate) : '-'}</div>
                </div>
            </div>

            <div class="mt-6 flex gap-2">
                <button on:click={() => openModal($activeTask)}
                    class="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">
                    <i class="ph ph-pencil-simple"></i> {$_('task_detail.edit')}
                </button>
                <button on:click={deleteTask}
                    class="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-bold hover:bg-red-100 border border-red-100">
                    <i class="ph ph-trash"></i>
                </button>
            </div>
        </div>
    {:else}
        <div class="h-full flex flex-col items-center justify-center text-center opacity-40 p-10">
            <i class="ph ph-hand-tap text-5xl text-slate-300 mb-4"></i>
            <h4 class="font-bold text-slate-600 text-lg">{$_('task_detail.empty_hint')}</h4>
        </div>
    {/if}
</aside>