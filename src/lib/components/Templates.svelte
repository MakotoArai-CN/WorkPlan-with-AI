<script>
    import { taskStore, activeTask } from '../stores/tasks.js';
    import { showConfirm } from '../stores/modal.js';

    export let openModal;

    function selectTemplate(template) {
        activeTask.set(template);
    }

    async function deleteTemplate(id) {
        const confirmed = await showConfirm({
            title: '删除模板',
            message: '确定要删除这个任务模板吗？',
            confirmText: '删除',
            cancelText: '取消',
            variant: 'danger'
        });
        if (confirmed) {
            taskStore.deleteTemplate(id);
            if ($activeTask?.id === id) {
                activeTask.set(null);
            }
        }
    }
</script>

<header class="h-16 bg-white/90 backdrop-blur px-6 flex justify-between items-center z-10 sticky top-0 border-b border-slate-200 shrink-0">
    <div>
        <h2 class="text-lg font-bold text-purple-800">任务模板库</h2>
        <div class="text-xs text-slate-500">预设常用任务</div>
    </div>
    <button on:click={() => openModal()}
        class="h-9 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-bold shadow-md shadow-purple-200 flex items-center gap-2">
        <i class="ph-bold ph-plus"></i>新建
    </button>
</header>

<div class="flex-1 overflow-y-auto p-4 space-y-3 pb-20">
    {#if $taskStore.templates.length === 0}
        <div class="flex flex-col items-center justify-center h-64 text-slate-400">
            <i class="ph ph-copy text-4xl mb-2 text-purple-200"></i>
            <p class="text-sm">暂无模板</p>
        </div>
    {/if}

    {#each $taskStore.templates as tmpl (tmpl.id)}
        <div on:click={() => selectTemplate(tmpl)}
            class="task-card template-card bg-white rounded-xl shadow-sm border border-slate-200 p-3 flex items-center gap-3 cursor-pointer relative"
            class:active={$activeTask && $activeTask.id === tmpl.id}>
            <div class="font-bold text-slate-800 text-sm flex-1">{tmpl.title}</div>
            <div class="flex items-center gap-1">
                <button on:click|stopPropagation={() => openModal(tmpl)}
                    class="p-1.5 text-slate-300 hover:text-purple-600 rounded">
                    <i class="ph ph-pencil-simple text-lg"></i>
                </button>
                <button on:click|stopPropagation={() => deleteTemplate(tmpl.id)}
                    class="p-1.5 text-slate-300 hover:text-red-600 rounded">
                    <i class="ph ph-trash text-lg"></i>
                </button>
            </div>
        </div>
    {/each}
</div>

<style>
    .task-card {
        transition: all 0.2s ease;
        border-left-width: 4px;
        border-left-color: transparent;
    }
    .template-card.active {
        border-left-color: #9333ea;
        background-color: #faf5ff;
        border-color: #e9d5ff;
    }
</style>