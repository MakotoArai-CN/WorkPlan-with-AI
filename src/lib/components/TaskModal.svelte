<script>
    import { taskStore, currentView, viewDate, today } from '../stores/tasks.js';

    export let show = false;
    export let editTask = null;

    let data = {
        id: '',
        title: '',
        status: 'todo',
        priority: 'normal',
        date: '',
        deadline: '',
        note: '',
        subtasks: [],
        repeatDays: [],
        enabled: true
    };

    let newSubtaskInput;
    let draggingIndex = null;

    $: if (show) {
        if (editTask) {
            data = JSON.parse(JSON.stringify(editTask));
        } else {
            data = {
                id: Date.now().toString(),
                title: '',
                status: 'todo',
                priority: 'normal',
                date: $currentView === 'dashboard' ? $viewDate + 'T12:00' : $today + 'T09:00',
                deadline: '',
                note: '',
                subtasks: [],
                repeatDays: [],
                enabled: true
            };
        }
    }

    function close() {
        show = false;
        editTask = null;
    }

    function save() {
        if (!data.title.trim()) return;

        if ($currentView === 'dashboard') {
            if (editTask) {
                taskStore.updateTask(data.id, data);
            } else {
                taskStore.addTask(data);
            }
        } else if ($currentView === 'templates') {
            if (editTask) {
                taskStore.updateTemplate(data.id, data);
            } else {
                taskStore.addTemplate(data);
            }
        } else if ($currentView === 'scheduled') {
            if (editTask) {
                taskStore.updateScheduledTask(data.id, data);
            } else {
                taskStore.addScheduledTask(data);
            }
        }

        close();
    }

    function addSubtask() {
        const value = newSubtaskInput?.value?.trim();
        if (value) {
            data.subtasks = [...data.subtasks, { title: value, status: 'todo' }];
            newSubtaskInput.value = '';
        }
    }

    function removeSubtask(index) {
        data.subtasks = data.subtasks.filter((_, i) => i !== index);
    }

    function dragStart(index) {
        draggingIndex = index;
    }

    function dragDrop(targetIndex) {
        if (draggingIndex === null || draggingIndex === targetIndex) return;
        const item = data.subtasks[draggingIndex];
        data.subtasks = data.subtasks.filter((_, i) => i !== draggingIndex);
        data.subtasks.splice(targetIndex, 0, item);
        draggingIndex = null;
    }

    function loadTemplate(e) {
        const template = $taskStore.templates.find(t => t.id === e.target.value);
        if (template) {
            data.title = template.title;
            data.priority = template.priority || 'normal';
            data.subtasks = JSON.parse(JSON.stringify(template.subtasks || []));
            data.note = template.note || '';
        }
        e.target.value = '';
    }

    function toggleRepeatDay(day) {
        if (data.repeatDays.includes(day)) {
            data.repeatDays = data.repeatDays.filter(d => d !== day);
        } else {
            data.repeatDays = [...data.repeatDays, day];
        }
    }

    const dayLabels = ['一', '二', '三', '四', '五', '六', '日'];
</script>

{#if show}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div on:click={close} class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"></div>
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg relative flex flex-col max-h-[90vh] overflow-hidden transform transition-all">
            <div class="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 class="font-bold text-lg text-slate-800">{editTask ? '编辑' : '新建'}</h3>
                <button on:click={close}><i class="ph ph-x text-xl"></i></button>
            </div>

            <div class="p-6 overflow-y-auto space-y-5">
                {#if $currentView === 'dashboard' && !editTask && $taskStore.templates.length > 0}
                    <div class="bg-purple-50 border border-purple-100 rounded-lg p-3">
                        <select on:change={loadTemplate}
                            class="w-full bg-white border border-purple-200 rounded px-2 py-1.5 text-sm text-slate-700">
                            <option value="">-- 快速加载模板 --</option>
                            {#each $taskStore.templates as t}
                                <option value={t.id}>{t.title}</option>
                            {/each}
                        </select>
                    </div>
                {/if}

                <div>
                    <label class="text-xs font-bold text-slate-500 uppercase">名称</label>
                    <input bind:value={data.title} type="text"
                        class="w-full text-lg font-bold border-b-2 border-slate-200 py-1 focus:border-blue-500 outline-none"
                        placeholder="输入名称">
                </div>

                {#if $currentView === 'scheduled'}
                    <div class="bg-teal-50 p-4 rounded-xl">
                        <label class="text-xs font-bold text-teal-700 uppercase mb-2 block">重复周期</label>
                        <div class="flex justify-between gap-1">
                            {#each dayLabels as dayStr, idx}
                                {@const dayValue = idx === 6 ? 0 : idx + 1}
                                <label class="cursor-pointer">
                                    <input type="checkbox" checked={data.repeatDays.includes(dayValue)}
                                        on:change={() => toggleRepeatDay(dayValue)} class="hidden peer">
                                    <span class="block w-8 h-8 rounded-full border border-teal-200 bg-white text-center leading-8 text-sm text-slate-500 peer-checked:bg-teal-500 peer-checked:text-white transition-all">
                                        {dayStr}
                                    </span>
                                </label>
                            {/each}
                        </div>
                    </div>
                {/if}

                <div>
                    <label class="text-xs font-bold text-slate-500 uppercase">备注</label>
                    <textarea bind:value={data.note} rows="3"
                        class="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm resize-none"></textarea>
                </div>

                <div class="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div class="space-y-2">
                        {#each data.subtasks as sub, index}
                            <div class="flex gap-2 items-center group" draggable="true"
                                on:dragstart={() => dragStart(index)}
                                on:drop={() => dragDrop(index)}
                                on:dragover|preventDefault>
                                <i class="ph-bold ph-dots-six-vertical text-slate-300 cursor-move"></i>
                                <input bind:value={sub.title}
                                    class="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-sm">
                                <button on:click={() => removeSubtask(index)}>
                                    <i class="ph-bold ph-trash text-slate-400"></i>
                                </button>
                            </div>
                        {/each}
                        <div class="flex gap-2">
                            <input type="text" bind:this={newSubtaskInput} placeholder="新子任务..."
                                on:keydown={(e) => e.key === 'Enter' && addSubtask()}
                                class="flex-1 bg-transparent border-b border-slate-300 px-2 py-1 text-sm outline-none">
                            <button on:click={addSubtask} class="text-blue-600 text-sm font-bold">添加</button>
                        </div>
                    </div>
                </div>

                {#if $currentView === 'dashboard'}
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">计划</label>
                            <input type="datetime-local" bind:value={data.date}
                                class="w-full border border-slate-200 rounded px-2 py-2 text-sm">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">截止</label>
                            <input type="datetime-local" bind:value={data.deadline}
                                class="w-full border border-slate-200 rounded px-2 py-2 text-sm">
                        </div>
                    </div>
                {/if}
            </div>

            <div class="p-4 border-t border-slate-100 flex justify-end gap-3 bg-white">
                <button on:click={close}
                    class="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">取消</button>
                <button on:click={save}
                    class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-bold shadow">确认</button>
            </div>
        </div>
    </div>
{/if}