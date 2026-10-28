<script>
    import { settingsStore } from "../stores/settings.js";
    import { taskStore } from "../stores/tasks.js";
    import { passwordsStore } from "../stores/passwords.js";
    import { secureSyncStatus, syncNotesNow, syncPasswordsNow, syncWorklogNow } from "../utils/secure-sync.js";
    import { invoke } from "@tauri-apps/api/core";
    import { showAlert, showConfirm, showToast } from "../stores/modal.js";
    import { onMount, onDestroy, tick } from "svelte";
    import { _, locale } from 'svelte-i18n';
    import { get } from 'svelte/store';
    import { setLocale, supportedLocales } from '../i18n/index.js';
    import { exportToJSON, describeSavedLocation } from "../utils/export.js";
    import { pickTrustedDirectory } from "../utils/local-file-tools.js";
    import VaultwardenImport from "./VaultwardenImport.svelte";
    import {
        DATABASE_PROVIDER_CATALOG,
        DATABASE_SETUP_SQL,
        getDatabaseProviderMeta,
    } from "../utils/database-providers.js";
    import { isAndroidRuntime, isWebDemo } from "../utils/runtime.js";

    let isAndroid = false;

    let checkingUpdate = false;
    let themeGridEl;
    let languageGridEl;
    let themePill = { left: 0, top: 0, width: 0, height: 0, ready: false };
    let languagePill = { left: 0, top: 0, width: 0, height: 0, ready: false };

    function measurePill(container, attribute, value) {
        if (!container) return { left: 0, top: 0, width: 0, height: 0, ready: false };
        const target = container.querySelector(`[data-${attribute}="${value}"]`);
        if (!target) return { left: 0, top: 0, width: 0, height: 0, ready: false };
        return {
            left: target.offsetLeft,
            top: target.offsetTop,
            width: target.offsetWidth,
            height: target.offsetHeight,
            ready: true
        };
    }

    function updateAppearancePills() {
        themePill = measurePill(themeGridEl, 'theme-id', get(settingsStore).theme);
        languagePill = measurePill(languageGridEl, 'language', get(locale));
    }

    $: if (themeGridEl) {
        $settingsStore.theme;
        tick().then(updateAppearancePills);
    }

    $: if (languageGridEl) {
        $locale;
        tick().then(updateAppearancePills);
    }

    onMount(() => {
        window.addEventListener('resize', updateAppearancePills);
        tick().then(updateAppearancePills);
        return () => window.removeEventListener('resize', updateAppearancePills);
    });

    onDestroy(() => {
        window.removeEventListener('resize', updateAppearancePills);
    });
    let isMobile = false;
    let fileInput;
    let trustedDirectoryInput = '';

    async function toggleNotesSync(event) {
        const t = get(_);
        const input = event.currentTarget;
        const enabled = input.checked;
        if (!enabled) {
            settingsStore.setSyncFlag('syncNotes', false);
            return;
        }
        if (!get(passwordsStore).isUnlocked) {
            input.checked = false;
            await showAlert({
                title: t('settings.sync_notes'),
                message: t('settings.sync_vault_locked'),
                variant: 'warning'
            });
            return;
        }
        const confirmed = await showConfirm({
            title: t('settings.sync_notes'),
            message: t('settings.sync_notes_confirm'),
            confirmText: t('common.confirm') || '开启',
            cancelText: t('common.cancel') || '取消'
        });
        if (!confirmed) {
            input.checked = false;
            return;
        }
        settingsStore.setSyncFlag('syncNotes', true);
        const result = await syncNotesNow({ manual: true });
        if (!result.success) {
            settingsStore.setSyncFlag('syncNotes', false);
            await showAlert({
                title: t('settings.sync_notes'),
                message: result.error || t('settings.sync_failed'),
                variant: 'danger'
            });
        }
    }

    async function togglePasswordSync(event) {
        const t = get(_);
        const input = event.currentTarget;
        const enabled = input.checked;
        if (!enabled) {
            settingsStore.setSyncFlag('syncPasswords', false);
            return;
        }
        if (!get(passwordsStore).isUnlocked) {
            input.checked = false;
            await showAlert({
                title: t('settings.sync_passwords'),
                message: t('settings.sync_vault_locked'),
                variant: 'warning'
            });
            return;
        }
        const confirmed = await showConfirm({
            title: t('settings.sync_passwords'),
            message: t('settings.sync_passwords_confirm'),
            confirmText: t('common.confirm') || '开启',
            cancelText: t('common.cancel') || '取消'
        });
        if (!confirmed) {
            input.checked = false;
            return;
        }
        settingsStore.setSyncFlag('syncPasswords', true);
        const result = await syncPasswordsNow({ manual: true });
        if (!result.success) {
            settingsStore.setSyncFlag('syncPasswords', false);
            await showAlert({
                title: t('settings.sync_passwords'),
                message: result.error || t('settings.sync_failed'),
                variant: 'danger'
            });
        }
    }

    async function manualSyncNotes() {
        const t = get(_);
        const result = await syncNotesNow({ manual: true });
        if (!result.success) {
            showToast({ message: result.error || t('settings.sync_failed'), type: 'error' });
        } else {
            showToast({ message: t('settings.sync_done'), type: 'success' });
        }
    }

    function handleVaultwardenImported(items) {
        const count = passwordsStore.addPasswordsBatch(items);
        showToast({
            message: get(_)('passwords.vaultwarden_imported', { values: { count } }),
            type: count > 0 ? 'success' : 'warning'
        });
    }

    function handleVaultwardenPushed(result) {
        showToast({
            message: get(_)('passwords.vaultwarden_push_success', {
                values: { pushed: result.pushed, skipped: result.skipped, failed: result.failed }
            }),
            type: result.pushed > 0 ? 'success' : 'warning'
        });
    }

    async function manualSyncPasswords() {
        const t = get(_);
        const result = await syncPasswordsNow({ manual: true });
        if (!result.success) {
            showToast({ message: result.error || t('settings.sync_failed'), type: 'error' });
        } else {
            showToast({ message: t('settings.sync_done'), type: 'success' });
        }
    }

    async function toggleWorklogSync(event) {
        const t = get(_);
        const input = event.currentTarget;
        if (!input.checked) {
            settingsStore.setSyncFlag('syncWorklog', false);
            return;
        }
        if (!get(passwordsStore).isUnlocked) {
            input.checked = false;
            await showAlert({
                title: t('settings.sync_worklog'),
                message: t('settings.sync_vault_locked'),
                variant: 'warning'
            });
            return;
        }
        const confirmed = await showConfirm({
            title: t('settings.sync_worklog'),
            message: t('settings.sync_worklog_confirm'),
            confirmText: t('common.confirm') || '开启',
            cancelText: t('common.cancel') || '取消'
        });
        if (!confirmed) {
            input.checked = false;
            return;
        }
        settingsStore.setSyncFlag('syncWorklog', true);
        const result = await syncWorklogNow({ manual: true });
        if (!result.success) {
            settingsStore.setSyncFlag('syncWorklog', false);
            await showAlert({
                title: t('settings.sync_worklog'),
                message: result.error || t('settings.sync_failed'),
                variant: 'danger'
            });
        }
    }

    async function manualSyncWorklog() {
        const t = get(_);
        const result = await syncWorklogNow({ manual: true });
        if (!result.success) {
            showToast({ message: result.error || t('settings.sync_failed'), type: 'error' });
        } else {
            showToast({ message: t('settings.sync_done'), type: 'success' });
        }
    }

    function syncStatusLabel(status) {
        const t = get(_);
        if (status === 'syncing') return t('settings.sync_syncing');
        if (status === 'done') return t('settings.sync_done');
        if (status === 'error') return t('settings.sync_error');
        return t('settings.sync_idle');
    }

    onMount(() => {
        isAndroid = isAndroidRuntime();
        isMobile =
            /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
                navigator.userAgent,
            ) || window.innerWidth < 768;
    });

    async function toggleAutoStart() {
        const t = get(_);
        try {
            await settingsStore.toggleAutoStart();
        } catch (error) {
            await showAlert({ title: t('common.error'), message: String(error), variant: "danger" });
        }
    }

    async function toggleCloseToQuit() {
        const t = get(_);
        try {
            await settingsStore.toggleCloseToQuit();
        } catch (error) {
            await showAlert({ title: t('common.error'), message: String(error), variant: "danger" });
        }
    }

    async function testNotification() {
        const t = get(_);
        try {
            await settingsStore.testNotification();
        } catch (error) {
            await showAlert({ title: t('common.error'), message: error.message, variant: "danger" });
        }
    }

    async function checkUpdate() {
        const t = get(_);
        checkingUpdate = true;
        try {
            const data = await invoke("check_update");
            if (data.has_update) {
                const confirmed = await showConfirm({
                    title: t('settings.update_available'),
                    message: t('settings.update_desc', { values: { version: data.latest_version } }),
                    confirmText: t('settings.download'),
                    cancelText: t('settings.later'),
                    variant: "success",
                });
                if (confirmed) { await invoke("open_releases"); }
            } else {
                await showAlert({ title: t('settings.check_update'), message: t('settings.up_to_date'), variant: "success" });
            }
        } catch (error) {
            await showAlert({ title: t('common.error'), message: String(error), variant: "danger" });
        } finally {
            checkingUpdate = false;
        }
    }

    async function openGithub() {
        await invoke("open_github");
    }

    function showAgreement() {
        settingsStore.showAgreementModal();
    }

    async function exportData() {
        const t = get(_);
        showToast({ message: t('settings.backup'), type: 'info', duration: 1500 });
        const state = { 
            tasks: $taskStore.tasks, 
            templates: $taskStore.templates, 
            scheduledTasks: $taskStore.scheduledTasks 
        };
        const result = await exportToJSON(
            state,
            `planpro_backup_${new Date().toISOString().split('T')[0]}.json`
        );
        if (result?.cancelled) {
            showToast({ message: t('common.cancel'), type: 'info' });
        } else if (result?.success) {
            const location = describeSavedLocation(result.path);
            showToast({ message: location ? `${t('settings.backup_success')}: ${location}` : t('settings.backup_success'), type: 'success', duration: 6000 });
        } else {
            showToast({ message: String(result?.error || t('common.error')), type: 'error' });
        }
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

    function handleThemeChange(theme) {
        // Move the highlight before the theme class swap so the transition
        // starts on the click frame instead of waiting for a full re-render.
        themePill = measurePill(themeGridEl, 'theme-id', theme);
        settingsStore.setTheme(theme);
    }

    function handleLanguageChange(code) {
        languagePill = measurePill(languageGridEl, 'language', code);
        setLocale(code);
    }

    function handleEditorChange(editor) {
        settingsStore.setMarkdownEditor(editor);
    }

    function updateDatabaseField(field, value) {
        settingsStore.updateDatabaseConfig({ [field]: value });
    }

    function updateLocalFileField(field, value) {
        settingsStore.updateLocalFileConfig({ [field]: value });
    }

    function addTrustedDirectory() {
        const value = trustedDirectoryInput.trim();
        if (!value) return;
        settingsStore.addTrustedDirectory(value);
        trustedDirectoryInput = '';
    }

    async function browseTrustedDirectory() {
        const t = get(_);
        try {
            const selected = await pickTrustedDirectory({
                defaultPath: trustedDirectoryInput || $settingsStore.workspaceRoot || ''
            });
            if (selected) {
                settingsStore.addTrustedDirectory(selected);
                showToast({ message: t('common.added') || t('common.success') || '已添加', type: 'success', duration: 1500 });
            }
        } catch (e) {
            console.warn('Directory picker not available:', e);
            await showAlert({
                title: t('common.error'),
                message: String(e?.message || e),
                variant: 'danger'
            });
        }
    }

    async function copyDatabaseSql() {
        const t = get(_);
        try {
            await navigator.clipboard.writeText(DATABASE_SETUP_SQL);
            showToast({ message: t('common.copied'), type: 'success' });
        } catch (error) {
            showToast({ message: String(error), type: 'error' });
        }
    }

    $: activeDatabaseMeta = getDatabaseProviderMeta($settingsStore.databaseConfig?.service || 'supabase');
    $: useCustomDatabaseConfig = $settingsStore.databaseConfig?.useCustomConfig ?? false;
    $: themeOptions = [
        { id: 'light', label: $_('settings.theme_light'), icon: 'ph-sun', preview: 'bg-white border border-slate-200', accent: 'text-amber-500' },
        { id: 'dark', label: $_('settings.theme_dark'), icon: 'ph-moon', preview: 'bg-slate-800 border border-slate-600', accent: 'text-indigo-400' },
        { id: 'auto', label: $_('settings.theme_auto'), icon: 'ph-circle-half', preview: 'bg-gradient-to-br from-white to-slate-800 border border-slate-300', accent: 'text-slate-600' },
        { id: 'ocean', label: $_('settings.theme_ocean'), icon: 'ph-wave-sine', preview: 'bg-gradient-to-br from-sky-100 to-cyan-200 border border-sky-200', accent: 'text-sky-600' },
        { id: 'forest', label: $_('settings.theme_forest'), icon: 'ph-tree-evergreen', preview: 'bg-gradient-to-br from-emerald-100 to-lime-200 border border-emerald-200', accent: 'text-emerald-600' },
        { id: 'sunset', label: $_('settings.theme_sunset'), icon: 'ph-sun-horizon', preview: 'bg-gradient-to-br from-orange-100 to-rose-200 border border-orange-200', accent: 'text-orange-500' },
        { id: 'rose', label: $_('settings.theme_rose'), icon: 'ph-flower-lotus', preview: 'bg-gradient-to-br from-rose-100 to-pink-200 border border-pink-200', accent: 'text-rose-500' },
        { id: 'graphite', label: $_('settings.theme_graphite'), icon: 'ph-moon-stars', preview: 'bg-gradient-to-br from-[#191e38] to-[#0c0f1a] border border-[rgba(120,140,200,0.2)]', accent: 'text-indigo-300' },
    ];
</script>

<div class="flex flex-col h-screen md:h-full overflow-hidden bg-slate-50 dark:bg-slate-900">
    <header
        class="h-14 md:h-16 bg-white/90 dark:bg-slate-800/90 backdrop-blur px-4 md:px-6 flex justify-between items-center z-10 sticky top-0 border-b border-slate-200 dark:border-slate-700 shrink-0"
    >
        <div>
            <h2 class="text-base md:text-lg font-bold text-slate-800 dark:text-slate-100">
                {$_('settings.title')}
            </h2>
            <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">
                {$_('settings.subtitle')}
            </div>
        </div>
    </header>

    <div
        class="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6 overscroll-contain pb-32 md:pb-40 min-h-0"
        style="-webkit-overflow-scrolling: touch;"
    >
        <!-- 外观设置 -->
        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <i class="ph ph-palette text-lg"></i> {$_('settings.appearance')}
            </div>
            <div class="p-4 md:p-6 space-y-4">
                <div>
                    <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base mb-2">{$_('settings.theme_mode')}</div>
                    <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 mb-3">{$_('settings.theme_desc')}</div>
                    <div bind:this={themeGridEl} class="relative grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div data-pill="theme" class="appearance-pill pointer-events-none absolute rounded-xl bg-blue-50 dark:bg-blue-900/30"
                            style={`width:${themePill.width}px;height:${themePill.height}px;transform:translate3d(${themePill.left}px, ${themePill.top}px, 0);opacity:${themePill.ready ? 1 : 0}`}></div>
                        {#each themeOptions as theme}
                            <button
                                data-theme-id={theme.id}
                                on:click={() => handleThemeChange(theme.id)}
                                class="relative z-10 flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-colors duration-500 {$settingsStore.theme === theme.id ? 'border-blue-500 shadow-sm' : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'}"
                            >
                                <div class={`w-10 h-10 rounded-lg flex items-center justify-center shadow-sm ${theme.preview}`}>
                                    <i class={`ph ${theme.icon} text-xl ${theme.accent}`}></i>
                                </div>
                                <span class="text-xs font-bold text-slate-600 dark:text-slate-300">{theme.label}</span>
                            </button>
                        {/each}
                    </div>
                </div>
            </div>
        </div>

        <!-- 语言设置 -->
        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <i class="ph ph-translate text-lg"></i> {$_('settings.language')}
            </div>
            <div class="p-4 md:p-6">
                <div bind:this={languageGridEl} class="relative grid grid-cols-3 gap-2">
                    <div data-pill="language" class="appearance-pill pointer-events-none absolute rounded-xl bg-blue-50 dark:bg-blue-900/30"
                        style={`width:${languagePill.width}px;height:${languagePill.height}px;transform:translate3d(${languagePill.left}px, ${languagePill.top}px, 0);opacity:${languagePill.ready ? 1 : 0}`}></div>
                    {#each supportedLocales as lang}
                        <button
                            data-language={lang.code}
                            on:click={() => handleLanguageChange(lang.code)}
                            class="relative z-10 flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-colors duration-500 {$locale === lang.code ? 'border-blue-500 shadow-sm' : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'}"
                        >
                            <span class="text-sm font-bold text-slate-700 dark:text-slate-200">{lang.label}</span>
                        </button>
                    {/each}
                </div>
            </div>
        </div>

        <!-- 编辑器设置 -->
        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <i class="ph ph-pencil-simple text-lg"></i> {$_('settings.editor')}
            </div>
            <div class="p-4 md:p-6 space-y-4">
                <div>
                    <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base mb-2">{$_('settings.markdown_editor')}</div>
                    <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 mb-3">{$_('settings.editor_desc')}</div>
                    <div class="grid grid-cols-2 gap-2">
                        <button
                            on:click={() => handleEditorChange('vditor')}
                            class="flex items-center gap-3 p-3 rounded-xl border-2 transition-all {$settingsStore.markdownEditor === 'vditor' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'}"
                        >
                            <div class="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                                <i class="ph ph-file-text text-xl text-green-600"></i>
                            </div>
                            <div class="text-left">
                                <div class="text-sm font-bold text-slate-700 dark:text-slate-200">Vditor</div>
                                <div class="text-[10px] text-slate-500 dark:text-slate-400">{$_('settings.editor_vditor_desc')}</div>
                            </div>
                        </button>
                        <button
                            on:click={() => handleEditorChange('milkdown')}
                            class="flex items-center gap-3 p-3 rounded-xl border-2 transition-all {$settingsStore.markdownEditor === 'milkdown' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'}"
                        >
                            <div class="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                                <i class="ph ph-notebook text-xl text-purple-600"></i>
                            </div>
                            <div class="text-left">
                                <div class="text-sm font-bold text-slate-700 dark:text-slate-200">Milkdown</div>
                                <div class="text-[10px] text-slate-500 dark:text-slate-400">{$_('settings.editor_milkdown_desc')}</div>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        {#if $settingsStore.notificationAvailable}
            <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
                <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <i class="ph ph-bell text-lg"></i> {$_('settings.notification')}
                </div>
                <div class="p-4 md:p-6 space-y-4">
                    <div class="flex items-center justify-between">
                        <div>
                            <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base">{$_('settings.system_notification')}</div>
                            <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('settings.notification_desc')}</div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={$settingsStore.enableNotification}
                                on:change={settingsStore.toggleNotification}
                                class="sr-only peer"
                            />
                            <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>
                    {#if $settingsStore.enableNotification}
                        <div class="pl-4 border-l-2 border-blue-100 dark:border-blue-800">
                            <button on:click={testNotification} class="text-xs text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1">
                                <i class="ph ph-play"></i> {$_('settings.test_notification')}
                            </button>
                        </div>
                    {/if}
                </div>
            </div>
        {/if}

        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <i class="ph ph-clock-afternoon text-lg"></i> {$_('settings.efficiency_tools')}
            </div>
            <div class="p-4 md:p-6 space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base">{$_('settings.overtime')}</div>
                        <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('settings.overtime_desc')}</div>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={$settingsStore.enableOvertime}
                            on:change={settingsStore.toggleOvertime}
                            class="sr-only peer"
                        />
                        <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                    </label>
                </div>
                {#if $settingsStore.enableOvertime}
                    <div class="pl-4 border-l-2 border-orange-100 dark:border-orange-800 text-[10px] md:text-xs text-slate-500 dark:text-slate-400">
                        {$_('settings.overtime_hint')}
                    </div>
                {/if}
            </div>
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <i class="ph ph-shield-check text-lg"></i> {$_('settings.secure_sync')}
            </div>
            <div class="p-4 md:p-6 space-y-5">
                <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">
                    {$_('settings.secure_sync_desc')}
                </div>

                <div class="space-y-2">
                    <div class="flex items-center justify-between gap-3">
                        <div>
                            <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base">{$_('settings.sync_notes')}</div>
                            <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('settings.sync_notes_desc')}</div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer shrink-0">
                            <input
                                id="sync-notes-toggle"
                                type="checkbox"
                                checked={$settingsStore.syncNotes}
                                on:change={toggleNotesSync}
                                class="sr-only peer"
                            />
                            <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                        </label>
                    </div>
                    <div class="text-[10px] text-slate-400 dark:text-slate-500">{$_('settings.sync_notes_hint')}</div>
                    {#if $settingsStore.syncNotes}
                        <div class="flex items-center justify-between gap-3 pl-3 border-l-2 border-emerald-100 dark:border-emerald-800">
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={$settingsStore.syncLockedNotes}
                                    on:change={(event) => settingsStore.setSyncFlag('syncLockedNotes', event.currentTarget.checked)}
                                    class="rounded border-slate-300 text-emerald-600 focus:ring-emerald-400" />
                                <span class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('settings.sync_locked_notes')}</span>
                            </label>
                            <div class="flex items-center gap-2">
                                <span class="text-[10px] text-slate-400">{$_('settings.sync_status')}: {syncStatusLabel($secureSyncStatus.notes)}</span>
                                <button on:click={manualSyncNotes} disabled={$secureSyncStatus.notes === 'syncing'}
                                    class="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-emerald-50 text-emerald-600 disabled:opacity-50">
                                    {$_('settings.sync_now')}
                                </button>
                            </div>
                        </div>
                    {/if}
                </div>

                <div class="border-t border-slate-100 dark:border-slate-700"></div>

                <div class="space-y-2">
                    <div class="flex items-center justify-between gap-3">
                        <div>
                            <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base">{$_('settings.sync_passwords')}</div>
                            <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('settings.sync_passwords_desc')}</div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer shrink-0">
                            <input
                                id="sync-passwords-toggle"
                                type="checkbox"
                                checked={$settingsStore.syncPasswords}
                                on:change={togglePasswordSync}
                                class="sr-only peer"
                            />
                            <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                        </label>
                    </div>
                    <div class="text-[10px] text-slate-400 dark:text-slate-500">{$_('settings.sync_passwords_hint')}</div>
                    {#if $settingsStore.syncPasswords}
                        <div class="flex items-center justify-between gap-3 pl-3 border-l-2 border-indigo-100 dark:border-indigo-800">
                            <span class="text-[10px] text-slate-400">
                                {#if $passwordsStore.isUnlocked}
                                    {$_('settings.sync_status')}: {syncStatusLabel($secureSyncStatus.passwords)}
                                {:else}
                                    {$_('settings.sync_vault_locked_short')}
                                {/if}
                            </span>
                            <button on:click={manualSyncPasswords}
                                disabled={!$passwordsStore.isUnlocked || $secureSyncStatus.passwords === 'syncing'}
                                class="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-indigo-50 text-indigo-600 disabled:opacity-50">
                                {$_('settings.sync_now')}
                            </button>
                        </div>
                        <div class="pl-3 border-l-2 border-indigo-100 dark:border-indigo-800">
                            <VaultwardenImport
                                disabled={!$passwordsStore.isUnlocked}
                                itemCount={$passwordsStore.isUnlocked ? $passwordsStore.passwords.length : 0}
                                getItems={() => passwordsStore.getDecryptedPasswords()}
                                onImported={handleVaultwardenImported}
                                onPushed={handleVaultwardenPushed}
                            />
                        </div>
                    {/if}
                </div>

                <div class="border-t border-slate-100 dark:border-slate-700"></div>

                <div class="space-y-2">
                    <div class="flex items-center justify-between gap-3">
                        <div>
                            <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base">{$_('settings.sync_worklog')}</div>
                            <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('settings.sync_worklog_desc')}</div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer shrink-0">
                            <input
                                id="sync-worklog-toggle"
                                type="checkbox"
                                checked={$settingsStore.syncWorklog}
                                on:change={toggleWorklogSync}
                                class="sr-only peer"
                            />
                            <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                        </label>
                    </div>
                    <div class="text-[10px] text-slate-400 dark:text-slate-500">{$_('settings.sync_worklog_hint')}</div>
                    {#if $settingsStore.syncWorklog}
                        <div class="flex items-center justify-between gap-3 pl-3 border-l-2 border-amber-100 dark:border-amber-800">
                            <span class="text-[10px] text-slate-400">
                                {#if $passwordsStore.isUnlocked}
                                    {$_('settings.sync_status')}: {syncStatusLabel($secureSyncStatus.worklog)}
                                {:else}
                                    {$_('settings.sync_vault_locked_short')}
                                {/if}
                            </span>
                            <button on:click={manualSyncWorklog}
                                disabled={!$passwordsStore.isUnlocked || $secureSyncStatus.worklog === 'syncing'}
                                class="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-amber-50 text-amber-700 disabled:opacity-50">
                                {$_('settings.sync_now')}
                            </button>
                        </div>
                    {/if}
                </div>

                {#if $secureSyncStatus.error}
                    <div class="text-[10px] text-red-500 break-words">{$secureSyncStatus.error}</div>
                {/if}

                <div class="text-[10px] text-slate-400 dark:text-slate-500 flex items-start gap-1.5">
                    <i class="ph ph-info mt-0.5"></i>
                    <span>{$_('settings.sync_requires_db')}</span>
                </div>
            </div>
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <i class="ph ph-sparkle text-lg"></i> {$_('settings.ai_features')}
            </div>
            <div class="p-4 md:p-6 space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base">{$_('settings.ai_report')}</div>
                        <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('settings.ai_report_desc') || ''}</div>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={$settingsStore.enableAiSummary}
                            on:change={settingsStore.toggleAiSummary}
                            class="sr-only peer"
                        />
                        <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                </div>
                <div class="flex items-center justify-between">
                    <div>
                        <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base flex items-center gap-2">
                            {$_('settings.ai_chat_tools')}
                            <span class="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                                {$_('settings.experimental')}
                            </span>
                        </div>
                        <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('settings.ai_chat_tools_desc') || ''}</div>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={$settingsStore.enableAiChatTools}
                            on:change={settingsStore.toggleAiChatTools}
                            class="sr-only peer"
                        />
                        <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
                    </label>
                </div>
                <div class="flex items-center justify-between">
                    <div>
                        <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base">
                            {$_('settings.ai_execution_notification')}
                        </div>
                        <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('settings.ai_execution_notification_desc')}</div>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={$settingsStore.enableAiExecutionNotification}
                            on:change={settingsStore.toggleAiExecutionNotification}
                            class="sr-only peer"
                        />
                        <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                </div>
                {#if !isWebDemo}
                <div class="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-4">
                    <div class="flex items-start justify-between gap-4">
                        <div>
                            <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base">
                                {$_('settings.local_files')}
                            </div>
                            <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 leading-6">
                                {$_('settings.local_files_desc')}
                            </div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={$settingsStore.localFileConfig?.enabled}
                                on:change={(e) => updateLocalFileField('enabled', e.target.checked)}
                                class="sr-only peer"
                            />
                            <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-fuchsia-600"></div>
                        </label>
                    </div>

                    {#if $settingsStore.localFileConfig?.enabled}
                        <div class="rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 p-3 space-y-3">
                            <div>
                                <div class="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                                    {$_('settings.workspace_root')}
                                </div>
                                <div class="mt-1 text-xs font-mono break-all text-slate-600 dark:text-slate-300">
                                    {$settingsStore.workspaceRoot || $_('settings.workspace_unknown')}
                                </div>
                            </div>
                            <div class="flex items-center justify-between gap-4">
                                <div>
                                    <div class="font-bold text-sm text-slate-700 dark:text-slate-200">
                                        {$_('settings.local_files_confirm')}
                                    </div>
                                    <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">
                                        {$_('settings.local_files_confirm_desc')}
                                    </div>
                                </div>
                                <label class="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={$settingsStore.localFileConfig?.requireConfirmation}
                                        on:change={(e) => updateLocalFileField('requireConfirmation', e.target.checked)}
                                        class="sr-only peer"
                                    />
                                    <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                                </label>
                            </div>
                            <div class="space-y-2">
                                <div class="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                                    {$_('settings.trusted_directories')}
                                </div>
                                {#if isMobile}
                                    <button
                                        on:click={browseTrustedDirectory}
                                        class="w-full h-11 px-4 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-sm font-bold flex items-center justify-center gap-2"
                                    >
                                        <i class="ph ph-folder-open text-lg"></i>
                                        通过系统授权目录
                                    </button>
                                {:else}
                                    <div class="flex gap-2">
                                        <input
                                            bind:value={trustedDirectoryInput}
                                            type="text"
                                            placeholder={$_('settings.trusted_directories_placeholder')}
                                            on:keydown={(e) => e.key === 'Enter' && addTrustedDirectory()}
                                            class="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-fuchsia-400 font-mono"
                                        />
                                        <button
                                            on:click={browseTrustedDirectory}
                                            class="h-11 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-bold border border-slate-200"
                                            title={$_('settings.browse') || 'Browse'}
                                        >
                                            <i class="ph ph-folder-open text-lg"></i>
                                        </button>
                                        <button
                                            on:click={addTrustedDirectory}
                                            class="h-11 px-4 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-sm font-bold"
                                        >
                                            {$_('common.add')}
                                        </button>
                                    </div>
                                {/if}
                                <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 leading-6">
                                    {$_('settings.trusted_directories_desc')}
                                </div>
                                <div class="space-y-2">
                                    {#each $settingsStore.localFileConfig?.trustedDirectories || [] as directory}
                                        <div class="flex items-start gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5">
                                            <div class="flex-1 min-w-0 text-xs font-mono break-all text-slate-600 dark:text-slate-300">
                                                {directory}
                                            </div>
                                            <button
                                                on:click={() => settingsStore.removeTrustedDirectory(directory)}
                                                class="text-slate-400 hover:text-red-600 transition"
                                                title={$_('common.delete')}
                                            >
                                                <i class="ph ph-x"></i>
                                            </button>
                                        </div>
                                    {:else}
                                        <div class="text-xs text-slate-400">
                                            {$_('settings.trusted_directories_empty')}
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        </div>
                    {/if}
                </div>
                {/if}
            </div>
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <i class="ph ph-database text-lg"></i> 数据库配置
            </div>
            <div class="p-4 md:p-6 space-y-5">
                <div class="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-4">
                    <div class="flex items-center justify-between gap-4">
                        <div>
                            <div class="font-bold text-sm text-slate-700 dark:text-slate-200">
                                {$_('settings.database_custom_title')}
                            </div>
                            <div class="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-6">
                                {$_('settings.database_custom_desc')}
                            </div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer shrink-0">
                            <input
                                type="checkbox"
                                checked={useCustomDatabaseConfig}
                                on:change={(e) => updateDatabaseField('useCustomConfig', e.target.checked)}
                                class="sr-only peer"
                            />
                            <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>

                    <div
                        class="overflow-hidden transition-[max-height,opacity,margin] duration-300 ease-out"
                        class:max-h-[1000px]={useCustomDatabaseConfig}
                        class:opacity-100={useCustomDatabaseConfig}
                        class:mt-0={useCustomDatabaseConfig}
                        class:max-h-0={!useCustomDatabaseConfig}
                        class:opacity-0={!useCustomDatabaseConfig}
                    >
                        <div class="pt-1 space-y-4">
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label for="database-service" class="text-xs font-bold text-slate-500 uppercase mb-2 block">
                                        数据库服务
                                    </label>
                                    <select
                                        id="database-service"
                                        value={$settingsStore.databaseConfig?.service || 'supabase'}
                                        on:change={(e) => updateDatabaseField('service', e.target.value)}
                                        class="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400"
                                    >
                                        {#each DATABASE_PROVIDER_CATALOG as provider}
                                            <option value={provider.id}>{provider.name}</option>
                                        {/each}
                                    </select>
                                </div>
                                <div>
                                    <div class="text-xs font-bold text-slate-500 uppercase mb-2 block">
                                        启用云同步
                                    </div>
                                    <label class="relative inline-flex items-center cursor-pointer mt-1">
                                        <input
                                            type="checkbox"
                                            checked={$settingsStore.databaseConfig?.enabled}
                                            on:change={(e) => updateDatabaseField('enabled', e.target.checked)}
                                            class="sr-only peer"
                                            aria-label="启用云同步"
                                        />
                                        <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                    </label>
                                </div>
                                <div>
                                    <label for="database-url" class="text-xs font-bold text-slate-500 uppercase mb-2 block">
                                        HTTP API / 项目地址
                                    </label>
                                    <input
                                        id="database-url"
                                        value={$settingsStore.databaseConfig?.url || ''}
                                        on:input={(e) => updateDatabaseField('url', e.target.value)}
                                        type="url"
                                        placeholder="https://your-project.supabase.co"
                                        class="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 font-mono"
                                    />
                                </div>
                                <div>
                                    <label for="database-api-key" class="text-xs font-bold text-slate-500 uppercase mb-2 block">
                                        API Key / Token
                                    </label>
                                    <input
                                        id="database-api-key"
                                        value={$settingsStore.databaseConfig?.apiKey || ''}
                                        on:input={(e) => updateDatabaseField('apiKey', e.target.value)}
                                        type="password"
                                        placeholder="service role / anon / gateway token"
                                        class="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 font-mono"
                                    />
                                </div>
                                <div>
                                    <label for="database-table-name" class="text-xs font-bold text-slate-500 uppercase mb-2 block">
                                        数据表 / 集合名
                                    </label>
                                    <input
                                        id="database-table-name"
                                        value={$settingsStore.databaseConfig?.tableName || ''}
                                        on:input={(e) => updateDatabaseField('tableName', e.target.value)}
                                        type="text"
                                        placeholder="planpro_data"
                                        class="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 font-mono"
                                    />
                                </div>
                                <div>
                                    <label for="database-project-id" class="text-xs font-bold text-slate-500 uppercase mb-2 block">
                                        数据库名 / 项目 ID
                                    </label>
                                    <input
                                        id="database-project-id"
                                        value={$settingsStore.databaseConfig?.projectId || ''}
                                        on:input={(e) => updateDatabaseField('projectId', e.target.value)}
                                        type="text"
                                        placeholder="可选"
                                        class="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400"
                                    />
                                </div>
                            </div>

                            <div class="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                                <div class="font-bold text-sm text-slate-700 dark:text-slate-200">
                                    {activeDatabaseMeta.name}
                                </div>
                                <div class="text-xs text-slate-500 dark:text-slate-400">
                                    类型：{activeDatabaseMeta.databaseType}
                                </div>
                                <div class="text-xs text-slate-500 dark:text-slate-400">
                                    免费层：{activeDatabaseMeta.freeTier}
                                </div>
                                <div class="text-xs text-slate-500 dark:text-slate-400">
                                    升级后：{activeDatabaseMeta.paidTier}
                                </div>
                                <div class="text-xs text-slate-600 dark:text-slate-300 leading-6">
                                    {activeDatabaseMeta.notes}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {#if useCustomDatabaseConfig}
                    <div class="space-y-3">
                        <div class="flex items-center justify-between gap-2 flex-wrap">
                            <div>
                                <div class="font-bold text-sm text-slate-700 dark:text-slate-200">
                                    自托管 / PostgreSQL 建表 SQL
                                </div>
                                <div class="text-xs text-slate-500 dark:text-slate-400">
                                    适用于 Supabase、自托管 Postgres、通过 PostgREST 暴露的兼容接口
                                </div>
                            </div>
                            <button
                                on:click={copyDatabaseSql}
                                class="h-8 px-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold flex items-center gap-1.5"
                            >
                                <i class="ph ph-copy"></i> 复制 SQL
                            </button>
                        </div>
                        <pre class="text-xs leading-6 rounded-xl bg-slate-950 text-slate-100 p-4 overflow-x-auto"><code>{DATABASE_SETUP_SQL}</code></pre>
                    </div>

                    <div class="overflow-x-auto">
                        <table class="min-w-full text-xs border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                            <thead class="bg-slate-50 dark:bg-slate-700/60">
                                <tr>
                                    <th class="px-3 py-2 text-left">服务/工具</th>
                                    <th class="px-3 py-2 text-left">数据库类型</th>
                                    <th class="px-3 py-2 text-left">免费层</th>
                                    <th class="px-3 py-2 text-left">付费/升级</th>
                                    <th class="px-3 py-2 text-left">说明</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each DATABASE_PROVIDER_CATALOG as provider}
                                    <tr class="border-t border-slate-200 dark:border-slate-700 align-top">
                                        <td class="px-3 py-2 font-bold text-slate-700 dark:text-slate-200">
                                            {provider.name}
                                        </td>
                                        <td class="px-3 py-2 text-slate-500 dark:text-slate-400">
                                            {provider.databaseType}
                                        </td>
                                        <td class="px-3 py-2 text-slate-500 dark:text-slate-400">
                                            {provider.freeTier}
                                        </td>
                                        <td class="px-3 py-2 text-slate-500 dark:text-slate-400">
                                            {provider.paidTier}
                                        </td>
                                        <td class="px-3 py-2 text-slate-500 dark:text-slate-400 leading-6">
                                            {provider.notes}
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                {/if}
            </div>
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <i class="ph ph-chart-bar text-lg"></i> {$_('settings.charts')}
            </div>
            <div class="p-4 md:p-6 space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base">{$_('settings.show_charts')}</div>
                        <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('settings.charts_desc') || ''}</div>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={$settingsStore.enableCharts}
                            on:change={settingsStore.toggleCharts}
                            class="sr-only peer"
                        />
                        <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                    </label>
                </div>
            </div>
        </div>

        {#if !isMobile && !isWebDemo}
            <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
                <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <i class="ph ph-power text-lg"></i> {$_('settings.startup')}
                </div>
                <div class="p-4 md:p-6 space-y-4">
                    <div class="flex items-center justify-between">
                        <div>
                            <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base">{$_('settings.autostart')}</div>
                            <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('settings.autostart_desc') || ''}</div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={$settingsStore.autoStart}
                                on:change={toggleAutoStart}
                                disabled={$settingsStore.autoStartLoading}
                                class="sr-only peer"
                            />
                            <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600 peer-disabled:opacity-50"></div>
                        </label>
                    </div>
                    {#if $settingsStore.autoStartLoading}
                        <div class="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                            <i class="ph ph-spinner animate-spin"></i> {$_('settings.configuring')}
                        </div>
                    {/if}
                </div>
            </div>

            <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
                <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <i class="ph ph-x-circle text-lg"></i> {$_('settings.window')}
                </div>
                <div class="p-4 md:p-6 space-y-4">
                    <div class="flex items-center justify-between">
                        <div>
                            <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base">{$_('settings.close_to_quit')}</div>
                            <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('settings.close_to_quit_desc') || ''}</div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={$settingsStore.closeToQuit}
                                on:change={toggleCloseToQuit}
                                class="sr-only peer"
                            />
                            <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                        </label>
                    </div>
                </div>
            </div>
        {:else}
            <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
                <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <i class="ph ph-arrow-u-up-left text-lg"></i> {$_('settings.back_behavior')}
                </div>
                <div class="p-4 md:p-6 space-y-4">
                    <div class="flex items-center justify-between">
                        <div>
                            <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base">{$_('settings.double_back_exit')}</div>
                            <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('settings.back_behavior_desc') || ''}</div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={$settingsStore.closeToQuit}
                                on:change={toggleCloseToQuit}
                                class="sr-only peer"
                            />
                            <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                        </label>
                    </div>
                </div>
            </div>

            <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
                <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <i class="ph ph-database text-lg"></i> {$_('settings.management')}
                </div>
                <div class="p-4 md:p-6 space-y-3">
                    <div class="grid grid-cols-2 gap-3">
                        <button on:click={exportData}
                            class="flex items-center justify-center gap-2 py-3 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 rounded-lg text-sm font-bold text-slate-700 dark:text-slate-200 transition">
                            <i class="ph ph-download-simple text-lg"></i> {$_('settings.backup')}
                        </button>
                        <button on:click={() => fileInput.click()}
                            class="flex items-center justify-center gap-2 py-3 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 rounded-lg text-sm font-bold text-slate-700 dark:text-slate-200 transition">
                            <i class="ph ph-upload-simple text-lg"></i> {$_('settings.restore')}
                        </button>
                    </div>
                    <button on:click={logout}
                        class="w-full flex items-center justify-center gap-2 py-3 bg-orange-50 dark:bg-orange-900/30 hover:bg-orange-100 dark:hover:bg-orange-900/50 border border-orange-200 dark:border-orange-800 rounded-lg text-sm font-bold text-orange-600 dark:text-orange-400 transition">
                        <i class="ph-bold ph-sign-out text-lg"></i> {$_('settings.switch_account')}
                    </button>
                    <button on:click={clearData}
                        class="w-full flex items-center justify-center gap-2 py-2.5 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition">
                        <i class="ph ph-trash text-lg"></i> {$_('settings.danger_zone')}
                    </button>
                    <input type="file" bind:this={fileInput} on:change={handleImport} class="hidden" accept=".json">
                </div>
            </div>
        {/if}

        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <i class="ph ph-info text-lg"></i> {$_('settings.about')}
            </div>
            <div class="p-4 md:p-6 space-y-4">
                <div class="flex items-center gap-3 md:gap-4">
                    <div class="w-12 h-12 md:w-16 md:h-16 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                        <i class="ph-bold ph-check-square-offset text-2xl md:text-3xl"></i>
                    </div>
                    <div class="flex-1">
                        <h3 class="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100">WorkPlan with AI</h3>
                        <div class="text-xs md:text-sm text-slate-500 dark:text-slate-400">{$_('settings.version')} {$settingsStore.appVersion}</div>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2 md:gap-3">
                    <button on:click={openGithub}
                        class="flex items-center justify-center gap-2 py-2.5 md:py-3 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 rounded-lg text-xs md:text-sm font-bold text-slate-700 dark:text-slate-200 transition">
                        <i class="ph ph-github-logo text-lg"></i> GitHub
                    </button>
                    {#if !isWebDemo}
                    <button on:click={checkUpdate} disabled={checkingUpdate}
                        class="flex items-center justify-center gap-2 py-2.5 md:py-3 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 rounded-lg text-xs md:text-sm font-bold text-blue-700 dark:text-blue-400 transition disabled:opacity-50">
                        <i class="ph text-lg" class:ph-spinner={checkingUpdate} class:animate-spin={checkingUpdate} class:ph-download-simple={!checkingUpdate}></i>
                        {checkingUpdate ? ($_('common.loading') || '...') : $_('settings.check_update')}
                    </button>
                    {/if}
                </div>
                <button on:click={showAgreement}
                    class="w-full flex items-center justify-center gap-2 py-2.5 md:py-3 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 rounded-lg text-xs md:text-sm font-bold text-slate-600 dark:text-slate-300 transition">
                    <i class="ph ph-scroll text-lg"></i> {$_('agreement_page.title')}
                </button>
            </div>
        </div>

        <div class="text-center text-[10px] md:text-xs text-slate-400 dark:text-slate-500 py-4">
            Powered by ❤️ MakotoArai-CN
        </div>
    </div>
</div>
