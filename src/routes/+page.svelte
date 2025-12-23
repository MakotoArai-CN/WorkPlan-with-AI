<script>
    import { onMount, tick } from "svelte";
    import { taskStore, currentView, activeTask } from '$lib/stores/tasks.js';
    import { showAiPanel, showAiSettings, clearChatHistory } from '$lib/stores/ai.js';
    import ContextMenu from '$lib/components/ContextMenu.svelte';
    import { settingsStore } from '$lib/stores/settings.js';
    import { pushNavigation, popNavigation, getNavigationDepth } from '$lib/stores/navigation.js';

    import SplashScreen from '$lib/components/SplashScreen.svelte';
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

    let showModal = false;
    let editTask = null;
    let isMobile = false;
    let appReady = false;

    $: needsAgreement = !$settingsStore.agreementAccepted;

    onMount(() => {
        isMobile = window.innerWidth < 768 || 
            /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent);
    });

    function handleSplashComplete() {
        appReady = true;
    }

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
</script>

{#if !appReady}
    <SplashScreen duration={1500} onComplete={handleSplashComplete} />
{:else}
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

            <main class="flex-1 flex flex-col relative bg-[#f1f5f9] min-w-0 border-r border-slate-200 pb-14 md:pb-0">
                {#if $currentView === 'dashboard'}
                    <Dashboard {openModal} />
                {:else if $currentView === 'aichat'}
                    <AiChat />
                {:else if $currentView === 'templates'}
                    <Templates {openModal} />
                {:else if $currentView === 'scheduled'}
                    <Scheduled {openModal} />
                {:else if $currentView === 'statistics'}
                    <Statistics />
                {:else if $currentView === 'notes'}
                    <Notes />
                {:else if $currentView === 'passwords'}
                    <Passwords />
                {:else if $currentView === 'settings'}
                    <Settings />
                {:else if $currentView === 'more'}
                    <MoreMenu />
                {/if}
            </main>

            {#if $currentView !== 'aichat' && $currentView !== 'notes'}
                <TaskDetail {openModal}>
                    <svelte:fragment slot="ai-panel">
                        <AiPanel />
                    </svelte:fragment>
                </TaskDetail>
            {/if}

            <MobileTaskDetail {openModal} />

            {#if $showAiPanel && $currentView !== 'aichat' && $currentView !== 'notes'}
                <div class="md:hidden fixed inset-0 z-50 bg-white flex flex-col safe-area-container">
                    <div class="h-14 border-b border-rose-100 flex items-center justify-between px-4 bg-white shrink-0 mobile-header">
                        <button on:click={() => { showAiPanel.set(false); popNavigation(); }} 
                            class="text-slate-500 flex items-center gap-1 font-bold">
                            <i class="ph-bold ph-caret-left text-lg"></i> 返回
                        </button>
                        <div class="font-bold text-rose-600 flex items-center gap-1">
                            <i class="ph-fill ph-sparkle"></i> AI Chat
                        </div>
                        <button on:click={() => clearChatHistory()} class="text-slate-400" aria-label="清空聊天">
                            <i class="ph ph-trash text-xl"></i>
                        </button>
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