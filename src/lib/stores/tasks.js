import { writable, derived, get } from 'svelte/store';
import { getDefaultDatabaseConfig } from '../utils/database-providers.js';

const DEFAULT_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const DEFAULT_SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || '';
const DEFAULT_TABLE_NAME = import.meta.env.VITE_SUPABASE_TABLE || 'planpro_data';

let supabase = null;
let supabaseCacheKey = '';

function readDatabaseConfig() {
    const fallback = {
        ...getDefaultDatabaseConfig(),
        enabled: Boolean(DEFAULT_SUPABASE_URL && DEFAULT_SUPABASE_KEY),
        useCustomConfig: false,
        service: 'supabase',
        url: DEFAULT_SUPABASE_URL,
        apiKey: DEFAULT_SUPABASE_KEY,
        tableName: DEFAULT_TABLE_NAME
    };

    if (typeof window === 'undefined') {
        return fallback;
    }

    try {
        const raw = localStorage.getItem('planpro_system_settings');
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        const savedConfig = {
            ...fallback,
            ...(parsed.databaseConfig || {})
        };
        const useCustomConfig = savedConfig.useCustomConfig ?? false;
        const databaseConfig = {
            ...savedConfig
        };
        if (!useCustomConfig) {
            return fallback;
        }
        return {
            ...databaseConfig,
            useCustomConfig,
            enabled: databaseConfig.enabled ?? Boolean(databaseConfig.url && databaseConfig.apiKey),
            tableName: databaseConfig.tableName || DEFAULT_TABLE_NAME
        };
    } catch (error) {
        console.warn('Failed to read database config:', error);
        return fallback;
    }
}

function shouldUseCustomHttpAdapter(databaseConfig) {
    return Boolean(databaseConfig?.useCustomConfig);
}

function trimTrailingSlash(value = '') {
    return String(value || '').trim().replace(/\/+$/, '');
}

function resolveRestBaseUrl(url = '') {
    const normalized = trimTrailingSlash(url);
    if (!normalized) return '';
    if (/\/rest\/v1$/i.test(normalized)) {
        return normalized;
    }
    return `${normalized}/rest/v1`;
}

function buildRestTableUrl(databaseConfig) {
    const restBaseUrl = resolveRestBaseUrl(databaseConfig.url);
    const tableName = databaseConfig.tableName || DEFAULT_TABLE_NAME;
    return `${restBaseUrl}/${tableName}`;
}

