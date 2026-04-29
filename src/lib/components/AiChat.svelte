<script>
    import { onMount, tick } from "svelte";
    import {
        aiChatHistory,
        aiChatSessions,
        activeAiChatSessionId,
        aiChatDraft,
        aiChatComposerAttachments,
        aiChatContext,
        aiChatCapabilities,
        isAiLoading,
        showAiSettings,
        sendChatMessage,
        retryChatMessage,
        retryFromAssistantMessage,
        editAndResend,
        rollbackMessage,
        exportChatToMarkdown,
        confirmAiChatLocalFileOperation,
        clearAiChatHistory,
        createAiChatSession,
        selectAiChatSession,
        deleteAiChatSession,
        attachFilesToAiChatComposer,
        attachMediaToAiChatComposer,
        removeAiChatComposerAttachment,
        clearAiChatDraft,
        saveAiChatHistory,
        probeAiCapabilities,
        stopStreaming,
    } from "../stores/ai.js";
    import { showConfirm, showToast } from "../stores/modal.js";
    import { taskStore } from "../stores/tasks.js";
    import {
        popNavigation,
        getNavigationDepth,
    } from "../stores/navigation.js";
    import { openExternalUrl } from "../utils/open-external.js";
    import { resizeTextarea } from "../utils/textarea-autosize.js";
    import { exportToMarkdown } from "../utils/export.js";
    import MarkdownRenderer from "./MarkdownRenderer.svelte";
    import { _ } from "svelte-i18n";
    import { get } from "svelte/store";

    export let onBack = null;

    let inputText = "";
    let chatContainer;
    let composerTextarea;
    let chatStyle = "default";
    let showSessionDrawer = false;
    let previousSessionId = null;

    $: currentSession =
        $aiChatSessions.find((session) => session.id === $activeAiChatSessionId) ||
        $aiChatSessions[0] ||
        null;
    $: if ($aiChatDraft && !inputText) {
        inputText = $aiChatDraft;
    }

    $: chatStyles = [
        {
            id: "default",
            name: $_("ai_chat.chat_style_default"),
            icon: "ph-chat-circle",
            color: "blue",
        },
        {
            id: "fun",
            name: $_("ai_chat.chat_style_fun"),
            icon: "ph-smiley",
            color: "yellow",
        },
        {
            id: "professional",
            name: $_("ai_chat.chat_style_pro"),
            icon: "ph-briefcase",
            color: "slate",
        },
        {
            id: "concise",
            name: $_("ai_chat.chat_style_concise"),
            icon: "ph-lightning",
            color: "green",
        },
        {
            id: "teacher",
            name: $_("ai_chat.chat_style_teacher"),
            icon: "ph-chalkboard-teacher",
            color: "orange",
        },
    ];

    $: capabilityBadges = [
        {
            id: "project",
            label: $_("ai_chat.capability_project_tools"),
            active: $aiChatCapabilities.projectToolsAvailable,
            icon: $aiChatCapabilities.projectToolsAvailable ? "ph-check-circle" : "ph-chat-circle",
            runtime: $aiChatCapabilities.probed ? $aiChatCapabilities.toolCallRuntimeAvailable : null,
        },
        {
            id: "files",
            label: $_("ai_chat.capability_local_files"),
            active: $aiChatCapabilities.localFilesAvailable,
            icon: $aiChatCapabilities.localFilesAvailable ? "ph-folder-open" : "ph-folder-simple",
            runtime: $aiChatCapabilities.probed ? $aiChatCapabilities.localFilesAvailable : null,
        },
        {
            id: "search",
            label: $_("ai_chat.capability_web_search"),
            active: $aiChatCapabilities.webSearchAvailable,
            icon: $aiChatCapabilities.webSearchAvailable ? "ph-globe" : "ph-globe-hemisphere-west",
            runtime: $aiChatCapabilities.probed ? $aiChatCapabilities.webSearchAvailable : null,
        },
    ];

    let isProbing = false;
    async function handleProbeCapabilities() {
        if (isProbing) return;
        isProbing = true;
        try {
            await probeAiCapabilities();
        } catch (e) {
            console.error('Probe failed:', e);
        } finally {
            isProbing = false;
        }
    }

    async function scrollToBottom() {
        await tick();
        if (!chatContainer) {
            return;
        }

        requestAnimationFrame(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        });
    }

    async function syncComposerHeight() {
        await tick();
        resizeTextarea(composerTextarea, 0.5);
    }

    function handleBack() {
        if (onBack) {
            onBack();
        } else {
            const depth = getNavigationDepth();
            if (depth > 1) {
                popNavigation();
            }
        }
    }

    function formatAttachmentSize(size = 0) {
        if (!size) return "0 B";
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    async function handleAttachFiles() {
        if ($isAiLoading) return;
        try {
            const files = await attachFilesToAiChatComposer();
            if (files.length > 0) {
                showToast({
                    message: `已附加 ${files.length} 个文件`,
                    type: "success",
                    duration: 1600,
                });
            }
        } catch (error) {
            console.error("Attach failed:", error);
            showToast({
                message: String(error?.message || error || "文件附加失败"),
                type: "error",
            });
        }
    }

    let lightboxUrl = null;

    async function handleAttachMedia() {
        if ($isAiLoading) return;
        try {
            const files = await attachMediaToAiChatComposer();
            if (files.length > 0) {
                showToast({
                    message: `已附加 ${files.length} 个媒体文件`,
                    type: "success",
                    duration: 1600,
                });
            }
        } catch (error) {
            console.error("Attach media failed:", error);
            showToast({
                message: String(error?.message || error || "媒体文件附加失败"),
                type: "error",
            });
        }
    }

    async function handleSaveGeneratedMedia(msg) {
        try {
            const { invoke } = await import("@tauri-apps/api/core");
            const ext = msg.type === "generated_image" ? "png" : "mp3";
            const mimeType = msg.mimeType || (msg.type === "generated_image" ? "image/png" : "audio/mpeg");
            const filename = `generated_${Date.now()}.${ext}`;

            const binary = atob(msg.base64Data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }

            const path = await invoke("save_file_to_downloads", {
                filename,
                content: msg.base64Data,
            });
            showToast({
                message: `已保存到: ${path}`,
                type: "success",
                duration: 3000,
            });
        } catch (error) {
            console.error("Save failed:", error);
            showToast({
                message: String(error?.message || error || "保存失败"),
                type: "error",
            });
        }
    }

    async function handleSend() {
        if ((!inputText.trim() && !$aiChatComposerAttachments.length) || $isAiLoading) return;
        const text = inputText.trim() || "请阅读并分析这些附件。";
        const attachments = $aiChatComposerAttachments;
        inputText = "";
        try {
            await sendChatMessage(text, chatStyle, null, { attachments });
            clearAiChatDraft();
            scrollToBottom();
        } catch (error) {
            console.error("Send failed:", error);
        }
    }

    async function handleRetry(index) {
        try {
            await retryChatMessage(index);
            scrollToBottom();
        } catch (error) {
            console.error("Retry failed:", error);
        }
    }

    async function handleClear() {
        const t = get(_);
        const confirmed = await showConfirm({
            title: t("ai_chat.confirm_clear"),
            message: t("ai_chat.confirm_clear"),
            confirmText: t("ai_chat.confirm_clear_btn"),
            cancelText: t("common.cancel"),
            variant: "warning",
        });
        if (confirmed) {
            clearAiChatHistory();
        }
    }

    async function handleDeleteSession(sessionId) {
        const session = $aiChatSessions.find((item) => item.id === sessionId);
        if (!session) return;
        const t = get(_);
        const confirmed = await showConfirm({
            title: t("ai_chat.delete_session"),
            message: t("ai_chat.delete_session_confirm", { values: { title: session.title || t("ai_chat.unnamed_session") } }),
            confirmText: t("common.delete"),
            cancelText: t("common.cancel"),
            variant: "danger",
        });
        if (confirmed) {
            deleteAiChatSession(sessionId);
        }
    }

    function handleCreateSession() {
        createAiChatSession();
        showSessionDrawer = false;
    }

    function handleSelectSession(sessionId) {
        selectAiChatSession(sessionId);
        showSessionDrawer = false;
    }

    function copyMessage(content) {
        if (navigator.clipboard && content) {
            navigator.clipboard.writeText(content);
            showToast({ message: $_("common.copied"), type: 'success', duration: 1500 });
        }
    }

    function handleEditResend(index, content) {
        const restoredText = editAndResend(index);
        if (restoredText) {
            inputText = restoredText;
            tick().then(() => {
                composerTextarea?.focus();
                syncComposerHeight();
            });
        }
    }

    async function handleRollback(index) {
        const t = get(_);
        const confirmed = await showConfirm({
            title: t("ai_chat.rollback"),
            message: t("ai_chat.rollback_confirm"),
            confirmText: t("ai_chat.rollback"),
            cancelText: t("common.cancel"),
            variant: "warning",
        });
        if (confirmed) {
            rollbackMessage(index);
        }
    }

    async function handleRetryAssistant(index) {
        try {
            await retryFromAssistantMessage(index);
            scrollToBottom();
        } catch (error) {
            console.error("Retry failed:", error);
        }
    }

    async function handleExportChat() {
        const md = exportChatToMarkdown();
        if (md) {
            const session = $aiChatSessions.find(s => s.id === $activeAiChatSessionId);
            const filename = `chat-${session?.title || 'export'}-${new Date().toISOString().slice(0, 10)}.md`;
            const result = await exportToMarkdown(md, filename);
            if (result?.success) {
                const msg = result.path
                    ? `${$_("ai_chat.export_success")}: ${result.path}`
                    : $_("ai_chat.export_success");
                showToast({ message: msg, type: 'success' });
            }
        } else {
            showToast({ message: $_("ai_chat.export_empty"), type: 'warning' });
        }
    }

    async function handleConfirmFileOperation(index, operation) {
        const res = await confirmAiChatLocalFileOperation(index, operation);
        if (res?.success) {
            showToast({ message: $_("ai_chat.file_operation_success"), type: 'success' });
        } else if (res && !res.success) {
            showToast({ message: $_("ai_chat.file_operation_failed"), type: 'error' });
        }
    }

    function formatSessionTime(value) {
        if (!value) return "";
        const date = new Date(value);
        return date.toLocaleString();
    }

    function getSessionPreview(session) {
        const t = get(_);
        const lastMessage = [...(session?.history || [])].reverse().find((item) => item);
        if (!lastMessage) return t("ai_chat.no_messages");
        if (lastMessage.type === "web_search_result") {
            return t("ai_chat.search_prefix", { values: { query: lastMessage.query || t("ai_chat.capability_web_search") } });
        }
        if (lastMessage.type === "ai_execution_plan") {
            return `📋 ${lastMessage.plan?.title || '执行计划'}`;
        }
        if (typeof lastMessage.content === "string" && lastMessage.content.trim()) {
            return lastMessage.content.replace(/\s+/g, " ").trim().slice(0, 40);
        }
        return lastMessage.type || t("ai_chat.no_messages");
    }

    function getMessageSource(msg) {
        return msg?.assistantSource || get(aiChatContext)?.source || "tasks";
    }

    function replaceChatMessage(index, nextMessage) {
        aiChatHistory.update((history) => {
            const nextHistory = [...history];
            nextHistory[index] = nextMessage;
            return nextHistory;
        });
        saveAiChatHistory();
        scrollToBottom();
    }

    function removeChatMessage(index) {
        replaceChatMessage(index, {
            role: "assistant",
            type: "text",
            content: get(_)("ai_chat.action_cancelled"),
        });
    }

    function addScopedItem(data, source = "tasks") {
        const normalized = {
            ...data,
            id: data.id || Date.now().toString(),
            status: data.status || "todo",
            subtasks: (data.subtasks || []).map((item) => ({
                title: typeof item === "string" ? item : item.title,
                status: item.status || "todo",
            })),
        };

        if (source === "templates") {
            taskStore.addTemplate(normalized);
            return;
        }

        if (source === "scheduled") {
            taskStore.addScheduledTask({
                ...normalized,
                repeatDays: Array.isArray(normalized.repeatDays) ? normalized.repeatDays : [],
                enabled: normalized.enabled ?? true,
                date: normalized.date || "",
                deadline: normalized.deadline || "",
            });
            return;
        }

        taskStore.addTask(normalized);
    }

    function updateScopedItem(id, updates, source = "tasks") {
        if (source === "templates") {
            taskStore.updateTemplate(id, updates);
            return;
        }
        if (source === "scheduled") {
            taskStore.updateScheduledTask(id, updates);
            return;
        }
        taskStore.updateTask(id, updates);
    }

    function deleteScopedItem(id, source = "tasks") {
        if (source === "templates") {
            taskStore.deleteTemplate(id);
            return;
        }
        if (source === "scheduled") {
            taskStore.deleteScheduledTask(id);
            return;
        }
        taskStore.deleteTask(id);
    }

    function formatDateTime(value) {
        return value ? value.replace("T", " ") : "";
    }

    function formatTimeOnly(value) {
        if (!value) return "";
        const parts = value.split("T");
        return parts.length > 1 ? parts[1] : "";
    }

    function formatPriority(priority) {
        return get(_)(`task_priority.${priority}`) || get(_)("task_priority.normal");
    }

    function formatStatus(status) {
        return get(_)(`task_status.${status}`) || get(_)("task_status.todo");
    }

    function getPriorityColor(priority) {
        const colorMap = {
            normal: "text-slate-500",
            urgent: "text-orange-500",
            critical: "text-red-500",
        };
        return colorMap[priority] || "text-slate-500";
    }

    function getStatusBgColor(status) {
        const colorMap = {
            todo: "bg-slate-100 text-slate-600",
            doing: "bg-blue-100 text-blue-600",
            done: "bg-green-100 text-green-600",
        };
        return colorMap[status] || "bg-slate-100 text-slate-600";
    }

    function formatRepeatDays(days = []) {
        const t = get(_);
        const map = {
            1: t("weekdays.mon"),
            2: t("weekdays.tue"),
            3: t("weekdays.wed"),
            4: t("weekdays.thu"),
            5: t("weekdays.fri"),
            6: t("weekdays.sat"),
            0: t("weekdays.sun"),
        };
        const prefix = t("weekdays.prefix");
        return (days || []).map((day) => `${prefix}${map[day] || day}`);
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

        if (date.getTime() === today.getTime()) return get(_)("ai_panel.today");
        if (date.getTime() === tomorrow.getTime()) return get(_)("ai_panel.tomorrow");
        if (date.getTime() === dayAfterTomorrow.getTime()) return get(_)("ai_panel.day_after");
        if (date.getTime() === yesterday.getTime()) return get(_)("ai_panel.yesterday");

        return dateStr.split("T")[0];
    }

    function buildUpdateDescriptions(updates = {}) {
        const descriptions = [];
        if (updates.title) descriptions.push(`${get(_)("ai_panel.title_label")} → "${updates.title}"`);
        if (updates.date) descriptions.push(`${get(_)("ai_panel.time_label")} → ${formatDateTime(updates.date)}`);
        if (updates.deadline) descriptions.push(`${get(_)("ai_panel.deadline")} → ${formatDateTime(updates.deadline)}`);
        if (updates.priority) descriptions.push(`${get(_)("ai_panel.priority_label")} → ${formatPriority(updates.priority)}`);
        if (updates.note !== undefined) descriptions.push(`${get(_)("ai_panel.note_label")} → "${updates.note}"`);
        if (updates.repeatDays) descriptions.push(`${get(_)("scheduled_page.repeat")} → ${formatRepeatDays(updates.repeatDays).join("、")}`);
        if (typeof updates.enabled === "boolean") descriptions.push(`${get(_)("ai_chat.enabled_status")} → ${updates.enabled ? get(_)("ai_chat.enabled") : get(_)("ai_chat.disabled")}`);
        if (updates.subtasks) descriptions.push(`${get(_)("ai_panel.subtasks")} updated`);
        return descriptions;
    }

    async function handleConfirmTask(data, index, source) {
        addScopedItem(data, source);
        replaceChatMessage(index, {
            role: "assistant",
            type: "text",
            content: get(_)("ai_panel.task_added_msg", { values: { title: data.title } }),
        });
    }

    async function handleConfirmMultiTask(msg, index) {
        const pendingTasks = msg.tasks.filter((_, taskIndex) => !(msg.confirmedIndexes || []).includes(taskIndex));
        pendingTasks.forEach((task, taskIndex) => {
            addScopedItem({
                ...task,
                id: task.id || (Date.now() + taskIndex).toString(),
            }, getMessageSource(msg));
        });
        replaceChatMessage(index, {
            role: "assistant",
            type: "text",
            content: get(_)("ai_panel.tasks_added_msg", { values: { count: pendingTasks.length } }),
        });
    }

    async function handleDeleteConfirm(msg, index) {
        const taskNames = msg.tasks.map((task) => `• ${task.title}`).join("\n");
        const confirmed = await showConfirm({
            title: get(_)("ai_panel.confirm_delete"),
            message: `${get(_)("ai_panel.delete_tasks_confirm", { values: { count: msg.tasks.length } })}\n\n${taskNames}`,
            confirmText: get(_)("common.delete"),
            cancelText: get(_)("common.cancel"),
            variant: "danger",
        });
        if (!confirmed) return;

        msg.tasks.forEach((task) => deleteScopedItem(task.id, getMessageSource(msg)));
        replaceChatMessage(index, {
            role: "assistant",
            type: "text",
            content: `🗑️ ${get(_)("ai_panel.confirm_delete")}: ${msg.tasks.map((task) => task.title).join(", ")}`,
        });
    }

    async function handleUpdateConfirm(msg, index) {
        const updateDescriptions = buildUpdateDescriptions(msg.updates);
        const confirmed = await showConfirm({
            title: get(_)("ai_panel.confirm_modify"),
            message: get(_)("ai_panel.modify_task_confirm", {
                values: {
                    title: msg.task.title,
                    changes: updateDescriptions.join("\n"),
                },
            }),
            confirmText: get(_)("ai_panel.confirm_modify"),
            cancelText: get(_)("common.cancel"),
            variant: "warning",
        });
        if (!confirmed) return;

        updateScopedItem(msg.task.id, msg.updates, getMessageSource(msg));
        replaceChatMessage(index, {
            role: "assistant",
            type: "text",
            content: `✏️ ${get(_)("ai_panel.task_modified_msg", {
                values: {
                    title: msg.task.title,
                    changes: updateDescriptions.join("，"),
                },
            })}`,
        });
    }

    async function handleMultiUpdateConfirm(msg, index) {
        const summaryLines = msg.operations
            .map((operation) => {
                const updates = buildUpdateDescriptions(operation.updates);
                return `• ${operation.task.title}: ${updates.join(", ")}`;
            })
            .join("\n");

        const confirmed = await showConfirm({
            title: get(_)("ai_panel.confirm_all_modify"),
            message: `${get(_)("ai_panel.modify_tasks_confirm", { values: { count: msg.operations.length } })}\n\n${summaryLines}`,
            confirmText: get(_)("ai_panel.confirm_modify"),
            cancelText: get(_)("common.cancel"),
            variant: "warning",
        });
        if (!confirmed) return;

        msg.operations.forEach((operation) => updateScopedItem(operation.task.id, operation.updates, getMessageSource(msg)));
        replaceChatMessage(index, {
            role: "assistant",
            type: "text",
            content: get(_)("ai_panel.tasks_modified_msg", { values: { count: msg.operations.length } }),
        });
    }

    async function handleBatchCompleteConfirm(msg, index) {
        const taskNames = msg.operations.map((operation) => `• ${operation.task.title}`).join("\n");
        const confirmed = await showConfirm({
            title: get(_)("ai_panel.mark_complete"),
            message: `${get(_)("ai_panel.batch_complete_confirm", { values: { count: msg.operations.length } })}\n\n${taskNames}`,
            confirmText: get(_)("ai_panel.mark_complete"),
            cancelText: get(_)("common.cancel"),
            variant: "success",
        });
        if (!confirmed) return;

        msg.operations.forEach((operation) => updateScopedItem(operation.task.id, operation.updates, getMessageSource(msg)));
        replaceChatMessage(index, {
            role: "assistant",
            type: "text",
            content: get(_)("ai_panel.tasks_completed_msg", { values: { count: msg.operations.length } }),
        });
    }

    async function handleMixedConfirm(msg, index) {
        const summaryLines = [];
        if (msg.updateOps?.length) {
            summaryLines.push(`[${get(_)("ai_panel.modify_section")}]`);
            msg.updateOps.forEach((operation) => {
                summaryLines.push(`• ${operation.task.title}: ${buildUpdateDescriptions(operation.updates).join(", ")}`);
            });
        }
        if (msg.deleteOps?.length) {
            summaryLines.push(`[${get(_)("ai_panel.delete_section")}]`);
            msg.deleteOps.forEach((task) => summaryLines.push(`• ${task.title}`));
        }

        const confirmed = await showConfirm({
            title: get(_)("ai_panel.confirm_execute"),
            message: `${get(_)("ai_panel.mixed_confirm_msg")}\n\n${summaryLines.join("\n")}`,
            confirmText: get(_)("ai_panel.confirm_execute"),
            cancelText: get(_)("common.cancel"),
            variant: "warning",
        });
        if (!confirmed) return;

        msg.updateOps?.forEach((operation) => updateScopedItem(operation.task.id, operation.updates, getMessageSource(msg)));
        msg.deleteOps?.forEach((task) => deleteScopedItem(task.id, getMessageSource(msg)));
        replaceChatMessage(index, {
            role: "assistant",
            type: "text",
            content: [
                msg.updateOps?.length ? `${get(_)("ai_panel.modify_section")} ${msg.updateOps.length}` : "",
                msg.deleteOps?.length ? `${get(_)("ai_panel.delete_section")} ${msg.deleteOps.length}` : "",
            ].filter(Boolean).join("，"),
        });
    }

    async function handleSubtaskConfirm(msg, index) {
        let newSubtasks = [...(msg.task.subtasks || [])];

        for (const change of msg.subtaskChanges || []) {
            if (change.action === "add") {
                newSubtasks.push({ title: change.new_title, status: "todo" });
            } else if (change.action === "delete") {
                newSubtasks = newSubtasks.filter((item) => item.title !== change.old_title);
            } else if (change.action === "update") {
                newSubtasks = newSubtasks.map((item) =>
                    item.title === change.old_title
                        ? { ...item, title: change.new_title }
                        : item,
                );
            } else if (change.action === "toggle") {
                newSubtasks = newSubtasks.map((item) =>
                    item.title === change.old_title
                        ? { ...item, status: item.status === "done" ? "todo" : "done" }
                        : item,
                );
            }
        }

        updateScopedItem(msg.task.id, { subtasks: newSubtasks }, getMessageSource(msg));
        replaceChatMessage(index, {
            role: "assistant",
            type: "text",
            content: get(_)("ai_panel.subtask_completed_msg", { values: { title: msg.task.title } }),
        });
    }

    onMount(() => {
        scrollToBottom();
        syncComposerHeight();
    });

    $: if ($aiChatHistory.length) scrollToBottom();
    $: if ($activeAiChatSessionId !== previousSessionId) {
        previousSessionId = $activeAiChatSessionId;
        scrollToBottom();
    }
    $: {
        inputText;
        syncComposerHeight();
    }
</script>

<div class="flex h-[100dvh] md:h-full overflow-hidden bg-slate-50 dark:bg-slate-900" data-ai-shell>
    {#if showSessionDrawer}
        <div
            class="md:hidden fixed inset-0 z-40 bg-slate-950/30 dark:bg-slate-950/60 backdrop-blur-sm"
            on:click={() => (showSessionDrawer = false)}
            on:keydown={() => (showSessionDrawer = false)}
            tabindex="0"
            role="button"
        ></div>
    {/if}

    <aside
        class="w-[280px] bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col shrink-0 h-full z-50 transition-transform duration-200 md:flex"
        class:fixed={showSessionDrawer}
        class:inset-y-0={showSessionDrawer}
        class:left-0={showSessionDrawer}
        class:translate-x-0={!showSessionDrawer}
        class:-translate-x-full={!showSessionDrawer}
    >
        <div class="min-h-16 px-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between shrink-0 safe-top-panel">
            <div>
                <div class="text-sm font-black text-slate-800 dark:text-slate-100">{$_("ai_chat.session_history")}</div>
                <div class="text-[11px] text-slate-400 dark:text-slate-500">
                    {$_("ai_chat.session_count", { values: { count: $aiChatSessions.length } })}
                </div>
            </div>
            <button
                on:click={handleCreateSession}
                class="h-9 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5"
            >
                <i class="ph ph-plus"></i> {$_("ai_chat.new_session")}
            </button>
        </div>

        <div class="flex-1 overflow-y-auto p-3 space-y-2 bg-white dark:bg-slate-800">
            {#each $aiChatSessions as session}
                <div
                    on:click={() => handleSelectSession(session.id)}
                    on:keydown={(e) => (e.key === "Enter" || e.key === " ") && handleSelectSession(session.id)}
                    tabindex="0"
                    role="button"
                    class="w-full text-left rounded-2xl border p-3 transition-all duration-150 group cursor-pointer border-l-4 {session.id === $activeAiChatSessionId
                        ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800 border-l-indigo-500 shadow-sm'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 border-l-transparent hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-l-slate-300'}"
                >
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0 flex-1 flex items-start gap-3">
                            <div class="w-9 h-9 rounded-xl overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700">
                                <img
                                    src={session.assistantAvatar}
                                    alt={session.title || $_("ai_chat.title")}
                                    class="w-full h-full object-cover"
                                />
                            </div>
                            <div class="min-w-0 flex-1">
                                <div class="font-bold text-sm text-slate-700 dark:text-slate-200 truncate">
                                    {session.title || $_("ai_chat.new_session")}
                                </div>
                                <div class="text-xs text-slate-400 dark:text-slate-500 truncate mt-1">
                                    {getSessionPreview(session)}
                                </div>
                                <div class="text-[10px] text-slate-300 dark:text-slate-600 mt-2">
                                    {formatSessionTime(session.updatedAt)}
                                </div>
                            </div>
                        </div>
                        <button
                            on:click|stopPropagation={() => handleDeleteSession(session.id)}
                            class="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition"
                            title={$_("ai_chat.delete_session")}
                        >
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </div>
            {/each}
        </div>
    </aside>

    <div class="flex-1 min-w-0 flex flex-col bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-850 overflow-hidden">
        <header
            class="min-h-14 md:min-h-16 bg-white/90 dark:bg-slate-800/90 backdrop-blur px-3 md:px-6 flex justify-between items-center z-10 border-b border-slate-200 dark:border-slate-700 shrink-0 safe-top"
        >
            <div class="flex items-center gap-2 md:gap-3 min-w-0">
                <button
                    on:click={handleBack}
                    class="md:hidden text-slate-500 dark:text-slate-400 flex items-center gap-1 font-bold mr-1"
                    aria-label={$_("common.back")}
                >
                    <i class="ph-bold ph-caret-left text-lg"></i>
                </button>
                <button
                    on:click={() => (showSessionDrawer = !showSessionDrawer)}
                    class="md:hidden h-9 w-9 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center"
                    aria-label={$_("ai_chat.sessions")}
                >
                    <i class="ph ph-list text-lg"></i>
                </button>
                <div
                    class="w-8 h-8 md:w-10 md:h-10 rounded-xl overflow-hidden shadow-lg shrink-0 border border-indigo-100/70 dark:border-indigo-900/70 bg-white/80 dark:bg-slate-700/80"
                >
                    <img
                        src={currentSession?.assistantAvatar || "/avatars/assistant-orbit-1.svg"}
                        alt={$_("ai_chat.title")}
                        class="w-full h-full object-cover"
                    />
                </div>
                <div class="min-w-0">
                    <h2 class="text-base md:text-lg font-bold text-slate-800 dark:text-slate-100 truncate">
                        {currentSession?.title || $_("ai_chat.title")}
                    </h2>
                    <div
                        class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 hidden md:block truncate"
                    >
                        {$_("ai_chat.subtitle")}
                    </div>
                </div>
            </div>
            <div class="flex items-center gap-1 md:gap-2">
                <button
                    on:click={() => showAiSettings.set(true)}
                    class="h-8 md:h-9 px-4 md:px-4 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-medium flex items-center gap-1 md:gap-2 transition"
                >
                    <i class="ph ph-gear"></i>
                    <span class="hidden md:inline">{$_("ai_chat.settings")}</span>
                </button>
                <button
                    on:click={handleExportChat}
                    class="h-8 md:h-9 px-4 md:px-4 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-medium flex items-center gap-1 md:gap-2 transition"
                >
                    <i class="ph ph-export"></i>
                    <span class="hidden md:inline">{$_("ai_chat.export")}</span>
                </button>
                <button
                    on:click={handleClear}
                    class="h-8 md:h-9 px-4 md:px-4 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium flex items-center gap-1 md:gap-2 transition"
                >
                    <i class="ph ph-trash"></i>
                    <span class="hidden md:inline">{$_("ai_chat.clear_btn")}</span>
                </button>
            </div>
        </header>

        {#if $aiChatContext}
            <div class="px-3 md:px-6 py-3 border-b border-indigo-100 dark:border-indigo-900/50 bg-gradient-to-r from-indigo-50/90 to-sky-50/90 dark:from-indigo-950/40 dark:to-sky-950/40">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <div class="text-xs font-black uppercase tracking-[0.18em] text-indigo-500 dark:text-indigo-400">
                            {$aiChatContext.scope || "Context"}
                        </div>
                        <div class="mt-1 font-bold text-slate-700 dark:text-slate-200 truncate">
                            {$aiChatContext.title || $_("ai_chat.title")}
                        </div>
                        {#if $aiChatContext.description}
                            <div class="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-5 line-clamp-2">
                                {$aiChatContext.description}
                            </div>
                        {/if}
                    </div>
                    <button
                        on:click={clearAiChatDraft}
                        class="w-8 h-8 rounded-xl bg-white/80 dark:bg-slate-700/80 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white dark:hover:bg-slate-700 flex items-center justify-center shrink-0 transition"
                        title={$_("common.close")}
                    >
                        <i class="ph ph-x"></i>
                    </button>
                </div>
            </div>
        {/if}

        <div
            class="px-3 md:px-4 py-2 md:py-3 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 overflow-x-auto shrink-0"
        >
            <div class="flex gap-1.5 md:gap-2 min-w-max">
                {#each chatStyles as style}
                    <button
                        on:click={() => (chatStyle = style.id)}
                        class="px-2 md:px-3 py-1 md:py-1.5 rounded-full text-[16px] md:text-xs font-bold flex items-center gap-1 md:gap-1.5 transition-all whitespace-nowrap {chatStyle === style.id
                            ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700'
                            : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600'}"
                    >
                        <i class="ph {style.icon}"></i>
                        {style.name}
                    </button>
                {/each}
            </div>
        </div>

        <div class="px-3 md:px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 shrink-0">
            <div class="flex flex-wrap items-center gap-2">
                <div class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                    {$_("ai_chat.capability_title")}
                </div>
                <div
                    class={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold border ${
                        $aiChatCapabilities.toolRouterEnabled
                            ? "bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800"
                            : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
                    }`}
                >
                    <i class={`ph ${$aiChatCapabilities.toolRouterEnabled ? "ph-plugs-connected" : "ph-chat-circle-dots"}`}></i>
                    {$aiChatCapabilities.toolRouterEnabled
                        ? $_("ai_chat.capability_mode_internal")
                        : $_("ai_chat.capability_mode_chat_only")}
                </div>
                {#each capabilityBadges as badge}
                    <div
                        class={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold border ${
                            badge.active
                                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                                : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600"
                        }`}
                    >
                        <i class={`ph ${badge.icon}`}></i>
                        {badge.label}
                        {#if badge.runtime === true}
                            <i class="ph-fill ph-check-circle text-emerald-500 text-[10px]"></i>
                        {:else if badge.runtime === false}
                            <i class="ph-fill ph-x-circle text-red-400 text-[10px]"></i>
                        {/if}
                    </div>
                {/each}
                {#if $aiChatCapabilities.localFilesAvailable && $aiChatCapabilities.localFilesRequireConfirmation}
                    <div class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold border bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800">
                        <i class="ph ph-shield-check"></i>
                        {$_("ai_chat.capability_confirm_required")}
                    </div>
                {/if}
                <button
                    on:click={handleProbeCapabilities}
                    disabled={isProbing}
                    class={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold border transition-all ${
                        isProbing
                            ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-400 dark:text-indigo-500 border-indigo-200 dark:border-indigo-800 cursor-wait"
                            : $aiChatCapabilities.probed
                                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-950/60"
                                : "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-950/60"
                    }`}
                >
                    {#if isProbing}
                        <i class="ph ph-circle-notch animate-spin"></i>
                        {$_("ai_chat.detecting") || "..."}
                    {:else if $aiChatCapabilities.probed}
                        <i class="ph ph-arrow-clockwise"></i>
                        {$_("ai_chat.redetect") || "Re-detect"}
                    {:else}
                        <i class="ph ph-magnifying-glass"></i>
                        {$_("ai_chat.detect_capabilities") || "Detect"}
                    {/if}
                </button>
            </div>
        </div>

        <div
            bind:this={chatContainer}
            class="flex-1 overflow-y-auto p-3 md:p-4 space-y-3 md:space-y-4 scroll-smooth overscroll-contain min-h-0 -webkit-overflow-scrolling-touch"
        >
            {#if $aiChatHistory.length === 0}
                <div
                    class="flex flex-col items-center justify-center h-full text-center py-8 md:py-12"
                >
                    <div
                        class="w-16 h-16 md:w-20 md:h-20 bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/50 dark:to-purple-900/50 rounded-2xl flex items-center justify-center mb-3 md:mb-4"
                    >
                        <i
                            class="ph-fill ph-sparkle text-3xl md:text-4xl text-indigo-500 dark:text-indigo-400"
                        ></i>
                    </div>
                    <h3 class="text-base md:text-lg font-bold text-slate-700 dark:text-slate-200 mb-2">
                        {$_("ai_chat.start")}
                    </h3>
                    <p class="text-xs md:text-sm text-slate-500 dark:text-slate-400 max-w-xs px-4">
                        {$_("ai_chat.empty_hint")}
                    </p>
                    <div class="mt-4 md:mt-6 grid grid-cols-2 gap-2 max-w-xs px-4">
                        <button
                            on:click={() => {
                                inputText = "Hello, introduce yourself";
                                handleSend();
                            }}
                            class="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-xs text-slate-600 dark:text-slate-300 transition"
                        >
                            👋 {$_("ai_chat.quick_intro")}
                        </button>
                        <button
                            on:click={() => {
                                inputText = "How's the weather today?";
                                handleSend();
                            }}
                            class="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-xs text-slate-600 dark:text-slate-300 transition"
                        >
                            🌤️ {$_("ai_chat.quick_weather")}
                        </button>
                        <button
                            on:click={() => {
                                inputText = "Tell me a joke";
                                handleSend();
                            }}
                            class="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-xs text-slate-600 dark:text-slate-300 transition"
                        >
                            😄 {$_("ai_chat.quick_joke")}
                        </button>
                        <button
                            on:click={() => {
                                inputText = "Write me a poem";
                                handleSend();
                            }}
                            class="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-xs text-slate-600 dark:text-slate-300 transition"
                        >
                            ✨ {$_("ai_chat.quick_poem")}
                        </button>
                    </div>
                </div>
            {:else}
                {#each $aiChatHistory as msg, index}
                    <div
                        class="flex gap-2 md:gap-3 min-w-0"
                        class:flex-row-reverse={msg.role === "user"}
                    >
                        {#if msg.role === "user"}
                            <div
                                class="w-8 h-8 md:w-9 md:h-9 rounded-xl shrink-0 overflow-hidden shadow-sm border border-blue-200/70 bg-blue-50"
                            >
                                <img
                                    src={currentSession?.userAvatar || "/avatars/user-orbit-1.svg"}
                                    alt="User avatar"
                                    class="w-full h-full object-cover"
                                />
                            </div>
                        {:else}
                            <div
                                class="w-8 h-8 md:w-9 md:h-9 rounded-xl shrink-0 overflow-hidden shadow-sm border border-indigo-200/70 bg-indigo-50"
                            >
                                <img
                                    src={currentSession?.assistantAvatar || "/avatars/assistant-orbit-1.svg"}
                                    alt="Assistant avatar"
                                    class="w-full h-full object-cover"
                                />
                            </div>
                        {/if}
                        <div class="min-w-0 max-w-[85%] md:max-w-[80%] group">
                            {#if msg.role === "user"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-blue-600 text-white rounded-tr-none markdown-message user-markdown break-words overflow-hidden"
                                >
                                    <MarkdownRenderer content={msg.content} />
                                    {#if msg.attachments?.length}
                                        <div class="mt-3 space-y-2">
                                            {#each msg.attachments as attachment}
                                                {#if attachment.mediaType === 'image' && attachment.thumbnailUrl}
                                                    <div class="rounded-xl overflow-hidden border border-white/15">
                                                        <button
                                                            on:click={() => lightboxUrl = attachment.thumbnailUrl}
                                                            class="block w-full"
                                                        >
                                                            <img
                                                                src={attachment.thumbnailUrl}
                                                                alt={attachment.name}
                                                                class="max-w-full max-h-60 rounded-xl object-contain cursor-pointer hover:opacity-90 transition"
                                                            />
                                                        </button>
                                                        <div class="px-3 py-1.5 text-[10px] text-blue-100/80">
                                                            {attachment.name} · {formatAttachmentSize(attachment.size)}
                                                        </div>
                                                    </div>
                                                {:else if attachment.mediaType === 'audio' && attachment.base64Data}
                                                    <div class="rounded-xl border border-white/15 bg-white/10 px-3 py-2">
                                                        <div class="flex items-center gap-2 mb-2">
                                                            <i class="ph ph-music-note text-sm"></i>
                                                            <span class="text-xs font-bold">{attachment.name}</span>
                                                            <span class="text-[10px] text-blue-100/80">{formatAttachmentSize(attachment.size)}</span>
                                                        </div>
                                                        <audio controls class="w-full h-8" preload="none">
                                                            <source src="data:{attachment.mimeType};base64,{attachment.base64Data}" type={attachment.mimeType} />
                                                        </audio>
                                                    </div>
                                                {:else if attachment.mediaType === 'video'}
                                                    <div class="rounded-xl border border-white/15 bg-white/10 px-3 py-2">
                                                        <div class="flex items-center gap-2">
                                                            <i class="ph ph-video-camera text-sm"></i>
                                                            <span class="text-xs font-bold">{attachment.name}</span>
                                                            <span class="text-[10px] text-blue-100/80">{formatAttachmentSize(attachment.size)}</span>
                                                        </div>
                                                    </div>
                                                {:else}
                                                    <div class="rounded-xl border border-white/15 bg-white/10 px-3 py-2">
                                                        <div class="flex items-start justify-between gap-3">
                                                            <div class="min-w-0 flex-1">
                                                                <div class="text-xs font-bold break-words">{attachment.name}</div>
                                                                <div class="mt-1 text-[11px] text-blue-100/90 break-all">{attachment.path}</div>
                                                            </div>
                                                            <div class="text-[10px] font-semibold text-blue-100/90 shrink-0">
                                                                {formatAttachmentSize(attachment.size)}
                                                            </div>
                                                        </div>
                                                        {#if attachment.truncated}
                                                            <div class="mt-2 text-[10px] text-blue-100/80">
                                                                内容已截断
                                                            </div>
                                                        {/if}
                                                    </div>
                                                {/if}
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                                <div
                                    class="mt-1 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity justify-end"
                                >
                                    <button
                                        on:click={() => copyMessage(msg.content)}
                                        class="p-1.5 text-blue-300 hover:text-white hover:bg-blue-500/30 rounded transition"
                                        title={$_("common.copy")}
                                    >
                                        <i class="ph ph-copy text-sm"></i>
                                    </button>
                                    <button
                                        on:click={() => handleEditResend(index, msg.content)}
                                        class="p-1.5 text-blue-300 hover:text-white hover:bg-blue-500/30 rounded transition"
                                        title={$_("ai_chat.edit_resend")}
                                    >
                                        <i class="ph ph-pencil-simple text-sm"></i>
                                    </button>
                                    <button
                                        on:click={() => handleRollback(index)}
                                        class="p-1.5 text-blue-300 hover:text-white hover:bg-blue-500/30 rounded transition"
                                        title={$_("ai_chat.rollback")}
                                    >
                                        <i class="ph ph-arrow-u-up-left text-sm"></i>
                                    </button>
                                </div>
                            {:else if msg.type === "text"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-tl-none markdown-message break-words overflow-hidden"
                                >
                                    <MarkdownRenderer content={msg.content} />
                                </div>
                                <div
                                    class="mt-1 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                                >
                                    <button
                                        on:click={() => copyMessage(msg.content)}
                                        class="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition"
                                        title={$_("ai.copy")}
                                    >
                                        <i class="ph ph-copy text-sm"></i>
                                    </button>
                                    <button
                                        on:click={() => handleRetryAssistant(index)}
                                        class="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition"
                                        title={$_("ai_chat.retry_text")}
                                    >
                                        <i class="ph ph-arrow-clockwise text-sm"></i>
                                    </button>
                                </div>
                            {:else if msg.type === "streaming"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-tl-none relative overflow-hidden markdown-message break-words"
                                >
                                    <MarkdownRenderer content={msg.content || ""} />
                                    {#if msg.isStreaming}
                                        <div class="flex gap-1.5 mt-2">
                                            <div
                                                class="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce"
                                                style="animation-delay: 0ms"
                                            ></div>
                                            <div
                                                class="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce"
                                                style="animation-delay: 150ms"
                                            ></div>
                                            <div
                                                class="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce"
                                                style="animation-delay: 300ms"
                                            ></div>
                                        </div>
                                    {/if}
                                </div>
                            {:else if msg.type === "loading"}
                                <div
                                    class="p-3 md:p-4 rounded-2xl text-sm shadow-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-tl-none"
                                >
                                    <div class="flex items-center gap-3">
                                        <div class="flex gap-1.5">
                                            <div
                                                class="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce"
                                                style="animation-delay: 0ms"
                                            ></div>
                                            <div
                                                class="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce"
                                                style="animation-delay: 150ms"
                                            ></div>
                                            <div
                                                class="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce"
                                                style="animation-delay: 300ms"
                                            ></div>
                                        </div>
                                        <span class="text-xs text-slate-400 dark:text-slate-500">
                                            {$_("ai.loading")}
                                        </span>
                                    </div>
                                </div>
                            {:else if msg.type === "tool_progress"}
                                <div
                                    class="p-3 md:p-4 rounded-2xl text-sm shadow-sm bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 text-slate-700 dark:text-slate-200 rounded-tl-none"
                                >
                                    {#if msg.steps?.length}
                                        <div class="space-y-1.5 mb-2">
                                            {#each msg.steps as step}
                                                <div class="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                                                    <i class="ph-fill ph-check-circle text-emerald-500 dark:text-emerald-400 text-xs"></i>
                                                    <span>{$_(`ai_chat.tool_step_${step}`)}</span>
                                                </div>
                                            {/each}
                                        </div>
                                    {/if}
                                    {#if msg.currentStep}
                                        <div class="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                                            <i class="ph ph-circle-notch animate-spin text-sm"></i>
                                            <span>{$_(`ai_chat.tool_step_${msg.currentStep}`)}</span>
                                        </div>
                                    {/if}
                                </div>
                            {:else if msg.type === "file_confirm"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-fuchsia-50 dark:bg-fuchsia-950/30 border border-fuchsia-200 dark:border-fuchsia-800 text-slate-700 dark:text-slate-200 rounded-tl-none"
                                >
                                    <div class="text-xs font-bold text-fuchsia-600 dark:text-fuchsia-400 flex items-center gap-2">
                                        <i class="ph ph-folder-open"></i>
                                        {msg.message}
                                    </div>
                                    <div class="mt-3 text-xs font-mono break-all text-slate-600 dark:text-slate-300">
                                        {msg.operation.path}
                                    </div>
                                    {#if msg.operation.authorizationDirectory}
                                        <div class="mt-3 rounded-xl bg-white dark:bg-slate-800 border border-fuchsia-100 dark:border-fuchsia-900/50 p-3 text-xs text-slate-600 dark:text-slate-300">
                                            <div class="font-bold text-fuchsia-700 dark:text-fuchsia-400">
                                                将授权目录
                                            </div>
                                            <div class="mt-1 font-mono break-all">
                                                {msg.operation.authorizationDirectory}
                                            </div>
                                        </div>
                                    {/if}
                                    {#if msg.operation.content}
                                        <pre class="mt-3 rounded-xl bg-white dark:bg-slate-800 border border-fuchsia-100 dark:border-fuchsia-900/50 p-3 overflow-x-auto text-[11px] leading-6 text-slate-600 dark:text-slate-300"><code>{msg.operation.content.slice(0, 400)}{msg.operation.content.length > 400 ? '\n...' : ''}</code></pre>
                                    {/if}
                                    <div class="mt-3 flex gap-2">
                                        <button
                                            on:click={() => handleConfirmFileOperation(index, msg.operation)}
                                            class="px-3 py-1.5 bg-fuchsia-600 text-white rounded-lg text-xs font-bold hover:bg-fuchsia-700 flex items-center gap-1 transition"
                                        >
                                            <i class="ph ph-check"></i>
                                            {$_("common.confirm")}
                                        </button>
                                        <button
                                            on:click={() => removeChatMessage(index)}
                                            class="px-3 py-1.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 rounded-lg text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-600 transition"
                                        >
                                            {$_("common.cancel")}
                                        </button>
                                    </div>
                                </div>
                            {:else if msg.type === "task_card"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-slate-700 dark:text-slate-200 rounded-tl-none"
                                >
                                    <div class="text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                                        <i class="ph ph-check-square-offset"></i>
                                        {msg.entityLabel || $_("ai_chat.task_entity")}{$_("ai_chat.pending_confirm")}
                                    </div>
                                    <div class="mt-3 rounded-xl bg-white dark:bg-slate-800 border border-emerald-100 dark:border-emerald-900/50 p-3">
                                        <div class="font-bold text-slate-800 dark:text-slate-100">{msg.data.title}</div>
                                        {#if msg.data.repeatDays && msg.data.repeatDays.length > 0}
                                            <div class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                                {formatRepeatDays(msg.data.repeatDays).join("、")}
                                            </div>
                                        {:else if msg.data.date}
                                            <div class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                                {getRelativeDate(msg.data.date)} {formatTimeOnly(msg.data.date)}
                                            </div>
                                        {/if}
                                        <div class="mt-2 flex items-center gap-2 flex-wrap text-xs">
                                            <span class={`px-2 py-0.5 rounded-full ${getStatusBgColor(msg.data.status)}`}>
                                                {formatStatus(msg.data.status)}
                                            </span>
                                            {#if msg.data.priority}
                                                <span class={getPriorityColor(msg.data.priority)}>
                                                    {formatPriority(msg.data.priority)}
                                                </span>
                                            {/if}
                                        </div>
                                    </div>
                                    <div class="mt-3 flex gap-2">
                                        <button
                                            on:click={() => handleConfirmTask(msg.data, index, getMessageSource(msg))}
                                            class="flex-1 px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition"
                                        >
                                            {$_("common.confirm")}
                                        </button>
                                        <button
                                            on:click={() => removeChatMessage(index)}
                                            class="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-600 transition"
                                        >
                                            {$_("common.cancel")}
                                        </button>
                                    </div>
                                </div>
                            {:else if msg.type === "multi_task_card"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-slate-700 dark:text-slate-200 rounded-tl-none"
                                >
                                    <div class="text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                                        <i class="ph ph-list-checks"></i>
                                        {msg.tasks.length} {msg.entityLabel || $_("ai_chat.task_entity")}{$_("ai_chat.pending_add")}
                                    </div>
                                    <div class="mt-3 space-y-2 max-h-72 overflow-y-auto">
                                        {#each msg.tasks as task}
                                            <div class="rounded-xl bg-white dark:bg-slate-800 border border-emerald-100 dark:border-emerald-900/50 p-3">
                                                <div class="font-bold text-slate-800 dark:text-slate-100">{task.title}</div>
                                                {#if task.repeatDays && task.repeatDays.length > 0}
                                                    <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                        {formatRepeatDays(task.repeatDays).join("、")}
                                                    </div>
                                                {:else if task.date}
                                                    <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                        {getRelativeDate(task.date)} {formatTimeOnly(task.date)}
                                                    </div>
                                                {/if}
                                            </div>
                                        {/each}
                                    </div>
                                    <div class="mt-3 flex gap-2">
                                        <button
                                            on:click={() => handleConfirmMultiTask(msg, index)}
                                            class="flex-1 px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition"
                                        >
                                            {$_("common.confirm")}
                                        </button>
                                        <button
                                            on:click={() => removeChatMessage(index)}
                                            class="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-600 transition"
                                        >
                                            {$_("common.cancel")}
                                        </button>
                                    </div>
                                </div>
                            {:else if msg.type === "delete_confirm"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-slate-700 dark:text-slate-200 rounded-tl-none"
                                >
                                    <div class="text-xs font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
                                        <i class="ph ph-trash"></i>
                                        {msg.message}
                                    </div>
                                    <div class="mt-3 space-y-2 max-h-72 overflow-y-auto">
                                        {#each msg.tasks as task}
                                            <div class="rounded-xl bg-white dark:bg-slate-800 border border-red-100 dark:border-red-900/50 p-3">
                                                <div class="font-bold text-slate-800 dark:text-slate-100">{task.title}</div>
                                                <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                    {getRelativeDate(task.date)} {formatTimeOnly(task.date)}
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                    <div class="mt-3 flex gap-2">
                                        <button
                                            on:click={() => handleDeleteConfirm(msg, index)}
                                            class="flex-1 px-3 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition"
                                        >
                                            {$_("common.confirm")}
                                        </button>
                                        <button
                                            on:click={() => removeChatMessage(index)}
                                            class="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-600 transition"
                                        >
                                            {$_("common.cancel")}
                                        </button>
                                    </div>
                                </div>
                            {:else if msg.type === "update_confirm"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-slate-700 dark:text-slate-200 rounded-tl-none"
                                >
                                    <div class="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-2">
                                        <i class="ph ph-pencil-simple"></i>
                                        {msg.message || $_("ai_panel.confirm_modify")}
                                    </div>
                                    <div class="mt-3 rounded-xl bg-white dark:bg-slate-800 border border-amber-100 dark:border-amber-900/50 p-3">
                                        <div class="font-bold text-slate-800 dark:text-slate-100">{msg.task.title}</div>
                                        <div class="mt-2 text-xs text-slate-500 dark:text-slate-400 space-y-1">
                                            {#each buildUpdateDescriptions(msg.updates) as line}
                                                <div>{line}</div>
                                            {/each}
                                        </div>
                                    </div>
                                    <div class="mt-3 flex gap-2">
                                        <button
                                            on:click={() => handleUpdateConfirm(msg, index)}
                                            class="flex-1 px-3 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold hover:bg-amber-600 transition"
                                        >
                                            {$_("common.confirm")}
                                        </button>
                                        <button
                                            on:click={() => removeChatMessage(index)}
                                            class="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-600 transition"
                                        >
                                            {$_("common.cancel")}
                                        </button>
                                    </div>
                                </div>
                            {:else if msg.type === "multi_update_confirm"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-slate-700 dark:text-slate-200 rounded-tl-none"
                                >
                                    <div class="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-2">
                                        <i class="ph ph-checks"></i>
                                        {msg.message}
                                    </div>
                                    <div class="mt-3 space-y-2 max-h-72 overflow-y-auto">
                                        {#each msg.operations as operation}
                                            <div class="rounded-xl bg-white dark:bg-slate-800 border border-amber-100 dark:border-amber-900/50 p-3">
                                                <div class="font-bold text-slate-800 dark:text-slate-100">{operation.task.title}</div>
                                                <div class="mt-2 text-xs text-slate-500 dark:text-slate-400 space-y-1">
                                                    {#each buildUpdateDescriptions(operation.updates) as line}
                                                        <div>{line}</div>
                                                    {/each}
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                    <div class="mt-3 flex gap-2">
                                        <button
                                            on:click={() => handleMultiUpdateConfirm(msg, index)}
                                            class="flex-1 px-3 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold hover:bg-amber-600 transition"
                                        >
                                            {$_("common.confirm")}
                                        </button>
                                        <button
                                            on:click={() => removeChatMessage(index)}
                                            class="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-600 transition"
                                        >
                                            {$_("common.cancel")}
                                        </button>
                                    </div>
                                </div>
                            {:else if msg.type === "batch_complete_confirm"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-slate-700 dark:text-slate-200 rounded-tl-none"
                                >
                                    <div class="text-xs font-bold text-green-700 dark:text-green-400 flex items-center gap-2">
                                        <i class="ph ph-check-circle"></i>
                                        {msg.message}
                                    </div>
                                    <div class="mt-3 space-y-2 max-h-72 overflow-y-auto">
                                        {#each msg.operations as operation}
                                            <div class="rounded-xl bg-white dark:bg-slate-800 border border-green-100 dark:border-green-900/50 p-3">
                                                <div class="font-bold text-slate-800 dark:text-slate-100">{operation.task.title}</div>
                                                <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                    {getRelativeDate(operation.task.date)} {formatTimeOnly(operation.task.date)}
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                    <div class="mt-3 flex gap-2">
                                        <button
                                            on:click={() => handleBatchCompleteConfirm(msg, index)}
                                            class="flex-1 px-3 py-2 bg-green-600 text-white rounded-xl text-xs font-bold hover:bg-green-700 transition"
                                        >
                                            {$_("common.confirm")}
                                        </button>
                                        <button
                                            on:click={() => removeChatMessage(index)}
                                            class="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-600 transition"
                                        >
                                            {$_("common.cancel")}
                                        </button>
                                    </div>
                                </div>
                            {:else if msg.type === "mixed_confirm"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 text-slate-700 dark:text-slate-200 rounded-tl-none"
                                >
                                    <div class="text-xs font-bold text-purple-700 dark:text-purple-400 flex items-center gap-2">
                                        <i class="ph ph-lightning"></i>
                                        {msg.message}
                                    </div>
                                    <div class="mt-3 space-y-3">
                                        {#if msg.updateOps?.length}
                                            <div>
                                                <div class="text-xs font-bold text-amber-600 dark:text-amber-400 mb-2">{$_("ai_panel.modify_section")} ({msg.updateOps.length})</div>
                                                <div class="space-y-2">
                                                    {#each msg.updateOps as operation}
                                                        <div class="rounded-xl bg-white dark:bg-slate-800 border border-amber-100 dark:border-amber-900/50 p-3">
                                                            <div class="font-bold text-slate-800 dark:text-slate-100">{operation.task.title}</div>
                                                            <div class="mt-2 text-xs text-slate-500 dark:text-slate-400 space-y-1">
                                                                {#each buildUpdateDescriptions(operation.updates) as line}
                                                                    <div>{line}</div>
                                                                {/each}
                                                            </div>
                                                        </div>
                                                    {/each}
                                                </div>
                                            </div>
                                        {/if}
                                        {#if msg.deleteOps?.length}
                                            <div>
                                                <div class="text-xs font-bold text-red-600 dark:text-red-400 mb-2">{$_("ai_panel.delete_section")} ({msg.deleteOps.length})</div>
                                                <div class="space-y-2">
                                                    {#each msg.deleteOps as task}
                                                        <div class="rounded-xl bg-white dark:bg-slate-800 border border-red-100 dark:border-red-900/50 p-3">
                                                            <div class="font-bold text-slate-800 dark:text-slate-100">{task.title}</div>
                                                        </div>
                                                    {/each}
                                                </div>
                                            </div>
                                        {/if}
                                    </div>
                                    <div class="mt-3 flex gap-2">
                                        <button
                                            on:click={() => handleMixedConfirm(msg, index)}
                                            class="flex-1 px-3 py-2 bg-purple-600 text-white rounded-xl text-xs font-bold hover:bg-purple-700 transition"
                                        >
                                            {$_("common.confirm")}
                                        </button>
                                        <button
                                            on:click={() => removeChatMessage(index)}
                                            class="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-600 transition"
                                        >
                                            {$_("common.cancel")}
                                        </button>
                                    </div>
                                </div>
                            {:else if msg.type === "query_result"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-slate-700 dark:text-slate-200 rounded-tl-none"
                                >
                                    <div class="text-xs font-bold text-sky-700 dark:text-sky-400 flex items-center gap-2">
                                        <i class="ph ph-magnifying-glass"></i>
                                        {msg.summary}
                                    </div>
                                    {#if msg.filterDescription}
                                        <div class="mt-2 text-xs text-slate-500 dark:text-slate-400">{msg.filterDescription}</div>
                                    {/if}
                                    <div class="mt-3 space-y-2 max-h-72 overflow-y-auto">
                                        {#each msg.tasks as task}
                                            <div class="rounded-xl bg-white dark:bg-slate-800 border border-sky-100 dark:border-sky-900/50 p-3">
                                                <div class="flex items-start justify-between gap-2">
                                                    <div class="min-w-0 flex-1">
                                                        <div class="font-bold text-slate-800 dark:text-slate-100 truncate">{task.title}</div>
                                                        <div class="mt-1 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2">
                                                            {#if task.repeatDays && task.repeatDays.length > 0}
                                                                <span>{formatRepeatDays(task.repeatDays).join("、")}</span>
                                                            {:else if task.date}
                                                                <span>{getRelativeDate(task.date)} {formatTimeOnly(task.date)}</span>
                                                            {/if}
                                                            {#if task.priority !== "normal"}
                                                                <span class={getPriorityColor(task.priority)}>{formatPriority(task.priority)}</span>
                                                            {/if}
                                                        </div>
                                                    </div>
                                                    <span class={`px-2 py-0.5 rounded-full text-xs font-bold ${getStatusBgColor(task.status)}`}>
                                                        {formatStatus(task.status)}
                                                    </span>
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {:else if msg.type === "web_search_result"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800 text-slate-700 dark:text-slate-200 rounded-tl-none"
                                >
                                    <div class="text-xs font-bold text-cyan-700 dark:text-cyan-400 flex items-center gap-2">
                                        <i class="ph ph-globe-hemisphere-west"></i>
                                        {msg.message || $_("ai_chat.web_search_result")}
                                    </div>
                                    {#if msg.query}
                                        <div class="mt-2 text-xs text-cyan-700/80 dark:text-cyan-400/80">
                                            {$_("ai_chat.search_query_label", { values: { query: msg.query } })}
                                        </div>
                                    {/if}
                                    {#if msg.summary}
                                        <div class="mt-3 rounded-xl bg-white dark:bg-slate-800 border border-cyan-100 dark:border-cyan-900/50 p-3">
                                            <MarkdownRenderer content={msg.summary} />
                                        </div>
                                    {/if}
                                    <div class="mt-3 space-y-2 max-h-80 overflow-y-auto">
                                        {#if msg.entries?.length}
                                            {#each msg.entries as entry, entryIndex}
                                                <div class="rounded-xl bg-white dark:bg-slate-800 border border-cyan-100 dark:border-cyan-900/50 p-3">
                                                    <div class="flex items-start justify-between gap-3">
                                                        <div class="min-w-0 flex-1">
                                                            <div class="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-500">
                                                                {entry.source || "Web"} #{entryIndex + 1}
                                                            </div>
                                                            <div class="mt-1 font-bold text-slate-800 dark:text-slate-100 break-words">
                                                                {entry.title}
                                                            </div>
                                                            <div class="mt-1 text-xs text-slate-500 dark:text-slate-400 break-all">
                                                                {entry.url}
                                                            </div>
                                                            {#if entry.snippet}
                                                                <div class="mt-2 text-xs text-slate-600 dark:text-slate-300 leading-5">
                                                                    {entry.snippet}
                                                                </div>
                                                            {/if}
                                                        </div>
                                                        <button
                                                            on:click={() => openExternalUrl(entry.url)}
                                                            class="shrink-0 px-3 py-1.5 rounded-lg bg-cyan-600 text-white text-xs font-bold hover:bg-cyan-700 transition"
                                                        >
                                                            {$_("ai_chat.open_link")}
                                                        </button>
                                                    </div>
                                                </div>
                                            {/each}
                                        {:else}
                                            <div class="rounded-xl bg-white dark:bg-slate-800 border border-cyan-100 dark:border-cyan-900/50 p-3 text-xs text-slate-500 dark:text-slate-400">
                                                {$_("ai_chat.no_results")}
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                            {:else if msg.type === "subtask_confirm"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 text-slate-700 dark:text-slate-200 rounded-tl-none"
                                >
                                    <div class="text-xs font-bold text-purple-700 dark:text-purple-400 flex items-center gap-2">
                                        <i class="ph ph-list-checks"></i>
                                        {msg.message}
                                    </div>
                                    <div class="mt-3 rounded-xl bg-white dark:bg-slate-800 border border-purple-100 dark:border-purple-900/50 p-3">
                                        <div class="font-bold text-slate-800 dark:text-slate-100">{msg.task.title}</div>
                                        <div class="mt-2 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                                            {#each msg.subtaskChanges as change}
                                                <div class="rounded-lg border border-purple-100 dark:border-purple-900/50 dark:bg-slate-800/50 px-3 py-2">
                                                    {#if change.action === "add"}
                                                        <span class="text-green-600 font-bold">{$_("ai_panel.add_action")}:</span> {change.new_title}
                                                    {:else if change.action === "delete"}
                                                        <span class="text-red-600 font-bold">{$_("ai_panel.delete_action")}:</span> {change.old_title}
                                                    {:else if change.action === "update"}
                                                        <span class="text-amber-600 font-bold">{$_("ai_panel.update_action")}:</span> {change.old_title} → {change.new_title}
                                                    {:else if change.action === "toggle"}
                                                        <span class="text-blue-600 font-bold">{$_("ai_panel.toggle_action")}:</span> {change.old_title}
                                                    {/if}
                                                </div>
                                            {/each}
                                        </div>
                                    </div>
                                    <div class="mt-3 flex gap-2">
                                        <button
                                            on:click={() => handleSubtaskConfirm(msg, index)}
                                            class="flex-1 px-3 py-2 bg-purple-600 text-white rounded-xl text-xs font-bold hover:bg-purple-700 transition"
                                        >
                                            {$_("common.confirm")}
                                        </button>
                                        <button
                                            on:click={() => removeChatMessage(index)}
                                            class="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-600 transition"
                                        >
                                            {$_("common.cancel")}
                                        </button>
                                    </div>
                                </div>
                            {:else if msg.type === "generated_image"}
                                <div class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-tl-none max-w-sm">
                                    {#if msg.base64Data}
                                        <button
                                            on:click={() => lightboxUrl = `data:${msg.mimeType || 'image/png'};base64,${msg.base64Data}`}
                                            class="block w-full"
                                        >
                                            <img
                                                src="data:{msg.mimeType || 'image/png'};base64,{msg.base64Data}"
                                                alt={msg.prompt || 'Generated image'}
                                                class="w-full rounded-xl cursor-pointer hover:opacity-90 transition"
                                            />
                                        </button>
                                    {:else if msg.url}
                                        <button
                                            on:click={() => lightboxUrl = msg.url}
                                            class="block w-full"
                                        >
                                            <img
                                                src={msg.url}
                                                alt={msg.prompt || 'Generated image'}
                                                class="w-full rounded-xl cursor-pointer hover:opacity-90 transition"
                                            />
                                        </button>
                                    {/if}
                                    {#if msg.content}
                                        <div class="mt-2 text-xs text-slate-500 dark:text-slate-400 italic">
                                            {msg.content}
                                        </div>
                                    {/if}
                                    <div class="mt-2 flex gap-2">
                                        <button
                                            on:click={() => handleSaveGeneratedMedia(msg)}
                                            class="px-2.5 py-1 text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition"
                                        >
                                            <i class="ph ph-download-simple mr-1"></i>保存
                                        </button>
                                    </div>
                                </div>
                            {:else if msg.type === "generated_audio"}
                                <div class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-tl-none">
                                    <div class="flex items-center gap-2 mb-2">
                                        <i class="ph ph-speaker-high text-purple-500"></i>
                                        <span class="text-xs font-bold text-slate-700 dark:text-slate-200">语音生成</span>
                                        {#if msg.voice}
                                            <span class="text-[10px] text-slate-400 dark:text-slate-500">({msg.voice})</span>
                                        {/if}
                                    </div>
                                    {#if msg.base64Data}
                                        <audio controls class="w-full" preload="none">
                                            <source src="data:{msg.mimeType || 'audio/mpeg'};base64,{msg.base64Data}" type={msg.mimeType || 'audio/mpeg'} />
                                        </audio>
                                    {/if}
                                    {#if msg.content}
                                        <div class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                            {msg.content}
                                        </div>
                                    {/if}
                                    <div class="mt-2 flex gap-2">
                                        <button
                                            on:click={() => handleSaveGeneratedMedia(msg)}
                                            class="px-2.5 py-1 text-xs bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/50 transition"
                                        >
                                            <i class="ph ph-download-simple mr-1"></i>保存
                                        </button>
                                    </div>
                                </div>
                            {:else if msg.type === "ai_execution_plan"}
                                <div class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-tl-none">
                                    <div class="flex items-center gap-2 mb-2.5">
                                        <i class="ph ph-list-checks text-blue-500 text-base"></i>
                                        <span class="text-xs font-bold text-slate-700 dark:text-slate-200">{msg.plan?.title || '执行计划'}</span>
                                        {#if msg.isExecuting}
                                            <span class="ml-auto text-[10px] text-blue-500 dark:text-blue-400 animate-pulse">执行中...</span>
                                        {:else if msg.plan?.status === 'done'}
                                            <span class="ml-auto text-[10px] text-green-500 dark:text-green-400">已完成</span>
                                        {:else if msg.plan?.status === 'cancelled'}
                                            <span class="ml-auto text-[10px] text-slate-400 dark:text-slate-500">已取消</span>
                                        {:else if msg.plan?.status === 'partial'}
                                            <span class="ml-auto text-[10px] text-amber-500 dark:text-amber-400">部分完成</span>
                                        {/if}
                                    </div>
                                    <div class="space-y-1.5">
                                        {#each msg.plan?.steps || [] as step, si}
                                            <div class="flex items-start gap-2 px-2 py-1.5 rounded-lg {step.status === 'running' ? 'bg-blue-50 dark:bg-blue-900/20' : step.status === 'done' ? 'bg-green-50/50 dark:bg-green-900/10' : step.status === 'failed' ? 'bg-red-50/50 dark:bg-red-900/10' : 'bg-slate-50 dark:bg-slate-600/30'}">
                                                <span class="shrink-0 mt-0.5">
                                                    {#if step.status === 'done'}
                                                        <i class="ph-fill ph-check-circle text-green-500 text-sm"></i>
                                                    {:else if step.status === 'running'}
                                                        <i class="ph ph-circle-notch text-blue-500 text-sm animate-spin"></i>
                                                    {:else if step.status === 'failed'}
                                                        <i class="ph-fill ph-x-circle text-red-500 text-sm"></i>
                                                    {:else if step.status === 'skipped'}
                                                        <i class="ph ph-minus-circle text-slate-400 text-sm"></i>
                                                    {:else}
                                                        <i class="ph ph-circle text-slate-300 dark:text-slate-500 text-sm"></i>
                                                    {/if}
                                                </span>
                                                <div class="min-w-0 flex-1">
                                                    <span class="text-xs {step.status === 'done' ? 'text-green-700 dark:text-green-300' : step.status === 'running' ? 'text-blue-700 dark:text-blue-300 font-medium' : step.status === 'failed' ? 'text-red-700 dark:text-red-300' : 'text-slate-500 dark:text-slate-400'}">
                                                        {step.title}
                                                    </span>
                                                    {#if step.status === 'failed' && step.error}
                                                        <div class="text-[10px] text-red-500 dark:text-red-400 mt-0.5">{step.error}</div>
                                                    {/if}
                                                    {#if step.status === 'done' && step.result}
                                                        <button
                                                            class="text-[10px] text-blue-500 dark:text-blue-400 hover:underline mt-0.5 block"
                                                            on:click={() => {
                                                                const el = document.getElementById(`step-detail-${index}-${si}`);
                                                                if (el) el.classList.toggle('hidden');
                                                            }}
                                                        >
                                                            查看详情
                                                        </button>
                                                        <div id="step-detail-{index}-{si}" class="hidden mt-1 text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-600/50 rounded p-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
                                                            {#if step.result.type === 'web_search'}
                                                                搜索: {step.result.query}
                                                                {#each (step.result.entries || []).slice(0, 3) as entry}
                                                                    {'\n'}• {entry.title}
                                                                {/each}
                                                            {:else if step.result.type === 'content_generation' || step.result.type === 'summarize'}
                                                                {(step.result.content || '').slice(0, 500)}
                                                            {:else if step.result.type === 'file_read'}
                                                                {(step.result.files || []).map(f => f.name).join(', ')}
                                                            {:else if step.result.type === 'task_create'}
                                                                任务: {step.result.task?.title || ''}
                                                            {:else}
                                                                {JSON.stringify(step.result).slice(0, 300)}
                                                            {/if}
                                                        </div>
                                                    {/if}
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                    {#if msg.plan?.steps?.length}
                                        <div class="mt-2 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500">
                                            <span>进度: {msg.plan.steps.filter(s => s.status === 'done').length}/{msg.plan.steps.length}</span>
                                            {#if msg.isExecuting}
                                                <button
                                                    on:click={stopStreaming}
                                                    class="px-2 py-0.5 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition text-[10px]"
                                                >
                                                    <i class="ph ph-stop mr-0.5"></i>取消
                                                </button>
                                            {/if}
                                        </div>
                                    {/if}
                                    {#if msg.summary && !msg.isExecuting}
                                        <div class="mt-3 pt-2.5 border-t border-slate-200 dark:border-slate-600">
                                            <MarkdownRenderer content={msg.summary} />
                                        </div>
                                    {/if}
                                </div>
                            {:else if msg.type === "error"}
                                <div
                                    class="p-2.5 md:p-3 rounded-2xl text-sm shadow-sm bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-tl-none"
                                >
                                    <div class="flex flex-col gap-2">
                                        <div class="flex items-center gap-2">
                                            <i class="ph-fill ph-warning-circle"></i>
                                            <span>{$_("ai.retry")}: {msg.content}</span>
                                        </div>
                                        <button
                                            on:click={() => handleRetry(index)}
                                            class="self-start px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 flex items-center gap-1 transition"
                                        >
                                            <i class="ph ph-arrow-clockwise"></i>
                                            {$_("ai.retry")}
                                        </button>
                                    </div>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/each}
            {/if}
        </div>

        <div
            class="p-3 md:p-4 pb-5 md:pb-4 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 shrink-0 safe-bottom"
        >
            {#if $aiChatComposerAttachments.length}
                <div class="mb-3 flex flex-wrap gap-2">
                    {#each $aiChatComposerAttachments as attachment}
                        <div class="max-w-full flex items-start gap-2 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/70 px-3 py-2">
                            {#if attachment.thumbnailUrl}
                                <img
                                    src={attachment.thumbnailUrl}
                                    alt={attachment.name}
                                    class="w-10 h-10 rounded-lg object-cover shrink-0"
                                />
                            {:else if attachment.mediaType === 'audio'}
                                <div class="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center shrink-0">
                                    <i class="ph ph-music-note text-purple-600 dark:text-purple-300 text-lg"></i>
                                </div>
                            {:else if attachment.mediaType === 'video'}
                                <div class="w-10 h-10 rounded-lg bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center shrink-0">
                                    <i class="ph ph-video-camera text-rose-600 dark:text-rose-300 text-lg"></i>
                                </div>
                            {/if}
                            <div class="min-w-0">
                                <div class="text-xs font-bold text-slate-700 dark:text-slate-200 break-words">
                                    {attachment.name}
                                </div>
                                <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 break-all">
                                    {formatAttachmentSize(attachment.size)}
                                    {#if attachment.truncated}
                                        · 已截断
                                    {/if}
                                    {#if attachment.mediaType && attachment.mediaType !== 'text'}
                                        · {attachment.mediaType}
                                    {/if}
                                </div>
                            </div>
                            <button
                                on:click={() => removeAiChatComposerAttachment(attachment.path)}
                                class="shrink-0 text-slate-400 hover:text-red-500 transition"
                                aria-label="移除附件"
                                title="移除附件"
                            >
                                <i class="ph ph-x text-sm"></i>
                            </button>
                        </div>
                    {/each}
                </div>
            {/if}
            <div
                class="flex gap-2 items-end bg-slate-50 dark:bg-slate-700 p-2 rounded-2xl border border-slate-200 dark:border-slate-600 focus-within:border-indigo-400 dark:focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-50 dark:focus-within:ring-indigo-900/30 transition-all"
            >
                <button
                    on:click={handleAttachFiles}
                    class="p-2 md:p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-300 hover:border-indigo-300 transition disabled:opacity-50"
                    disabled={$isAiLoading || !$aiChatCapabilities.localFilesAvailable}
                    aria-label="附加文件"
                    title={$aiChatCapabilities.localFilesAvailable ? "附加文本文件" : "当前环境不可用"}
                >
                    <i class="ph ph-paperclip text-base md:text-lg"></i>
                </button>
                <button
                    on:click={handleAttachMedia}
                    class="p-2 md:p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:text-purple-600 dark:hover:text-purple-300 hover:border-purple-300 transition disabled:opacity-50"
                    disabled={$isAiLoading || !$aiChatCapabilities.localFilesAvailable}
                    aria-label="附加媒体"
                    title={$aiChatCapabilities.localFilesAvailable ? "附加图片/音频/视频" : "当前环境不可用"}
                >
                    <i class="ph ph-image text-base md:text-lg"></i>
                </button>
                <textarea
                    bind:this={composerTextarea}
                    bind:value={inputText}
                    on:input={syncComposerHeight}
                    on:keydown={(e) =>
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        (e.preventDefault(), handleSend())}
                    rows="1"
                    placeholder={$_("ai_chat.ph")}
                    disabled={$isAiLoading}
                    class="flex-1 min-h-[44px] bg-transparent border-none focus:ring-0 text-sm resize-none py-2 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none disabled:opacity-50"
                ></textarea>
                {#if $isAiLoading}
                    <button
                        on:click={stopStreaming}
                        class="p-2 md:p-2.5 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-xl hover:from-red-600 hover:to-rose-700 active:scale-95 transition-all shadow-lg shadow-red-200"
                        aria-label={$_("ai_chat.stop_generating")}
                    >
                        <i class="ph-bold ph-stop text-base md:text-lg"></i>
                    </button>
                {:else}
                    <button
                        on:click={handleSend}
                        class="p-2 md:p-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 active:scale-95 transition-all disabled:opacity-50 shadow-lg shadow-indigo-200"
                        disabled={!inputText.trim() && !$aiChatComposerAttachments.length}
                        aria-label={$_("common.send")}
                    >
                        <i class="ph-bold ph-paper-plane-right text-base md:text-lg"></i>
                    </button>
                {/if}
            </div>
            <div class="mt-2 text-center text-[10px] text-slate-400 dark:text-slate-500">
                {$_("ai_chat.style_hint", {
                    values: {
                        style:
                            chatStyles.find((s) => s.id === chatStyle)?.name ||
                            $_("ai_chat.chat_style_default"),
                    },
                })}
            </div>
        </div>
    </div>
</div>

{#if lightboxUrl}
    <button
        class="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
        on:click={() => lightboxUrl = null}
        on:keydown={(e) => e.key === 'Escape' && (lightboxUrl = null)}
    >
        <img
            src={lightboxUrl}
            alt="Preview"
            class="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
        />
    </button>
{/if}

<style>
    .safe-top {
        padding-top: max(0.4rem, env(safe-area-inset-top));
    }

    .safe-top-panel {
        padding-top: max(0.85rem, env(safe-area-inset-top) + 0.35rem);
        padding-bottom: 0.85rem;
    }

    .safe-bottom {
        padding-bottom: max(5.25rem, env(safe-area-inset-bottom) + 0.5rem);
    }

    @media (min-width: 768px) {
        .safe-top,
        .safe-top-panel {
            padding-top: 0;
            padding-bottom: 0;
        }

        .safe-bottom {
            padding-bottom: max(1rem, env(safe-area-inset-bottom));
        }
    }

    .markdown-message :global(.markdown-content) {
        font-size: 0.875rem;
        max-width: 100%;
    }

    .markdown-message :global(.markdown-content),
    .markdown-message :global(.markdown-content p),
    .markdown-message :global(.markdown-content li),
    .markdown-message :global(.markdown-content blockquote),
    .markdown-message :global(.markdown-content td),
    .markdown-message :global(.markdown-content th),
    .markdown-message :global(.markdown-content strong),
    .markdown-message :global(.markdown-content em) {
        overflow-wrap: anywhere;
        word-break: break-word;
    }

    .markdown-message :global(.markdown-content a),
    .markdown-message :global(.markdown-content code:not(pre code)) {
        overflow-wrap: anywhere;
        word-break: break-all;
    }

    .markdown-message :global(.markdown-content pre) {
        max-width: 100%;
    }

    .markdown-message :global(.markdown-content pre code) {
        overflow-wrap: normal;
        word-break: normal;
    }

    .user-markdown :global(.markdown-content a) {
        color: #bfdbfe;
        text-decoration: underline;
    }
    .user-markdown :global(.markdown-content code) {
        background: rgba(255, 255, 255, 0.15);
        color: #fff;
    }
    .user-markdown :global(.markdown-content pre) {
        background: rgba(0, 0, 0, 0.2);
        border-color: rgba(255, 255, 255, 0.1);
    }

    @media (max-width: 767px) {
        aside:not(.fixed) {
            display: none;
        }
    }

    /* Message entry animation */
    @keyframes msg-slide-in {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
    }
    :global([data-ai-shell] .flex.gap-2),
    :global([data-ai-shell] .flex.gap-3) {
        animation: msg-slide-in 0.25s ease-out;
    }

    /* Session item hover */
    :global([data-ai-shell] aside .group) {
        transition: all 0.15s ease;
    }
    :global([data-ai-shell] aside .group:hover) {
        transform: translateX(2px);
    }
    :global([data-ai-shell] aside .group:active) {
        transform: scale(0.98);
    }
</style>
