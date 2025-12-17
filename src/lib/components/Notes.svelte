<script>
    import { notesStore, activeNote, notesList } from '../stores/notes.js';
    import { showConfirm, showToast } from '../stores/modal.js';
    import { renderMarkdown } from '../utils/markdown.js';
    import { exportToMarkdown, exportToHTML, exportToPDF } from '../utils/export.js';
    import MarkdownRenderer from './MarkdownRenderer.svelte';
    import { onMount } from 'svelte';

    let editMode = false;
    let editContent = '';
    let editTitle = '';
    let searchQuery = '';
    let previewElement;
    let showSidebar = false;
    let showExportMenu = false;
    let editingTitle = false;
    let isMobile = false;

    onMount(() => {
        notesStore.load();
        isMobile = window.innerWidth < 768;
        window.addEventListener('resize', () => {
            isMobile = window.innerWidth < 768;
        });
    });

    $: filteredNotes = $notesList.filter(note => 
        note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.content.toLowerCase().includes(searchQuery.toLowerCase())
    );

    function createNote() {
        notesStore.addNote({ title: '新笔记', content: '' });
        editMode = true;
        editTitle = '新笔记';
        editContent = '';
        editingTitle = true;
        if (isMobile) showSidebar = false;
    }

    function selectNote(note) {
        notesStore.setActiveNote(note.id);
        editMode = false;
        editingTitle = false;
        if (isMobile) showSidebar = false;
    }

    function startEdit() {
        if ($activeNote) {
            editTitle = $activeNote.title;
            editContent = $activeNote.content;
            editMode = true;
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
            notesStore.updateNote($activeNote.id, {
                title: editTitle,
                content: editContent
            });
            editMode = false;
            editingTitle = false;
        }
    }

    function cancelEdit() {
        editMode = false;
        editTitle = '';
        editContent = '';
        editingTitle = false;
    }

    async function deleteNote() {
        if (!$activeNote) return;
        const confirmed = await showConfirm({
            title: '删除笔记',
            message: `确定要删除"${$activeNote.title}"吗？`,
            confirmText: '删除',
            cancelText: '取消',
            variant: 'danger'
        });
        if (confirmed) {
            notesStore.deleteNote($activeNote.id);
        }
    }

    async function handleExport(type) {
        if (!$activeNote) return;
        showExportMenu = false;
        const filename = $activeNote.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
        
        try {
            if (type === 'markdown') {
                exportToMarkdown($activeNote.content, `${filename}.md`, { showToast });
            } else if (type === 'html') {
                const html = renderMarkdown($activeNote.content);
                exportToHTML(html, `${filename}.html`, $activeNote.title, { showToast });
            } else if (type === 'pdf') {
                if (previewElement) {
                    await exportToPDF(previewElement, `${filename}.pdf`, { width: 'a4', showToast });
                }
            }
        } catch (e) {
            showToast({ message: '导出失败: ' + e.message, type: 'error' });
        }
    }

    function formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function simplifyBase64(text) {
        return text.replace(/!\[([^\]]*)\]\(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+\)/g, (match, alt) => {
            return `![${alt || 'image'}](data:image/...base64...)`;
        });
    }

    function getDisplayContent(content) {
        if (editMode) {
            return simplifyBase64(content);
        }
        return content;
    }

    function handlePaste(e) {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const base64 = event.target.result;
                        const imageMarkdown = `\n![image](${base64})\n`;
                        editContent += imageMarkdown;
                    };
                    reader.readAsDataURL(file);
                }
                return;
            }

            if (item.type === 'text/plain') {
                item.getAsString((text) => {
                    const urlPattern = /^https?:\/\/[^\s]+$/;
                    if (urlPattern.test(text.trim())) {
                        e.preventDefault();
                        const linkMarkdown = `[链接名称](${text.trim()})`;
                        const textarea = e.target;
                        const start = textarea.selectionStart;
                        const end = textarea.selectionEnd;
                        editContent = editContent.substring(0, start) + linkMarkdown + editContent.substring(end);
                        setTimeout(() => {
                            textarea.selectionStart = start + 1;
                            textarea.selectionEnd = start + 5;
                            textarea.focus();
                        }, 0);
                    }
                });
            }
        }
    }

    function toggleSidebar() {
        showSidebar = !showSidebar;
    }
</script>

