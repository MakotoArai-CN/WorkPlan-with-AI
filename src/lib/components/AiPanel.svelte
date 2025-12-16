<script>
    import {
        chatHistory,
        isAiLoading,
        showAiPanel,
        showAiSettings,
        sendAiMessage,
        retryLastMessage,
        confirmAiTask,
        confirmMultiTask,
        confirmAllMultiTasks,
        markMessageProcessed,
        removeAiMessage,
        getCurrentProvider,
    } from "../stores/ai.js";
    import { taskStore } from "../stores/tasks.js";
    import { showAlert, showConfirm } from "../stores/modal.js";

    let inputText = "";
    let chatContainer;

    function scrollToBottom() {
        if (chatContainer) {
            setTimeout(() => {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }, 50);
        }
    }

    function getExistingTasks() {
        const state = $taskStore;
        return state.tasks || [];
    }

    async function handleSend() {
        if (!inputText.trim()) return;
        const text = inputText;
        inputText = "";
        try {
            await sendAiMessage(text, getExistingTasks());
            scrollToBottom();
        } catch (error) {
            await showAlert({
                title: "发送失败",
                message: error.message,
                variant: "danger",
            });
        }
    }

    async function handleRetry(index) {
        try {
            await retryLastMessage(index, getExistingTasks());
            scrollToBottom();
        } catch (error) {
            await showAlert({
                title: "重试失败",
                message: error.message,
                variant: "danger",
            });
        }
    }

    function handleConfirmTask(data, index) {
        const taskToAdd = {
            ...data,
            id: data.id || Date.now().toString(),
            status: "todo",
            subtasks: (data.subtasks || []).map((s) => ({
                title: typeof s === "string" ? s : s.title,
                status: "todo",
            })),
        };
        taskStore.addTask(taskToAdd);
        confirmAiTask(index);
        chatHistory.update((h) => [
            ...h,
            {
                role: "assistant",
                type: "text",
                content: `任务 "${data.title}" 已成功添加！`,
            },
        ]);
        scrollToBottom();
    }

    function handleConfirmMultiTask(msgIndex, taskIndex, task) {
        const taskToAdd = {
            ...task,
            id: task.id || (Date.now() + taskIndex).toString(),
            status: "todo",
            subtasks: (task.subtasks || []).map((s) => ({
                title: typeof s === "string" ? s : s.title,
                status: "todo",
            })),
        };
        taskStore.addTask(taskToAdd);
        confirmMultiTask(msgIndex, taskIndex);
        scrollToBottom();
    }

    function handleConfirmAllTasks(msgIndex, tasks, confirmedIndexes) {
        const unconfirmed = tasks.filter(
            (_, i) => !confirmedIndexes.includes(i),
        );
        unconfirmed.forEach((task, idx) => {
            const taskToAdd = {
                ...task,
                id: task.id || (Date.now() + idx).toString(),
                status: "todo",
                subtasks: (task.subtasks || []).map((s) => ({
                    title: typeof s === "string" ? s : s.title,
                    status: "todo",
                })),
            };
            taskStore.addTask(taskToAdd);
        });
        confirmAllMultiTasks(msgIndex);
        chatHistory.update((h) => [
            ...h,
            {
                role: "assistant",
                type: "text",
                content: `已添加 ${unconfirmed.length} 个任务！`,
            },
        ]);
        scrollToBottom();
    }

    async function handleDeleteConfirm(tasks, msgIndex) {
        const taskNames = tasks.map((t) => `• ${t.title}`).join("\n");
        const confirmed = await showConfirm({
            title: "确认删除",
            message: `确定要删除以下 ${tasks.length} 个任务吗？\n\n${taskNames}`,
            confirmText: "删除",
            cancelText: "取消",
            variant: "danger",
        });
        if (confirmed) {
            tasks.forEach((task) => {
                taskStore.deleteTask(task.id);
            });
            chatHistory.update((h) => {
                const newHistory = [...h];
                newHistory[msgIndex] = {
                    role: "assistant",
                    type: "text",
                    content: `🗑️ 已删除 ${tasks.length} 个任务：${tasks.map((t) => t.title).join("、")}`,
                };
                return newHistory;
            });
            scrollToBottom();
        }
    }

    async function handleUpdateConfirm(task, updates, msgIndex) {
        const updateDescriptions = [];
        if (updates.title) updateDescriptions.push(`标题 → "${updates.title}"`);
        if (updates.date)
            updateDescriptions.push(`时间 → ${formatDateTime(updates.date)}`);
        if (updates.deadline)
            updateDescriptions.push(
                `截止 → ${formatDateTime(updates.deadline)}`,
            );
        if (updates.priority)
            updateDescriptions.push(
                `优先级 → ${formatPriority(updates.priority)}`,
            );
        if (updates.note !== undefined)
            updateDescriptions.push(`备注 → "${updates.note}"`);
        if (updates.subtasks) updateDescriptions.push(`子任务已更新`);

        const confirmed = await showConfirm({
            title: "确认修改",
            message: `确定要修改任务 "${task.title}" 吗？\n\n修改内容：\n${updateDescriptions.join("\n")}`,
            confirmText: "确认修改",
            cancelText: "取消",
            variant: "warning",
        });
        if (confirmed) {
            taskStore.updateTask(task.id, updates);
            chatHistory.update((h) => {
                const newHistory = [...h];
                newHistory[msgIndex] = {
                    role: "assistant",
                    type: "text",
                    content: `✏️ 已修改任务 "${task.title}"：${updateDescriptions.join("，")}`,
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
                    updates.push(`标题→"${op.updates.title}"`);
                if (op.updates.date)
                    updates.push(
                        `时间→${formatDateTime(op.updates.date).split(" ")[0]}`,
                    );
                if (op.updates.priority)
                    updates.push(
                        `优先级→${formatPriority(op.updates.priority)}`,
                    );
                return `• ${op.task.title}: ${updates.join(", ") || "更新内容"}`;
            })
            .join("\n");

        const confirmed = await showConfirm({
            title: "确认批量修改",
            message: `确定要修改以下 ${operations.length} 个任务吗？\n\n${summaryLines}`,
            confirmText: "确认修改",
            cancelText: "取消",
            variant: "warning",
        });
        if (confirmed) {
            operations.forEach((op) => {
                taskStore.updateTask(op.task.id, op.updates);
            });
            chatHistory.update((h) => {
                const newHistory = [...h];
                newHistory[msgIndex] = {
                    role: "assistant",
                    type: "text",
                    content: `已修改 ${operations.length} 个任务`,
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
            title: "批量标记完成",
            message: `确定要将以下 ${operations.length} 个任务标记为完成吗？\n\n${taskNames}`,
            confirmText: "标记完成",
            cancelText: "取消",
            variant: "success",
        });

        if (confirmed) {
            operations.forEach((op) => {
                taskStore.updateTask(op.task.id, op.updates);
            });
            chatHistory.update((h) => {
                const newHistory = [...h];
                newHistory[msgIndex] = {
                    role: "assistant",
                    type: "text",
                    content: `已将 ${operations.length} 个任务标记为完成！`,
                };
                return newHistory;
            });
            scrollToBottom();
        }
    }

    async function handleMixedConfirm(deleteOps, updateOps, msgIndex) {
        let summaryLines = [];

        if (updateOps.length > 0) {
            summaryLines.push("【修改】");
            updateOps.forEach((op) => {
                const updates = [];
                if (op.updates.date)
                    updates.push(
                        `时间→${formatDateTime(op.updates.date).split(" ")[0]}`,
                    );
                if (op.updates.title)
                    updates.push(`标题→"${op.updates.title}"`);
                summaryLines.push(
                    `  • ${op.task.title}: ${updates.join(", ")}`,
                );
            });
        }

        if (deleteOps.length > 0) {
            summaryLines.push("【删除】");
            deleteOps.forEach((task) => {
                summaryLines.push(`  • ${task.title}`);
            });
        }

        const confirmed = await showConfirm({
            title: "确认操作",
            message: `确定要执行以下操作吗？\n\n${summaryLines.join("\n")}`,
            confirmText: "确认执行",
            cancelText: "取消",
            variant: "warning",
        });

        if (confirmed) {
            updateOps.forEach((op) => {
                taskStore.updateTask(op.task.id, op.updates);
            });
            deleteOps.forEach((task) => {
                taskStore.deleteTask(task.id);
            });

            const resultParts = [];
            if (updateOps.length > 0)
                resultParts.push(`修改了 ${updateOps.length} 个任务`);
            if (deleteOps.length > 0)
                resultParts.push(`删除了 ${deleteOps.length} 个任务`);

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
        const map = { normal: "普通", urgent: "紧急", critical: "特急" };
        return map[p] || "普通";
    }

    function formatStatus(s) {
        const map = { todo: "未开始", doing: "进行中", done: "已完成" };
        return map[s] || "未开始";
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

        if (date.getTime() === today.getTime()) return "今天";
        if (date.getTime() === tomorrow.getTime()) return "明天";
        if (date.getTime() === dayAfterTomorrow.getTime()) return "后天";
        if (date.getTime() === yesterday.getTime()) return "昨天";

        return formatDateOnly(dateStr);
    }

    $: if ($chatHistory.length) scrollToBottom();
</script>

<div class="flex flex-col h-full bg-rose-50/30">
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
                <div class="font-bold text-rose-600 mb-1">我是您的任务助手</div>
                <div class="text-slate-600 space-y-1">
                    <div>
                        <span class="text-slate-500">添加：</span
                        >"明天下午3点开会"
                    </div>
                    <div>
                        <span class="text-slate-500">删除：</span
                        >"删除明天的会议任务"
                    </div>
                    <div>
                        <span class="text-slate-500">修改：</span
                        >"把会议改到后天"
                    </div>
                    <div>
                        <span class="text-slate-500">查询：</span
                        >"本周有什么任务"
                    </div>
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
                                >正在分析您的需求...</span
                            >
                        </div>
                    {:else if msg.type === "error"}
                        <div class="flex flex-col gap-2">
                            <div class="flex items-center gap-2">
                                <i class="ph-fill ph-warning-circle"></i>
                                <span>出错了: {msg.content}</span>
                            </div>
                            <button
                                on:click={() => handleRetry(index)}
                                class="self-start px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 flex items-center gap-1 transition"
                            >
                                <i class="ph ph-arrow-clockwise"></i> 重试
                            </button>
                        </div>
                    {:else if msg.type === "task_card"}
                        <div class="mt-1">
                            <div
                                class="mb-2 font-bold text-rose-600 text-xs md:text-sm flex items-center gap-1"
                            >
                                <i class="ph ph-plus-circle"></i> 确认添加此任务？
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
                                                >截止 {formatTimeOnly(
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
                                            子任务 ({msg.data.subtasks.length})
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
                                        <i class="ph-bold ph-check"></i> 已添加
                                    {:else}
                                        <i class="ph ph-plus"></i> 确认添加
                                    {/if}
                                </button>
                                {#if !msg.confirmed}
                                    <button
                                        on:click={() => removeAiMessage(index)}
                                        class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                    >
                                        取消
                                    </button>
                                {/if}
                            </div>
                        </div>
                    {:else if msg.type === "multi_task_card"}
                        <div class="mt-1">
                            <div
                                class="mb-2 font-bold text-rose-600 text-xs md:text-sm flex items-center gap-1"
                            >
                                <i class="ph ph-list-plus"></i> 识别到 {msg
                                    .tasks.length} 个任务
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
                                                        含 {task.subtasks
                                                            .length} 个子任务
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
                                                    ? "已添加"
                                                    : "+ 添加"}
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
                                        <i class="ph ph-checks"></i> 全部添加 ({msg
                                            .tasks.length -
                                            (msg.confirmedIndexes?.length ||
                                                0)})
                                    </button>
                                    <button
                                        on:click={() => removeAiMessage(index)}
                                        class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                    >
                                        取消
                                    </button>
                                </div>
                            {:else}
                                <div
                                    class="text-center text-[10px] text-green-600 font-bold py-1"
                                >
                                    所有任务已添加完成
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
                                    <i class="ph ph-trash"></i> 确认删除 ({msg
                                        .tasks.length})
                                </button>
                                <button
                                    on:click={() => removeAiMessage(index)}
                                    class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                >
                                    取消
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
                                            <span class="text-slate-400 w-12">标题</span>
                                            <span class="text-slate-400 line-through">{msg.task.title}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{msg.updates.title}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.date}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">时间</span>
                                            <span class="text-slate-400">{getRelativeDate(msg.task.date)} {formatTimeOnly(msg.task.date)}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{getRelativeDate(msg.updates.date)} {formatTimeOnly(msg.updates.date)}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.priority && msg.updates.priority !== msg.task.priority}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">优先级</span>
                                            <span class="text-slate-400">{formatPriority(msg.task.priority)}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{formatPriority(msg.updates.priority)}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.status && msg.updates.status !== msg.task.status}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">状态</span>
                                            <span class="text-slate-400">{formatStatus(msg.task.status)}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{formatStatus(msg.updates.status)}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.deadline}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">截止</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{formatDateTime(msg.updates.deadline)}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.note !== undefined}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">备注</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{msg.updates.note || "(清空)"}</span>
                                        </div>
                                    {/if}
                                </div>
                            </div>
                            <div class="flex gap-2">
                                <button
                                    on:click={() => handleUpdateConfirm(msg.task, msg.updates, index)}
                                    class="flex-1 bg-amber-500 text-white py-1.5 rounded-lg font-bold text-xs hover:bg-amber-600 flex items-center justify-center gap-1"
                                >
                                    <i class="ph ph-check"></i> 确认修改
                                </button>
                                <button
                                    on:click={() => removeAiMessage(index)}
                                    class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                >
                                    取消
                                </button>
                            </div>
                        </div>
                    {:else if msg.type === 'update_confirm'}
                        <div class="mt-1">
                            <div class="mb-2 font-bold text-amber-600 text-xs md:text-sm flex items-center gap-1">
                                <i class="ph ph-pencil-simple"></i> {msg.message}
                            </div>
                            <div class="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3 text-left">
                                <div class="font-bold text-slate-800 text-xs mb-2">原任务: {msg.task.title}</div>
                                <div class="text-[10px] space-y-1">
                                    {#if msg.updates.title}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">标题</span>
                                            <span class="text-slate-400 line-through">{msg.task.title}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{msg.updates.title}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.date}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">时间</span>
                                            <span class="text-slate-400">{getRelativeDate(msg.task.date)} {formatTimeOnly(msg.task.date)}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{getRelativeDate(msg.updates.date)} {formatTimeOnly(msg.updates.date)}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.priority && msg.updates.priority !== msg.task.priority}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">优先级</span>
                                            <span class="text-slate-400">{formatPriority(msg.task.priority)}</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{formatPriority(msg.updates.priority)}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.deadline}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">截止</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{formatDateTime(msg.updates.deadline)}</span>
                                        </div>
                                    {/if}
                                    {#if msg.updates.note !== undefined}
                                        <div class="flex items-center gap-1">
                                            <span class="text-slate-400 w-12">备注</span>
                                            <i class="ph ph-arrow-right text-amber-500"></i>
                                            <span class="text-amber-700 font-bold">{msg.updates.note || '(清空)'}</span>
                                        </div>
                                    {/if}
                                </div>
                            </div>
                            <div class="flex gap-2">
                                <button on:click={() => handleUpdateConfirm(msg.task, msg.updates, index)}
                                    class="flex-1 bg-amber-500 text-white py-1.5 rounded-lg font-bold text-xs hover:bg-amber-600 flex items-center justify-center gap-1">
                                    <i class="ph ph-check"></i> 确认修改
                                </button>
                                <button on:click={() => removeAiMessage(index)}
                                    class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200">
                                    取消
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
                                                时间 → {getRelativeDate(op.updates.date)} {formatTimeOnly(op.updates.date)}
                                            {/if}
                                            {#if op.updates.title}
                                                标题 → {op.updates.title}
                                            {/if}
                                            {#if op.updates.priority}
                                                优先级 → {formatPriority(op.updates.priority)}
                                            {/if}
                                            {#if op.updates.status}
                                                状态 → {formatStatus(op.updates.status)}
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
                                    <i class="ph ph-checks"></i> 确认全部修改 ({msg.operations.length})
                                </button>
                                <button
                                    on:click={() => removeAiMessage(index)}
                                    class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                >
                                    取消
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
                                    <i class="ph ph-checks"></i> 标记完成 ({msg
                                        .operations.length})
                                </button>
                                <button
                                    on:click={() => removeAiMessage(index)}
                                    class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                >
                                    取消
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
                                        <i class="ph ph-pencil-simple"></i> 修改
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
                                        <i class="ph ph-trash"></i> 删除 ({msg
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
                                    <i class="ph ph-check"></i> 确认执行
                                </button>
                                <button
                                    on:click={() => removeAiMessage(index)}
                                    class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200"
                                >
                                    取消
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
                                                子任务: {task.subtasks.filter(
                                                    (s) => s.status === "done",
                                                ).length}/{task.subtasks.length}
                                                完成
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
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
                bind:value={inputText}
                on:keydown={(e) =>
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    (e.preventDefault(), handleSend())}
                rows="1"
                placeholder="描述您的需求..."
                disabled={$isAiLoading}
                class="flex-1 bg-transparent border-none focus:ring-0 text-xs md:text-sm resize-none max-h-20 md:max-h-24 py-2 text-slate-700 outline-none disabled:opacity-50"
            ></textarea>
            <button
                on:click={handleSend}
                class="p-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 active:scale-95 transition-transform disabled:opacity-50"
                disabled={!inputText.trim() || $isAiLoading}
            >
                <i class="ph-bold ph-paper-plane-right"></i>
            </button>
        </div>
        <div class="mt-1.5 flex justify-center gap-2 flex-wrap">
            <button
                on:click={() => {
                    inputText = "查询今天有什么任务";
                    handleSend();
                }}
                class="text-[10px] px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded transition"
            >
                今天任务
            </button>
            <button
                on:click={() => {
                    inputText = "查询本周有什么任务";
                    handleSend();
                }}
                class="text-[10px] px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded transition"
            >
                本周任务
            </button>
            <button
                on:click={() => {
                    inputText = "查询明天有什么任务";
                    handleSend();
                }}
                class="text-[10px] px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded transition"
            >
                明天任务
            </button>
        </div>
    </div>
</div>

<style>
    .safe-bottom {
        padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
    }
</style>
