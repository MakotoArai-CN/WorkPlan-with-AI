<script>
    import { onMount } from 'svelte';
    import '../app.css';
    import '@phosphor-icons/web/regular';
    import '@phosphor-icons/web/bold';
    import '@phosphor-icons/web/fill';
    import { taskStore, activeTasks, today, viewDate } from '$lib/stores/tasks.js';
    import { settingsStore } from '$lib/stores/settings.js';
    import { reloadConnectorConfig } from '$lib/stores/connector.js';
    import { loadAiConfig } from '$lib/stores/ai.js';
    import { notesStore } from '$lib/stores/notes.js';
    import { passwordsStore } from '$lib/stores/passwords.js';
    import { initSecureSync } from '$lib/utils/secure-sync.js';
    import { isWebDemo } from '$lib/utils/runtime.js';
    import { initLocalDatabase, installLocalDatabaseMirror } from '$lib/utils/local-db.js';
    import { installGlassPointer } from '$lib/utils/glass-pointer.js';
    import { formatLocalDate } from '$lib/utils/datetime.js';
    import { showConfirm, showAlert } from '$lib/stores/modal.js';
    import { showExitToast } from '$lib/stores/navigation.js';
    import GlobalModal from '$lib/components/GlobalModal.svelte';
    import { retryPendingErase, resumeProtectionErase } from '$lib/utils/vault-protection.js';
    const loadBackupModal = () => import('$lib/components/BackupModal.svelte');
    let backupModule;
    import { backupModal, closeBackupModal } from '$lib/stores/backup-modal.js';
    import { get } from 'svelte/store';
    import { setupI18n } from '$lib/i18n/index.js';
    import { _, isLoading } from 'svelte-i18n';

    let i18nReady = false;

    onMount(() => {
        const retryErase = () => { void retryPendingErase().catch(error => console.warn('Protection deletion pending:', error)); };
        window.addEventListener('online', retryErase);
        let destroyed = false;
        let unlistenNotification = () => {};
        let unlistenAutostart = () => {};
        let unlistenUpdate = () => {};
        let unlistenAbout = () => {};
        let notificationTimer = null;
        let uninstallGlassPointer = () => {};
        let interval = null;
        let heartbeatInterval = null;

        (async () => {
            setupI18n();
            if (get(isLoading)) {
                await new Promise(resolve => {
                    let unsub = () => {};
                    unsub = isLoading.subscribe(loading => {
                        if (!loading) {
                            unsub();
                            resolve();
                        }
                    });
                });
            }
            if (destroyed) return;

            try {
                const localDb = await initLocalDatabase();
                await installLocalDatabaseMirror();
                if (await resumeProtectionErase()) return;
            } catch (error) {
                console.warn('Local database init failed:', error);
                // Do not initialize stores if a destructive operation is unfinished.
                if (localStorage.getItem('workplan_protection_erase') || passwordsStore.getProtection().failures > 10) return;
            }

            i18nReady = true;
            // Specular highlight for the liquid glass theme (no-op elsewhere).
            uninstallGlassPointer = installGlassPointer();
            taskStore.loadFromLocal();
            reloadConnectorConfig();
            await settingsStore.init();
            loadAiConfig();
            notesStore.load();
            // Vault entries are loaded on first use, not on the startup critical path.
            initSecureSync();
            void retryPendingErase().catch(error => console.warn('Protection deletion pending:', error));
            if (isWebDemo || destroyed) return;

            const currentSettings = get(settingsStore);
            if (currentSettings.closeToQuit) {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    await invoke('set_close_to_quit', { value: true });
                } catch {}
            }

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

            notificationTimer = setTimeout(() => {
                if (destroyed) return;
                const tasks = get(activeTasks);
                if (tasks.length > 0) {
                    settingsStore.showTaskNotification(tasks);
                }
            }, 2000);

            interval = setInterval(() => {
                // Roll the "today" cursor over at local midnight; a long-running
                // window otherwise keeps showing yesterday's board.
                const currentDay = formatLocalDate(new Date());
                const previousDay = get(today);
                if (currentDay !== previousDay) {
                    today.set(currentDay);
                    viewDate.update(value => value === previousDay ? currentDay : value);
                }
                taskStore.checkScheduled();
            }, 60000);

            // 心跳：每分钟检查一次，用户空闲 ≥5 分钟且距上次同步 ≥5 分钟时做一次后台双向同步。
            heartbeatInterval = setInterval(() => {
                if (destroyed) return;
                taskStore.maybeHeartbeat({ idleMs: 300000, minIntervalMs: 300000 });
            }, 60000);
        })();

        return () => {
            destroyed = true;
            window.removeEventListener('online', retryErase);
            unlistenNotification();
            unlistenAutostart();
            unlistenUpdate();
            unlistenAbout();
            uninstallGlassPointer();
            if (notificationTimer) clearTimeout(notificationTimer);
            if (interval) clearInterval(interval);
            if (heartbeatInterval) clearInterval(heartbeatInterval);
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
    {#if $backupModal.show}
        {#await (backupModule ||= loadBackupModal()) then module}
            <svelte:component this={module.default} show={$backupModal.show} mode={$backupModal.mode} onClose={closeBackupModal} />
        {/await}
    {/if}
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