<div class="flex flex-col h-screen md:h-full overflow-hidden bg-slate-50">
    <header class="h-14 md:h-16 bg-white/90 backdrop-blur px-4 md:px-6 flex justify-between items-center z-10 sticky top-0 border-b border-slate-200 shrink-0">
        <div class="flex items-center gap-2">
            {#if isMobile}
                <button on:click={toggleSidebar} class="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
                    <i class="ph ph-list text-xl"></i>
                </button>
            {/if}
            <div>
                <h2 class="text-base md:text-lg font-bold text-emerald-800">工作笔记</h2>
                <div class="text-[10px] md:text-xs text-slate-500">支持 Markdown</div>
            </div>
        </div>
        <button on:click={createNote}
            class="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold shadow-md shadow-emerald-200 flex items-center gap-2">
            <i class="ph-bold ph-plus"></i>
            <span class="hidden md:inline">新建</span>
        </button>
    </header>

    <div class="flex flex-1 overflow-hidden relative">
        {#if isMobile && showSidebar}
            <div class="absolute inset-0 bg-black/30 z-20" on:click={() => showSidebar = false} on:keydown={() => showSidebar = false} role="button" tabindex="0"></div>
        {/if}

        <div class="w-64 md:w-72 bg-white border-r border-slate-200 flex flex-col shrink-0 absolute md:relative z-30 h-full transition-transform duration-200"
            class:translate-x-0={!isMobile || showSidebar}
            class:-translate-x-full={isMobile && !showSidebar}>
            <div class="p-3 border-b border-slate-100">
                <div class="relative">
                    <input type="text" bind:value={searchQuery} placeholder="搜索笔记..."
                        class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 pl-9 text-sm focus:outline-none focus:border-emerald-400">
                    <i class="ph ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
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
                        <button on:click={() => selectNote(note)}
                            class="w-full text-left p-3 border-b border-slate-100 hover:bg-slate-50 transition"
                            class:bg-emerald-50={$activeNote?.id === note.id}
                            class:border-l-4={$activeNote?.id === note.id}
                            class:border-l-emerald-500={$activeNote?.id === note.id}>
                            <div class="font-bold text-slate-700 text-sm truncate">{note.title}</div>
                            <div class="text-xs text-slate-400 mt-1 truncate">{note.content.slice(0, 50) || '空白笔记'}</div>
                            <div class="text-[10px] text-slate-300 mt-1">{formatDate(note.updatedAt)}</div>
                        </button>
                    {/each}
                {/if}
            </div>
        </div>

        <div class="flex-1 flex flex-col overflow-hidden">
            {#if $activeNote}
                <div class="h-12 bg-white border-b border-slate-100 flex items-center justify-between px-4 shrink-0">
                    <div class="flex-1 min-w-0">
                        {#if editingTitle || editMode}
                            <input type="text" bind:value={editTitle}
                                on:blur={saveTitle}
                                on:keydown={(e) => e.key === 'Enter' && saveTitle()}
                                class="w-full font-bold text-lg text-slate-800 focus:outline-none bg-transparent border-b-2 border-emerald-400">
                        {:else}
                            <button on:click={startEditTitle} class="font-bold text-lg text-slate-800 hover:text-emerald-600 truncate block w-full text-left">
                                {$activeNote.title}
                            </button>
                        {/if}
                    </div>
                    <div class="flex items-center gap-1 md:gap-2 shrink-0 ml-2">
                        {#if editMode}
                            <button on:click={saveNote}
                                class="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700">
                                <i class="ph ph-check"></i> 保存
                            </button>
                            <button on:click={cancelEdit}
                                class="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-200">
                                取消
                            </button>
                        {:else}
                            <button on:click={startEdit}
                                class="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg">
                                <i class="ph ph-pencil-simple text-lg"></i>
                            </button>
                            <div class="relative">
                                <button on:click={() => showExportMenu = !showExportMenu}
                                    class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                                    <i class="ph ph-export text-lg"></i>
                                </button>
                                {#if showExportMenu}
                                    <div class="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
                                        <button on:click={() => handleExport('markdown')}
                                            class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2">
                                            <i class="ph ph-file-md text-lg text-slate-500"></i> Markdown
                                        </button>
                                        <button on:click={() => handleExport('html')}
                                            class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2">
                                            <i class="ph ph-file-html text-lg text-orange-500"></i> HTML
                                        </button>
                                        <button on:click={() => handleExport('pdf')}
                                            class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2">
                                            <i class="ph ph-file-pdf text-lg text-red-500"></i> PDF
                                        </button>
                                    </div>
                                {/if}
                            </div>
                            <button on:click={deleteNote}
                                class="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                                <i class="ph ph-trash text-lg"></i>
                            </button>
                        {/if}
                    </div>
                </div>

                <div class="flex-1 overflow-y-auto p-4 md:p-6 overscroll-contain" style="-webkit-overflow-scrolling: touch;">
                    {#if editMode}
                        <textarea bind:value={editContent} on:paste={handlePaste}
                            placeholder="开始输入内容...支持 Markdown 格式&#10;&#10;粘贴图片会自动转为 Markdown&#10;粘贴链接会自动转为 [链接名称](url) 格式"
                            class="w-full h-full min-h-[300px] resize-none focus:outline-none text-sm font-mono text-slate-700 leading-relaxed bg-transparent"></textarea>
                    {:else}
                        <div bind:this={previewElement} class="prose prose-sm max-w-none pb-20">
                            <MarkdownRenderer content={$activeNote.content} />
                        </div>
                    {/if}
                </div>
            {:else}
                <div class="flex-1 flex items-center justify-center text-slate-400">
                    <div class="text-center">
                        <i class="ph ph-notebook text-5xl mb-4"></i>
                        <p class="text-lg font-bold">选择或创建一个笔记</p>
                        {#if isMobile}
                            <button on:click={toggleSidebar} class="mt-4 text-emerald-600 font-bold text-sm">
                                <i class="ph ph-list"></i> 查看笔记列表
                            </button>
                        {/if}
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>

{#if showExportMenu}
    <div class="fixed inset-0 z-40" on:click={() => showExportMenu = false} on:keydown={() => showExportMenu = false} role="button" tabindex="0"></div>
{/if}