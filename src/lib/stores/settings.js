import { writable, get } from 'svelte/store';
import { _ as i18n } from 'svelte-i18n';
import { getDefaultDatabaseConfig } from '../utils/database-providers.js';
import { getDefaultLocalFileConfig, getWorkspaceRoot } from '../utils/local-file-tools.js';

const DARK_THEMES = new Set(['dark', 'graphite']);
const NOTIFICATION_CHANNEL_ID = 'workplan-important';
let themeTransitionTimer = null;
let notificationChannelPromise = null;

function getInitialSettings() {
    if (typeof window === 'undefined') {
        return {
            enableNotification: true,
            autoStart: false,
            autoStartLoading: false,
            notificationAvailable: false,
            enableAiSummary: true,
            enableCharts: true,
            enableAiChatTools: true,
            closeToQuit: false,
            agreementAccepted: false,
            showAgreement: false,
            autoSaveApiKey: false,
            appVersion: '0.3.1',
            dailyReportPrompt: '',
            weeklyReportPrompt: '',
            theme: 'auto',
            markdownEditor: 'vditor',
            databaseConfig: getDefaultDatabaseConfig(),
            localFileConfig: getDefaultLocalFileConfig(),
            workspaceRoot: ''
        };
    }
    const saved = localStorage.getItem('planpro_system_settings');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            return {
                enableNotification: parsed.enableNotification ?? true,
                autoStart: false,
                autoStartLoading: false,
                notificationAvailable: false,
                enableAiSummary: parsed.enableAiSummary ?? true,
                enableCharts: parsed.enableCharts ?? true,
                enableAiChatTools: parsed.enableAiChatTools ?? true,
                closeToQuit: parsed.closeToQuit ?? false,
                agreementAccepted: parsed.agreementAccepted ?? false,
                showAgreement: false,
                autoSaveApiKey: parsed.autoSaveApiKey ?? false,
                appVersion: '0.3.1',
                dailyReportPrompt: parsed.dailyReportPrompt || '',
                weeklyReportPrompt: parsed.weeklyReportPrompt || '',
                theme: parsed.theme || 'auto',
                markdownEditor: parsed.markdownEditor || 'vditor',
                databaseConfig: {
                    ...getDefaultDatabaseConfig(),
                    ...(parsed.databaseConfig || {})
                },
                localFileConfig: {
                    ...getDefaultLocalFileConfig(),
                    ...(parsed.localFileConfig || {})
                },
                workspaceRoot: ''
            };
        } catch {
            return getDefaultSettings();
        }
    }
    return getDefaultSettings();
}

function getDefaultSettings() {
    return {
        enableNotification: true,
        autoStart: false,
        autoStartLoading: false,
        notificationAvailable: false,
        enableAiSummary: true,
        enableCharts: true,
        enableAiChatTools: true,
        closeToQuit: false,
        agreementAccepted: false,
        showAgreement: false,
        autoSaveApiKey: false,
        appVersion: '0.3.1',
        dailyReportPrompt: '',
        weeklyReportPrompt: '',
        theme: 'auto',
        markdownEditor: 'vditor',
        databaseConfig: getDefaultDatabaseConfig(),
        localFileConfig: getDefaultLocalFileConfig(),
        workspaceRoot: ''
    };
}

