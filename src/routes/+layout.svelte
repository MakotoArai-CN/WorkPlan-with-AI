<script>
    import { onMount } from 'svelte';
    import '../app.css';
    import '@phosphor-icons/web/regular';
    import '@phosphor-icons/web/bold';
    import '@phosphor-icons/web/fill';
    import { taskStore, activeTasks } from '$lib/stores/tasks.js';
    import { settingsStore } from '$lib/stores/settings.js';
    import { loadAiConfig } from '$lib/stores/ai.js';
    import { showConfirm, showAlert } from '$lib/stores/modal.js';
    import GlobalModal from '$lib/components/GlobalModal.svelte';
    import { get } from 'svelte/store';

    onMount(async () => {
        taskStore.loadFromLocal();
        await settingsStore.init();
        loadAiConfig();

        let unlistenNotification = () => {};
        let unlistenAutostart = () => {};
        let unlistenUpdate = () => {};

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
                    if (data && data.tag_name) {
                        const latestVersion = data.tag_name.replace('v', '');
                        const currentVersion = settings.appVersion;
                        if (latestVersion !== currentVersion) {
                            const confirmed = await showConfirm({
                                title: '发现新版本',
                                message: `发现新版本 ${latestVersion}，是否前往下载？`,
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
                    }
                } catch (e) {
                    console.error(e);
                }
            });
        } catch (e) {
            console.log('Tauri events not available:', e);
        }

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
            clearInterval(interval);
        };
    });
</script>

<GlobalModal />
<slot />