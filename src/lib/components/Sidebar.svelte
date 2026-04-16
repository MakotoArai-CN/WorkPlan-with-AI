<script>
    import { currentView, taskStore, enabledScheduledCount, activeTasks } from '../stores/tasks.js';
    import { showConfirm, showToast } from '../stores/modal.js';
    import { _ } from 'svelte-i18n';
    import { get } from 'svelte/store';

    const AUTO_COLLAPSE_VIEWS = new Set(['notes', 'aichat']);

    let fileInput;
    let collapsed = false;
    let lastView = 'dashboard';

    $: if (AUTO_COLLAPSE_VIEWS.has($currentView)) {
        collapsed = true;
    } else if (AUTO_COLLAPSE_VIEWS.has(lastView) && lastView !== $currentView) {
        collapsed = false;
    }

    $: lastView = $currentView;

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
            icon: 'ph-robot',
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
    ];

    function switchView(view) {
        currentView.set(view);
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

    function exportData() {
        const t = get(_);
        showToast({ message: t('settings.backup'), type: 'info', duration: 1500 });
        const data = taskStore.exportData($taskStore);
        const blob = new Blob([data], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `planpro_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast({ message: t('settings.backup_success'), type: 'success' });
    }

    function handleImport(event) {
        const t = get(_);
        const file = event.target.files[0];
        if (!file) return;
        showToast({ message: t('settings.import_importing') || '...', type: 'info', duration: 1500 });
        const reader = new FileReader();
        reader.onload = async (e) => {
            const result = taskStore.importData(e.target.result);
            if (result.success) {
                showToast({ message: t('settings.import_success'), type: 'success' });
            } else {
                showToast({ message: t('settings.import_failed', { values: { error: result.error } }), type: 'error' });
            }
        };
        reader.onerror = () => {
            showToast({ message: t('settings.file_read_failed'), type: 'error' });
        };
        reader.readAsText(file);
        event.target.value = '';
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
            taskStore.logout();
            showToast({ message: t('settings.logout_success'), type: 'info' });
        }
    }

    async function clearData() {
        const t = get(_);
        const confirmed = await showConfirm({
            title: t('settings.clear_title'),
            message: t('settings.clear_confirm', { values: { key: $taskStore.accessKey } }),
            confirmText: t('settings.clear_confirm_btn'),
            cancelText: t('common.cancel'),
            variant: 'danger'
        });
        if (confirmed) {
            await taskStore.clearAllData($taskStore.accessKey);
            showToast({ message: t('settings.clear_success'), type: 'success' });
            location.reload();
        }
    }
</script>

<aside
    class="hidden md:flex bg-white border-r border-slate-200 flex-col z-20 shadow-lg shrink-0 transition-[width,padding] duration-300 ease-out"
    class:w-72={!collapsed}
    class:w-24={collapsed}
>
    <div class="px-4 py-3 flex items-center border-b border-slate-100 h-16 gap-3">
        <div class="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-md shrink-0">
            <i class="ph ph-check-square-offset text-xl"></i>
        </div>

        <div
            class="flex-1 min-w-0 transition-all duration-300 overflow-hidden"
            class:opacity-0={collapsed}
            class:w-0={collapsed}
        >
            <h1 class="text-lg font-bold tracking-tight text-slate-800 leading-tight truncate">WorkPlan</h1>
            <div class="text-[10px] text-slate-400 font-mono truncate" title={$_('sidebar.current_key')}>
                {$taskStore.accessKey}
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
            class={`relative flex items-center rounded-2xl border text-xs font-bold transition-all duration-300 ${getSyncStatusClasses($taskStore.syncStatus)} ${collapsed ? 'justify-center px-2 py-2.5' : 'gap-2 px-3 py-2.5'}`}
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

            {#if !collapsed}
                <span class="truncate">
                    {#if $taskStore.syncStatus === 'syncing'}{$_('sync.syncing')}
                    {:else if $taskStore.syncStatus === 'done'}{$_('sync.synced')}
                    {:else if $taskStore.syncStatus === 'error'}{$_('sync.sync_failed')}
                    {:else}{$_('sync.ready')}{/if}
                </span>
            {/if}
        </div>
    </div>

    <nav class="flex-1 px-3 pb-3 space-y-1.5">
        {#each navItems as item}
            <button
                on:click={() => switchView(item.id)}
                class={`relative w-full flex items-center rounded-2xl py-3 transition-all duration-300 text-sm font-bold ${collapsed ? 'justify-center px-2' : 'justify-start gap-3 px-3 text-left'} ${$currentView === item.id ? `${item.activeBg} ${item.activeText} shadow-sm` : `text-slate-600 ${item.hoverBg}`}`}
                title={item.label}
            >
                <span class="w-5 flex items-center justify-center shrink-0">
                    <i class={`ph ${item.icon} text-lg shrink-0`}></i>
                </span>

                {#if !collapsed}
                    <span class="truncate">{item.label}</span>
                {/if}

                {#if item.badge}
                    {#if collapsed}
                        <span class={`absolute top-2 right-2 min-w-4 h-4 px-1 rounded-full text-[10px] leading-4 font-bold ${item.badgeClass}`}>
                            {item.badge}
                        </span>
                    {:else}
                        <span class={`ml-auto min-w-5 h-5 px-1.5 rounded-full text-[10px] leading-5 font-bold ${item.badgeClass}`}>
                            {item.badge}
                        </span>
                    {/if}
                {/if}
            </button>
        {/each}
    </nav>

    <div class="p-3 border-t border-slate-100 bg-slate-50">
        {#if !collapsed}
            <div class="text-[10px] font-bold text-slate-400 uppercase mb-2">{$_('settings.management')}</div>
        {/if}

        <div class={`grid gap-2 ${collapsed ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <button
                on:click={exportData}
                class={`flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-blue-600 hover:border-blue-200 transition ${collapsed ? 'h-11' : 'gap-1 py-2 text-xs'}`}
                title={$_('settings.backup')}
            >
                <i class="ph ph-download-simple"></i>
                {#if !collapsed}<span>{$_('settings.backup')}</span>{/if}
            </button>

            <button
                on:click={() => fileInput.click()}
                class={`flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-blue-600 hover:border-blue-200 transition ${collapsed ? 'h-11' : 'gap-1 py-2 text-xs'}`}
                title={$_('settings.restore')}
            >
                <i class="ph ph-upload-simple"></i>
                {#if !collapsed}<span>{$_('settings.restore')}</span>{/if}
            </button>

            <button
                on:click={logout}
                class={`${collapsed ? '' : 'col-span-2'} flex items-center justify-center rounded-xl border border-red-100 bg-white text-red-500 hover:bg-red-50 transition ${collapsed ? 'h-11' : 'gap-1 py-2 text-xs font-bold'}`}
                title={$_('settings.switch_account')}
            >
                <i class="ph-bold ph-sign-out"></i>
                {#if !collapsed}<span>{$_('settings.switch_account')}</span>{/if}
            </button>

            <button
                on:click={clearData}
                class={`${collapsed ? '' : 'col-span-2'} flex items-center justify-center rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition ${collapsed ? 'h-11' : 'gap-1 py-2 text-[10px]'}`}
                title={$_('settings.danger_zone')}
            >
                <i class="ph ph-trash"></i>
                {#if !collapsed}<span>{$_('settings.danger_zone')}</span>{/if}
            </button>

            <input type="file" bind:this={fileInput} on:change={handleImport} class="hidden" accept=".json">
        </div>
    </div>
</aside>
