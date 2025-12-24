<script>
    import { createEventDispatcher, onMount, onDestroy } from 'svelte';
    import { currentView, taskStore } from '../stores/tasks.js';
    import { showToast } from '../stores/modal.js';
    const dispatch = createEventDispatcher();
    let visible = false;
    let x = 0;
    let y = 0;
    let menuRef;
    let hasSelection = false;
    let hasFocusedInput = false;
    let frozenState = { hasSelection: false, hasFocusedInput: false };
    let savedActiveElement = null;
    let savedSelectionRange = { start: 0, end: 0 };
    function updateContextState() {
        hasSelection = window.getSelection().toString().length > 0;
        const activeEl = document.activeElement;
        hasFocusedInput = activeEl && (
            activeEl.tagName === 'INPUT' || 
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.isContentEditable
        );
    }
    $: menuItems = visible ? [
        { id: 'refresh', label: '刷新', icon: 'ph-arrow-clockwise', shortcut: 'F5', show: true },
        { id: 'divider1', type: 'divider', show: frozenState.hasSelection || frozenState.hasFocusedInput },
        { id: 'copy', label: '复制', icon: 'ph-copy', shortcut: 'Ctrl+C', show: frozenState.hasSelection },
        { id: 'paste', label: '粘贴', icon: 'ph-clipboard', shortcut: 'Ctrl+V', show: frozenState.hasFocusedInput },
        { id: 'divider2', type: 'divider', show: true },
        { id: 'createTask', label: '创建任务', icon: 'ph-plus-circle', shortcut: 'Ctrl+N', show: true },
        { id: 'aiChat', label: 'AI Chat', icon: 'ph-robot', shortcut: 'Ctrl+I', show: true },
        { id: 'divider3', type: 'divider', show: true },
        { id: 'dailyReport', label: '生成日报', icon: 'ph-sun', shortcut: '', show: true },
        { id: 'weeklyReport', label: '生成周报', icon: 'ph-calendar-check', shortcut: '', show: true },
        { id: 'divider4', type: 'divider', show: true },
        { id: 'syncData', label: '同步数据', icon: 'ph-cloud-arrow-up', shortcut: '', show: true },
        { id: 'about', label: '关于项目', icon: 'ph-github-logo', shortcut: '', show: true }
    ].filter(item => item.show !== false) : [];
    function show(event) {
        event.preventDefault();
        updateContextState();
        frozenState = { hasSelection, hasFocusedInput };
        const activeEl = document.activeElement;
        savedActiveElement = activeEl;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
            savedSelectionRange = {
                start: activeEl.selectionStart || 0,
                end: activeEl.selectionEnd || 0
            };
        } else {
            savedSelectionRange = { start: 0, end: 0 };
        }
        visible = true;
        const menuWidth = 200;
        const menuHeight = 320;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        x = event.clientX;
        y = event.clientY;
        if (x + menuWidth > windowWidth) {
            x = windowWidth - menuWidth - 10;
        }
        if (y + menuHeight > windowHeight) {
            y = windowHeight - menuHeight - 10;
        }
        x = Math.max(10, x);
        y = Math.max(10, y);
    }
    function hide() {
        visible = false;
        frozenState = { hasSelection: false, hasFocusedInput: false };
    }
    async function handleAction(id) {
        const targetElement = savedActiveElement;
        const selectionRange = { ...savedSelectionRange };
        hide();
        await new Promise(resolve => setTimeout(resolve, 10));
        switch (id) {
            case 'refresh':
                window.location.reload();
                break;
            case 'copy':
                try {
                    const selection = window.getSelection().toString();
                    if (selection) {
                        await navigator.clipboard.writeText(selection);
                        showToast({ message: '已复制', type: 'success', duration: 1500 });
                    }
                } catch {
                    document.execCommand('copy');
                }
                break;
            case 'paste':
                try {
                    const text = await navigator.clipboard.readText();
                    if (!text) {
                        showToast({ message: '剪贴板为空', type: 'warning', duration: 1500 });
                        break;
                    }
                    if (targetElement && (targetElement.tagName === 'INPUT' || targetElement.tagName === 'TEXTAREA')) {
                        targetElement.focus();
                        const start = selectionRange.start;
                        const end = selectionRange.end;
                        const value = targetElement.value || '';
                        targetElement.value = value.substring(0, start) + text + value.substring(end);
                        const newPos = start + text.length;
                        targetElement.selectionStart = newPos;
                        targetElement.selectionEnd = newPos;
                        targetElement.dispatchEvent(new Event('input', { bubbles: true }));
                        showToast({ message: '已粘贴', type: 'success', duration: 1500 });
                    } else if (targetElement && targetElement.isContentEditable) {
                        targetElement.focus();
                        document.execCommand('insertText', false, text);
                        showToast({ message: '已粘贴', type: 'success', duration: 1500 });
                    } else {
                        showToast({ message: '请先选择输入框', type: 'warning', duration: 1500 });
                    }
                } catch (e) {
                    try {
                        document.execCommand('paste');
                    } catch {
                        showToast({ message: '粘贴失败', type: 'error', duration: 1500 });
                    }
                }
                break;
            case 'createTask':
                dispatch('createTask');
                break;
            case 'aiChat':
                dispatch('openAiChat');
                break;
            case 'dailyReport':
                dispatch('generateReport', { type: 'daily' });
                break;
            case 'weeklyReport':
                dispatch('generateReport', { type: 'weekly' });
                break;
            case 'syncData':
                taskStore.loadFromLocal();
                showToast({ message: '数据同步中...', type: 'info', duration: 1500 });
                break;
            case 'about':
                window.open('https://github.com/MakotoArai-CN/WorkPlan-with-AI', '_blank');
                break;
        }
    }
    function handleKeydown(event) {
        if (event.key === 'Escape') {
            hide();
        }
        if (event.ctrlKey || event.metaKey) {
            switch (event.key.toLowerCase()) {
                case 'n':
                    event.preventDefault();
                    dispatch('createTask');
                    break;
                case 'i':
                    event.preventDefault();
                    dispatch('openAiChat');
                    break;
            }
        }
    }
    function handleClickOutside(event) {
        if (visible && menuRef && !menuRef.contains(event.target)) {
            hide();
        }
    }
    onMount(() => {
        document.addEventListener('contextmenu', show);
        document.addEventListener('click', handleClickOutside);
        document.addEventListener('keydown', handleKeydown);
    });
    onDestroy(() => {
        document.removeEventListener('contextmenu', show);
        document.removeEventListener('click', handleClickOutside);
        document.removeEventListener('keydown', handleKeydown);
    });
