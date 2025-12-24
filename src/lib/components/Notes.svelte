<script>
    import { notesStore, activeNote, notesList } from "../stores/notes.js";
    import { showConfirm, showToast } from "../stores/modal.js";
    import { renderMarkdown } from "../utils/markdown.js";
    import {
        exportToMarkdown,
        exportToHTML,
        exportToPDF,
    } from "../utils/export.js";
    import {
        aiConfig,
        getEffectiveConfig,
        streamingContent,
    } from "../stores/ai.js";
    import { isG4FProvider } from "../utils/g4f-client.js";
    import MarkdownRenderer from "./MarkdownRenderer.svelte";
    import { onMount, onDestroy, tick } from "svelte";
    import "vditor/dist/index.css";

    let editMode = false;
    let editContent = "";
    let editTitle = "";
    let searchQuery = "";
    let previewElement;
    let showSidebar = false;
    let showExportMenu = false;
    let editingTitle = false;
    let isMobile = false;
    let vditorInstance = null;
    let vditorContainer;
    let autoSaveTimer = null;
    let summarizing = false;
    let autoSaveEnabled = true;
    let showAiPanel = false;
    let aiMessages = [];
    let aiLoading = false;

    onMount(async () => {
        notesStore.load();
        isMobile = window.innerWidth < 768;
        window.addEventListener("resize", handleResize);
        document.addEventListener("keydown", handleKeydown);
        const saved = localStorage.getItem("planpro_notes_autosave");
        if (saved !== null) {
            autoSaveEnabled = saved === "true";
        }
    });

    onDestroy(() => {
        window.removeEventListener("resize", handleResize);
        document.removeEventListener("keydown", handleKeydown);
        if (vditorInstance) {
            vditorInstance.destroy();
        }
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
        }
    });

    function handleResize() {
        isMobile = window.innerWidth < 768;
    }

    function handleKeydown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            if (editMode && $activeNote) {
                saveNote();
                showToast({
                    message: "已保存",
                    type: "success",
                    duration: 1500,
                });
            }
        }
    }

    function toggleAutoSave() {
        autoSaveEnabled = !autoSaveEnabled;
        localStorage.setItem("planpro_notes_autosave", String(autoSaveEnabled));
        showToast({
            message: autoSaveEnabled ? "自动保存已开启" : "自动保存已关闭",
            type: "info",
            duration: 1500,
        });
    }

    async function initVditor() {
        if (!vditorContainer) return;
        if (vditorInstance) {
            vditorInstance.destroy();
        }
        const Vditor = (await import("vditor")).default;

        vditorInstance = new Vditor(vditorContainer, {
            height: "100%",
            mode: "ir",
            theme: "classic",
            icon: "material",
            placeholder: "开始输入内容...支持 Markdown 格式",
            cache: { enable: false },
            value: editContent,
            toolbarConfig: {
                pin: true,
                hide: false,
            },
            hint: {
                delay: 200,
                emoji: {},
            },
            toolbar: [
                "headings",
                "bold",
                "italic",
                "strike",
                "|",
                "list",
                "ordered-list",
                "check",
                "quote",
                "|",
                "code",
                "inline-code",
                "link",
                "|",
                "table",
                "line",
                "|",
                "undo",
                "redo",
                "|",
                "fullscreen",
                "preview",
            ],
            upload: {
                accept: "image/*",
                multiple: false,
                max: 10 * 1024 * 1024,
                handler: async (files) => {
                    const file = files[0];
                    if (!file) return null;
                    if (file.type.startsWith("image/")) {
                        return new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                resolve(e.target.result);
                            };
                            reader.readAsDataURL(file);
                        });
                    } else {
                        showToast({
                            message: "仅支持图片上传",
                            type: "warning",
                        });
                        return null;
                    }
                },
                filename: (name) =>
                    name
                        .replace(/[^(a-zA-Z0-9\u4e00-\u9fa5\.)]/g, "")
                        .replace(/[\?\\/:|<>\*\[\]\(\)\$%\{\}@~]/g, "")
                        .replace("/\\s/g", ""),
            },
            input: (value) => {
                editContent = value;
                if (autoSaveEnabled) {
                    scheduleAutoSave();
                }
            },
            after: () => {
                if (editContent) {
                    vditorInstance.setValue(editContent);
                }
            },
        });
    }

    function scheduleAutoSave() {
        if (!autoSaveEnabled) return;
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
        }
        autoSaveTimer = setTimeout(() => {
            if ($activeNote && editMode) {
                notesStore.updateNote($activeNote.id, {
                    title: editTitle,
                    content: editContent,
                });
                showToast({
                    message: "已自动保存",
                    type: "success",
                    duration: 1000,
                });
            }
        }, 2000);
    }

    $: filteredNotes = $notesList.filter(
        (note) =>
            note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            note.content.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    function createNote() {
        notesStore.addNote({ title: "新笔记", content: "" });
        editMode = true;
        editTitle = "新笔记";
        editContent = "";
        editingTitle = true;
        if (isMobile) showSidebar = false;
        tick().then(initVditor);
    }

    function selectNote(note) {
        notesStore.setActiveNote(note.id);
        editMode = false;
        editingTitle = false;
        if (isMobile) showSidebar = false;
    }

    async function startEdit() {
        if ($activeNote) {
            editTitle = $activeNote.title;
            editContent = $activeNote.content;
            editMode = true;
            await tick();
            await initVditor();
        }
    }

    function startEditTitle() {
        if ($activeNote) {
            editTitle = $activeNote.title;
            editingTitle = true;
        }
    }

    function saveTitle() {
        if ($activeNote && editTitle.trim()) {
            notesStore.updateNote($activeNote.id, { title: editTitle.trim() });
        }
        editingTitle = false;
    }

    function saveNote() {
        if ($activeNote) {
            if (vditorInstance) {
                editContent = vditorInstance.getValue();
            }
            notesStore.updateNote($activeNote.id, {
                title: editTitle,
                content: editContent,
            });
            editMode = false;
            editingTitle = false;
            if (vditorInstance) {
                vditorInstance.destroy();
                vditorInstance = null;
            }
        }
    }

    function cancelEdit() {
        editMode = false;
        editTitle = "";
        editContent = "";
        editingTitle = false;
        if (vditorInstance) {
            vditorInstance.destroy();
            vditorInstance = null;
        }
    }

    async function deleteNote() {
        if (!$activeNote) return;
        const confirmed = await showConfirm({
            title: "删除笔记",
            message: `确定要删除"${$activeNote.title}"吗？`,
            confirmText: "删除",
            cancelText: "取消",
            variant: "danger",
        });
        if (confirmed) {
            notesStore.deleteNote($activeNote.id);
            showAiPanel = false;
            aiMessages = [];
        }
    }

    function toggleAiPanel() {
        showAiPanel = !showAiPanel;
        if (showAiPanel && aiMessages.length === 0 && $activeNote) {
            aiMessages = [
                {
                    role: "assistant",
                    type: "text",
                    content: `我是您的笔记助手，可以帮您总结笔记 "${$activeNote.title}" 的内容。\n\n点击下方按钮开始总结，或输入其他问题。`,
                },
            ];
        }
    }

    async function summarizeNote() {
        if (!$activeNote || !$activeNote.content) {
            showToast({ message: "笔记内容为空", type: "warning" });
            return;
        }
        const config = getEffectiveConfig();
        const needsApiKey =
            !isG4FProvider(config.provider) &&
            config.provider !== "ollama" &&
            config.provider !== "lmstudio";
        if (needsApiKey && !config.apiKey) {
            showToast({ message: "请先配置 AI API Key", type: "warning" });
            return;
        }
        aiLoading = true;
        aiMessages = [
            ...aiMessages,
            { role: "user", type: "text", content: "请总结这篇笔记" },
        ];
        aiMessages = [
            ...aiMessages,
            {
                role: "assistant",
                type: "streaming",
                content: "",
                isStreaming: true,
            },
        ];
        const streamingIndex = aiMessages.length - 1;
        try {
            const { callAIWithMessagesStream } = await import(
                "../utils/ai-providers.js"
            );
            const systemPrompt = `你是一个专业的文档总结助手。请对以下笔记内容进行总结，提取关键信息和要点。
笔记标题：${$activeNote.title}
笔记内容：
${$activeNote.content}
要求：
1. 保持简洁，突出重点
2. 使用 Markdown 格式
3. 包含：主要内容概述、关键要点（用列表）、如有待办事项请标注
4. 总结字数控制在原文的 1/3 以内`;
            const messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: "请总结这篇笔记" },
            ];
            const onChunk = (delta, fullContent) => {
                aiMessages = aiMessages.map((msg, idx) =>
                    idx === streamingIndex
                        ? { ...msg, content: fullContent, isStreaming: true }
                        : msg,
                );
            };
            const result = await callAIWithMessagesStream(
                config,
                messages,
                onChunk,
            );
            aiMessages = aiMessages.map((msg, idx) =>
                idx === streamingIndex
                    ? {
                          role: "assistant",
                          type: "text",
                          content: result || "总结生成失败",
                          isStreaming: false,
                      }
                    : msg,
            );
        } catch (error) {
            aiMessages = aiMessages.map((msg, idx) =>
                idx === streamingIndex
                    ? {
                          role: "assistant",
                          type: "error",
                          content: error.message,
                      }
                    : msg,
            );
            showToast({
                message: "AI总结失败: " + error.message,
                type: "error",
            });
        } finally {
            aiLoading = false;
        }
    }

    async function handleExport(type) {
        if (!$activeNote) return;
        showExportMenu = false;
        const filename = $activeNote.title.replace(
            /[^a-zA-Z0-9\u4e00-\u9fa5]/g,
            "_",
        );
        try {
            if (type === "markdown") {
                exportToMarkdown($activeNote.content, `${filename}.md`, {
                    showToast,
                });
            } else if (type === "html") {
                const html = renderMarkdown($activeNote.content);
                exportToHTML(html, `${filename}.html`, $activeNote.title, {
                    showToast,
                });
            } else if (type === "pdf") {
                if (previewElement) {
                    await exportToPDF(previewElement, `${filename}.pdf`, {
                        width: "a4",
                        showToast,
                    });
                }
            }
        } catch (e) {
            showToast({ message: "导出失败: " + e.message, type: "error" });
        }
    }

    function formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString("zh-CN", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    function toggleSidebar() {
        showSidebar = !showSidebar;
    }

    function copyAiMessage(content) {
        if (navigator.clipboard && content) {
            navigator.clipboard.writeText(content);
            showToast({ message: "已复制", type: "success", duration: 1500 });
        }
    }

    function saveAsSummaryNote() {
        const lastAssistantMsg = aiMessages
            .filter((m) => m.role === "assistant" && m.type === "text")
            .pop();
        if (lastAssistantMsg && lastAssistantMsg.content) {
            const summaryNote = {
                title: `[总结] ${$activeNote.title}`,
                content: `# ${$activeNote.title} - AI总结\n\n${lastAssistantMsg.content}\n\n---\n*由 AI 自动生成于 ${new Date().toLocaleString()}*`,
            };
            notesStore.addNote(summaryNote);
            showToast({ message: "AI总结已保存为新笔记", type: "success" });
        }
    }
</script>

<div class="flex flex-col h-screen md:h-full overflow-hidden bg-slate-50">
    <header
        class="h-14 md:h-16 bg-white/90 backdrop-blur px-4 md:px-6 flex justify-between items-center z-10 sticky top-0 border-b border-slate-200 shrink-0"
    >
        <div class="flex items-center gap-2">
            {#if isMobile}
                <button
                    on:click={toggleSidebar}
                    class="p-2 text-slate-500 hover:bg-slate-100 rounded-lg"
                >
                    <i class="ph ph-list text-xl"></i>
                </button>
            {/if}
            <div>
                <h2 class="text-base md:text-lg font-bold text-emerald-800">
                    工作笔记
                </h2>
                <div class="text-[10px] md:text-xs text-slate-500">
                    支持 Markdown
                </div>
            </div>
        </div>
        <div class="flex items-center gap-2">
            <button
                on:click={toggleAutoSave}
                class="h-9 px-3 rounded-lg text-sm font-medium flex items-center gap-1.5 transition"
                class:bg-emerald-100={autoSaveEnabled}
                class:text-emerald-700={autoSaveEnabled}
                class:bg-slate-100={!autoSaveEnabled}
                class:text-slate-500={!autoSaveEnabled}
                title={autoSaveEnabled ? "自动保存已开启" : "自动保存已关闭"}
            >
                <i
                    class="ph {autoSaveEnabled
                        ? 'ph-floppy-disk'
                        : 'ph-floppy-disk-back'}"
                ></i>
                <span class="hidden md:inline text-xs"
                    >{autoSaveEnabled ? "自动" : "手动"}</span
                >
            </button>
            <button
                on:click={createNote}
                class="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold shadow-md shadow-emerald-200 flex items-center gap-2"
            >
                <i class="ph-bold ph-plus"></i>
                <span class="hidden md:inline">新建</span>
            </button>
        </div>
    </header>
    <div class="flex flex-1 overflow-hidden relative">
        {#if isMobile && showSidebar}
            <div
                class="absolute inset-0 bg-black/30 z-20"
                on:click={() => (showSidebar = false)}
                on:keydown={() => (showSidebar = false)}
                role="button"
                tabindex="0"
            ></div>
        {/if}
        <div
            class="w-64 md:w-72 bg-white border-r border-slate-200 flex flex-col shrink-0 absolute md:relative z-30 h-full transition-transform duration-200"
            class:translate-x-0={!isMobile || showSidebar}
            class:-translate-x-full={isMobile && !showSidebar}
        >
            <div class="p-3 border-b border-slate-100">
                <div class="relative">
                    <input
                        type="text"
                        bind:value={searchQuery}
                        placeholder="搜索笔记..."
                        class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 pl-9 text-sm focus:outline-none focus:border-emerald-400"
                    />
                    <i
                        class="ph ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    ></i>
                </div>
            </div>
            <div class="flex-1 overflow-y-auto">
                {#if filteredNotes.length === 0}
                    <div class="text-center py-8 text-slate-400 text-sm">
                        <i class="ph ph-note-blank text-3xl mb-2"></i>
                        <p>暂无笔记</p>
                    </div>
                {:else}
                    {#each filteredNotes as note (note.id)}
                        <button
                            on:click={() => selectNote(note)}
                            class="w-full text-left p-3 border-b border-slate-100 hover:bg-slate-50 transition"
                            class:bg-emerald-50={$activeNote?.id === note.id}
                            class:border-l-4={$activeNote?.id === note.id}
                            class:border-l-emerald-500={$activeNote?.id ===
                                note.id}
                        >
                            <div
                                class="font-bold text-slate-700 text-sm truncate"
                            >
                                {note.title}
                            </div>
                            <div class="text-xs text-slate-400 mt-1 truncate">
                                {note.content.slice(0, 50) || "空白笔记"}
                            </div>
                            <div class="text-[10px] text-slate-300 mt-1">
                                {formatDate(note.updatedAt)}
                            </div>
                        </button>
                    {/each}
                {/if}
            </div>
        </div>
        <div class="flex-1 flex flex-col overflow-hidden min-w-0">
            {#if $activeNote}
                <div
                    class="h-12 bg-white border-b border-slate-100 flex items-center justify-between px-4 shrink-0"
                >
                    <div class="flex-1 min-w-0">
                        {#if editingTitle || editMode}
                            <input
                                type="text"
                                bind:value={editTitle}
                                on:blur={saveTitle}
                                on:keydown={(e) =>
                                    e.key === "Enter" && saveTitle()}
                                class="w-full font-bold text-lg text-slate-800 focus:outline-none bg-transparent border-b-2 border-emerald-400"
                            />
                        {:else}
                            <button
                                on:click={startEditTitle}
                                class="font-bold text-lg text-slate-800 hover:text-emerald-600 truncate block w-full text-left"
                            >
                                {$activeNote.title}
                            </button>
                        {/if}
                    </div>
                    <div class="flex items-center gap-1 md:gap-2 shrink-0 ml-2">
                        {#if editMode}
                            <button
                                on:click={saveNote}
                                class="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700"
                            >
                                <i class="ph ph-check"></i> 保存
                            </button>
                            <button
                                on:click={cancelEdit}
                                class="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-200"
                            >
                                取消
                            </button>
                        {:else}
                            <button
                                on:click={startEdit}
                                class="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg"
                            >
                                <i class="ph ph-pencil-simple text-lg"></i>
                            </button>
                            <button
                                on:click={toggleAiPanel}
                                class="p-2 rounded-lg transition"
                                class:text-indigo-600={showAiPanel}
                                class:bg-indigo-50={showAiPanel}
                                class:text-slate-400={!showAiPanel}
                                class:hover:text-indigo-600={!showAiPanel}
                                class:hover:bg-indigo-50={!showAiPanel}
                                title="AI 助手"
                            >
                                <i class="ph ph-sparkle text-lg"></i>
                            </button>
                            <div class="relative">
                                <button
                                    on:click={() =>
                                        (showExportMenu = !showExportMenu)}
                                    class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                                >
                                    <i class="ph ph-export text-lg"></i>
                                </button>
                                {#if showExportMenu}
                                    <div
                                        class="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50 min-w-[140px]"
                                    >
                                        <button
                                            on:click={() =>
                                                handleExport("markdown")}
                                            class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2"
                                        >
                                            <i
                                                class="ph ph-file-md text-lg text-slate-500"
                                            ></i> Markdown
                                        </button>
                                        <button
                                            on:click={() =>
                                                handleExport("html")}
                                            class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2"
                                        >
                                            <i
                                                class="ph ph-file-html text-lg text-orange-500"
                                            ></i> HTML
                                        </button>
                                        <button
                                            on:click={() => handleExport("pdf")}
                                            class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2"
                                        >
                                            <i
                                                class="ph ph-file-pdf text-lg text-red-500"
                                            ></i> PDF
                                        </button>
                                    </div>
                                {/if}
                            </div>
                            <button
                                on:click={deleteNote}
                                class="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                            >
                                <i class="ph ph-trash text-lg"></i>
                            </button>
                        {/if}
                    </div>
                </div>
                <div class="flex-1 overflow-hidden flex flex-col">
                    {#if editMode}
                        <div bind:this={vditorContainer} class="h-full"></div>
                    {:else}
                        <div
                            class="h-full overflow-y-auto p-4 md:p-6 overscroll-contain"
                            style="-webkit-overflow-scrolling: touch;"
                        >
                            <div
                                bind:this={previewElement}
                                class="prose prose-sm max-w-none pb-20"
                            >
                                <MarkdownRenderer
                                    content={$activeNote.content}
                                />
                            </div>
                        </div>
                    {/if}
                </div>
            {:else}
                <div
                    class="flex-1 flex items-center justify-center text-slate-400"
                >
                    <div class="text-center">
                        <i class="ph ph-notebook text-5xl mb-4"></i>
                        <p class="text-lg font-bold">选择或创建一个笔记</p>
                        {#if isMobile}
                            <button
                                on:click={toggleSidebar}
                                class="mt-4 text-emerald-600 font-bold text-sm"
                            >
                                <i class="ph ph-list"></i> 查看笔记列表
                            </button>
                        {/if}
                    </div>
                </div>
            {/if}
        </div>
        {#if showAiPanel && !isMobile && $activeNote}
            <aside
                class="w-[350px] bg-white border-l border-slate-200 flex flex-col shrink-0 h-full shadow-[-4px_0_15px_rgba(0,0,0,0.02)]"
            >
                <div
                    class="h-12 border-b border-indigo-100 flex items-center justify-between px-4 bg-indigo-50/50"
                >
                    <div
                        class="font-bold text-indigo-700 flex items-center gap-2 text-sm"
                    >
                        <i class="ph-fill ph-sparkle"></i> AI 笔记助手
                    </div>
                    <button
                        on:click={() => (showAiPanel = false)}
                        class="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                    >
                        <i class="ph ph-x text-lg"></i>
                    </button>
                </div>
                <div class="flex-1 overflow-y-auto p-4 space-y-3">
                    {#each aiMessages as msg, index}
                        <div
                            class="flex gap-2"
                            class:flex-row-reverse={msg.role === "user"}
                        >
                            <div
                                class="w-7 h-7 rounded-full shrink-0 flex items-center justify-center"
                                class:bg-blue-100={msg.role === "user"}
                                class:text-blue-600={msg.role === "user"}
                                class:bg-indigo-100={msg.role !== "user"}
                                class:text-indigo-600={msg.role !== "user"}
                            >
                                <i
                                    class={msg.role === "user"
                                        ? "ph-fill ph-user text-sm"
                                        : "ph-fill ph-sparkle text-sm"}
                                ></i>
                            </div>
                            <div class="max-w-[85%] group">
                                {#if msg.type === "text"}
                                    <div
                                        class="p-2.5 rounded-2xl text-xs shadow-sm"
                                        class:bg-blue-600={msg.role === "user"}
                                        class:text-white={msg.role === "user"}
                                        class:rounded-tr-none={msg.role ===
                                            "user"}
                                        class:bg-white={msg.role !== "user"}
                                        class:border={msg.role !== "user"}
                                        class:border-indigo-100={msg.role !==
                                            "user"}
                                        class:text-slate-700={msg.role !==
                                            "user"}
                                        class:rounded-tl-none={msg.role !==
                                            "user"}
                                    >
                                        <MarkdownRenderer
                                            content={msg.content}
                                        />
                                    </div>
                                    {#if msg.role === "assistant"}
                                        <div
                                            class="mt-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <button
                                                on:click={() =>
                                                    copyAiMessage(msg.content)}
                                                class="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded text-xs"
                                            >
                                                <i class="ph ph-copy"></i>
                                            </button>
                                            <button
                                                on:click={saveAsSummaryNote}
                                                class="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded text-xs"
                                                title="保存为新笔记"
                                            >
                                                <i class="ph ph-floppy-disk"
                                                ></i>
                                            </button>
                                        </div>
                                    {/if}
                                {:else if msg.type === "streaming"}
                                    <div
                                        class="p-2.5 rounded-2xl text-xs shadow-sm bg-white border border-indigo-100 text-slate-700 rounded-tl-none"
                                    >
                                        <MarkdownRenderer
                                            content={msg.content || ""}
                                        />
                                        {#if msg.isStreaming}
                                            <div class="flex gap-1 mt-2">
                                                <div
                                                    class="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
                                                    style="animation-delay: 0ms"
                                                ></div>
                                                <div
                                                    class="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
                                                    style="animation-delay: 150ms"
                                                ></div>
                                                <div
                                                    class="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
                                                    style="animation-delay: 300ms"
                                                ></div>
                                            </div>
                                        {/if}
                                    </div>
                                {:else if msg.type === "error"}
                                    <div
                                        class="p-2.5 rounded-2xl text-xs shadow-sm bg-red-50 border border-red-200 text-red-700 rounded-tl-none"
                                    >
                                        <i class="ph-fill ph-warning-circle"
                                        ></i>
                                        {msg.content}
                                    </div>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
                <div class="p-3 border-t border-slate-100 bg-white">
                    <button
                        on:click={summarizeNote}
                        disabled={aiLoading || !$activeNote?.content}
                        class="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {#if aiLoading}
                            <i class="ph ph-spinner animate-spin"></i> 生成中...
                        {:else}
                            <i class="ph ph-sparkle"></i> AI 总结笔记
                        {/if}
                    </button>
                </div>
            </aside>
        {/if}
    </div>
</div>

{#if showAiPanel && isMobile && $activeNote}
    <div class="fixed inset-0 z-50 bg-white flex flex-col">
        <div
            class="h-14 border-b border-indigo-100 flex items-center justify-between px-4 bg-indigo-50/50 shrink-0"
        >
            <button
                on:click={() => (showAiPanel = false)}
                class="text-slate-500 flex items-center gap-1 font-bold text-sm"
            >
                <i class="ph-bold ph-caret-left text-lg"></i> 返回
            </button>
            <div
                class="font-bold text-indigo-700 flex items-center gap-2 text-sm"
            >
                <i class="ph-fill ph-sparkle"></i> AI 笔记助手
            </div>
            <div class="w-16"></div>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-3">
            {#each aiMessages as msg}
                <div
                    class="flex gap-2"
                    class:flex-row-reverse={msg.role === "user"}
                >
                    <div
                        class="w-8 h-8 rounded-full shrink-0 flex items-center justify-center"
                        class:bg-blue-100={msg.role === "user"}
                        class:text-blue-600={msg.role === "user"}
                        class:bg-indigo-100={msg.role !== "user"}
                        class:text-indigo-600={msg.role !== "user"}
                    >
                        <i
                            class={msg.role === "user"
                                ? "ph-fill ph-user"
                                : "ph-fill ph-sparkle"}
                        ></i>
                    </div>
                    <div class="max-w-[85%]">
                        {#if msg.type === "text"}
                            <div
                                class="p-3 rounded-2xl text-sm shadow-sm"
                                class:bg-blue-600={msg.role === "user"}
                                class:text-white={msg.role === "user"}
                                class:rounded-tr-none={msg.role === "user"}
                                class:bg-white={msg.role !== "user"}
                                class:border={msg.role !== "user"}
                                class:border-indigo-100={msg.role !== "user"}
                                class:text-slate-700={msg.role !== "user"}
                                class:rounded-tl-none={msg.role !== "user"}
                            >
                                <MarkdownRenderer content={msg.content} />
                            </div>
                            {#if msg.role === "assistant"}
                                <div class="mt-2 flex gap-2">
                                    <button
                                        on:click={() =>
                                            copyAiMessage(msg.content)}
                                        class="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold"
                                    >
                                        <i class="ph ph-copy"></i> 复制
                                    </button>
                                    <button
                                        on:click={saveAsSummaryNote}
                                        class="px-3 py-1.5 bg-emerald-100 text-emerald-600 rounded-lg text-xs font-bold"
                                    >
                                        <i class="ph ph-floppy-disk"></i> 保存
                                    </button>
                                </div>
                            {/if}
                        {:else if msg.type === "streaming"}
                            <div
                                class="p-3 rounded-2xl text-sm shadow-sm bg-white border border-indigo-100 text-slate-700 rounded-tl-none"
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
                        {:else if msg.type === "error"}
                            <div
                                class="p-3 rounded-2xl text-sm shadow-sm bg-red-50 border border-red-200 text-red-700 rounded-tl-none"
                            >
                                <i class="ph-fill ph-warning-circle"></i>
                                {msg.content}
                            </div>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
        <div class="p-4 border-t border-slate-100 bg-white safe-bottom">
            <button
                on:click={summarizeNote}
                disabled={aiLoading || !$activeNote?.content}
                class="w-full py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
                {#if aiLoading}
                    <i class="ph ph-spinner animate-spin"></i> 生成中...
                {:else}
                    <i class="ph ph-sparkle"></i> AI 总结笔记
                {/if}
            </button>
        </div>
    </div>
{/if}

{#if showExportMenu}
    <div
        class="fixed inset-0 z-40"
        on:click={() => (showExportMenu = false)}
        on:keydown={() => (showExportMenu = false)}
        role="button"
        tabindex="0"
    ></div>
{/if}

<style>
    :global(.vditor) {
        border: none !important;
    }
    :global(.vditor-toolbar) {
        border-bottom: 1px solid #e2e8f0 !important;
        padding: 8px !important;
        z-index: 10 !important;
    }
    :global(.vditor-ir) {
        padding: 16px !important;
    }
    :global(.vditor-hint) {
        z-index: 100 !important;
    }
    :global(.vditor-tip) {
        z-index: 100 !important;
        top: auto !important;
        bottom: 100% !important;
        margin-bottom: 8px !important;
    }
    :global(.vditor-toolbar__item) {
        position: relative !important;
    }
    :global(.vditor-panel--arrow) {
        z-index: 100 !important;
    }
    :global(.vditor-tooltipped::after),
    :global(.vditor-tooltipped::before) {
        z-index: 101 !important;
    }
    .safe-bottom {
        padding-bottom: max(1rem, env(safe-area-inset-bottom));
    }
</style>