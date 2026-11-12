<script>
    import { currentView, taskStore, enabledScheduledCount, activeTasks } from '../stores/tasks.js';
    import { settingsStore } from '../stores/settings.js';
    import { passwordsStore } from '../stores/passwords.js';
    import { showConfirm, showToast } from '../stores/modal.js';
    import { _ } from 'svelte-i18n';
    import { get } from 'svelte/store';
    import { tick } from 'svelte';
    import { flushLocalDatabase } from '../utils/local-db.js';
    import { openBackupModal } from '../stores/backup-modal.js';
    import { isWebDemo } from '../utils/runtime.js';
    import SidebarResizeHandle from './SidebarResizeHandle.svelte';

    const AUTO_COLLAPSE_VIEWS = new Set(['notes', 'aichat']);

    let navEl;
    let pillTop = 0;
    let pillHeight = 0;
    let pillReady = false;
    let collapsed = false;
    let lastView = 'dashboard';

    // Collapse on full-width editors and restore on the way back. Keep the
    // previous-view check in the same statement: a separate `$: lastView = ...`
    // runs first, making `lastView !== $currentView` permanently false.
    $: {
        if (AUTO_COLLAPSE_VIEWS.has($currentView)) {
            collapsed = true;
        } else if (AUTO_COLLAPSE_VIEWS.has(lastView)) {
            collapsed = false;
        }
        lastView = $currentView;
    }

    $: navItems = [
        {
            id: 'dashboard',
            label: $_('nav.dashboard'),
            icon: 'ph-sun',
            activeBg: 'bg-blue-50',
            activeText: 'text-blue-700',
            hoverBg: 'hover:bg-slate-50',
            badge: $activeTasks.length > 0 ? $activeTasks.length : null,
            badgeClass: 'bg-blue-600 text-white'
        },
        {
            id: 'templates',
            label: $_('nav.templates_full'),
            icon: 'ph-copy',
            activeBg: 'bg-purple-50',
            activeText: 'text-purple-700',
            hoverBg: 'hover:bg-slate-50'
        },
        {
            id: 'scheduled',
            label: $_('nav.scheduled'),
            icon: 'ph-clock-countdown',
            activeBg: 'bg-teal-50',
            activeText: 'text-teal-700',
            hoverBg: 'hover:bg-slate-50',
            badge: $enabledScheduledCount > 0 ? $enabledScheduledCount : null,
            badgeClass: 'bg-teal-100 text-teal-700'
        },
        {
            id: 'statistics',
            label: $_('nav.statistics'),
            icon: 'ph-chart-bar',
            activeBg: 'bg-indigo-50',
            activeText: 'text-indigo-700',
            hoverBg: 'hover:bg-slate-50'
        },
        ...($settingsStore.enableOvertime ? [{
            id: 'worklog',
            label: $_('nav.worklog'),
            icon: 'ph-clipboard-text',
            activeBg: 'bg-orange-50',
            activeText: 'text-orange-700',
            hoverBg: 'hover:bg-slate-50'
        }] : []),
        {
            id: 'notes',
            label: $_('nav.notes'),
            icon: 'ph-notebook',
            activeBg: 'bg-emerald-50',
            activeText: 'text-emerald-700',
            hoverBg: 'hover:bg-slate-50'
        },
        {
            id: 'aichat',
            label: $_('nav.ai_chat'),
            icon: 'ph-chat-teardrop-dots',
            activeBg: 'bg-gradient-to-r from-indigo-50 to-purple-50',
            activeText: 'text-indigo-700',
            hoverBg: 'hover:bg-slate-50'
        },
        {
            id: 'passwords',
            label: $_('nav.passwords'),
            icon: 'ph-key',
            activeBg: 'bg-amber-50',
            activeText: 'text-amber-700',
            hoverBg: 'hover:bg-slate-50'
        },
        {
            id: 'settings',
            label: $_('nav.settings'),
            icon: 'ph-gear',
            activeBg: 'bg-slate-100',
            activeText: 'text-slate-700',
            hoverBg: 'hover:bg-slate-50'
        }
    ].filter(item => !(isWebDemo && item.id === 'passwords'));

    function switchView(view) {
        if (view === 'passwords') {
            window.dispatchEvent(new CustomEvent('workplan:passwords-entry'));
        }
        currentView.set(view);
    }

    function updateNavPill() {
        if (!navEl || typeof window === 'undefined') return;
        const active = navEl.querySelector(`[data-nav-id="${$currentView}"]`);
        if (!active) {
            pillReady = false;
            return;
        }
        pillTop = active.offsetTop;
        pillHeight = active.offsetHeight;
        pillReady = true;
    }

    $: if (navEl) {
        $currentView;
        collapsed;
        navItems.length;
        tick().then(updateNavPill);
    }

    function handleNavResize() {
        updateNavPill();
    }

    function toggleCollapse() {
        collapsed = !collapsed;
    }

    function getSyncStatusClasses(status) {
        if (status === 'syncing') {
            return 'bg-blue-50 text-blue-600 border-blue-200';
        }
        if (status === 'done') {
            return 'bg-green-50 text-green-600 border-green-200';
        }
        if (status === 'error') {
            return 'bg-red-50 text-red-600 border-red-200';
        }
        return 'bg-slate-50 text-slate-400 border-slate-200';
    }

    async function logout() {
        const t = get(_);
        const confirmed = await showConfirm({
            title: t('settings.logout_title'),
            message: t('settings.logout_confirm'),
            confirmText: t('settings.logout_confirm_btn'),
            cancelText: t('common.cancel'),
            variant: 'warning'
        });
        if (confirmed) {
            passwordsStore.suspendForAccountSwitch();
            taskStore.logout();
            await flushLocalDatabase();
            showToast({ message: t('settings.logout_success'), type: 'info' });
            location.reload();
        }
    }


