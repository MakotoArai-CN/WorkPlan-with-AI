<script>
    import { settingsStore } from "../stores/settings.js";
    import { taskStore } from "../stores/tasks.js";
    import { invoke } from "@tauri-apps/api/core";
    import { showAlert, showConfirm, showToast } from "../stores/modal.js";
    import { onMount } from "svelte";
    import { _, locale } from 'svelte-i18n';
    import { get } from 'svelte/store';
    import { setLocale, supportedLocales } from '../i18n/index.js';

    let checkingUpdate = false;
    let isMobile = false;
    let fileInput;

    onMount(() => {
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

    function exportData() {
        const t = get(_);
        showToast({ message: t('settings.backup'), type: 'info', duration: 1500 });
        const state = { 
            tasks: $taskStore.tasks, 
            templates: $taskStore.templates, 
            scheduledTasks: $taskStore.scheduledTasks 
        };
        const data = JSON.stringify(state, null, 2);
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

    function handleThemeChange(theme) {
        settingsStore.setTheme(theme);
    }

    function handleEditorChange(editor) {
        settingsStore.setMarkdownEditor(editor);
    }
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
                    <div class="grid grid-cols-3 gap-2">
                        <button
                            on:click={() => handleThemeChange('light')}
                            class="flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all {$settingsStore.theme === 'light' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'}"
                        >
                            <div class="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shadow-sm">
                                <i class="ph ph-sun text-xl text-amber-500"></i>
                            </div>
                            <span class="text-xs font-bold text-slate-600 dark:text-slate-300">{$_('settings.theme_light')}</span>
                        </button>
                        <button
                            on:click={() => handleThemeChange('dark')}
                            class="flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all {$settingsStore.theme === 'dark' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'}"
                        >
                            <div class="w-10 h-10 rounded-lg bg-slate-800 border border-slate-600 flex items-center justify-center shadow-sm">
                                <i class="ph ph-moon text-xl text-indigo-400"></i>
                            </div>
                            <span class="text-xs font-bold text-slate-600 dark:text-slate-300">{$_('settings.theme_dark')}</span>
                        </button>
                        <button
                            on:click={() => handleThemeChange('auto')}
                            class="flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all {$settingsStore.theme === 'auto' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'}"
                        >
                            <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-white to-slate-800 border border-slate-300 flex items-center justify-center shadow-sm">
                                <i class="ph ph-circle-half text-xl text-slate-600"></i>
                            </div>
                            <span class="text-xs font-bold text-slate-600 dark:text-slate-300">{$_('settings.theme_auto')}</span>
                        </button>
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
                <div class="grid grid-cols-3 gap-2">
                    {#each supportedLocales as lang}
                        <button
                            on:click={() => setLocale(lang.code)}
                            class="flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all {$locale === lang.code ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'}"
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
                        <div class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base">{$_('settings.auto_save_key')}</div>
                        <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('settings.auto_save_key_desc') || ''}</div>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={$settingsStore.autoSaveApiKey}
                            on:change={settingsStore.toggleAutoSaveApiKey}
                            class="sr-only peer"
                        />
                        <div class="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                </div>
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

        {#if !isMobile}
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
                    <button on:click={checkUpdate} disabled={checkingUpdate}
                        class="flex items-center justify-center gap-2 py-2.5 md:py-3 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 rounded-lg text-xs md:text-sm font-bold text-blue-700 dark:text-blue-400 transition disabled:opacity-50">
                        <i class="ph text-lg" class:ph-spinner={checkingUpdate} class:animate-spin={checkingUpdate} class:ph-download-simple={!checkingUpdate}></i>
                        {checkingUpdate ? ($_('common.loading') || '...') : $_('settings.check_update')}
                    </button>
                </div>
                <button on:click={showAgreement}
                    class="w-full flex items-center justify-center gap-2 py-2.5 md:py-3 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 rounded-lg text-xs md:text-sm font-bold text-slate-600 dark:text-slate-300 transition">
                    <i class="ph ph-scroll text-lg"></i> {$_('agreement_page.title')}
                </button>
            </div>
        </div>

        <div class="text-center text-[10px] md:text-xs text-slate-400 dark:text-slate-500 py-4">
            Made with ❤️ by MakotoArai-CN
        </div>
    </div>
</div>