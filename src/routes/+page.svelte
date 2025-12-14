<script>
    import { taskStore, currentView, activeTask } from '$lib/stores/tasks.js';
    import { showAiPanel, showAiSettings, clearChatHistory } from '$lib/stores/ai.js';
    import { settingsStore } from '$lib/stores/settings.js';
    import LoginModal from '$lib/components/LoginModal.svelte';
    import Sidebar from '$lib/components/Sidebar.svelte';
    import MobileNav from '$lib/components/MobileNav.svelte';
    import Dashboard from '$lib/components/Dashboard.svelte';
    import Templates from '$lib/components/Templates.svelte';
    import Scheduled from '$lib/components/Scheduled.svelte';
    import Statistics from '$lib/components/Statistics.svelte';
    import Settings from '$lib/components/Settings.svelte';
    import AiChat from '$lib/components/AiChat.svelte';
    import TaskDetail from '$lib/components/TaskDetail.svelte';
    import MobileTaskDetail from '$lib/components/MobileTaskDetail.svelte';
    import TaskModal from '$lib/components/TaskModal.svelte';
    import AiPanel from '$lib/components/AiPanel.svelte';
    import AiSettings from '$lib/components/AiSettings.svelte';
    import AgreementModal from '$lib/components/AgreementModal.svelte';

    let showModal = false;
    let editTask = null;

    $: needsAgreement = !$settingsStore.agreementAccepted;

    function openModal(task = null) {
        editTask = task;
        showModal = true;
    }

    function closeModal() {
        showModal = false;
        editTask = null;
    }
</script>

<div class="h-screen flex flex-col md:flex-row overflow-hidden text-slate-800 safe-area-container">
    {#if needsAgreement}
        <AgreementModal isFirstTime={true} />
    {:else if !$taskStore.accessKey}
        <LoginModal />
    {:else}
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
            {:else if $currentView === 'settings'}
                <Settings />
            {/if}
        </main>
        {#if $currentView !== 'aichat'}
            <TaskDetail {openModal}>
                <svelte:fragment slot="ai-panel">
                    <AiPanel />
                </svelte:fragment>
            </TaskDetail>
        {/if}
        <MobileTaskDetail {openModal} />
        {#if $showAiPanel && $currentView !== 'aichat'}
            <div class="md:hidden fixed inset-0 z-50 bg-white flex flex-col safe-area-container">
                <div class="h-14 border-b border-rose-100 flex items-center justify-between px-4 bg-white shrink-0 mobile-header">
                    <button on:click={() => showAiPanel.set(false)} class="text-slate-500 flex items-center gap-1 font-bold">
                        <i class="ph-bold ph-caret-left text-lg"></i> 返回
                    </button>
                    <div class="font-bold text-rose-600 flex items-center gap-1">
                        <i class="ph-fill ph-sparkle"></i> AI 助手
                    </div>
                    <button on:click={() => clearChatHistory()} class="text-slate-400" aria-label="清空聊天">
                        <i class="ph ph-trash text-xl"></i>
                    </button>
                </div>
                <AiPanel />
            </div>
        {/if}
        <MobileNav />
        <TaskModal bind:show={showModal} {editTask} />
        <AiSettings />
        <AgreementModal isFirstTime={false} />
    {/if}
</div>

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