</script>

<svelte:window on:resize={handleNavResize} />

<aside
    id="navigation-sidebar"
    data-glass-role="sidebar"
    class="relative hidden md:flex bg-white border-r border-slate-200 flex-col z-20 shadow-lg shrink-0 transition-[width,padding] duration-300 ease-out"
    class:w-72={!collapsed}
    class:w-24={collapsed}
    class:nav-collapsed={collapsed}
>
    <div class="nav-header py-3 flex items-center border-b border-slate-100 h-16 px-4 gap-3">
        <div class="nav-brand" aria-hidden={collapsed}>
            <div class="nav-brand-inner">
            <div class="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-md shrink-0">
                <i class="ph ph-check-square-offset text-xl"></i>
            </div>

            <div class="flex-1 min-w-0 overflow-hidden">
                <h1 class="text-lg font-bold tracking-tight text-slate-800 leading-tight truncate">WorkPlan</h1>
                <div class="text-[10px] text-slate-400 font-mono truncate" title={$_('sidebar.current_key')}>
                    {$taskStore.accessKey}
                </div>
            </div>
            </div>
        </div>

        <button
            on:click={toggleCollapse}
            class="w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50 flex items-center justify-center shrink-0 transition-transform duration-300"
            title={collapsed ? $_('common.expand') || 'Expand' : $_('common.collapse') || 'Collapse'}
        >
            <i class:ph-caret-double-right={collapsed} class:ph-caret-double-left={!collapsed} class="ph text-lg"></i>
        </button>
    </div>

    <div class="px-4 py-3">
        <div
            class={`nav-sync relative flex items-center rounded-2xl border text-xs font-bold transition-all duration-300 gap-2 px-3 py-2.5 ${getSyncStatusClasses($taskStore.syncStatus)}`}
            title={$taskStore.syncStatus === 'syncing'
                ? $_('sync.syncing')
                : $taskStore.syncStatus === 'done'
                    ? $_('sync.synced')
                    : $taskStore.syncStatus === 'error'
                        ? $_('sync.sync_failed')
                        : $_('sync.ready')}
        >
            {#if $taskStore.syncStatus === 'syncing'}
                <i class="ph ph-spinner animate-spin shrink-0"></i>
            {:else if $taskStore.syncStatus === 'done'}
                <i class="ph-bold ph-check shrink-0"></i>
            {:else if $taskStore.syncStatus === 'error'}
                <i class="ph-bold ph-warning shrink-0"></i>
            {:else}
                <i class="ph ph-cloud shrink-0"></i>
            {/if}

                <span class="nav-label truncate" aria-hidden={collapsed}>
                    {#if $taskStore.syncStatus === 'syncing'}{$_('sync.syncing')}
                    {:else if $taskStore.syncStatus === 'done'}{$_('sync.synced')}
                    {:else if $taskStore.syncStatus === 'error'}{$_('sync.sync_failed')}
                    {:else}{$_('sync.ready')}{/if}
                </span>
        </div>
    </div>

    <nav bind:this={navEl} class="relative flex-1 px-3 pb-3 space-y-1.5">
        <div
            class="nav-active-pill pointer-events-none absolute left-3 right-3 top-0 rounded-2xl bg-slate-100 shadow-sm transition-transform duration-300 ease-out will-change-transform"
            style={`transform:translate3d(0, ${pillTop}px, 0);height:${pillHeight}px;opacity:${pillReady ? 1 : 0}`}
        ></div>
        {#each navItems as item}
            <button
                on:click={() => switchView(item.id)}
                data-nav-id={item.id}
                class={`nav-item relative z-10 w-full items-center rounded-2xl py-3 text-sm font-bold text-left ${$currentView === item.id ? item.activeText : `text-slate-600 ${item.hoverBg}`}`}
                title={item.label}
                aria-label={item.label}
            >
                <span class="w-5 flex items-center justify-center shrink-0">
                    <i class={`ph ${item.icon} text-lg shrink-0`}></i>
                </span>

                    <span class="nav-label truncate" aria-hidden={collapsed}>{item.label}</span>

                {#if item.badge}
                        <span class={`nav-badge min-w-5 h-5 px-1.5 rounded-full text-[10px] leading-5 font-bold ${item.badgeClass}`}>
                            {item.badge}
                        </span>
                {/if}
            </button>
        {/each}
    </nav>


    <div class="p-3 border-t border-slate-100 bg-slate-50">
            <div class="nav-management text-[10px] font-bold text-slate-400 uppercase mb-2" aria-hidden={collapsed}>{$_('settings.management')}</div>

        <div class={`grid gap-2 ${collapsed ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <button
                on:click={() => openBackupModal('export')}
                class={`flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-blue-600 hover:border-blue-200 transition ${collapsed ? 'h-11' : 'gap-1 py-2 text-xs'}`}
                title={$_('settings.backup')}
            >
                <i class="ph ph-download-simple"></i>
                <span class="nav-footer-label" aria-hidden={collapsed}>{$_('settings.backup')}</span>
            </button>

            <button
                on:click={() => openBackupModal('import')}
                class={`flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-blue-600 hover:border-blue-200 transition ${collapsed ? 'h-11' : 'gap-1 py-2 text-xs'}`}
                title={$_('settings.restore')}
            >
                <i class="ph ph-upload-simple"></i>
                <span class="nav-footer-label" aria-hidden={collapsed}>{$_('settings.restore')}</span>
            </button>

            <button
                on:click={logout}
                class={`${collapsed ? '' : 'col-span-2'} flex items-center justify-center rounded-xl border border-red-100 bg-white text-red-500 hover:bg-red-50 transition ${collapsed ? 'h-11' : 'gap-1 py-2 text-xs font-bold'}`}
                title={$_('settings.switch_account')}
            >
                <i class="ph-bold ph-sign-out"></i>
                <span class="nav-footer-label" aria-hidden={collapsed}>{$_('settings.switch_account')}</span>
            </button>

        </div>
    </div>

    <SidebarResizeHandle controls="navigation-sidebar" storageKey="workplan_navigation_panel_width"
        defaultWidth={288} minWidth={200} maxWidth={400} reserveWidth={560}
        bind:collapsed collapsedWidth={96} on:resize={handleNavResize} />
</aside>

<style>
    .nav-header { transition: gap 300ms ease-out, padding 300ms ease-out; }
    .nav-brand { flex: 1; min-width: 0; overflow: hidden; opacity: 1; transition: flex 300ms ease-out, opacity 180ms ease-out; }
    .nav-brand-inner { display: flex; gap: 12px; align-items: center; min-width: 180px; }
    .nav-item {
        display: grid;
        grid-template-columns: 20px minmax(0, 1fr) auto;
        gap: 12px;
        padding-left: 12px;
        padding-right: 12px;
        transition: grid-template-columns 300ms ease-out, gap 300ms ease-out, padding 300ms ease-out, color 180ms ease-out;
    }
    .nav-label { min-width: 0; opacity: 1; transition: opacity 180ms ease-out; }
    .nav-sync .nav-label { flex: 1; }
    .nav-sync { padding-left: 12px; transition: padding 300ms ease-out, gap 300ms ease-out; }
    .nav-badge { transition: transform 300ms ease-out; }
    .nav-footer-label { max-width: 160px; white-space: nowrap; overflow: hidden; opacity: 1; transition: max-width 300ms ease-out, opacity 180ms ease-out; }
    .nav-management { max-height: 20px; opacity: 1; overflow: hidden; transition: max-height 300ms ease-out, margin 300ms ease-out, opacity 180ms ease-out; }
    .nav-collapsed .nav-header { gap: 0; padding-left: calc((100% - 36px) / 2); padding-right: calc((100% - 36px) / 2); }
    .nav-collapsed .nav-brand { flex: 0; opacity: 0; }
    .nav-collapsed .nav-item { grid-template-columns: 20px minmax(0, 1fr) 0px; gap: 0; padding-left: calc((100% - 20px) / 2); padding-right: 0; }
    .nav-collapsed .nav-label { opacity: 0; pointer-events: none; }
    .nav-collapsed .nav-badge { transform: translate(-20px, -10px) scale(0.8); }
    .nav-collapsed .nav-sync { gap: 0; padding-left: calc((100% - 12px) / 2); padding-right: 0; }
    .nav-collapsed .nav-footer-label { max-width: 0; opacity: 0; }
    .nav-collapsed .nav-management { max-height: 0; margin-bottom: 0; opacity: 0; }
    @media (prefers-reduced-motion: reduce) {
        aside, .nav-header, .nav-brand, .nav-item, .nav-label, .nav-sync, .nav-badge, .nav-footer-label, .nav-management { transition: none; }
    }
</style>
