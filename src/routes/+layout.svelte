<script>
    import { onMount } from 'svelte';
    import '../app.css';
    import '@phosphor-icons/web/regular';
    import '@phosphor-icons/web/bold';
    import '@phosphor-icons/web/fill';
    import { taskStore, activeTasks } from '$lib/stores/tasks.js';
    import { settingsStore } from '$lib/stores/settings.js';
    import { loadAiConfig } from '$lib/stores/ai.js';
    import { notesStore } from '$lib/stores/notes.js';
    import { passwordsStore } from '$lib/stores/passwords.js';
    import { showConfirm, showAlert } from '$lib/stores/modal.js';
    import { setupAndroidBackHandler, handleBackPress, showExitToast } from '$lib/stores/navigation.js';
    import GlobalModal from '$lib/components/GlobalModal.svelte';
    import { get } from 'svelte/store';

    let unlistenBack = () => {};

    onMount(async () => {
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
                const settings = get(settingsStore);
                try {
                    const data = await invoke('check_update');
                    if (data && data.has_update) {
                        const confirmed = await showConfirm({
                            title: '发现新版本',
                            message: `发现新版本 v${data.latest_version}，是否前往下载？`,
                            confirmText: '前往下载',
                            cancelText: '稍后',
                            variant: 'success'
                        });
                        if (confirmed) {
                            await invoke('open_releases');
                        }
                    } else {
                        await showAlert({ title: '检查更新', message: '当前已是最新版本！', variant: 'success' });
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
                console.log('Returned from:', view);
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
                    const { appWindow } = await import('@tauri-apps/api/window');
                    await appWindow.minimize();
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

{#if $showExitToast}
    <div class="fixed bottom-20 left-0 right-0 z-[102] flex justify-center pointer-events-none">
        <div class="bg-slate-800 text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium">
            再按一次退出应用
        </div>
    </div>
{/if}

<slot />