</script>

{#if visible}
    <div bind:this={menuRef} class="context-menu" style="left: {x}px; top: {y}px;">
        {#each menuItems as item}
            {#if item.type === 'divider'}
                <div class="menu-divider"></div>
            {:else}
                <button class="menu-item" on:click={() => handleAction(item.id)}>
                    <i class="ph {item.icon}"></i>
                    <span class="menu-label">{item.label}</span>
                    {#if item.shortcut}
                        <span class="menu-shortcut">{item.shortcut}</span>
                    {/if}
                </button>
            {/if}
        {/each}
    </div>
{/if}

<style>
    .context-menu {
        position: fixed;
        z-index: 9999;
        min-width: 200px;
        background: rgba(255, 255, 255, 0.98);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
        padding: 6px;
        animation: menuFadeIn 0.15s ease-out;
    }
    @keyframes menuFadeIn {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
    }
    .menu-item {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 8px 12px;
        border: none;
        background: transparent;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        color: #334155;
        transition: all 0.15s ease;
        text-align: left;
    }
    .menu-item:hover {
        background: #f1f5f9;
        color: #1e293b;
    }
    .menu-item:active {
        background: #e2e8f0;
        transform: scale(0.98);
    }
    .menu-item i {
        font-size: 16px;
        color: #64748b;
        width: 20px;
        text-align: center;
    }
    .menu-item:hover i {
        color: #3b82f6;
    }
    .menu-label {
        flex: 1;
        font-weight: 500;
    }
    .menu-shortcut {
        font-size: 11px;
        color: #94a3b8;
        font-family: ui-monospace, monospace;
        padding: 2px 6px;
        background: #f1f5f9;
        border-radius: 4px;
    }
    .menu-divider {
        height: 1px;
        background: #e2e8f0;
        margin: 6px 8px;
    }
</style>