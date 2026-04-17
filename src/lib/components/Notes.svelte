<script>
    import { notesStore, activeNote, notesList, noteCategories } from "../stores/notes.js";
    import { showConfirm, showToast } from "../stores/modal.js";
    import { renderMarkdown } from "../utils/markdown.js";
    import {
        exportToMarkdown,
        exportToHTML,
        exportToPDF,
    } from "../utils/export.js";
    import {
        getEffectiveConfig,
        configureAiPanel,
        showAiPanel,
    } from "../stores/ai.js";
    import { settingsStore } from "../stores/settings.js";
    import { _, locale } from 'svelte-i18n';
    import { get } from 'svelte/store';
    import { toIntlLocale } from '../i18n/index.js';

    function t(key, opts) { return get(_)(key, opts); }

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
    let milkdownEditor = null;
    let milkdownContainer;
    let autoSaveTimer = null;
    let selectedCategory = null;
    $: if (selectedCategory === null) selectedCategory = $_('notes.category_all');
    let showCategoryPanel = false;
    let newCategoryName = '';
    let aiSuggestion = '';
    let aiSuggestionTimer = null;
    let autoSaveEnabled = true;
    export let openDetailPanel = null;

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
        if (milkdownEditor) {
            milkdownEditor = null;
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
                    message: $_('notes.saved'),
                    type: "success",
                    duration: 1500,
                });
            }
        }
    }

    function toggleAutoSave() {
        autoSaveEnabled = !autoSaveEnabled;
        localStorage.setItem("planpro_notes_autosave", String(autoSaveEnabled));
        const t = get(_);
        showToast({
            message: autoSaveEnabled ? t('notes.auto_save_on') : t('notes.auto_save_off'),
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
            placeholder: get(_)('notes.start_typing'),
            cache: { enable: false },
            value: editContent,
            tab: "\t", // Insert tab character on Tab key
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
                    if (!file) return;
                    if (!file.type.startsWith("image/")) {
                        showToast({
                            message: get(_)('notes.only_image'),
                            type: "warning",
                        });
                        return;
                    }
                    try {
                        const dataUrl = await readFileAsDataUrl(file);
                        const safeName = sanitizeUploadName(
                            file.name.replace(/\.[^.]+$/, ""),
                        );
                        vditorInstance?.insertValue(
                            `![${safeName}](${dataUrl})`,
                        );
                    } catch {
                        showToast({
                            message: get(_)('notes.export_failed_short'),
                            type: "error",
                        });
                    }
                },
                filename: (name) => sanitizeUploadName(name),
            },
            input: (value) => {
                editContent = value;
                if (autoSaveEnabled) {
                    scheduleAutoSave();
                }
                if (aiSuggestionTimer) clearTimeout(aiSuggestionTimer);
                aiSuggestion = '';
                aiSuggestionTimer = setTimeout(() => requestAiSuggestion(value), 1500);
            },
            keydown: (e) => {
                if (e.key === 'Tab' && aiSuggestion && !e.shiftKey) {
                    e.preventDefault();
                    if (vditorInstance) {
                        const cur = vditorInstance.getValue();
                        vditorInstance.insertValue(aiSuggestion);
                        aiSuggestion = '';
                    }
                    return true;
                }
            },
            after: () => {
                if (editContent) {
                    vditorInstance.setValue(editContent);
                }
            },
        });
    }

    async function initMilkdown() {
        if (!milkdownContainer) return;
        if (milkdownEditor) {
            milkdownEditor = null;
            milkdownContainer.innerHTML = '';
        }
        const { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } = await import('@milkdown/core');
        const { commonmark } = await import('@milkdown/preset-commonmark');
        const { nord } = await import('@milkdown/theme-nord');
        const { listener, listenerCtx } = await import('@milkdown/plugin-listener');
        milkdownEditor = await Editor.make()
            .config(nord)
            .config((ctx) => {
                ctx.set(rootCtx, milkdownContainer);
                ctx.set(defaultValueCtx, editContent || '');
                ctx.get(listenerCtx).markdownUpdated((ctx, markdown) => {
                    editContent = markdown;
                    if (autoSaveEnabled) {
                        scheduleAutoSave();
                    }
                });
            })
            .use(commonmark)
            .use(listener)
            .create();
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
                    message: get(_)('notes.auto_saved'),
                    type: "success",
                    duration: 1000,
                });
            }
        }, 2000);
    }

    $: filteredNotes = $notesList.filter((note) => {
        const matchesSearch =
            note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            note.content.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory =
            selectedCategory === $_('notes.category_all') || note.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    function getEditor() {
        return $settingsStore.markdownEditor || 'vditor';
    }

    async function initEditor() {
        if (getEditor() === 'milkdown') {
            await initMilkdown();
        } else {
            await initVditor();
        }
    }

    function createNote() {
        const defaultTitle = $_('notes.new_note_title');
        notesStore.addNote({ title: defaultTitle, content: "" });
        editMode = true;
        editTitle = defaultTitle;
        editContent = "";
        editingTitle = true;
        if (isMobile) showSidebar = false;
        tick().then(initEditor);
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
            await initEditor();
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

    function destroyEditor() {
        if (vditorInstance) {
            vditorInstance.destroy();
            vditorInstance = null;
        }
        if (milkdownEditor) {
            milkdownEditor = null;
            if (milkdownContainer) milkdownContainer.innerHTML = '';
        }
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
            destroyEditor();
        }
    }

    function cancelEdit() {
        editMode = false;
        editTitle = "";
        editContent = "";
        editingTitle = false;
        destroyEditor();
    }

    async function deleteNote() {
        if (!$activeNote) return;
        const confirmed = await showConfirm({
            title: $_('notes.delete_note'),
            message: $_('notes.delete_confirm', { values: { title: $activeNote.title } }),
            confirmText: $_('common.delete'),
            cancelText: $_('common.cancel'),
            variant: "danger",
        });
        if (confirmed) {
            notesStore.deleteNote($activeNote.id);
        }
    }

    function openNoteAiAssistant(mode = 'general') {
        if (!$activeNote) return;

        const noteTitle = $activeNote.title || $_('notes.new_note_title');
        const noteCategory = $activeNote.category || $_('notes.category_all');
        const noteContent = ($activeNote.content || '').trim();
        const draft = mode === 'summary'
            ? `我正在整理一篇工作笔记，请基于下面的内容生成一份结构清晰的摘要，并给出后续可执行建议。\n\n标题：${noteTitle}\n分类：${noteCategory}\n内容：\n${noteContent || '（当前为空）'}`
            : `我正在处理一篇工作笔记，请结合下面这篇笔记继续协助我。你可以帮我总结、扩写、润色、拆分行动项，或者回答与内容相关的问题。\n\n标题：${noteTitle}\n分类：${noteCategory}\n内容：\n${noteContent || '（当前为空）'}`;

        configureAiPanel({
            scope: 'notes',
            mode: 'note',
            source: 'notes',
            title: `${noteTitle} · AI`,
            description: noteContent.slice(0, 140) || $_('notes.blank_note'),
            entityLabel: '笔记',
            draft,
            activeNoteId: $activeNote.id,
            noteTitle,
            noteCategory,
            noteContent
        }, true);
        if (openDetailPanel) {
            openDetailPanel('ai');
            return;
        }
        showAiPanel.set(true);
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
            showToast({ message: get(_)('notes.export_failed_short') + ": " + e.message, type: "error" });
        }
    }

    function formatDate(dateStr) {
        const date = new Date(dateStr);
        const localeCode = toIntlLocale($locale || 'zh');
        return date.toLocaleDateString(localeCode, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    function addCategory() {
        const name = newCategoryName.trim();
        if (!name) return;
        notesStore.addCategory(name);
        newCategoryName = '';
    }

    function selectCategory(cat) {
        selectedCategory = cat;
        if (isMobile) showSidebar = false;
    }

    async function requestAiSuggestion(currentText) {
        if (!currentText || currentText.length < 20) return;
        const config = getEffectiveConfig();
        const needsApiKey =
            config.provider !== 'ollama' &&
            config.provider !== 'lmstudio' &&
            !String(config.provider || '').startsWith('g4f');
        if (needsApiKey && !config.apiKey) return;
        const lastLines = currentText.split('\n').slice(-3).join('\n');
        if (lastLines.trim().length < 10) return;
        try {
            const { callAIWithMessages } = await import('../utils/ai-providers.js');
            const result = await callAIWithMessages(
                config,
                [
                    { role: 'system', content: t('notes.ai_autocomplete_system_prompt') },
                    { role: 'user', content: lastLines }
                ]
            );
            if (result && result.trim()) {
                aiSuggestion = result.trim().split('\n')[0].slice(0, 100);
            }
        } catch (e) {
            aiSuggestion = '';
        }
    }

    function toggleSidebar() {
        showSidebar = !showSidebar;
    }

    function sanitizeUploadName(name) {
        return (
            String(name || "image")
                .replace(/[^(a-zA-Z0-9\u4e00-\u9fa5\.)]/g, "")
                .replace(/[\?\\/:|<>\*\[\]\(\)\$%\{\}@~]/g, "")
                .replace(/\s/g, "") || "image"
        );
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target?.result || "");
            reader.onerror = () => reject(new Error("file_read_failed"));
            reader.readAsDataURL(file);
        });
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
                    aria-label={$_('notes.view_list')}
                >
                    <i class="ph ph-list text-xl"></i>
                </button>
            {/if}
            <div>
                <h2 class="text-base md:text-lg font-bold text-emerald-800">
                    {$_('notes.title')}
                </h2>
                <div class="text-[10px] md:text-xs text-slate-500">
                    {$_('notes.subtitle')}
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
                title={autoSaveEnabled ? $_('notes.auto_save_on') : $_('notes.auto_save_off')}
            >
                <i
                    class="ph {autoSaveEnabled
                        ? 'ph-floppy-disk'
                        : 'ph-floppy-disk-back'}"
                ></i>
                <span class="hidden md:inline text-xs"
                    >{autoSaveEnabled ? $_('notes.auto_save') : $_('notes.manual_save')}</span
                >
            </button>
            <button
                on:click={createNote}
                class="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold shadow-md shadow-emerald-200 flex items-center gap-2"
            >
                <i class="ph-bold ph-plus"></i>
                <span class="hidden md:inline">{$_('common.new')}</span>
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
            <div class="p-3 border-b border-slate-100 space-y-2">
                <div class="relative">
                    <input
                        type="text"
                        bind:value={searchQuery}
                        placeholder={$_('notes.search')}
                        class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 pl-9 text-sm focus:outline-none focus:border-emerald-400"
                    />
                    <i class="ph ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                </div>
                <div class="flex gap-1 overflow-x-auto pb-1">
                    {#each $noteCategories as cat}
                        <button
                            on:click={() => selectCategory(cat)}
                            class="shrink-0 px-2.5 py-1 rounded-full text-xs font-bold transition"
                            class:bg-emerald-600={selectedCategory === cat}
                            class:text-white={selectedCategory === cat}
                            class:bg-slate-100={selectedCategory !== cat}
                            class:text-slate-600={selectedCategory !== cat}
                        >{cat}</button>
                    {/each}
                    <button
                        on:click={() => showCategoryPanel = !showCategoryPanel}
                        class="shrink-0 px-2 py-1 rounded-full text-xs text-slate-400 hover:text-emerald-600"
                        title={$_('notes.manage_category')}
                    ><i class="ph ph-plus"></i></button>
                </div>
                {#if showCategoryPanel}
                    <div class="flex gap-1">
                        <input
                            type="text"
                            bind:value={newCategoryName}
                            placeholder={$_('notes.new_category_ph')}
                            on:keydown={(e) => e.key === 'Enter' && addCategory()}
                            class="flex-1 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-400"
                        />
                        <button on:click={addCategory} class="px-2 py-1 bg-emerald-600 text-white rounded text-xs" aria-label={$_('common.add')}>
                            <i class="ph ph-check"></i>
                        </button>
                    </div>
                {/if}
            </div>
            <div class="flex-1 overflow-y-auto">
                {#if filteredNotes.length === 0}
                    <div class="text-center py-8 text-slate-400 text-sm">
                        <i class="ph ph-note-blank text-3xl mb-2"></i>
                        <p>{$_('notes.empty')}</p>
                    </div>
                {:else}
                    {#each filteredNotes as note (note.id)}
                        <button
                            on:click={() => selectNote(note)}
                            class="w-full text-left p-3 border-b border-slate-100 hover:bg-slate-50 transition"
                            class:bg-emerald-50={$activeNote?.id === note.id}
                            class:border-l-4={$activeNote?.id === note.id}
                            class:border-l-emerald-500={$activeNote?.id === note.id}
                        >
                            <div class="flex items-center gap-1 mb-0.5">
                                {#if note.category && note.category !== $_('notes.category_all')}
                                    <span class="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-bold">{note.category}</span>
                                {/if}
                            </div>
                            <div class="font-bold text-slate-700 text-sm truncate">{note.title}</div>
                            <div class="text-xs text-slate-400 mt-1 truncate">{note.content.slice(0, 50) || $_('notes.blank_note')}</div>
                            <div class="text-[10px] text-slate-300 mt-1">{formatDate(note.updatedAt)}</div>
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
                                <i class="ph ph-check"></i> {$_('common.save')}
                            </button>
                            <button
                                on:click={cancelEdit}
                                class="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-200"
                            >
                                {$_('common.cancel')}
                            </button>
                        {:else}
                            <button
                                on:click={startEdit}
                                class="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg"
                                aria-label={$_('task_detail.edit')}
                            >
                                <i class="ph ph-pencil-simple text-lg"></i>
                            </button>
                            <button
                                on:click={() => openNoteAiAssistant('general')}
                                class="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                                title={$_('notes.ai_assistant')}
                            >
                                <i class="ph ph-sparkle text-lg"></i>
                            </button>
                            <button
                                on:click={() => openNoteAiAssistant('summary')}
                                class="p-2 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition"
                                title={$_('notes.ai_preset_prompts')}
                            >
                                <i class="ph ph-text-align-left text-lg"></i>
                            </button>
                            <div class="relative">
                                <button
                                    on:click={() =>
                                        (showExportMenu = !showExportMenu)}
                                    class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                                    aria-label={$_('common.export')}
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
                                aria-label={$_('common.delete')}
                            >
                                <i class="ph ph-trash text-lg"></i>
                            </button>
                        {/if}
                    </div>
                </div>
                {#if $activeNote}
                    <div class="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                        <div class="flex items-center gap-2 rounded-2xl border border-emerald-100 bg-white/90 px-2 py-1 shadow-sm">
                            <div class="hidden md:flex items-center gap-1 text-[10px] text-emerald-700 font-bold tracking-[0.14em] uppercase shrink-0">
                                <i class="ph ph-tag text-xs"></i>
                                <span>{$_('notes.category')}</span>
                            </div>
                            <div class="relative">
                                <i class="ph ph-tag absolute left-3 top-1/2 -translate-y-1/2 text-sm text-emerald-500 pointer-events-none md:hidden"></i>
                                <i class="ph ph-caret-down absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none"></i>
                                <select
                                    value={$activeNote.category || $_('notes.category_all')}
                                    on:change={(e) => notesStore.updateNote($activeNote.id, { category: e.target.value })}
                                    class="appearance-none h-10 min-w-[180px] md:min-w-[220px] rounded-2xl border border-transparent bg-slate-50 px-3 pr-10 md:pl-3 pl-9 text-sm font-semibold text-slate-700 transition focus:outline-none focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-50"
                                >
                                    {#each $noteCategories as cat}
                                        <option value={cat}>{cat}</option>
                                    {/each}
                                </select>
                            </div>
                        </div>
                        <div class="ml-auto text-[10px] text-slate-400 font-medium hidden md:block">
                            {$_('notes.ai_panel_followup_hint')}
                        </div>
                    </div>
                {/if}
                <div class="flex-1 overflow-hidden flex flex-col relative">
                    {#if editMode}
                        {#if aiSuggestion}
                            <div class="absolute bottom-4 left-4 right-4 z-10 pointer-events-none">
                                <div class="bg-slate-800/90 text-slate-300 text-xs px-3 py-2 rounded-lg backdrop-blur flex items-center gap-2">
                                    <i class="ph ph-sparkle text-purple-400"></i>
                                    <span class="flex-1 truncate italic">{aiSuggestion}</span>
                                    <span class="text-slate-500 shrink-0">{$_('notes.tab_accept')}</span>
                                </div>
                            </div>
                        {/if}
                        {#if $settingsStore.markdownEditor === 'milkdown'}
                            <div bind:this={milkdownContainer} class="h-full overflow-y-auto milkdown-container"></div>
                        {:else}
                            <div bind:this={vditorContainer} class="h-full"></div>
                        {/if}
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
                        <p class="text-lg font-bold">{$_('notes.select_or_create')}</p>
                        {#if isMobile}
                            <button
                                on:click={toggleSidebar}
                                class="mt-4 text-emerald-600 font-bold text-sm"
                            >
                                <i class="ph ph-list"></i> {$_('notes.view_list')}
                            </button>
                        {/if}
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>

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
        overflow: visible !important;
    }
    :global(.vditor-toolbar) {
        border-bottom: 1px solid #e2e8f0 !important;
        padding: 8px !important;
        z-index: 10 !important;
        overflow: visible !important;
    }
    :global(.vditor-reset),
    :global(.vditor-toolbar__item) {
        overflow: visible !important;
    }
    :global(.vditor-ir) {
        padding: 16px !important;
    }
    :global(.vditor-hint) {
        z-index: 200 !important;
    }
    :global(.vditor-tip) {
        z-index: 200 !important;
        top: auto !important;
        bottom: 100% !important;
        margin-bottom: 8px !important;
    }
    :global(.vditor-toolbar__item) {
        position: relative !important;
    }
    :global(.vditor-panel),
    :global(.vditor-panel--arrow) {
        z-index: 200 !important;
    }
    :global(.vditor-tooltipped::after),
    :global(.vditor-tooltipped::before) {
        z-index: 201 !important;
    }
    :global(.milkdown-container) {
        height: 100%;
        overflow-y: auto;
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        color: #0f172a;
        padding: 24px;
    }
    :global(.milkdown-container .editor) {
        min-height: 100%;
    }
    :global(.milkdown-container .ProseMirror) {
        min-height: calc(100vh - 16rem);
        max-width: none;
        padding: 28px 32px;
        background: rgba(255, 255, 255, 0.94);
        border: 1px solid #dbeafe;
        border-radius: 20px;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
        font-size: 15px;
        line-height: 1.8;
        color: #0f172a;
    }
    :global(.milkdown-container .ProseMirror:focus) {
        outline: none;
        border-color: #60a5fa;
        box-shadow: 0 20px 50px rgba(59, 130, 246, 0.16);
    }
    :global(.milkdown-container .ProseMirror h1),
    :global(.milkdown-container .ProseMirror h2),
    :global(.milkdown-container .ProseMirror h3) {
        color: #0f172a;
    }
    :global(.dark .milkdown-container) {
        background: linear-gradient(180deg, #0f172a 0%, #111827 100%);
        color: #e2e8f0;
    }
    :global(.dark .milkdown-container .ProseMirror) {
        background: rgba(15, 23, 42, 0.92);
        border-color: #334155;
        color: #e2e8f0;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
    }
    :global(.dark .milkdown-container .ProseMirror h1),
    :global(.dark .milkdown-container .ProseMirror h2),
    :global(.dark .milkdown-container .ProseMirror h3),
    :global(.dark .milkdown-container .ProseMirror p),
    :global(.dark .milkdown-container .ProseMirror li),
    :global(.dark .milkdown-container .ProseMirror strong) {
        color: #e2e8f0;
    }
    :global(.dark .milkdown-container .ProseMirror code) {
        background: #0f172a;
        color: #fda4af;
    }
</style>
