<script>
    import { tick } from "svelte";
    import {
        chatHistory,
        aiPanelContext,
        isAiLoading,
        showAiPanel,
        showAiSettings,
        sendAiMessage,
        retryLastMessage,
        confirmLocalFileOperation,
        confirmAiTask,
        confirmMultiTask,
        confirmAllMultiTasks,
        removeAiMessage
    } from "../stores/ai.js";
    import { taskStore } from "../stores/tasks.js";
    import { showAlert, showConfirm } from "../stores/modal.js";
    import { openExternalUrl } from "../utils/open-external.js";
    import { resizeTextarea } from "../utils/textarea-autosize.js";
    import { _ } from 'svelte-i18n';
    import { get } from 'svelte/store';

    function t(key, opts) { return get(_)(key, opts); }

    let inputText = "";
    let chatContainer;
    let composerTextarea;
    let panelMeta = {
        title: '',
        introTitle: '',
        introLines: [],
        placeholder: '',
        quickActions: []
    };

    function getExistingItems() {
        if ($aiPanelContext.source === 'templates') {
            return $taskStore.templates || [];
        }
        if ($aiPanelContext.source === 'scheduled') {
            return $taskStore.scheduledTasks || [];
        }
        return $taskStore.tasks || [];
    }

    function getAssistantPayload() {
        return {
            ...$aiPanelContext,
            items: getExistingItems()
        };
    }

    function addScopedItem(data) {
        const normalized = {
            ...data,
            id: data.id || Date.now().toString(),
            status: data.status || "todo",
            subtasks: (data.subtasks || []).map((s) => ({
                title: typeof s === "string" ? s : s.title,
                status: s.status || "todo",
            })),
        };

        if ($aiPanelContext.source === 'templates') {
            taskStore.addTemplate(normalized);
            return;
        }

        if ($aiPanelContext.source === 'scheduled') {
            taskStore.addScheduledTask({
                ...normalized,
                repeatDays: Array.isArray(normalized.repeatDays) ? normalized.repeatDays : [],
                enabled: normalized.enabled ?? true,
                date: normalized.date || '',
                deadline: normalized.deadline || ''
            });
            return;
        }

        taskStore.addTask(normalized);
    }

    function updateScopedItem(id, updates) {
        if ($aiPanelContext.source === 'templates') {
            taskStore.updateTemplate(id, updates);
            return;
        }
        if ($aiPanelContext.source === 'scheduled') {
            taskStore.updateScheduledTask(id, updates);
            return;
        }
        taskStore.updateTask(id, updates);
    }

    function deleteScopedItem(id) {
        if ($aiPanelContext.source === 'templates') {
            taskStore.deleteTemplate(id);
            return;
        }
        if ($aiPanelContext.source === 'scheduled') {
            taskStore.deleteScheduledTask(id);
            return;
        }
        taskStore.deleteTask(id);
    }

    function getPanelMeta() {
        if ($aiPanelContext.scope === 'notes') {
            return {
                title: $_('notes.ai_assistant'),
                introTitle: $_('notes.title'),
                introLines: [
                    $_('notes.ai_panel_summary_hint'),
                    $_('notes.ai_panel_polish_hint'),
                    $_('notes.ai_panel_followup_hint')
                ],
                placeholder: $_('notes.ai_panel_placeholder'),
                quickActions: [
                    { label: $_('notes.ai_panel_quick_summary'), value: $_('notes.ai_panel_quick_summary') },
                    { label: $_('notes.ai_panel_quick_polish'), value: $_('notes.ai_panel_quick_polish') },
                    { label: $_('notes.ai_panel_quick_actions'), value: $_('notes.ai_panel_quick_actions') }
                ]
            };
        }

        if ($aiPanelContext.scope === 'templates') {
            return {
                title: '模板 AI 助手',
                introTitle: $aiPanelContext.title || '任务模板助手',
                introLines: [
                    '你可以让我创建、整理或优化任务模板结构。',
                    '我可以补全模板步骤、适用场景、优先级和备注建议。',
                    '例如：创建周报模板 / 优化入职模板 / 列出当前模板。'
                ],
                placeholder: '描述你想新建、调整或查询的任务模板...',
                quickActions: [
                    { label: '新建模板', value: '帮我创建一个任务模板，包含标题、说明和子任务结构。' },
                    { label: '优化模板', value: '请帮我优化当前模板的结构，让它更清晰易复用。' },
                    { label: '模板清单', value: '请列出当前已有模板，并说明各自适用场景。' }
                ]
            };
        }

        if ($aiPanelContext.scope === 'scheduled') {
            return {
                title: '定时任务 AI 助手',
                introTitle: $aiPanelContext.title || '定时任务助手',
                introLines: [
                    '你可以让我创建周期提醒、整理执行频率或排查冲突。',
                    '我可以补全重复规则、截止时间、启用状态和备注说明。',
                    '例如：创建工作日晨会提醒 / 检查重复冲突 / 汇总已启用任务。'
                ],
                placeholder: '描述你想新增、修改或分析的定时任务...',
                quickActions: [
                    { label: '工作日提醒', value: '帮我创建一个工作日执行的定时任务，并补全合理时间与说明。' },
                    { label: '检查冲突', value: '请帮我检查当前定时任务是否存在时间冲突或重复安排。' },
                    { label: '启用清单', value: '请汇总当前已启用的定时任务，并按频率分类说明。' }
                ]
            };
        }

        if ($aiPanelContext.scope === 'statistics') {
            return {
                title: '统计 AI 助手',
                introTitle: $aiPanelContext.title || '数据统计助手',
                introLines: [
                    '你可以让我总结统计区间、分析延期风险，或提出改进建议。',
                    '我可以基于当前筛选范围输出复盘、瓶颈和执行建议。',
                    '例如：总结本周完成情况 / 分析延期任务 / 给出优化建议。'
                ],
                placeholder: '输入你想分析的统计问题或复盘目标...',
                quickActions: [
                    { label: '完成总结', value: '请总结当前统计区间内的任务完成情况，并给出一句结论。' },
                    { label: '延期分析', value: '请分析当前统计区间内的延期任务和主要风险点。' },
                    { label: '优化建议', value: '请根据当前统计数据，给我三个最值得执行的改进建议。' }
                ]
            };
        }

        return {
            title: $_('ai_panel.title'),
            introTitle: $aiPanelContext.title || $_('ai_panel.task_assistant'),
            introLines: [
                $_('ai_panel.add_hint') + $_('ai_panel.add_example'),
                $_('ai_panel.delete_hint') + $_('ai_panel.delete_example'),
                $_('ai_panel.modify_hint') + $_('ai_panel.modify_example'),
                $_('ai_panel.query_hint') + $_('ai_panel.query_example')
            ],
            placeholder: $_('ai_panel.placeholder'),
            quickActions: [
                { label: $_('ai_panel.quick_today'), value: $_('ai_panel.query_today_cmd') },
                { label: $_('ai_panel.quick_week'), value: $_('ai_panel.query_week_cmd') },
                { label: $_('ai_panel.quick_tomorrow'), value: $_('ai_panel.query_tomorrow_cmd') }
            ]
        };
    }

    async function syncComposerHeight() {
        await tick();
        resizeTextarea(composerTextarea, 0.5);
    }

    function scrollToBottom() {
        if (chatContainer) {
            setTimeout(() => {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }, 50);
        }
    }

    async function handleSend() {
        if (!inputText.trim()) return;
        const text = inputText;
        inputText = "";
        try {
            await sendAiMessage(text, getAssistantPayload());
            scrollToBottom();
        } catch (error) {
            await showAlert({
                title: t('ai_panel.send_failed'),
                message: error.message,
                variant: "danger",
            });
        }
    }

    async function handleRetry(index) {
        try {
            await retryLastMessage(index, getAssistantPayload());
            scrollToBottom();
        } catch (error) {
            await showAlert({
                title: t('ai_panel.retry_failed'),
                message: error.message,
                variant: "danger",
            });
        }
    }

    function handleConfirmTask(data, index) {
        addScopedItem(data);
        confirmAiTask(index);
        chatHistory.update((h) => [
            ...h,
            {
                role: "assistant",
                type: "text",
                content: t('ai_panel.task_added_msg', { values: { title: data.title } }),
            },
        ]);
        scrollToBottom();
    }

    function handleConfirmMultiTask(msgIndex, taskIndex, task) {
        addScopedItem({
            ...task,
            id: task.id || (Date.now() + taskIndex).toString()
        });
        confirmMultiTask(msgIndex, taskIndex);
        scrollToBottom();
    }

    function handleConfirmAllTasks(msgIndex, tasks, confirmedIndexes) {
        const unconfirmed = tasks.filter(
            (_, i) => !confirmedIndexes.includes(i),
        );
        unconfirmed.forEach((task, idx) => {
            addScopedItem({
                ...task,
                id: task.id || (Date.now() + idx).toString()
            });
        });
        confirmAllMultiTasks(msgIndex);
        chatHistory.update((h) => [
            ...h,
            {
                role: "assistant",
                type: "text",
                content: t('ai_panel.tasks_added_msg', { values: { count: unconfirmed.length } }),
            },
        ]);
        scrollToBottom();
    }

    async function handleDeleteConfirm(tasks, msgIndex) {
        const taskNames = tasks.map((t) => `• ${t.title}`).join("\n");
        const confirmed = await showConfirm({
            title: t('ai_panel.confirm_delete'),
            message: `${t('ai_panel.delete_tasks_confirm', { values: { count: tasks.length } })}\n\n${taskNames}`,
            confirmText: t('common.delete'),
            cancelText: t('common.cancel'),
            variant: "danger",
        });
        if (confirmed) {
            tasks.forEach((task) => {
                deleteScopedItem(task.id);
            });
            chatHistory.update((h) => {
                const newHistory = [...h];
                newHistory[msgIndex] = {
                    role: "assistant",
                    type: "text",
                    content: `🗑️ ${t('ai_panel.confirm_delete')}: ${tasks.map((t) => t.title).join(", ")}`,
                };
                return newHistory;
            });
            scrollToBottom();
        }
    }

    async function handleUpdateConfirm(task, updates, msgIndex) {
        const updateDescriptions = [];
        if (updates.title) updateDescriptions.push(`${t('ai_panel.title_label')} → "${updates.title}"`);
        if (updates.date)
            updateDescriptions.push(`${t('ai_panel.time_label')} → ${formatDateTime(updates.date)}`);
        if (updates.deadline)
            updateDescriptions.push(
                `${t('ai_panel.deadline')} → ${formatDateTime(updates.deadline)}`,
            );
        if (updates.priority)
            updateDescriptions.push(
                `${t('ai_panel.priority_label')} → ${formatPriority(updates.priority)}`,
            );
        if (updates.note !== undefined)
            updateDescriptions.push(`${t('ai_panel.note_label')} → "${updates.note}"`);
        if (updates.subtasks) updateDescriptions.push(`${t('ai_panel.subtasks')} updated`);

        const confirmed = await showConfirm({
            title: t('ai_panel.confirm_modify'),
            message: `${t('ai_panel.modify_task_confirm', { values: { title: task.title, changes: updateDescriptions.join("\n") } })}`,
            confirmText: t('ai_panel.confirm_modify'),
            cancelText: t('common.cancel'),
            variant: "warning",
        });
        if (confirmed) {
            updateScopedItem(task.id, updates);
            chatHistory.update((h) => {
                const newHistory = [...h];
                newHistory[msgIndex] = {
                    role: "assistant",
                    type: "text",
                    content: `✏️ ${t('ai_panel.task_modified_msg', { values: { title: task.title, changes: updateDescriptions.join("，") } })}`,
                };
                return newHistory;
            });
            scrollToBottom();
        }
    }

    async function handleMultiUpdateConfirm(operations, msgIndex) {
        const summaryLines = operations
            .map((op) => {
                const updates = [];
                if (op.updates.title)
                    updates.push(`${t('ai_panel.title_label')}→"${op.updates.title}"`);
                if (op.updates.date)
                    updates.push(
                        `${t('ai_panel.time_label')}→${formatDateTime(op.updates.date).split(" ")[0]}`,
                    );
                if (op.updates.priority)
                    updates.push(
                        `${t('ai_panel.priority_label')}→${formatPriority(op.updates.priority)}`,
                    );
                return `• ${op.task.title}: ${updates.join(", ")}`;
            })
            .join("\n");

        const confirmed = await showConfirm({
            title: t('ai_panel.confirm_all_modify'),
            message: `${t('ai_panel.modify_tasks_confirm', { values: { count: operations.length } })}\n\n${summaryLines}`,
            confirmText: t('ai_panel.confirm_modify'),
            cancelText: t('common.cancel'),
            variant: "warning",
        });
        if (confirmed) {
            operations.forEach((op) => {
                updateScopedItem(op.task.id, op.updates);
            });
            chatHistory.update((h) => {
                const newHistory = [...h];
                newHistory[msgIndex] = {
                    role: "assistant",
                    type: "text",
                    content: t('ai_panel.tasks_modified_msg', { values: { count: operations.length } }),
                };
                return newHistory;
            });
            scrollToBottom();
        }
    }

    async function handleBatchCompleteConfirm(operations, msgIndex) {
        const taskNames = operations
            .map((op) => `• ${op.task.title}`)
            .join("\n");

        const confirmed = await showConfirm({
            title: t('ai_panel.mark_complete'),
            message: `${t('ai_panel.batch_complete_confirm', { values: { count: operations.length } })}\n\n${taskNames}`,
            confirmText: t('ai_panel.mark_complete'),
            cancelText: t('common.cancel'),
            variant: "success",
        });

        if (confirmed) {
            operations.forEach((op) => {
                updateScopedItem(op.task.id, op.updates);
            });
            chatHistory.update((h) => {
                const newHistory = [...h];
                newHistory[msgIndex] = {
                    role: "assistant",
                    type: "text",
                    content: t('ai_panel.tasks_completed_msg', { values: { count: operations.length } }),
                };
                return newHistory;
            });
            scrollToBottom();
        }
    }

    async function handleMixedConfirm(deleteOps, updateOps, msgIndex) {
        let summaryLines = [];

        if (updateOps.length > 0) {
            summaryLines.push(`[${t('ai_panel.modify_section')}]`);
            updateOps.forEach((op) => {
                const updates = [];
                if (op.updates.date)
                    updates.push(
                        `${t('ai_panel.time_label')}→${formatDateTime(op.updates.date).split(" ")[0]}`,
                    );
                if (op.updates.title)
                    updates.push(`${t('ai_panel.title_label')}→"${op.updates.title}"`);
                summaryLines.push(
                    `  • ${op.task.title}: ${updates.join(", ")}`,
                );
            });
        }

        if (deleteOps.length > 0) {
            summaryLines.push(`[${t('ai_panel.delete_section')}]`);
            deleteOps.forEach((task) => {
                summaryLines.push(`  • ${task.title}`);
            });
        }

        const confirmed = await showConfirm({
            title: t('ai_panel.confirm_execute'),
            message: `${t('ai_panel.mixed_confirm_msg')}\n\n${summaryLines.join("\n")}`,
            confirmText: t('ai_panel.confirm_execute'),
            cancelText: t('common.cancel'),
            variant: "warning",
        });

        if (confirmed) {
            updateOps.forEach((op) => {
                updateScopedItem(op.task.id, op.updates);
            });
            deleteOps.forEach((task) => {
                deleteScopedItem(task.id);
            });

            const resultParts = [];
            if (updateOps.length > 0)
                resultParts.push(`${t('ai_panel.modify_section')} ${updateOps.length}`);
            if (deleteOps.length > 0)
                resultParts.push(`${t('ai_panel.delete_section')} ${deleteOps.length}`);

            chatHistory.update((h) => {
                const newHistory = [...h];
                newHistory[msgIndex] = {
                    role: "assistant",
                    type: "text",
                    content: `${resultParts.join("，")}`,
                };
                return newHistory;
            });
            scrollToBottom();
        }
    }

    function formatDateTime(d) {
        if (!d) return "";
        return d.replace("T", " ");
    }

    function formatDateOnly(d) {
        if (!d) return "";
        return d.split("T")[0];
    }

    function formatTimeOnly(d) {
        if (!d) return "";
        const parts = d.split("T");
        return parts.length > 1 ? parts[1] : "";
    }

    function formatPriority(p) {
        return t(`task_priority.${p}`) || t('task_priority.normal');
    }

    function formatStatus(s) {
        return t(`task_status.${s}`) || t('task_status.todo');
    }

    function getPriorityColor(p) {
        const map = {
            normal: "text-slate-500",
            urgent: "text-orange-500",
            critical: "text-red-500",
        };
        return map[p] || "text-slate-500";
    }

    function getStatusBgColor(s) {
        const map = {
            todo: "bg-slate-100 text-slate-600",
            doing: "bg-blue-100 text-blue-600",
            done: "bg-green-100 text-green-600",
        };
        return map[s] || "bg-slate-100 text-slate-600";
    }

    function getRelativeDate(dateStr) {
        if (!dateStr) return "";
        const date = new Date(dateStr.split("T")[0]);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const dayAfterTomorrow = new Date(today);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.getTime() === today.getTime()) return t('ai_panel.today');
        if (date.getTime() === tomorrow.getTime()) return t('ai_panel.tomorrow');
        if (date.getTime() === dayAfterTomorrow.getTime()) return t('ai_panel.day_after');
        if (date.getTime() === yesterday.getTime()) return t('ai_panel.yesterday');

        return formatDateOnly(dateStr);
    }

        function handleSubtaskConfirm(task, subtaskChanges, msgIndex) {
        let newSubtasks = [...(task.subtasks || [])];
        
        for (const change of subtaskChanges) {
            if (change.action === 'add') {
                newSubtasks.push({ title: change.new_title, status: 'todo' });
            } else if (change.action === 'delete') {
                newSubtasks = newSubtasks.filter(s => s.title !== change.old_title);
            } else if (change.action === 'update') {
                newSubtasks = newSubtasks.map(s => 
                    s.title === change.old_title 
                        ? { ...s, title: change.new_title }
                        : s
                );
            } else if (change.action === 'toggle') {
                newSubtasks = newSubtasks.map(s => 
                    s.title === change.old_title 
                        ? { ...s, status: s.status === 'done' ? 'todo' : 'done' }
                        : s
                );
            }
        }
        
        updateScopedItem(task.id, { subtasks: newSubtasks });
        
        chatHistory.update(h => {
            const newHistory = [...h];
            newHistory[msgIndex] = {
                role: 'assistant',
                type: 'text',
                content: t('ai_panel.subtask_completed_msg', { values: { title: task.title } })
            };
            return newHistory;
        });
        
        scrollToBottom();
    }

    $: if ($chatHistory.length) scrollToBottom();
    $: panelMeta = getPanelMeta();
    $: if ($aiPanelContext.draft && !$chatHistory.length) {
        inputText = $aiPanelContext.draft;
    }
    $: {
        inputText;
        syncComposerHeight();
    }
