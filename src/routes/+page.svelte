<script>
    import { onMount, tick } from "svelte";
    import { get } from 'svelte/store';
    import { taskStore, currentView, activeTask } from '$lib/stores/tasks.js';
    import { showAiPanel, showAiSettings, clearChatHistory } from '$lib/stores/ai.js';
    import ContextMenu from '$lib/components/ContextMenu.svelte';
    import { settingsStore } from '$lib/stores/settings.js';
    import { pushNavigation, popNavigation, peekNavigation, getNavigationDepth, initializeNavigation, setupAndroidBackHandler } from '$lib/stores/navigation.js';
    import { _ } from 'svelte-i18n';
    import { showConfirm } from '$lib/stores/modal.js';
    import {
        getAndroidStoragePermissionStatus,
        requestAndroidStoragePermissions
    } from '$lib/utils/local-file-tools.js';
    import { isAndroidRuntime } from '$lib/utils/runtime.js';
    import { DEFAULT_DETAIL_WIDTH, DETAIL_WIDTH_KEY, detailPanelLayout, detailWidthFromKey } from '$lib/utils/panel-resize.js';
    import LoginModal from '$lib/components/LoginModal.svelte';
    import LoginTransition from '$lib/components/LoginTransition.svelte';
    import Sidebar from '$lib/components/Sidebar.svelte';
    import MobileNav from '$lib/components/MobileNav.svelte';
    import Dashboard from '$lib/components/Dashboard.svelte';
    const loadTemplates = () => import('$lib/components/Templates.svelte');
    const loadScheduled = () => import('$lib/components/Scheduled.svelte');
    const loadStatistics = () => import('$lib/components/Statistics.svelte');
    const loadWorklog = () => import('$lib/components/Worklog.svelte');
    const loadSettings = () => import('$lib/components/Settings.svelte');
    const loadAiChat = () => import('$lib/components/AiChat.svelte');
    const loadNotes = () => import('$lib/components/Notes.svelte');
    const loadPasswords = () => import('$lib/components/Passwords.svelte');
    const loadMoreMenu = () => import('$lib/components/MoreMenu.svelte');
    import TaskDetail from '$lib/components/TaskDetail.svelte';
    import MobileTaskDetail from '$lib/components/MobileTaskDetail.svelte';
    import TaskModal from '$lib/components/TaskModal.svelte';
    const loadAiPanel = () => import('$lib/components/AiPanel.svelte');
    const loadAiSettings = () => import('$lib/components/AiSettings.svelte');
    import AgreementModal from '$lib/components/AgreementModal.svelte';

    const lazyModules = new Map();
    function lazy(loader) {
        if (!lazyModules.has(loader)) lazyModules.set(loader, loader().catch(error => { lazyModules.delete(loader); throw error; }));
        return lazyModules.get(loader);
    }

    const DESKTOP_DETAIL_VIEWS = new Set(['dashboard', 'templates', 'scheduled', 'statistics', 'notes']);
    const MOBILE_ROOT_VIEWS = new Set(['dashboard', 'templates', 'scheduled', 'notes', 'more']);
    const MOBILE_SECONDARY_VIEWS = new Set(['aichat', 'passwords', 'settings', 'statistics', 'worklog']);

    let showModal = false;
    let editTask = null;
    let isMobile = false;
    let isAndroid = false;
    let previousView = 'dashboard';
    let suppressNavigationRecord = false;
    let androidPermissionPromptShown = false;
    let showLoginTransition = false;
    let hadAccessKey = false;
    let authInitialized = false;
    let workspaceWidth = 1024;
    let preferredDetailWidth = DEFAULT_DETAIL_WIDTH;
    let resizePointerId = null;
    let resizeOriginX = 0;
    let resizeOriginWidth = DEFAULT_DETAIL_WIDTH;

    $: detailLayout = detailPanelLayout(workspaceWidth, preferredDetailWidth);

    function updateViewport() {
        const wasMobile = isMobile;
        // Match the CSS breakpoint, including a desktop window resized below it.
        isMobile = window.innerWidth < 768;
        if (!wasMobile && isMobile) {
            const view = get(currentView);
            initializeNavigation(MOBILE_ROOT_VIEWS.has(view) ? view : 'more');
            if (MOBILE_SECONDARY_VIEWS.has(view)) pushNavigation(view);
        }
        resizePointerId = null;
    }

    function observeWorkspace(node) {
        const measure = () => { workspaceWidth = node.getBoundingClientRect().width; };
        measure();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        observer?.observe(node);
        window.addEventListener('resize', measure);
        return { destroy() { observer?.disconnect(); window.removeEventListener('resize', measure); } };
    }

    function saveDetailWidth() {
        try { localStorage.setItem(DETAIL_WIDTH_KEY, String(Math.round(preferredDetailWidth))); } catch {}
    }

    function startDetailResize(event) {
        if (event.button !== 0 || !showDetailPanel) return;
        event.preventDefault();
        resizePointerId = event.pointerId;
        resizeOriginX = event.clientX;
        resizeOriginWidth = detailLayout.width;
        event.currentTarget.setPointerCapture(event.pointerId);
    }

    function moveDetailResize(event) {
        if (event.pointerId !== resizePointerId) return;
        preferredDetailWidth = detailPanelLayout(workspaceWidth, resizeOriginWidth + resizeOriginX - event.clientX).width;
    }

    function finishDetailResize(event) {
        if (event.pointerId !== resizePointerId) return;
        resizePointerId = null;
        saveDetailWidth();
    }

    function handleDetailResizeKey(event) {
        const next = detailWidthFromKey(event.key, detailLayout.width, detailLayout.min, detailLayout.max);
        if (next === null) return;
        event.preventDefault();
        preferredDetailWidth = next;
        saveDetailWidth();
    }

    function resetDetailWidth() {
        preferredDetailWidth = DEFAULT_DETAIL_WIDTH;
        saveDetailWidth();
    }

    $: needsAgreement = !$settingsStore.agreementAccepted;
    $: if (
        !needsAgreement &&
        isAndroid &&
        !$settingsStore.androidPermissionsPrompted &&
        !androidPermissionPromptShown
    ) {
        promptAndroidStartupPermissions();
    }

    $: if ($currentView === 'worklog' && !$settingsStore.enableOvertime) {
        currentView.set('dashboard');
    }

    onMount(() => {
        let cleanupBack = () => {};
        let destroyed = false;
        const unsubscribeAuth = taskStore.subscribe((state) => {
            const hasKey = Boolean(state?.accessKey);
            if (!authInitialized) {
                authInitialized = true;
                hadAccessKey = hasKey;
                return;
            }
            if (!hadAccessKey && hasKey) showLoginTransition = true;
            hadAccessKey = hasKey;
        });

        isAndroid = isAndroidRuntime();
        initializeNavigation('dashboard');
        updateViewport();
        window.addEventListener('resize', updateViewport);
        try {
            const stored = Number(localStorage.getItem(DETAIL_WIDTH_KEY));
            if (stored >= 280 && stored <= 720) preferredDetailWidth = stored;
        } catch {}

        if (isAndroid) {
            (async () => {
                const cleanup = await setupAndroidBackHandler(
                    () => get(settingsStore).closeToQuit,
                    {
                        onPrimaryBack: () => {
                            if (showModal) { closeModal(); return true; }
                            if (get(showAiSettings)) { showAiSettings.set(false); return true; }
                            if (get(currentView) === 'aichat') { handleAiChatBack(); return true; }
                            if (get(showAiPanel)) { handleAiPanelBack(); return true; }
                            if (get(activeTask)) { activeTask.set(null); return true; }
                            return false;
                        },
                        onSecondaryBack: ({ next }) => {
                            const nextView = typeof next === 'string' ? next : '';
                            if (nextView && nextView !== get(currentView)) {
                                setCurrentViewFromBack(nextView);
                                return;
                            }

                            const mainViews = ['dashboard', 'templates', 'scheduled', 'notes', 'more'];
                            const currentViewValue = get(currentView);
                            if (!mainViews.includes(currentViewValue)) {
                                setCurrentViewFromBack('more');
                            } else if (currentViewValue !== 'dashboard') {
                                setCurrentViewFromBack('dashboard');
                            }
                        },
                        onExit: async () => {
                            try {
                                const { invoke } = await import('@tauri-apps/api/core');
                                await invoke('exit_app');
                            } catch {
                                window.close();
                            }
                        },
                        onMinimize: async () => {
                            try {
                                const { getCurrentWindow } = await import('@tauri-apps/api/window');
                                await getCurrentWindow().minimize();
                            } catch {}
                        }
                    },
                );
                if (destroyed) {
                    cleanup();
                    return;
                }
                cleanupBack = cleanup;
            })();
        }

        return () => {
            destroyed = true;
            cleanupBack();
            unsubscribeAuth();
            window.removeEventListener('resize', updateViewport);
        };
    });

    $: if ($currentView !== previousView) {
        const from = previousView;
        activeTask.set(null);
        recordMobileNavigation(from, $currentView);
        previousView = $currentView;
    }

    $: showDetailPanel =
        !isMobile &&
        DESKTOP_DETAIL_VIEWS.has($currentView) &&
        (Boolean($activeTask) || $showAiPanel);
    $: if (!showDetailPanel) resizePointerId = null;

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
    }

    async function handleGenerateReport(event) {
        const { type } = event.detail;
        currentView.set('statistics');
    }

    function handleAiPanelBack() {
        showAiPanel.set(false);
        const depth = getNavigationDepth();
        if (depth > 1) {
            popNavigation();
        }
    }

    function handleAiChatBack() {
        const depth = getNavigationDepth();
        if (depth > 1) {
            popNavigation();
            setCurrentViewFromBack(peekNavigation() || 'more');
            return;
        }
        setCurrentViewFromBack('more');
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

    function setCurrentViewFromBack(view) {
        if (get(currentView) === view) {
            suppressNavigationRecord = false;
            return;
        }
        suppressNavigationRecord = true;
        currentView.set(view);
    }

    function recordMobileNavigation(from, next) {
        if (!isMobile) return;
        if (suppressNavigationRecord) {
            suppressNavigationRecord = false;
            return;
        }

        if (MOBILE_ROOT_VIEWS.has(next)) {
            initializeNavigation(next);
            return;
        }

        if (MOBILE_SECONDARY_VIEWS.has(next)) {
            if (!peekNavigation()) {
                initializeNavigation(MOBILE_ROOT_VIEWS.has(from) ? from : 'more');
            }
            if (peekNavigation() !== next) {
                pushNavigation(next);
            }
        }
    }

    async function promptAndroidStartupPermissions() {
        androidPermissionPromptShown = true;
        const t = get(_);

        const storageStatus = await getAndroidStoragePermissionStatus();
        if (storageStatus.available && storageStatus.granted && get(settingsStore).notificationAvailable) {
            settingsStore.markAndroidPermissionsPrompted();
            return;
        }

        const confirmed = await showConfirm({
            title: t('settings.android_permissions_title') || '权限设置',
            message: t('settings.android_permissions_desc') || 'WorkPlan 需要通知和媒体文件权限，用于任务提醒、附件读取和本地文件能力。确认后会打开系统授权窗口。',
            confirmText: t('common.confirm') || '确认',
            cancelText: t('common.cancel') || '取消',
            variant: 'info'
        });
        settingsStore.markAndroidPermissionsPrompted();
        if (!confirmed) return;

        await requestAndroidStoragePermissions();
        await settingsStore.requestNotificationPermission();
    }
</script>

<div class="h-dvh min-h-0 flex flex-col md:flex-row overflow-hidden text-slate-800 safe-area-container relative" data-glass-root class:resizing-detail={resizePointerId !== null}>
    {#if $settingsStore.theme === 'frosted'}
        <img class="frosted-wallpaper" src="/frosted-wallpaper.svg" alt="" aria-hidden="true" />
    {/if}
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

        <div use:observeWorkspace class="flex flex-1 min-w-0 min-h-0 relative">
        <main data-glass-role="workspace" class="flex-1 flex flex-col relative bg-slate-100 min-w-0 min-h-0 border-r border-slate-200 pb-14 md:pb-0">
            {#key $currentView}
            <svelte:boundary>
            {#if $currentView === 'dashboard'}
                <Dashboard {openModal} openDetailPanel={openDesktopDetailPanel} />
            {:else if $currentView === 'aichat'}
                {#await lazy(loadAiChat) then module}
                    <svelte:component this={module.default} onBack={handleAiChatBack} />
                {/await}
            {:else if $currentView === 'templates'}
                {#await lazy(loadTemplates) then module}
                    <svelte:component this={module.default} {openModal} openDetailPanel={openDesktopDetailPanel} />
                {/await}
            {:else if $currentView === 'scheduled'}
                {#await lazy(loadScheduled) then module}
                    <svelte:component this={module.default} {openModal} openDetailPanel={openDesktopDetailPanel} />
                {/await}
            {:else if $currentView === 'statistics'}
                {#await lazy(loadStatistics) then module}
                    <svelte:component this={module.default} openDetailPanel={openDesktopDetailPanel} />
                {/await}
            {:else if $currentView === 'worklog'}
                {#await lazy(loadWorklog) then module}
                    <svelte:component this={module.default}  />
                {/await}
            {:else if $currentView === 'notes'}
                {#await lazy(loadNotes) then module}
                    <svelte:component this={module.default} openDetailPanel={openDesktopDetailPanel} />
                {/await}
            {:else if $currentView === 'passwords'}
                {#await lazy(loadPasswords) then module}
                    <svelte:component this={module.default}  />
                {/await}
            {:else if $currentView === 'settings'}
                {#await lazy(loadSettings) then module}
                    <svelte:component this={module.default}  />
                {/await}
            {:else if $currentView === 'more'}
                {#await lazy(loadMoreMenu) then module}
                    <svelte:component this={module.default}  />
                {/await}
            {/if}
            {#snippet failed(error)}
                <div class="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
                    <i class="ph-fill ph-warning-circle text-3xl text-amber-500"></i>
                    <div class="text-sm font-bold text-slate-700 dark:text-slate-200">{$_('common.error') || 'Error'}</div>
                    <div class="max-w-lg break-words text-xs text-slate-500 dark:text-slate-400">{String(error?.message || error)}</div>
                    <button
                        on:click={() => currentView.set('dashboard')}
                        class="px-4 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold hover:bg-slate-700 transition"
                    >
                        {$_('nav.dashboard')}
                    </button>
                </div>
            {/snippet}
            </svelte:boundary>
            {/key}
        </main>

        {#if !isMobile && DESKTOP_DETAIL_VIEWS.has($currentView)}
            <div
                id="detail-panel"
                class="detail-panel hidden md:flex overflow-hidden shrink-0"
                class:detail-overlay={detailLayout.overlay}
                class:detail-hidden={!showDetailPanel}
                class:detail-resizing={resizePointerId !== null}
                style:width={showDetailPanel ? `${detailLayout.width}px` : '0px'}
                inert={!showDetailPanel}
            >
            {#if showDetailPanel}
                <!-- Focusable separators implement the ARIA window-splitter keyboard pattern. -->
                <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
                <div class="detail-resize-handle" role="separator" tabindex="0"
                    aria-label={$_('common.resize_panel')} title={$_('common.resize_panel')}
                    aria-orientation="vertical" aria-controls="detail-panel"
                    aria-valuenow={detailLayout.width} aria-valuemin={detailLayout.min} aria-valuemax={detailLayout.max}
                    on:pointerdown={startDetailResize} on:pointermove={moveDetailResize}
                    on:pointerup={finishDetailResize} on:pointercancel={finishDetailResize}
                    on:lostpointercapture={finishDetailResize} on:keydown={handleDetailResizeKey}
                    on:dblclick={resetDetailWidth}>
                    <span></span>
                </div>
            {/if}
            <TaskDetail {openModal} closePanel={closeDesktopDetailPanel}>
                <svelte:fragment slot="ai-panel">
                    {#if $showAiPanel}
                    {#await lazy(loadAiPanel) then module}
                    <svelte:component this={module.default}  />
                {/await}
                    {/if}
                </svelte:fragment>
            </TaskDetail>
            </div>
        {/if}
        </div>

        {#if isMobile}<MobileTaskDetail {openModal} />{/if}

        {#if isMobile && $showAiPanel && $currentView !== 'aichat' && $currentView !== 'passwords' && $currentView !== 'settings'}
            <div class="md:hidden fixed inset-0 z-50 bg-white flex flex-col safe-area-container">
                <div class="h-14 border-b border-rose-100 flex items-center justify-between px-4 bg-white shrink-0 mobile-header">
                    <button on:click={handleAiPanelBack}
                        class="text-slate-500 flex items-center gap-1 font-bold">
                        <i class="ph-bold ph-caret-left text-lg"></i> {$_('common.back')}
                    </button>
                    <div class="font-bold text-rose-600 flex items-center gap-1">
                        <i class="ph-fill ph-chat-teardrop-dots"></i> {$_('ai.assistant')}
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
                {#await lazy(loadAiPanel) then module}
                    <svelte:component this={module.default}  />
                {/await}
            </div>
        {/if}

        <MobileNav />
        <TaskModal bind:show={showModal} {editTask} on:close={closeModal} />
        {#if $showAiSettings}
        {#await lazy(loadAiSettings) then module}
                    <svelte:component this={module.default}  />
                {/await}
        {/if}
        <AgreementModal isFirstTime={false} />
    {/if}

    {#if showLoginTransition}
        <LoginTransition onDone={() => (showLoginTransition = false)} />
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
    .detail-panel {
        position: relative;
        min-height: 0;
        transition: width 180ms ease, opacity 180ms ease;
    }
    .detail-panel.detail-overlay {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        z-index: 30;
        box-shadow: -12px 0 28px rgba(15, 23, 42, 0.12);
    }
    .detail-panel.detail-hidden {
        opacity: 0;
        pointer-events: none;
    }
    .detail-panel.detail-resizing {
        transition: none;
    }
    .detail-resize-handle {
        position: absolute;
        inset: 0 auto 0 0;
        width: 9px;
        z-index: 20;
        cursor: col-resize;
        touch-action: none;
        outline: none;
    }
    .detail-resize-handle span {
        position: absolute;
        left: 1px;
        top: 50%;
        height: 36px;
        width: 3px;
        border-radius: 3px;
        transform: translateY(-50%);
        background: var(--app-border-strong, #cbd5e1);
        transition: background 120ms ease;
    }
    .detail-resize-handle:hover span,
    .detail-resize-handle:focus-visible span,
    .detail-resizing .detail-resize-handle span {
        background: #60a5fa;
    }
    .resizing-detail {
        cursor: col-resize;
        user-select: none;
    }
    @media (prefers-reduced-motion: reduce) {
        .detail-panel,
        .detail-resize-handle span {
            transition: none;
        }
    }
    @supports (padding-top: env(safe-area-inset-top)) {
        .safe-area-container {
            padding-top: env(safe-area-inset-top);
        }
    }
</style>
