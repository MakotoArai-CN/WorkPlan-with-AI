<script>
    import { onMount, tick } from "svelte";
    import { get } from 'svelte/store';
    import { taskStore, currentView, activeTask } from '$lib/stores/tasks.js';
    import { showAiPanel, showAiSettings, clearChatHistory } from '$lib/stores/ai.js';
    import ContextMenu from '$lib/components/ContextMenu.svelte';
    import { settingsStore } from '$lib/stores/settings.js';
    import { pushNavigation, popNavigation, getNavigationDepth, handleBackPress, showExitToast, initializeNavigation, setupAndroidBackHandler } from '$lib/stores/navigation.js';
    import { _ } from 'svelte-i18n';
    import LoginModal from '$lib/components/LoginModal.svelte';
    import Sidebar from '$lib/components/Sidebar.svelte';
    import MobileNav from '$lib/components/MobileNav.svelte';
    import Dashboard from '$lib/components/Dashboard.svelte';
    import Templates from '$lib/components/Templates.svelte';
    import Scheduled from '$lib/components/Scheduled.svelte';
    import Statistics from '$lib/components/Statistics.svelte';
    import Settings from '$lib/components/Settings.svelte';
    import AiChat from '$lib/components/AiChat.svelte';
    import Notes from '$lib/components/Notes.svelte';
    import Passwords from '$lib/components/Passwords.svelte';
    import MoreMenu from '$lib/components/MoreMenu.svelte';
    import TaskDetail from '$lib/components/TaskDetail.svelte';
    import MobileTaskDetail from '$lib/components/MobileTaskDetail.svelte';
    import TaskModal from '$lib/components/TaskModal.svelte';
    import AiPanel from '$lib/components/AiPanel.svelte';
    import AiSettings from '$lib/components/AiSettings.svelte';
    import AgreementModal from '$lib/components/AgreementModal.svelte';

    const DESKTOP_DETAIL_VIEWS = new Set(['dashboard', 'templates', 'scheduled', 'statistics', 'notes']);

    let showModal = false;
    let editTask = null;
    let isMobile = false;
    let previousView = 'dashboard';

    $: needsAgreement = !$settingsStore.agreementAccepted;

    onMount(async () => {
        isMobile = window.innerWidth < 768 ||
            /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent);
        initializeNavigation('dashboard');

        if (isMobile) {
            setupAndroidBackHandler(
                get(settingsStore).closeToQuit,
                {
                    onPrimaryBack: () => {
                        if (showModal) { closeModal(); return true; }
                        if (get(showAiPanel)) { handleAiPanelBack(); return true; }
                        if (get(activeTask)) { activeTask.set(null); return true; }
                        if (get(showAiSettings)) { showAiSettings.set(false); return true; }
                        return false;
                    },
                    onSecondaryBack: ({ next }) => {
                        if (next && next !== get(currentView)) {
                            currentView.set(next);
                        }
                    },
                    onExit: async () => {
                        try {
                            const { exit } = await import('@tauri-apps/plugin-process');
                            await exit(0);
                        } catch {}
                    },
                    onMinimize: async () => {
                        try {
                            const { getCurrentWindow } = await import('@tauri-apps/api/window');
                            await getCurrentWindow().minimize();
                        } catch {}
                    }
                }
            );
        }
    });

    $: if ($currentView !== previousView) {
        activeTask.set(null);
        previousView = $currentView;
    }

    $: showDetailPanel =
        !isMobile &&
        DESKTOP_DETAIL_VIEWS.has($currentView) &&
        (Boolean($activeTask) || $showAiPanel);

    function openModal(task = null) {
        editTask = task;
        showModal = true;
        if (isMobile) {
            pushNavigation('modal');
        }
    }

    function closeModal() {
        showModal = false;
        editTask = null;
        if (isMobile) {
            const depth = getNavigationDepth();
            if (depth > 0) {
                popNavigation();
            }
        }
    }

    function handleCreateTask() {
        const validViews = ['dashboard', 'templates', 'scheduled'];
        if (!validViews.includes($currentView)) {
            currentView.set('dashboard');
        }
        setTimeout(() => openModal(), 100);
    }

    function handleOpenAiChat() {
        currentView.set('aichat');
        pushNavigation('aichat');
    }

    async function handleGenerateReport(event) {
        const { type } = event.detail;
        currentView.set('statistics');
        pushNavigation('statistics');
    }

    function handleAiPanelBack() {
        showAiPanel.set(false);
        const depth = getNavigationDepth();
        if (depth > 1) {
            popNavigation();
        }
    }

    function handleTaskDetailBack() {
        activeTask.set(null);
    }

    function openDesktopDetailPanel(mode = 'detail') {
        if (mode === 'ai') {
            if ($showAiPanel) {
                showAiPanel.set(false);
                return;
            }
            activeTask.set(null);
            showAiPanel.set(true);
            return;
        }

        if (isMobile || !DESKTOP_DETAIL_VIEWS.has($currentView)) return;
        showAiPanel.set(false);
    }

    function closeDesktopDetailPanel() {
        showAiPanel.set(false);
        activeTask.set(null);
    }