</script>

<div class="flex flex-col h-full bg-rose-50/30" data-ai-shell>
    <div class="h-16 border-b border-rose-100 flex items-center justify-between px-6 bg-white shrink-0">
        <h3 class="font-bold text-rose-600 flex items-center gap-2">
            <i class="ph-fill ph-sparkle"></i> {panelMeta.title}
        </h3>
        <div class="flex items-center gap-2">
            <button on:click={() => showAiSettings.set(true)}
                class="text-xs font-bold text-rose-500 hover:text-rose-700 px-2 py-1 rounded hover:bg-rose-100 flex items-center gap-1">
                <i class="ph ph-gear"></i> {$_('ai_panel.settings')}
            </button>
            <button on:click={() => showAiPanel.set(false)}
                class="text-xs font-bold text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100 flex items-center gap-1">
                <i class="ph-bold ph-arrow-u-up-left"></i> {$_('ai_panel.back')}
            </button>
        </div>
    </div>

    <div
        bind:this={chatContainer}
        class="flex-1 overflow-y-auto p-3 md:p-4 space-y-3 md:space-y-4 scroll-smooth overscroll-contain"
    >
        <div class="flex gap-2 md:gap-3">
            <div
                class="w-7 h-7 md:w-8 md:h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 shrink-0"
            >
                <i class="ph-fill ph-robot text-sm md:text-base"></i>
            </div>
            <div
                class="bg-white border border-rose-100 p-2.5 md:p-3 rounded-2xl rounded-tl-none text-xs md:text-sm text-slate-700 shadow-sm max-w-[85%]"
            >
                <div class="font-bold text-rose-600 mb-1">{panelMeta.introTitle}</div>
                <div class="text-slate-600 space-y-1">
                    {#if $aiPanelContext.description}
                        <div class="text-slate-500 leading-6">{$aiPanelContext.description}</div>
                    {/if}
                    {#each panelMeta.introLines as line}
                        <div>{line}</div>
                    {/each}
                </div>
            </div>
        </div>

        {#each $chatHistory as msg, index}
            <div
                class="flex gap-2 md:gap-3"
                class:flex-row-reverse={msg.role === "user"}
            >
                <div
                    class="w-7 h-7 md:w-8 md:h-8 rounded-full shrink-0 flex items-center justify-center"
                    class:bg-blue-100={msg.role === "user"}
                    class:text-blue-600={msg.role === "user"}
                    class:bg-rose-100={msg.role !== "user"}
                    class:text-rose-600={msg.role !== "user"}
                >
                    <i
                        class={msg.role === "user"
                            ? "ph-fill ph-user text-sm md:text-base"
                            : "ph-fill ph-robot text-sm md:text-base"}
                    ></i>
                </div>

                <div
                    class="p-2.5 md:p-3 rounded-2xl text-xs md:text-sm shadow-sm max-w-[85%]"
                    class:bg-blue-600={msg.role === "user"}
                    class:text-white={msg.role === "user"}
                    class:rounded-tr-none={msg.role === "user"}
                    class:bg-white={msg.role !== "user" && msg.type !== "error"}
                    class:border={msg.role !== "user"}
                    class:border-rose-100={msg.role !== "user" &&
                        msg.type !== "error"}
                    class:text-slate-700={msg.role !== "user" &&
                        msg.type !== "error"}
                    class:rounded-tl-none={msg.role !== "user"}
                    class:bg-red-50={msg.type === "error"}
                    class:border-red-200={msg.type === "error"}
                    class:text-red-700={msg.type === "error"}
                >
                    {#if msg.type === "text"}
                        <div class="whitespace-pre-wrap">{msg.content}</div>
                    {:else if msg.type === "loading"}
                        <div class="flex items-center gap-2 py-1">
                            <div class="flex gap-1">
                                <div
                                    class="w-2 h-2 bg-rose-400 rounded-full animate-bounce"
                                    style="animation-delay: 0ms"
                                ></div>
                                <div
                                    class="w-2 h-2 bg-rose-400 rounded-full animate-bounce"
                                    style="animation-delay: 150ms"
                                ></div>
                                <div
                                    class="w-2 h-2 bg-rose-400 rounded-full animate-bounce"
                                    style="animation-delay: 300ms"
                                ></div>
                            </div>
                            <span class="text-[10px] text-slate-400"
                                >{$_('ai_panel.analyzing')}</span
                            >
                        </div>
                    {:else if msg.type === "error"}
                        <div class="flex flex-col gap-2">
                            <div class="flex items-center gap-2">
                                <i class="ph-fill ph-warning-circle"></i>
                                <span>{$_('ai_panel.error_prefix')}: {msg.content}</span>
                            </div>
                            <button
                                on:click={() => handleRetry(index)}
                                class="self-start px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 flex items-center gap-1 transition"
                            >
                                <i class="ph ph-arrow-clockwise"></i> {$_('ai_panel.retry')}
                            </button>
                        </div>
                    {:else if msg.type === "file_confirm"}
                        <div class="mt-1">
                            <div class="mb-2 font-bold text-fuchsia-600 text-xs md:text-sm flex items-center gap-1">
                                <i class="ph ph-folder-open"></i>
                                {msg.message}
                            </div>
                            <div class="bg-fuchsia-50 border border-fuchsia-200 rounded-xl p-3 mb-3 text-left">
                                <div class="text-[10px] uppercase tracking-[0.16em] font-bold text-fuchsia-500">
                                    {msg.operation.operation}
                                </div>
                                <div class="mt-1 text-xs font-mono break-all text-slate-700">
                                    {msg.operation.path}
                                </div>
                                {#if msg.operation.root}
                                    <div class="mt-2 text-[10px] text-slate-500 break-all">
                                        root: {msg.operation.root}
                                    </div>
                                {/if}
                                {#if msg.operation.query}
                                    <div class="mt-1 text-[10px] text-slate-500">
                                        query: {msg.operation.query}
                                    </div>
                                {/if}
                                {#if msg.operation.content}
                                    <pre class="mt-3 text-[10px] leading-6 rounded-lg bg-white border border-fuchsia-100 p-3 overflow-x-auto text-slate-600"><code>{msg.operation.content.slice(0, 400)}{msg.operation.content.length > 400 ? '\n...' : ''}</code></pre>
                                {/if}
                            </div>
                            <div class="flex gap-2">
                                <button
                                    on:click={() => confirmLocalFileOperation(index, msg.operation)}
                                    class="flex-1 bg-fuchsia-600 text-white py-1.5 rounded-lg font-bold text-xs hover:bg-fuchsia-700 flex items-center justify-center gap-1"
                                >
                                    <i class="ph ph-check"></i> {$_('common.confirm')}
                                </button>
                                <button
                                    on:click={() => removeAiMessage(index)}
                                    class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                >
                                    {$_('common.cancel')}
                                </button>
                            </div>
                        </div>
                    {:else if msg.type === "task_card"}
                        <div class="mt-1">
                            <div
                                class="mb-2 font-bold text-rose-600 text-xs md:text-sm flex items-center gap-1"
                            >
                                <i class="ph ph-plus-circle"></i> {$_('ai_panel.confirm_add')}
                            </div>
                            <div
                                class="bg-slate-50 border border-slate-200 rounded-xl p-2.5 md:p-3 mb-3 text-left"
                            >
                                <div
                                    class="font-bold text-slate-800 text-sm md:text-base mb-1.5"
                                >
                                    {msg.data.title}
                                </div>
                                <div
                                    class="text-[10px] md:text-xs text-slate-500 space-y-1"
                                >
                                    <div class="flex items-center gap-1.5">
                                        <i class="ph ph-calendar"></i>
                                        <span
                                            >{getRelativeDate(msg.data.date)}
                                            {formatTimeOnly(
                                                msg.data.date,
                                            )}</span
                                        >
                                        {#if msg.data.deadline}
                                            <span class="text-slate-300">→</span
                                            >
                                            <span class="text-orange-500"
                                                >{$_('ai_panel.deadline')} {formatTimeOnly(
                                                    msg.data.deadline,
                                                )}</span
                                            >
                                        {/if}
                                    </div>
                                    <div class="flex items-center gap-2">
                                        <span
                                            class={getPriorityColor(
                                                msg.data.priority,
                                            )}
                                        >
                                            <i class="ph-fill ph-flag"></i>
                                            {formatPriority(msg.data.priority)}
                                        </span>
                                    </div>
                                </div>
                                {#if msg.data.subtasks && msg.data.subtasks.length > 0}
                                    <div
                                        class="mt-2 pt-2 border-t border-slate-200"
                                    >
                                        <div
                                            class="text-[10px] text-slate-400 mb-1 font-bold"
                                        >
                                            {$_('ai_panel.subtasks')} ({msg.data.subtasks.length})
                                        </div>
                                        <ul class="space-y-0.5">
                                            {#each msg.data.subtasks as sub}
                                                <li
                                                    class="text-[10px] md:text-xs text-slate-600 flex items-center gap-1"
                                                >
                                                    <i
                                                        class="ph ph-circle text-slate-300 text-[8px]"
                                                    ></i>
                                                    {sub.title || sub}
                                                </li>
                                            {/each}
                                        </ul>
                                    </div>
                                {/if}
                                {#if msg.data.note}
                                    <div
                                        class="mt-2 pt-2 border-t border-slate-200 text-[10px] text-slate-500"
                                    >
                                        {msg.data.note}
                                    </div>
                                {/if}
                            </div>
                            <div class="flex gap-2">
                                <button
                                    on:click={() =>
                                        handleConfirmTask(msg.data, index)}
                                    class="flex-1 bg-rose-600 text-white py-1.5 rounded-lg font-bold text-xs hover:bg-rose-700 shadow-sm disabled:opacity-50 flex items-center justify-center gap-1"
                                    disabled={msg.confirmed}
                                >
                                    {#if msg.confirmed}
                                        <i class="ph-bold ph-check"></i> {$_('ai_panel.added')}
                                    {:else}
                                        <i class="ph ph-plus"></i> {$_('ai_panel.confirm_btn')}
                                    {/if}
                                </button>
                                {#if !msg.confirmed}
                                    <button
                                        on:click={() => removeAiMessage(index)}
                                        class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                    >
                                        {$_('common.cancel')}
                                    </button>
                                {/if}
                            </div>
                        </div>
                    {:else if msg.type === "multi_task_card"}
                        <div class="mt-1">
                            <div
                                class="mb-2 font-bold text-rose-600 text-xs md:text-sm flex items-center gap-1"
                            >
                                <i class="ph ph-list-plus"></i> {$_('ai_panel.found_tasks', { values: { count: msg
                                    .tasks.length } })}
                            </div>
                            <div
                                class="space-y-2 mb-3 max-h-64 overflow-y-auto"
                            >
                                {#each msg.tasks as task, taskIndex}
                                    {@const isConfirmed =
                                        msg.confirmedIndexes &&
                                        msg.confirmedIndexes.includes(
                                            taskIndex,
                                        )}
                                    <div
                                        class="bg-slate-50 border border-slate-200 rounded-lg p-2 text-left transition-all"
                                        class:opacity-50={isConfirmed}
                                        class:bg-green-50={isConfirmed}
                                        class:border-green-200={isConfirmed}
                                    >
                                        <div
                                            class="flex justify-between items-start gap-2"
                                        >
                                            <div class="flex-1 min-w-0">
                                                <div
                                                    class="font-bold text-slate-800 text-xs md:text-sm truncate"
                                                >
                                                    {task.title}
                                                </div>
                                                <div
                                                    class="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5"
                                                >
                                                    <i class="ph ph-calendar"
                                                    ></i>
                                                    {getRelativeDate(task.date)}
                                                    {formatTimeOnly(task.date)}
                                                    {#if task.priority !== "normal"}
                                                        <span
                                                            class={getPriorityColor(
                                                                task.priority,
                                                            )}
                                                        >
                                                            [{formatPriority(
                                                                task.priority,
                                                            )}]
                                                        </span>
                                                    {/if}
                                                </div>
                                                {#if task.subtasks && task.subtasks.length > 0}
                                                    <div
                                                        class="text-[10px] text-slate-400 mt-0.5"
                                                    >
                                                        {$_('ai_panel.contains_subtasks', { values: { count: task.subtasks.length } })}
                                                    </div>
                                                {/if}
                                            </div>
                                            <button
                                                on:click={() =>
                                                    handleConfirmMultiTask(
                                                        index,
                                                        taskIndex,
                                                        task,
                                                    )}
                                                class="px-2 py-1 rounded text-[10px] font-bold shrink-0 transition-all text-white"
                                                class:bg-green-600={isConfirmed}
                                                class:bg-rose-600={!isConfirmed}
                                                class:hover:bg-rose-700={!isConfirmed}
                                                disabled={isConfirmed}
                                            >
                                                {isConfirmed
                                                    ? $_('ai_panel.added')
                                                    : $_('ai_panel.add_action')}
                                            </button>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                            {#if !msg.confirmedIndexes || msg.confirmedIndexes.length < msg.tasks.length}
                                <div class="flex gap-2">
                                    <button
                                        on:click={() =>
                                            handleConfirmAllTasks(
                                                index,
                                                msg.tasks,
                                                msg.confirmedIndexes || [],
                                            )}
                                        class="flex-1 bg-rose-600 text-white py-1.5 rounded-lg font-bold text-xs hover:bg-rose-700 shadow-sm flex items-center justify-center gap-1"
                                    >
                                        <i class="ph ph-checks"></i> {$_('ai_panel.add_all')} ({msg
                                            .tasks.length -
                                            (msg.confirmedIndexes?.length ||
                                                0)})
                                    </button>
                                    <button
                                        on:click={() => removeAiMessage(index)}
                                        class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                    >
                                        {$_('common.cancel')}
                                    </button>
                                </div>
                            {:else}
                                <div
                                    class="text-center text-[10px] text-green-600 font-bold py-1"
                                >
                                    {$_('ai_panel.all_added')}
                                </div>
                            {/if}
                        </div>
                    {:else if msg.type === "delete_confirm"}
                        <div class="mt-1">
                            <div
                                class="mb-2 font-bold text-red-600 text-xs md:text-sm flex items-center gap-1"
                            >
                                <i class="ph ph-trash"></i>
                                {msg.message}
                            </div>
                            {#if msg.reason}
                                <div class="text-[10px] text-slate-500 mb-2">
                                    {msg.reason}
                                </div>
                            {/if}
                            <div
                                class="space-y-1.5 mb-3 max-h-48 overflow-y-auto"
                            >
                                {#each msg.tasks as task}
                                    <div
                                        class="bg-red-50 border border-red-200 rounded-lg p-2 text-left"
                                    >
                                        <div
                                            class="font-bold text-slate-800 text-xs"
                                        >
                                            {task.title}
                                        </div>
                                        <div
                                            class="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5"
                                        >
                                            <span
                                                >{getRelativeDate(task.date)}
                                                {formatTimeOnly(
                                                    task.date,
                                                )}</span
                                            >
                                            <span
                                                class={getStatusBgColor(
                                                    task.status,
                                                ) + " px-1 rounded"}
                                                >{formatStatus(
                                                    task.status,
                                                )}</span
                                            >
                                        </div>
                                    </div>
                                {/each}
                            </div>
                            <div class="flex gap-2">
                                <button
                                    on:click={() =>
                                        handleDeleteConfirm(msg.tasks, index)}
                                    class="flex-1 bg-red-600 text-white py-1.5 rounded-lg font-bold text-xs hover:bg-red-700 flex items-center justify-center gap-1"
                                >
                                    <i class="ph ph-trash"></i> {$_('ai_panel.confirm_delete')} ({msg
                                        .tasks.length})
                                </button>
                                <button
                                    on:click={() => removeAiMessage(index)}
                                    class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                >
                                    {$_('common.cancel')}
                                </button>
                            </div>
                        </div>
                    {:else if msg.type === "update_confirm"}
                        <div class="mt-1">
                            <div class="mb-2 font-bold text-amber-600 text-xs md:text-sm flex items-center gap-1">
                                <i class="ph ph-pencil-simple"></i>
                                {msg.message}
                            </div>
                            <div class="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3 text-left">
                                <div class="font-bold text-slate-800 text-xs mb-2">
                                    {msg.task.title}
                                </div>
                                <div class="text-[10px] space-y-1">
                                    {#if msg.updates.title}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">{$_('ai_panel.title_label')}</span>
                                            <span class="text-slate-400 line-through">{msg.task.title}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{msg.updates.title}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.date}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">{$_('ai_panel.time_label')}</span>
                                            <span class="text-slate-400">{getRelativeDate(msg.task.date)} {formatTimeOnly(msg.task.date)}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{getRelativeDate(msg.updates.date)} {formatTimeOnly(msg.updates.date)}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.priority && msg.updates.priority !== msg.task.priority}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">{$_('ai_panel.priority_label')}</span>
                                            <span class="text-slate-400">{formatPriority(msg.task.priority)}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{formatPriority(msg.updates.priority)}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.status && msg.updates.status !== msg.task.status}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">{$_('ai_panel.status_label')}</span>
                                            <span class="text-slate-400">{formatStatus(msg.task.status)}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{formatStatus(msg.updates.status)}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.deadline}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">{$_('ai_panel.deadline')}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{formatDateTime(msg.updates.deadline)}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.note !== undefined}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">{$_('ai_panel.note_label')}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{msg.updates.note || $_('ai_panel.clear_note')}</span>
                                        </div>
                                    {/if}
                                </div>
                            </div>
                            <div class="flex gap-2">
                                <button
                                    on:click={() => handleUpdateConfirm(msg.task, msg.updates, index)}
                                    class="flex-1 bg-amber-500 text-white py-1.5 rounded-lg font-bold text-xs hover:bg-amber-600 flex items-center justify-center gap-1"
                                >
                                    <i class="ph ph-check"></i> {$_('ai_panel.confirm_modify')}
                                </button>
                                <button
                                    on:click={() => removeAiMessage(index)}
                                    class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                >
                                    {$_('common.cancel')}
                                </button>
                            </div>
                        </div>
                    {:else if msg.type === 'update_confirm'}
                        <div class="mt-1">
                            <div class="mb-2 font-bold text-amber-600 text-xs md:text-sm flex items-center gap-1">
                                <i class="ph ph-pencil-simple"></i> {msg.message}
                            </div>
                            <div class="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3 text-left">
                                <div class="font-bold text-slate-800 text-xs mb-2">{$_('ai_panel.original_task')}: {msg.task.title}</div>
                                <div class="text-[10px] space-y-1">
                                    {#if msg.updates.title}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">{$_('ai_panel.title_label')}</span>
                                            <span class="text-slate-400 line-through">{msg.task.title}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{msg.updates.title}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.date}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">{$_('ai_panel.time_label')}</span>
                                            <span class="text-slate-400">{getRelativeDate(msg.task.date)} {formatTimeOnly(msg.task.date)}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{getRelativeDate(msg.updates.date)} {formatTimeOnly(msg.updates.date)}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.priority && msg.updates.priority !== msg.task.priority}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">{$_('ai_panel.priority_label')}</span>
                                            <span class="text-slate-400">{formatPriority(msg.task.priority)}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{formatPriority(msg.updates.priority)}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.deadline}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">{$_('ai_panel.deadline')}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{formatDateTime(msg.updates.deadline)}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.note !== undefined}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">{$_('ai_panel.note_label')}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{msg.updates.note || $_('ai_panel.clear_note')}</span>
                                        </div>
                                    {/if}
                                </div>
                            </div>
                            <div class="flex gap-2">
                                <button on:click={() => handleUpdateConfirm(msg.task, msg.updates, index)}
                                    class="flex-1 bg-amber-500 text-white py-1.5 rounded-lg font-bold text-xs hover:bg-amber-600 flex items-center justify-center gap-1">
                                    <i class="ph ph-check"></i> {$_('ai_panel.confirm_modify')}
                                </button>
                                <button on:click={() => removeAiMessage(index)}
                                    class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200">
                                    {$_('common.cancel')}
                                </button>
                            </div>
                        </div>
                    {:else if msg.type === "multi_update_confirm"}
                        <div class="mt-1">
                            <div class="mb-2 font-bold text-amber-600 text-xs md:text-sm flex items-center gap-1">
                                <i class="ph ph-pencil-simple"></i>
                                {msg.message}
                            </div>
                            <div class="space-y-1.5 mb-3 max-h-48 overflow-y-auto">
                                {#each msg.operations as op}
                                    <div class="bg-amber-50 border border-amber-200 rounded-lg p-2 text-left">
                                        <div class="font-bold text-slate-800 text-xs">{op.task.title}</div>
                                        <div class="text-[10px] text-amber-700 mt-0.5">
                                            {#if op.updates.date}
                                                {$_('ai_panel.time_label')} → {getRelativeDate(op.updates.date)} {formatTimeOnly(op.updates.date)}
                                            {/if}
                                            {#if op.updates.title}
                                                {$_('ai_panel.title_label')} → {op.updates.title}
                                            {/if}
                                            {#if op.updates.priority}
                                                {$_('ai_panel.priority_label')} → {formatPriority(op.updates.priority)}
                                            {/if}
                                            {#if op.updates.status}
                                                {$_('ai_panel.status_label')} → {formatStatus(op.updates.status)}
                                            {/if}
                                        </div>
                                    </div>
                                {/each}
                            </div>
                            <div class="flex gap-2">
                                <button
                                    on:click={() => handleMultiUpdateConfirm(msg.operations, index)}
                                    class="flex-1 bg-amber-500 text-white py-1.5 rounded-lg font-bold text-xs hover:bg-amber-600 flex items-center justify-center gap-1"
                                >
                                    <i class="ph ph-checks"></i> {$_('ai_panel.confirm_all_modify')} ({msg.operations.length})
                                </button>
                                <button
                                    on:click={() => removeAiMessage(index)}
                                    class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                >
                                    {$_('common.cancel')}
                                </button>
                            </div>
                        </div>
                    {:else if msg.type === "batch_complete_confirm"}
                        <div class="mt-1">
                            <div
                                class="mb-2 font-bold text-green-600 text-xs md:text-sm flex items-center gap-1"
                            >
                                <i class="ph ph-check-circle"></i>
                                {msg.message}
                            </div>
                            <div
                                class="space-y-1.5 mb-3 max-h-48 overflow-y-auto"
                            >
                                {#each msg.operations as op}
                                    <div
                                        class="bg-green-50 border border-green-200 rounded-lg p-2 text-left"
                                    >
                                        <div
                                            class="font-bold text-slate-800 text-xs"
                                        >
                                            {op.task.title}
                                        </div>
                                        <div class="text-[10px] text-slate-500">
                                            {getRelativeDate(op.task.date)}
                                            {formatTimeOnly(op.task.date)}
                                        </div>
                                    </div>
                                {/each}
                            </div>
                            <div class="flex gap-2">
                                <button
                                    on:click={() =>
                                        handleBatchCompleteConfirm(
                                            msg.operations,
                                            index,
                                        )}
                                    class="flex-1 bg-green-600 text-white py-1.5 rounded-lg font-bold text-xs hover:bg-green-700 flex items-center justify-center gap-1"
                                >
                                    <i class="ph ph-checks"></i> {$_('ai_panel.mark_complete')} ({msg
                                        .operations.length})
                                </button>
                                <button
                                    on:click={() => removeAiMessage(index)}
                                    class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                >
                                    {$_('common.cancel')}
                                </button>
                            </div>
                        </div>
                    {:else if msg.type === "mixed_confirm"}
                        <div class="mt-1">
                            <div
                                class="mb-2 font-bold text-purple-600 text-xs md:text-sm flex items-center gap-1"
                            >
                                <i class="ph ph-lightning"></i>
                                {msg.message}
                            </div>

                            {#if msg.updateOps && msg.updateOps.length > 0}
                                <div class="mb-2">
                                    <div
                                        class="text-[10px] text-amber-600 font-bold mb-1 flex items-center gap-1"
                                    >
                                        <i class="ph ph-pencil-simple"></i> {$_('ai_panel.modify_section')}
                                        ({msg.updateOps.length})
                                    </div>
                                    <div class="space-y-1">
                                        {#each msg.updateOps as op}
                                            <div
                                                class="bg-amber-50 border border-amber-200 rounded p-1.5 text-[10px]"
                                            >
                                                <span class="font-bold"
                                                    >{op.task.title}</span
                                                >
                                                {#if op.updates.date}
                                                    <span
                                                        class="text-amber-600"
                                                    >
                                                        → {getRelativeDate(
                                                            op.updates.date,
                                                        )}</span
                                                    >
                                                {/if}
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}

                            {#if msg.deleteOps && msg.deleteOps.length > 0}
                                <div class="mb-3">
                                    <div
                                        class="text-[10px] text-red-600 font-bold mb-1 flex items-center gap-1"
                                    >
                                        <i class="ph ph-trash"></i> {$_('ai_panel.delete_section')} ({msg
                                            .deleteOps.length})
                                    </div>
                                    <div class="space-y-1">
                                        {#each msg.deleteOps as task}
                                            <div
                                                class="bg-red-50 border border-red-200 rounded p-1.5 text-[10px]"
                                            >
                                                <span class="font-bold"
                                                    >{task.title}</span
                                                >
                                                <span
                                                    class="text-slate-400 ml-1"
                                                    >{getRelativeDate(
                                                        task.date,
                                                    )}</span
                                                >
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}

                            <div class="flex gap-2">
                                <button
                                    on:click={() =>
                                        handleMixedConfirm(
                                            msg.deleteOps,
                                            msg.updateOps,
                                            index,
                                        )}
                                    class="flex-1 bg-purple-600 text-white py-1.5 rounded-lg font-bold text-xs hover:bg-purple-700 flex items-center justify-center gap-1"
                                >
                                    <i class="ph ph-check"></i> {$_('ai_panel.confirm_execute')}
                                </button>
                                <button
                                    on:click={() => removeAiMessage(index)}
                                    class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                >
                                    {$_('common.cancel')}
                                </button>
                            </div>
                        </div>
                    {:else if msg.type === "query_result"}
                        <div class="mt-1">
                            <div
                                class="mb-2 font-bold text-blue-600 text-xs md:text-sm flex items-center gap-1"
                            >
                                <i class="ph ph-magnifying-glass"></i>
                                {msg.summary}
                            </div>
                            {#if msg.filterDescription}
                                <div class="text-[10px] text-slate-500 mb-2">
                                    {msg.filterDescription}
                                </div>
                            {/if}
                            <div class="space-y-1.5 max-h-64 overflow-y-auto">
                                {#each msg.tasks as task}
                                    <div
                                        class="bg-blue-50 border border-blue-200 rounded-lg p-2 text-left"
                                    >
                                        <div
                                            class="flex justify-between items-start"
                                        >
                                            <div class="flex-1 min-w-0">
                                                <div
                                                    class="font-bold text-slate-800 text-xs truncate"
                                                >
                                                    {task.title}
                                                </div>
                                                <div
                                                    class="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5 flex-wrap"
                                                >
                                                    <span
                                                        >{getRelativeDate(
                                                            task.date,
                                                        )}
                                                        {formatTimeOnly(
                                                            task.date,
                                                        )}</span
                                                    >
                                                    {#if task.priority !== "normal"}
                                                        <span
                                                            class={getPriorityColor(
                                                                task.priority,
                                                            )}
                                                            >[{formatPriority(
                                                                task.priority,
                                                            )}]</span
                                                        >
                                                    {/if}
                                                </div>
                                            </div>
                                            <span
                                                class="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 {getStatusBgColor(
                                                    task.status,
                                                )}"
                                            >
                                                {formatStatus(task.status)}
                                            </span>
                                        </div>
                                        {#if task.subtasks && task.subtasks.length > 0}
                                            <div
                                                class="mt-1 pt-1 border-t border-blue-200 text-[10px] text-slate-500"
                                            >
                                                {$_('ai_panel.subtask_progress', { values: { done: task.subtasks.filter(
                                                    (s) => s.status === "done",
                                                ).length, total: task.subtasks.length } })}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {:else if msg.type === "web_search_result"}
                        <div class="mt-1">
                            <div
                                class="mb-2 font-bold text-cyan-700 text-xs md:text-sm flex items-center gap-1"
                            >
                                <i class="ph ph-globe-hemisphere-west"></i>
                                {msg.message || '网页搜索结果'}
                            </div>
                            {#if msg.query}
                                <div class="text-[10px] text-cyan-700/80 mb-2">
                                    搜索词：{msg.query}
                                </div>
                            {/if}
                            {#if msg.summary}
                                <div class="bg-cyan-50 border border-cyan-200 rounded-lg p-2.5 text-[11px] text-slate-600 whitespace-pre-wrap leading-6 mb-3">
                                    {msg.summary}
                                </div>
                            {/if}
                            <div class="space-y-2 max-h-72 overflow-y-auto">
                                {#if msg.entries?.length}
                                    {#each msg.entries as entry, entryIndex}
                                        <div class="bg-white border border-cyan-100 rounded-lg p-2.5 text-left">
                                            <div class="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-500">
                                                {entry.source || 'Web'} #{entryIndex + 1}
                                            </div>
                                            <div class="mt-1 font-bold text-slate-800 text-xs break-words">
                                                {entry.title}
                                            </div>
                                            <div class="mt-1 text-[10px] text-slate-500 break-all">
                                                {entry.url}
                                            </div>
                                            {#if entry.snippet}
                                                <div class="mt-2 text-[10px] text-slate-600 leading-5">
                                                    {entry.snippet}
                                                </div>
                                            {/if}
                                            <div class="mt-2 flex justify-end">
                                                <button
                                                    on:click={() => openExternalUrl(entry.url)}
                                                    class="px-3 py-1.5 bg-cyan-600 text-white rounded-lg text-xs font-bold hover:bg-cyan-700 transition"
                                                >
                                                    打开
                                                </button>
                                            </div>
                                        </div>
                                    {/each}
                                {:else}
                                    <div class="bg-white border border-cyan-100 rounded-lg p-2.5 text-[10px] text-slate-500">
                                        未找到可用结果。
                                    </div>
                                {/if}
                            </div>
                        </div>
                                        {:else if msg.type === 'subtask_confirm'}
                        <div class="mt-1">
                            <div class="mb-2 font-bold text-purple-600 text-xs md:text-sm flex items-center gap-1">
                                <i class="ph ph-list-checks"></i>
                                {msg.message}
                            </div>
                            <div class="bg-purple-50 border border-purple-200 rounded-lg p-2.5 mb-3 text-left">
                                <div class="font-bold text-slate-800 text-xs mb-2">
                                    {$_('ai_panel.task_label')}: {msg.task.title}
                                </div>
                                <div class="text-[10px] space-y-1">
                                    {#each msg.subtaskChanges as change, idx}
                                        <div class="flex items-center gap-1 p-1 bg-white rounded border border-purple-100">
                                            {#if change.action === 'add'}
                                                <span class="text-green-600 font-bold">{$_('ai_panel.add_action')}:</span>
                                                <span class="text-slate-700">{change.new_title}</span>
                                            {:else if change.action === 'delete'}
                                                <span class="text-red-600 font-bold">{$_('ai_panel.delete_action')}:</span>
                                                <span class="text-slate-400 line-through">{change.old_title}</span>
                                            {:else if change.action === 'update'}
                                                <span class="text-amber-600 font-bold">{$_('ai_panel.update_action')}:</span>
                                                <span class="text-slate-400 line-through">{change.old_title}</span>
                                                <i class="ph ph-arrow-right text-purple-400"></i>
                                                <span class="text-slate-700">{change.new_title}</span>
                                            {:else if change.action === 'toggle'}
                                                <span class="text-blue-600 font-bold">{$_('ai_panel.toggle_action')}:</span>
                                                <span class="text-slate-700">{change.old_title}</span>
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            </div>
                            <div class="flex gap-2">
                                <button
                                    on:click={() => handleSubtaskConfirm(msg.task, msg.subtaskChanges, index)}
                                    class="flex-1 bg-purple-600 text-white py-1.5 rounded-lg font-bold text-xs hover:bg-purple-700 flex items-center justify-center gap-1"
                                    disabled={msg.confirmed}>
                                    {#if msg.confirmed}
                                        <i class="ph-bold ph-check"></i> {$_('ai_panel.executed')}
                                    {:else}
                                        <i class="ph ph-check"></i> {$_('ai_panel.confirm_execute')}
                                    {/if}
                                </button>
                                {#if !msg.confirmed}
                                    <button
                                        on:click={() => removeAiMessage(index)}
                                        class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200">
                                        {$_('common.cancel')}
                                    </button>
                                {/if}
                            </div>
                        </div>
                    {/if}
                </div>
            </div>
        {/each}
    </div>

    <div
        class="p-3 md:p-4 bg-white border-t border-rose-100 shrink-0 safe-bottom"
    >
        <div
            class="flex gap-2 items-end bg-slate-50 p-2 rounded-xl border border-rose-100 focus-within:border-rose-400 focus-within:ring-2 focus-within:ring-rose-50 transition-all"
        >
            <textarea
                bind:this={composerTextarea}
                bind:value={inputText}
                on:input={syncComposerHeight}
                on:keydown={(e) =>
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    (e.preventDefault(), handleSend())}
                rows="1"
                placeholder={panelMeta.placeholder}
                disabled={$isAiLoading}
                class="flex-1 min-h-[44px] bg-transparent border-none focus:ring-0 text-xs md:text-sm resize-none py-2 text-slate-700 outline-none disabled:opacity-50"
            ></textarea>
            <button
                on:click={handleSend}
                class="p-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 active:scale-95 transition-transform disabled:opacity-50"
                disabled={!inputText.trim() || $isAiLoading}
                aria-label={$_("common.send")}
            >
                <i class="ph-bold ph-paper-plane-right"></i>
            </button>
        </div>
        <div class="mt-1.5 flex justify-center gap-2 flex-wrap">
            {#each panelMeta.quickActions as action}
                <button
                    on:click={() => {
                        inputText = action.value;
                        handleSend();
                    }}
                    class="text-[10px] px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded transition"
                >
                    {action.label}
                </button>
            {/each}
        </div>
    </div>
</div>

<style>
    .safe-bottom {
        padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
    }
</style>
