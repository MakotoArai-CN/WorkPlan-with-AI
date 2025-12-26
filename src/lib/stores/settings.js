import { writable, get } from 'svelte/store';

function getInitialSettings() {
    if (typeof window === 'undefined') {
        return {
            enableNotification: true,
            autoStart: false,
            autoStartLoading: false,
            notificationAvailable: false,
            enableAiSummary: true,
            enableCharts: true,
            closeToQuit: false,
            agreementAccepted: false,
            showAgreement: false,
            autoSaveApiKey: false,
            appVersion: '0.2.6',
            dailyReportPrompt: '',
            weeklyReportPrompt: ''
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
                closeToQuit: parsed.closeToQuit ?? false,
                agreementAccepted: parsed.agreementAccepted ?? false,
                showAgreement: false,
                autoSaveApiKey: parsed.autoSaveApiKey ?? false,
                appVersion: '0.2.6',
                dailyReportPrompt: parsed.dailyReportPrompt || '',
                weeklyReportPrompt: parsed.weeklyReportPrompt || ''
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
        closeToQuit: false,
        agreementAccepted: false,
        showAgreement: false,
        autoSaveApiKey: false,
        appVersion: '0.2.6',
        dailyReportPrompt: '',
        weeklyReportPrompt: ''
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
            closeToQuit: state.closeToQuit,
            agreementAccepted: state.agreementAccepted,
            autoSaveApiKey: state.autoSaveApiKey,
            dailyReportPrompt: state.dailyReportPrompt,
            weeklyReportPrompt: state.weeklyReportPrompt
        }));
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

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const version = await invoke('get_app_version');
            update(s => ({ ...s, appVersion: version }));
        } catch {
            update(s => ({ ...s, appVersion: '0.2.6' }));
        }

        try {
            const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
            let granted = await isPermissionGranted();
            if (!granted) {
                const permission = await requestPermission();
                granted = permission === 'granted';
            }
            update(s => ({ ...s, notificationAvailable: granted }));
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

        const current = get({ subscribe });
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
        testNotification: async () => {
            const state = get({ subscribe });
            if (!state.notificationAvailable) {
                throw new Error('通知权限未授予');
            }
            try {
                const { sendNotification } = await import('@tauri-apps/plugin-notification');
                await sendNotification({
                    title: 'WorkPlan 测试通知',
                    body: '通知功能正常工作！'
                });
            } catch (e) {
                throw new Error('发送通知失败: ' + e.message);
            }
        },
        showTaskNotification: async (tasks) => {
            const state = get({ subscribe });
            if (!state.enableNotification || !state.notificationAvailable || !tasks?.length) return;
            try {
                const { sendNotification } = await import('@tauri-apps/plugin-notification');
                const titles = tasks.slice(0, 5).map(t => t.title).join('、');
                const extra = tasks.length > 5 ? `...等 ${tasks.length} 项任务` : '';
                await sendNotification({
                    title: `今日待办 (${tasks.length})`,
                    body: titles + extra
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