</script>

<div class="h-screen flex flex-col md:flex-row overflow-hidden text-slate-800 safe-area-container">
    {#if needsAgreement}
        <AgreementModal isFirstTime={true} />
    {:else if !$taskStore.accessKey}
        <LoginModal />
    {:else}
        {#if !isMobile}
            <ContextMenu 
                on:createTask={handleCreateTask}
                on:openAiChat={handleOpenAiChat}
                on:generateReport={handleGenerateReport}
            />
        {/if}

        <Sidebar />

        <main class="flex-1 flex flex-col relative bg-slate-100 min-w-0 border-r border-slate-200 pb-14 md:pb-0">
            {#if $currentView === 'dashboard'}
                <Dashboard {openModal} openDetailPanel={openDesktopDetailPanel} />
            {:else if $currentView === 'aichat'}
                <AiChat onBack={handleAiPanelBack} />
            {:else if $currentView === 'templates'}
                <Templates {openModal} openDetailPanel={openDesktopDetailPanel} />
            {:else if $currentView === 'scheduled'}
                <Scheduled {openModal} openDetailPanel={openDesktopDetailPanel} />
            {:else if $currentView === 'statistics'}
                <Statistics openDetailPanel={openDesktopDetailPanel} />
            {:else if $currentView === 'notes'}
                <Notes openDetailPanel={openDesktopDetailPanel} />
            {:else if $currentView === 'passwords'}
                <Passwords />
            {:else if $currentView === 'settings'}
                <Settings />
            {:else if $currentView === 'more'}
                <MoreMenu />
            {/if}
        </main>

        {#if DESKTOP_DETAIL_VIEWS.has($currentView)}
            <div
                class={`hidden md:flex overflow-hidden shrink-0 transition-[width,opacity,transform] duration-300 ease-out ${showDetailPanel ? 'w-[350px] opacity-100 translate-x-0 pointer-events-auto' : 'w-0 opacity-0 translate-x-6 pointer-events-none'}`}
            >
            <TaskDetail {openModal} closePanel={closeDesktopDetailPanel}>
                <svelte:fragment slot="ai-panel">
                    <AiPanel />
                </svelte:fragment>
            </TaskDetail>
            </div>
        {/if}

        <MobileTaskDetail {openModal} />

        {#if $showAiPanel && $currentView !== 'aichat' && $currentView !== 'passwords' && $currentView !== 'settings'}
            <div class="md:hidden fixed inset-0 z-50 bg-white flex flex-col safe-area-container">
                <div class="h-14 border-b border-rose-100 flex items-center justify-between px-4 bg-white shrink-0 mobile-header">
                    <button on:click={handleAiPanelBack}
                        class="text-slate-500 flex items-center gap-1 font-bold">
                        <i class="ph-bold ph-caret-left text-lg"></i> {$_('common.back')}
                    </button>
                    <div class="font-bold text-rose-600 flex items-center gap-1">
                        <i class="ph-fill ph-sparkle"></i> {$_('ai.assistant')}
                    </div>
                    <div class="flex items-center gap-2">
                        <button on:click={() => showAiSettings.set(true)} class="text-rose-400" aria-label={$_('ai_panel.settings')}>
                            <i class="ph ph-gear text-xl"></i>
                        </button>
                        <button on:click={() => clearChatHistory()} class="text-slate-400" aria-label={$_('ai.clear')}>
                            <i class="ph ph-trash text-xl"></i>
                        </button>
                    </div>
                </div>
                <AiPanel />
            </div>
        {/if}

        <MobileNav />
        <TaskModal bind:show={showModal} {editTask} on:close={closeModal} />
        <AiSettings />
        <AgreementModal isFirstTime={false} />
    {/if}
</div>

{#if $showExitToast}
    <div class="fixed bottom-20 left-0 right-0 z-[102] flex justify-center pointer-events-none">
        <div class="bg-slate-800 text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium">
            {$_('exit.press_again')}
        </div>
    </div>
{/if}

<style>
    :global(body) {
        margin: 0;
        padding: 0;
    }
    .safe-area-container {
        padding-top: env(safe-area-inset-top);
    }
    .mobile-header {
        margin-top: env(safe-area-inset-top);
    }
    @supports (padding-top: env(safe-area-inset-top)) {
        .safe-area-container {
            padding-top: env(safe-area-inset-top);
        }
    }
</style>