function createSettingsStore() {
    const { subscribe, set, update } = writable(getInitialSettings());

    function save(state) {
        if (typeof window === 'undefined') return;
        localStorage.setItem('planpro_system_settings', JSON.stringify({
            enableNotification: state.enableNotification,
            enableAiSummary: state.enableAiSummary,
            enableCharts: state.enableCharts,
            enableAiChatTools: state.enableAiChatTools,
            closeToQuit: state.closeToQuit,
            agreementAccepted: state.agreementAccepted,
            autoSaveApiKey: state.autoSaveApiKey,
            dailyReportPrompt: state.dailyReportPrompt,
            weeklyReportPrompt: state.weeklyReportPrompt,
            theme: state.theme,
            markdownEditor: state.markdownEditor,
            databaseConfig: state.databaseConfig,
            localFileConfig: state.localFileConfig
        }));
    }

    function applyTheme(theme, options = {}) {
        if (typeof window === 'undefined') return;
        const shouldAnimate = options.animate ?? false;
        const resolvedTheme = theme === 'auto'
            ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
            : theme;
        const isDark = DARK_THEMES.has(resolvedTheme);

        if (shouldAnimate) {
            document.documentElement.classList.add('theme-switching');
            document.body.classList.add('theme-switching');
            if (themeTransitionTimer) {
                clearTimeout(themeTransitionTimer);
            }
            themeTransitionTimer = setTimeout(() => {
                document.documentElement.classList.remove('theme-switching');
                document.body.classList.remove('theme-switching');
            }, 320);
        }

        document.documentElement.classList.toggle('dark', isDark);
        document.body.classList.toggle('dark', isDark);
        document.documentElement.dataset.theme = resolvedTheme;
        document.body.dataset.theme = resolvedTheme;
        document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
            const themeColorMap = {
                light: '#ffffff',
                dark: '#0f172a',
                ocean: '#e0f2fe',
                forest: '#ecfdf5',
                sunset: '#fff7ed',
                rose: '#fff1f2',
                graphite: '#111827'
            };
            metaTheme.setAttribute('content', themeColorMap[resolvedTheme] || (isDark ? '#0f172a' : '#ffffff'));
        }
    }

    async function ensureNotificationChannel() {
        if (typeof window === 'undefined') return null;

        const isAndroid = /Android/i.test(window.navigator?.userAgent || '');
        if (!isAndroid) {
            return null;
        }

        if (notificationChannelPromise) {
            return notificationChannelPromise;
        }

        notificationChannelPromise = (async () => {
            try {
                const {
                    channels,
                    createChannel,
                    Importance,
                    Visibility
                } = await import('@tauri-apps/plugin-notification');
                const existingChannels = await channels();
                if (!existingChannels.some((channel) => channel.id === NOTIFICATION_CHANNEL_ID)) {
                    await createChannel({
                        id: NOTIFICATION_CHANNEL_ID,
                        name: 'WorkPlan 重要通知',
                        description: '任务提醒与重要系统通知',
                        importance: Importance.High,
                        visibility: Visibility.Public,
                        lights: true,
                        vibration: true
                    });
                }
                return NOTIFICATION_CHANNEL_ID;
            } catch (error) {
                console.warn('Failed to ensure Android notification channel:', error);
                return null;
            }
        })();

        return notificationChannelPromise;
    }

    async function syncCloseToQuit(value) {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('set_close_to_quit', { value });
        } catch (e) {
            console.error('Failed to sync closeToQuit:', e);
        }
    }

    async function init() {
        if (typeof window === 'undefined') return;

        const current = get({ subscribe });
        applyTheme(current.theme, { animate: false });

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            const state = get({ subscribe });
            if (state.theme === 'auto') {
                applyTheme('auto', { animate: true });
            }
        });

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const version = await invoke('get_app_version');
            update(s => ({ ...s, appVersion: version }));
        } catch {
            update(s => ({ ...s, appVersion: '0.3.1' }));
        }

        const workspaceRoot = await getWorkspaceRoot();
        if (workspaceRoot) {
            update(s => ({ ...s, workspaceRoot }));
        }

        try {
            const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
            let granted = await isPermissionGranted();
            if (!granted) {
                const permission = await requestPermission();
                granted = permission === 'granted';
            }
            update(s => ({ ...s, notificationAvailable: granted }));
            if (granted) {
                await ensureNotificationChannel();
            }
        } catch {
            update(s => ({ ...s, notificationAvailable: false }));
        }

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const status = await invoke('get_autostart_status');
            update(s => ({ ...s, autoStart: status }));
        } catch {
            update(s => ({ ...s, autoStart: false }));
        }

        if (current.closeToQuit) {
            syncCloseToQuit(true);
        }
    }

    return {
        subscribe,
        init,
        toggleNotification: () => update(s => {
            const newState = { ...s, enableNotification: !s.enableNotification };
            save(newState);
            return newState;
        }),
        toggleAiSummary: () => update(s => {
            const newState = { ...s, enableAiSummary: !s.enableAiSummary };
            save(newState);
            return newState;
        }),
        toggleCharts: () => update(s => {
            const newState = { ...s, enableCharts: !s.enableCharts };
            save(newState);
            return newState;
        }),
        toggleAiChatTools: () => update(s => {
            const newState = { ...s, enableAiChatTools: !s.enableAiChatTools };
            save(newState);
            return newState;
        }),
        toggleAutoSaveApiKey: () => update(s => {
            const newState = { ...s, autoSaveApiKey: !s.autoSaveApiKey };
            save(newState);
            return newState;
        }),
        toggleCloseToQuit: async () => {
            const current = get({ subscribe });
            const newValue = !current.closeToQuit;
            await syncCloseToQuit(newValue);
            update(s => {
                const newState = { ...s, closeToQuit: newValue };
                save(newState);
                return newState;
            });
        },
        toggleAutoStart: async () => {
            update(s => ({ ...s, autoStartLoading: true }));
            const current = get({ subscribe });
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('set_autostart', { enable: !current.autoStart });
                update(s => ({ ...s, autoStart: !s.autoStart, autoStartLoading: false }));
            } catch (e) {
                console.error('AutoStart error:', e);
                update(s => ({ ...s, autoStartLoading: false }));
                throw e;
            }
        },
        setTheme: (theme) => update(s => {
            applyTheme(theme, { animate: true });
            const newState = { ...s, theme };
            save(newState);
            return newState;
        }),
        setMarkdownEditor: (editor) => update(s => {
            const newState = { ...s, markdownEditor: editor };
            save(newState);
            return newState;
        }),
        updateDatabaseConfig: (updates) => update(s => {
            const newState = {
                ...s,
                databaseConfig: {
                    ...getDefaultDatabaseConfig(),
                    ...(s.databaseConfig || {}),
                    ...updates
                }
            };
            save(newState);
            return newState;
        }),
        updateLocalFileConfig: (updates) => update(s => {
            const newState = {
                ...s,
                localFileConfig: {
                    ...getDefaultLocalFileConfig(),
                    ...(s.localFileConfig || {}),
                    ...updates
                }
            };
            save(newState);
            return newState;
        }),
        addTrustedDirectory: (directory) => update(s => {
            const value = String(directory || '').trim();
            if (!value) return s;
            const trustedDirectories = Array.from(
                new Set([...(s.localFileConfig?.trustedDirectories || []), value])
            );
            const newState = {
                ...s,
                localFileConfig: {
                    ...getDefaultLocalFileConfig(),
                    ...(s.localFileConfig || {}),
                    trustedDirectories
                }
            };
            save(newState);
            return newState;
        }),
        removeTrustedDirectory: (directory) => update(s => {
            const trustedDirectories = (s.localFileConfig?.trustedDirectories || [])
                .filter((item) => item !== directory);
            const newState = {
                ...s,
                localFileConfig: {
                    ...getDefaultLocalFileConfig(),
                    ...(s.localFileConfig || {}),
                    trustedDirectories
                }
            };
            save(newState);
            return newState;
        }),
        testNotification: async () => {
            const state = get({ subscribe });
            const t = get(i18n);
            if (!state.notificationAvailable) {
                throw new Error(t('settings.notification_permission') || '通知权限未授予');
            }
            try {
                const { sendNotification } = await import('@tauri-apps/plugin-notification');
                const channelId = await ensureNotificationChannel();
                await sendNotification({
                    title: t('settings.notification_test_title') || 'WorkPlan',
                    body: t('settings.notification_test_body') || 'OK',
                    channelId: channelId || undefined
                });
            } catch (e) {
                throw new Error((t('settings.notification_failed') || 'Error: ').replace('{error}', e.message));
            }
        },
        showTaskNotification: async (tasks) => {
            const state = get({ subscribe });
            if (!state.enableNotification || !state.notificationAvailable || !tasks?.length) return;
            try {
                const t = get(i18n);
                const { sendNotification } = await import('@tauri-apps/plugin-notification');
                const channelId = await ensureNotificationChannel();
                const titles = tasks.slice(0, 5).map(t2 => t2.title).join('、');
                const extra = tasks.length > 5 ? ` +${tasks.length}` : '';
                await sendNotification({
                    title: `${t('settings.today_tasks') || 'Today'} (${tasks.length})`,
                    body: titles + extra,
                    channelId: channelId || undefined
                });
            } catch (e) {
                console.error('Failed to show notification:', e);
            }
        },
        setDailyReportPrompt: (prompt) => update(s => {
            const newState = { ...s, dailyReportPrompt: prompt };
            save(newState);
            return newState;
        }),
        setWeeklyReportPrompt: (prompt) => update(s => {
            const newState = { ...s, weeklyReportPrompt: prompt };
            save(newState);
            return newState;
        }),
        acceptAgreement: () => update(s => {
            const newState = { ...s, agreementAccepted: true, showAgreement: false };
            save(newState);
            return newState;
        }),
        showAgreementModal: () => update(s => ({ ...s, showAgreement: true })),
        hideAgreementModal: () => update(s => ({ ...s, showAgreement: false })),
        isAgreementAccepted: () => get({ subscribe }).agreementAccepted,
        isAutoSaveApiKeyEnabled: () => get({ subscribe }).autoSaveApiKey
    };
}

export const settingsStore = createSettingsStore();
