<script>
    import { onMount } from 'svelte';
    import '../app.css';
    import '@phosphor-icons/web/regular';
    import '@phosphor-icons/web/bold';
    import '@phosphor-icons/web/fill';
    import { taskStore, activeTasks, currentView, activeTask } from '$lib/stores/tasks.js';
    import { settingsStore } from '$lib/stores/settings.js';
    import { loadAiConfig, showAiPanel } from '$lib/stores/ai.js';
    import { notesStore } from '$lib/stores/notes.js';
    import { passwordsStore } from '$lib/stores/passwords.js';
    import { showConfirm, showAlert } from '$lib/stores/modal.js';
    import { setupAndroidBackHandler, handleBackPress, showExitToast, popNavigation, getNavigationDepth, canGoBack } from '$lib/stores/navigation.js';
    import GlobalModal from '$lib/components/GlobalModal.svelte';
    import { get } from 'svelte/store';
    import { setupI18n } from '$lib/i18n/index.js';
    import { _, isLoading } from 'svelte-i18n';

    let unlistenBack = () => {};
    let i18nReady = false;

    onMount(async () => {
        setupI18n();
        await new Promise(resolve => {
            const unsub = isLoading.subscribe(loading => {
                if (!loading) { unsub(); resolve(); }
            });
        });
        i18nReady = true;
        taskStore.loadFromLocal();
        await settingsStore.init();
        loadAiConfig();
        notesStore.load();
        passwordsStore.load();

        const currentSettings = get(settingsStore);
        if (currentSettings.closeToQuit) {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('set_close_to_quit', { value: true });
            } catch {}
        }

        let unlistenNotification = () => {};
        let unlistenAutostart = () => {};
        let unlistenUpdate = () => {};
        let unlistenAbout = () => {};

        try {
            const { listen } = await import('@tauri-apps/api/event');
            unlistenNotification = await listen('tray-notification-toggle', () => {
                settingsStore.toggleNotification();
            });
            unlistenAutostart = await listen('tray-autostart-toggle', async () => {
                try {
                    await settingsStore.toggleAutoStart();
                } catch (e) {
                    console.error(e);
                }
            });
            unlistenUpdate = await listen('tray-check-update', async () => {
                const { invoke } = await import('@tauri-apps/api/core');
                try {
                    const data = await invoke('check_update');
                    if (data && data.has_update) {
                        const confirmed = await showConfirm({
                            title: get(_)('settings.update_available'),
                            message: get(_)('settings.update_desc', { values: { version: data.latest_version } }),
                            confirmText: get(_)('settings.download'),
                            cancelText: get(_)('settings.later'),
                            variant: 'success'
                        });
                        if (confirmed) {
                            await invoke('open_releases');
                        }
                    } else {
                        await showAlert({ title: get(_)('settings.check_update'), message: get(_)('settings.up_to_date'), variant: 'success' });
                    }
                } catch (e) {
                    console.error(e);
                }
            });
            unlistenAbout = await listen('tray-open-about', () => {
                settingsStore.showAgreementModal();
            });
        } catch (e) {
            console.log('Tauri events not available:', e);
        }

        const closeToQuit = get(settingsStore).closeToQuit;
        unlistenBack = await setupAndroidBackHandler(closeToQuit, {
            onSecondaryBack: (view) => {
                const currentViewValue = get(currentView);
                const aiPanelOpen = get(showAiPanel);
                const activeTaskValue = get(activeTask);

                if (aiPanelOpen && currentViewValue !== 'aichat' && currentViewValue !== 'notes') {
                    showAiPanel.set(false);
                    return;
                }

                if (activeTaskValue) {
                    activeTask.set(null);
                    return;
                }

                const mainViews = ['dashboard', 'templates', 'scheduled', 'notes', 'more'];
                if (!mainViews.includes(currentViewValue)) {
                    currentView.set('more');
                } else if (currentViewValue !== 'dashboard') {
                    currentView.set('dashboard');
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
                    const win = getCurrentWindow();
                    await win.minimize();
                } catch {
                    console.log('Minimize not available');
                }
            }
        });

        setTimeout(() => {
            const tasks = get(activeTasks);
            if (tasks.length > 0) {
                settingsStore.showTaskNotification(tasks);
            }
        }, 2000);

        const interval = setInterval(() => {
            taskStore.checkScheduled();
        }, 60000);

        return () => {
            unlistenNotification();
            unlistenAutostart();
            unlistenUpdate();
            unlistenAbout();
            unlistenBack();
            clearInterval(interval);
        };
    });
</script>

<GlobalModal />

{#if i18nReady}
    {#if $showExitToast}
        <div class="fixed bottom-20 left-0 right-0 z-[102] flex justify-center pointer-events-none">
            <div class="bg-slate-800 text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-fade-in">
                {$_('exit.press_again')}
            </div>
        </div>
    {/if}
    <slot />
{/if}

<style>
    @keyframes fade-in {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }
    :global(.animate-fade-in) {
        animation: fade-in 0.2s ease-out;
    }
</style>