function buildRestHeaders(databaseConfig, prefer = '') {
    const headers = {
        apikey: databaseConfig.apiKey,
        Authorization: `Bearer ${databaseConfig.apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
    };
    if (prefer) {
        headers.Prefer = prefer;
    }
    return headers;
}

async function parseRestPayload(response) {
    const raw = await response.text();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

function toDatabaseError(response, payload) {
    const error = new Error(
        payload?.message ||
        payload?.error?.message ||
        payload?.hint ||
        payload?.details ||
        (typeof payload === 'string' ? payload : `HTTP ${response.status}`)
    );
    error.code = payload?.code || String(response.status);
    error.status = response.status;
    return error;
}

async function requestRestRecord(databaseConfig, accessKey) {
    const url = new URL(buildRestTableUrl(databaseConfig));
    url.searchParams.set('select', 'content,updated_at');
    url.searchParams.set('user_key', `eq.${accessKey}`);
    url.searchParams.set('limit', '1');

    const response = await fetch(url, {
        method: 'GET',
        headers: buildRestHeaders(databaseConfig)
    });
    const payload = await parseRestPayload(response);
    if (!response.ok) {
        throw toDatabaseError(response, payload);
    }
    return Array.isArray(payload) ? (payload[0] || null) : payload;
}

async function upsertRestRecord(databaseConfig, accessKey, content, updatedAt) {
    const url = new URL(buildRestTableUrl(databaseConfig));
    url.searchParams.set('on_conflict', 'user_key');

    const response = await fetch(url, {
        method: 'POST',
        headers: buildRestHeaders(databaseConfig, 'resolution=merge-duplicates,return=minimal'),
        body: JSON.stringify([{
            user_key: accessKey,
            content,
            updated_at: updatedAt
        }])
    });
    const payload = await parseRestPayload(response);
    if (!response.ok) {
        throw toDatabaseError(response, payload);
    }
    return payload;
}

async function deleteRestRecord(databaseConfig, accessKey) {
    const url = new URL(buildRestTableUrl(databaseConfig));
    url.searchParams.set('user_key', `eq.${accessKey}`);

    const response = await fetch(url, {
        method: 'DELETE',
        headers: buildRestHeaders(databaseConfig, 'return=minimal')
    });
    const payload = await parseRestPayload(response);
    if (!response.ok) {
        throw toDatabaseError(response, payload);
    }
    return payload;
}

async function getSupabaseClient(databaseConfig) {
    if (typeof window === 'undefined') return null;
    const cacheKey = `${databaseConfig.url}|${databaseConfig.apiKey}`;
    if (supabase && supabaseCacheKey === cacheKey) return supabase;
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(databaseConfig.url, databaseConfig.apiKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    supabaseCacheKey = cacheKey;
    return supabase;
}

async function loadCloudRecord(accessKey) {
    if (typeof window === 'undefined') return null;
    const databaseConfig = readDatabaseConfig();
    if (!databaseConfig.enabled || !databaseConfig.url || !databaseConfig.apiKey) {
        console.warn('Database configuration missing. Cloud sync disabled.');
        return null;
    }

    if (shouldUseCustomHttpAdapter(databaseConfig)) {
        return await requestRestRecord(databaseConfig, accessKey);
    }

    const client = await getSupabaseClient(databaseConfig);
    if (!client) return null;
    const { data, error } = await client
        .from(databaseConfig.tableName || DEFAULT_TABLE_NAME)
        .select('content, updated_at')
        .eq('user_key', accessKey)
        .maybeSingle();

    if (error) {
        throw error;
    }
    return data;
}

async function saveCloudRecord(accessKey, content, updatedAt) {
    if (typeof window === 'undefined') return;
    const databaseConfig = readDatabaseConfig();
    if (!databaseConfig.enabled || !databaseConfig.url || !databaseConfig.apiKey) {
        return;
    }

    if (shouldUseCustomHttpAdapter(databaseConfig)) {
        await upsertRestRecord(databaseConfig, accessKey, content, updatedAt);
        return;
    }

    const client = await getSupabaseClient(databaseConfig);
    if (!client) return;
    const { error } = await client
        .from(databaseConfig.tableName || DEFAULT_TABLE_NAME)
        .upsert({ user_key: accessKey, content, updated_at: updatedAt }, { onConflict: 'user_key' });

    if (error) {
        throw error;
    }
}

async function deleteCloudRecord(accessKey) {
    if (typeof window === 'undefined') return;
    const databaseConfig = readDatabaseConfig();
    if (!databaseConfig.enabled || !databaseConfig.url || !databaseConfig.apiKey) {
        return;
    }

    if (shouldUseCustomHttpAdapter(databaseConfig)) {
        await deleteRestRecord(databaseConfig, accessKey);
        return;
    }

    const client = await getSupabaseClient(databaseConfig);
    if (!client) return;
    const { error } = await client
        .from(databaseConfig.tableName || DEFAULT_TABLE_NAME)
        .delete()
        .eq('user_key', accessKey);

    if (error) {
        throw error;
    }
}

function isRetryableError(error) {
    if (!error) return false;
    const retryableCodes = ['PGRST301', '503', '504', '522', '524'];
    const msg = (error.message || '').toLowerCase();
    return retryableCodes.includes(String(error.code)) ||
        msg.includes('paused') || msg.includes('timeout') ||
        msg.includes('unavailable') || msg.includes('network');
}

function createTaskStore() {
    const { subscribe, set, update } = writable({
        tasks: [],
        templates: [],
        scheduledTasks: [],
        accessKey: null,
        syncStatus: 'idle',
        lastCloudStr: ''
    });

    let saveTimer = null;
    // 用户最近一次"任务相关操作"的时间戳，用于心跳空闲检测。
    // 仅记录用户主动的数据变更；自动生成（checkScheduled）不计入。
    let lastActivityAt = Date.now();
    let lastHeartbeatAt = 0;
    let heartbeatRunning = false;

    function markActivity() {
        lastActivityAt = Date.now();
    }

    function getTableName() {
        return readDatabaseConfig().tableName || DEFAULT_TABLE_NAME;
    }

    function getPureDataString(data) {
        const copy = JSON.parse(JSON.stringify(data));
        ['tasks', 'templates', 'scheduledTasks'].forEach(key => {
            if (copy[key]) {
                copy[key].forEach(item => {
                    delete item.expanded;
                    delete item.isFromSchedule;
                });
            }
        });
        return JSON.stringify(copy);
    }

    async function loadData(accessKey) {
        const databaseConfig = readDatabaseConfig();
        if (!databaseConfig.enabled || !databaseConfig.url || !databaseConfig.apiKey) {
            update(s => ({ ...s, syncStatus: 'idle' }));
            return;
        }
        update(s => ({ ...s, syncStatus: 'syncing' }));
        try {
            const data = await loadCloudRecord(accessKey);

            if (data && data.content) {
                const json = data.content;
                const cloudStr = getPureDataString({
                    tasks: json.tasks || [],
                    templates: json.templates || [],
                    scheduledTasks: json.scheduledTasks || []
                });
                update(s => ({
                    ...s,
                    tasks: json.tasks || [],
                    templates: json.templates || [],
                    scheduledTasks: json.scheduledTasks || [],
                    syncStatus: 'done',
                    lastCloudStr: cloudStr
                }));
            } else {
                update(s => ({ ...s, syncStatus: 'idle' }));
            }
        } catch (e) {
            const msg = e?.message || '';
            if (e?.code === 'PGRST116' || msg.includes('not find')) {
                update(s => ({ ...s, syncStatus: 'idle' }));
                return;
            }
            if (e?.code === '42P01' || e?.code === 'PGRST205' || msg.includes('does not exist')) {
                console.warn('Table not found. Please create the planpro_data table in your database service.');
                update(s => ({ ...s, syncStatus: 'idle' }));
                return;
            }
            console.error('Load error:', e);
            update(s => ({ ...s, syncStatus: 'error' }));
        }
    }

    async function saveData(state) {
        if (!state.accessKey) return;

        const currentPureStr = getPureDataString({
            tasks: state.tasks,
            templates: state.templates,
            scheduledTasks: state.scheduledTasks
        });

        if (currentPureStr === state.lastCloudStr) return;

        // Every mutator calls saveData() from inside its own update() callback, so a
        // synchronous update() here would be clobbered by the outer callback's return
        // value and the syncing indicator would never light. Defer past that return.
        queueMicrotask(() => update(s => ({ ...s, syncStatus: 'syncing' })));

        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            try {
                const nowTimestamp = Date.now();
                const rawData = JSON.parse(currentPureStr);
                await saveCloudRecord(state.accessKey, rawData, nowTimestamp);
                update(s => ({ ...s, syncStatus: 'done', lastCloudStr: currentPureStr }));
                setTimeout(() => update(s => s.syncStatus === 'done' ? { ...s, syncStatus: 'idle' } : s), 3000);
            } catch (e) {
                console.error('Save error:', e);
                update(s => ({ ...s, syncStatus: 'error' }));
            }
        }, 2000);
    }

    // 心跳同步：用户空闲时由 +layout 定时调用。先推（本地未保存改动）后拉（其他设备的更新）。
    // 沿用现有"单 blob、最后写入胜出"模型，不做字段级合并。
    async function heartbeatSync() {
        if (heartbeatRunning) return;

        const databaseConfig = readDatabaseConfig();
        if (!databaseConfig.enabled || !databaseConfig.url || !databaseConfig.apiKey) return;

        const state = get({ subscribe });
        if (!state.accessKey) return;

        heartbeatRunning = true;
        // 取消等待中的防抖保存，避免与心跳推送竞态。
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }

        try {
            const localPureStr = getPureDataString({
                tasks: state.tasks,
                templates: state.templates,
                scheduledTasks: state.scheduledTasks
            });

            // 1) 先推：本地有未同步改动时上传。
            if (localPureStr !== state.lastCloudStr) {
                update(s => ({ ...s, syncStatus: 'syncing' }));
                const rawData = JSON.parse(localPureStr);
                await saveCloudRecord(state.accessKey, rawData, Date.now());
                update(s => ({ ...s, syncStatus: 'done', lastCloudStr: localPureStr }));
                setTimeout(() => update(s => s.syncStatus === 'done' ? { ...s, syncStatus: 'idle' } : s), 3000);
                lastHeartbeatAt = Date.now();
                return;
            }

            // 2) 后拉：本地已是最新，检查远端是否被其他设备更新。
            const data = await loadCloudRecord(state.accessKey);
            if (data && data.content) {
                const json = data.content;
                const cloudStr = getPureDataString({
                    tasks: json.tasks || [],
                    templates: json.templates || [],
                    scheduledTasks: json.scheduledTasks || []
                });
                if (cloudStr !== localPureStr) {
                    update(s => ({
                        ...s,
                        tasks: json.tasks || [],
                        templates: json.templates || [],
                        scheduledTasks: json.scheduledTasks || [],
                        syncStatus: 'done',
                        lastCloudStr: cloudStr
                    }));
                    setTimeout(() => update(s => s.syncStatus === 'done' ? { ...s, syncStatus: 'idle' } : s), 3000);
                }
            }
            lastHeartbeatAt = Date.now();
        } catch (e) {
            console.error('Heartbeat sync error:', e);
            update(s => ({ ...s, syncStatus: 'error' }));
        } finally {
            heartbeatRunning = false;
        }
    }

    function checkScheduledTasks(state) {
        const today = new Date().toISOString().split('T')[0];
        const todayDate = new Date(today);
        let addedCount = 0;
        const newTasks = [...state.tasks];

        state.scheduledTasks.forEach(sch => {
            if (!sch.enabled) return;
            let checkDate = sch.lastGeneratedDate
                ? new Date(new Date(sch.lastGeneratedDate).setDate(new Date(sch.lastGeneratedDate).getDate() + 1))
                : new Date(todayDate);

            while (checkDate <= todayDate) {
                const dayOfWeek = checkDate.getDay();
                if (sch.repeatDays.includes(dayOfWeek)) {
                    newTasks.push({
                        id: Date.now() + Math.random().toString(36).substr(2, 5),
                        title: sch.title,
                        status: 'todo',
                        priority: sch.priority || 'normal',
                        date: checkDate.toISOString().split('T')[0] + 'T09:00',
                        deadline: '',
                        note: sch.note || '',
                        subtasks: JSON.parse(JSON.stringify(sch.subtasks || [])),
                        expanded: false,
                        isFromSchedule: true
                    });
                    addedCount++;
                }
                checkDate.setDate(checkDate.getDate() + 1);
            }
            sch.lastGeneratedDate = today;
        });

        if (addedCount > 0) {
            update(s => ({ ...s, tasks: newTasks }));
        }
    }

    return {
        subscribe,
        set,
        update,
        login: (key) => {
            if (typeof window === 'undefined') return;
            localStorage.setItem('planpro_access_key', key);
            update(s => ({ ...s, accessKey: key }));
            loadData(key);
        },
        logout: () => {
            if (typeof window === 'undefined') return;
            localStorage.removeItem('planpro_access_key');
            set({ tasks: [], templates: [], scheduledTasks: [], accessKey: null, syncStatus: 'idle', lastCloudStr: '' });
        },
        loadFromLocal: () => {
            if (typeof window === 'undefined') return;
            const savedKey = localStorage.getItem('planpro_access_key');
            if (savedKey) {
                update(s => ({ ...s, accessKey: savedKey }));
                loadData(savedKey);
            }
        },
        addTask: (task) => update(s => {
            markActivity();
            const newState = { ...s, tasks: [...s.tasks, task] };
            saveData(newState);
            return newState;
        }),
        // Bulk insert. Calling addTask() in a loop re-serializes the whole task list
        // once per item, which is O(n²) and blocks the UI when the AI confirms a
        // large batch. This does one update and one saveData for the entire list.
        addTasks: (tasks) => {
            const list = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
            if (!list.length) return 0;
            update(s => {
                markActivity();
                const newState = { ...s, tasks: [...s.tasks, ...list] };
                saveData(newState);
                return newState;
            });
            return list.length;
        },
        updateTask: (id, updates) => update(s => {
            markActivity();
            const tasks = s.tasks.map(t => t.id === id ? { ...t, ...updates } : t);
            const newState = { ...s, tasks };
            saveData(newState);
            return newState;
        }),
        deleteTask: (id) => update(s => {
            markActivity();
            const newState = { ...s, tasks: s.tasks.filter(t => t.id !== id) };
            saveData(newState);
            return newState;
        }),
        addTemplate: (template) => update(s => {
            markActivity();
            const newState = { ...s, templates: [...s.templates, template] };
            saveData(newState);
            return newState;
        }),
        updateTemplate: (id, updates) => update(s => {
            markActivity();
            const templates = s.templates.map(t => t.id === id ? { ...t, ...updates } : t);
            const newState = { ...s, templates };
            saveData(newState);
            return newState;
        }),
        deleteTemplate: (id) => update(s => {
            markActivity();
            const newState = { ...s, templates: s.templates.filter(t => t.id !== id) };
            saveData(newState);
            return newState;
        }),
        addScheduledTask: (task) => update(s => {
            markActivity();
            const newState = { ...s, scheduledTasks: [...s.scheduledTasks, task] };
            saveData(newState);
            return newState;
        }),
        updateScheduledTask: (id, updates) => update(s => {
            markActivity();
            const scheduledTasks = s.scheduledTasks.map(t => t.id === id ? { ...t, ...updates } : t);
            const newState = { ...s, scheduledTasks };
            saveData(newState);
            return newState;
        }),
        deleteScheduledTask: (id) => update(s => {
            markActivity();
            const newState = { ...s, scheduledTasks: s.scheduledTasks.filter(t => t.id !== id) };
            saveData(newState);
            return newState;
        }),
        checkScheduled: () => update(s => {
            checkScheduledTasks(s);
            return s;
        }),
        clearAllData: async (accessKey) => {
            try {
                await deleteCloudRecord(accessKey);
            } catch (e) {
                console.error('Delete error:', e);
            }
            if (typeof window !== 'undefined') {
                localStorage.removeItem('planpro_access_key');
            }
            set({ tasks: [], templates: [], scheduledTasks: [], accessKey: null, syncStatus: 'idle', lastCloudStr: '' });
        },
        exportData: (state) => {
            return JSON.stringify({
                tasks: state.tasks,
                templates: state.templates,
                scheduledTasks: state.scheduledTasks
            }, null, 2);
        },
        importData: (jsonStr) => {
            try {
                const json = JSON.parse(jsonStr);
                update(s => {
                    markActivity();
                    const newState = {
                        ...s,
                        tasks: json.tasks || s.tasks,
                        templates: json.templates || s.templates,
                        scheduledTasks: json.scheduledTasks || s.scheduledTasks
                    };
                    saveData(newState);
                    return newState;
                });
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },
        markActivity,
        heartbeatSync,
        // 心跳入口：用户空闲达到 idleMs 且距上次心跳达到 minIntervalMs 时才同步。
        maybeHeartbeat: ({ idleMs = 300000, minIntervalMs = 300000 } = {}) => {
            const now = Date.now();
            if (now - lastActivityAt < idleMs) return;
            if (now - lastHeartbeatAt < minIntervalMs) return;
            heartbeatSync();
        }
    };
}

export const taskStore = createTaskStore();

const getToday = () => typeof window !== 'undefined' ? new Date().toISOString().split('T')[0] : '2024-01-01';

export const today = writable(getToday());
export const viewDate = writable(getToday());
export const currentView = writable('dashboard');
export const activeTask = writable(null);

export const activeTasks = derived(
    [taskStore, viewDate, today],
    ([$store, $viewDate, $today]) => {
        const now = new Date();
        const list = $store.tasks.filter(t => {
            const taskDate = t.date.split('T')[0];
            if (t.status === 'done') return false;
            if ($viewDate === $today) return taskDate <= $today;
            return taskDate === $viewDate;
        });

        const pMap = { critical: 3, urgent: 2, normal: 1 };
        const sMap = { doing: 2, todo: 1 };

        return list.sort((a, b) => {
            const pDiff = pMap[b.priority] - pMap[a.priority];
            if (pDiff !== 0) return pDiff;
            const aOver = a.deadline && a.deadline < now.toISOString() ? 1 : 0;
            const bOver = b.deadline && b.deadline < now.toISOString() ? 1 : 0;
            if (aOver !== bOver) return bOver - aOver;
            const sDiff = sMap[b.status] - sMap[a.status];
            if (sDiff !== 0) return sDiff;
            return a.date > b.date ? 1 : -1;
        });
    }
);

export const completedTasks = derived(
    [taskStore, viewDate, today],
    ([$store, $viewDate, $today]) => {
        return $store.tasks.filter(t => {
            if (t.status !== 'done') return false;
            if ($viewDate === $today) {
                return t.date.split('T')[0] === $today ||
                    (t.completedDate && t.completedDate.split('T')[0] === $today);
            }
            return t.date.split('T')[0] === $viewDate;
        });
    }
);

export const futurePreviews = derived(
    [taskStore, viewDate, today],
    ([$store, $viewDate, $today]) => {
        if ($viewDate <= $today) return [];
        const targetDay = new Date($viewDate).getDay();
        return $store.scheduledTasks
            .filter(s => s.enabled && s.repeatDays.includes(targetDay === 0 ? 7 : targetDay))
            .map(s => ({ ...s, id: 'preview_' + s.id, status: 'todo', isPreview: true }));
    }
);

export const enabledScheduledCount = derived(
    taskStore,
    $store => $store.scheduledTasks.filter(t => t.enabled).length
);
