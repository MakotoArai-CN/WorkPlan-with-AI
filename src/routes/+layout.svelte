<script>
    import { onMount, tick } from 'svelte';
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
    import { showExitToast } from '$lib/stores/navigation.js';
    import GlobalModal from '$lib/components/GlobalModal.svelte';
    import { updateDialog, checkForUpdates } from '$lib/stores/updates.js';
    const loadUpdateDialog = () => import('$lib/components/UpdateDialog.svelte');
    let updateModule;
    $: if ($updateDialog.show && !updateModule) updateModule = loadUpdateDialog();
    import { migrateLegacyProtection } from '$lib/utils/vault-protection.js';
    const loadBackupModal = () => import('$lib/components/BackupModal.svelte');
    const loadDataRepairModal = () => import('$lib/components/DataRepairModal.svelte');
    let backupModule;
    let startupError = '';
    let showStartupRepair = false;
    import { backupModal, closeBackupModal } from '$lib/stores/backup-modal.js';
    import { get } from 'svelte/store';
    import { setupI18n } from '$lib/i18n/index.js';
    import { _, isLoading } from 'svelte-i18n';

    let i18nReady = false;

    onMount(() => {
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
                if (localDb.error) throw new Error(localDb.error);
                await installLocalDatabaseMirror();
                migrateLegacyProtection();
            } catch (error) {
                console.warn('Local database init failed:', error);
                startupError = String(error?.message || error);
                await tick();
                window.dispatchEvent(new Event('workplan:ready'));
                return;
            }

            // Specular highlight for the liquid glass theme (no-op elsewhere).
            uninstallGlassPointer = installGlassPointer();
            taskStore.loadFromLocal();
            reloadConnectorConfig();
            // Hydrate preferences synchronously, but do not keep the startup
            // screen over native permission dialogs and peripheral checks.
            const settingsInit = settingsStore.init().catch(error => console.warn('Settings initialization failed:', error));
            loadAiConfig();
            notesStore.load();
            // Vault entries are loaded on first use, not on the startup critical path.
            initSecureSync();
            if (destroyed) return;
            i18nReady = true;
            await tick();
            window.dispatchEvent(new Event('workplan:ready'));
            if (isWebDemo || destroyed) return;
            await settingsInit;
            if (destroyed) return;

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
                unlistenUpdate = await listen('tray-check-update', () => { void checkForUpdates(); });
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
        })().catch(error => {
            console.error('Application startup failed:', error);
            if (!destroyed) window.dispatchEvent(new Event('workplan:startup-error'));
        });

        return () => {
            destroyed = true;
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
{#if i18nReady && updateModule}
    {#await updateModule then module}
        <svelte:component this={module.default} />
    {/await}
{/if}

{#if startupError}
    <div class="min-h-dvh grid place-items-center p-6 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100">
        <div class="max-w-lg space-y-4">
            <h1 class="text-xl font-bold">WorkPlan — {$_('common.error')}</h1>
            <p role="alert" class="text-sm break-words">{startupError}</p>
            <p class="text-xs text-slate-500">{$_('settings.secure_backup_restore_warning')}</p>
            <div class="flex gap-3">
                <button on:click={() => location.reload()} class="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-700">{$_('ai.retry')}</button>
                <button on:click={() => showStartupRepair = true} class="px-4 py-2 rounded-xl bg-blue-600 text-white">{$_('settings.secure_backup_title')}</button>
            </div>
        </div>
    </div>
    {#if showStartupRepair}
        {#await loadDataRepairModal() then module}
            <svelte:component this={module.default} show={showStartupRepair} onClose={() => showStartupRepair = false} />
        {/await}
    {/if}
{/if}

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
