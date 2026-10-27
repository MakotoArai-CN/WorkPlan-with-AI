import { writable, derived, get } from 'svelte/store';
import { getDefaultDatabaseConfig } from '../utils/database-providers.js';
import { formatLocalDate, formatLocalDateTime, parseLocalDate } from '../utils/datetime.js';
import { buildScheduledInstances, normalizeRepeatDays } from '../utils/schedule.js';
import { normalizeLeaveRecord, normalizeOvertimeRecord } from '../utils/overtime.js';
import { mergeSyncState, normalizeSyncPayload } from '../utils/task-sync.js';

const DEFAULT_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const DEFAULT_SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || '';
const DEFAULT_TABLE_NAME = import.meta.env.VITE_SUPABASE_TABLE || 'planpro_data';
const LOCAL_CACHE_KEY = 'planpro_tasks_local_cache';

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

export async function loadCloudRecord(accessKey) {
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

export async function saveCloudRecord(accessKey, content, updatedAt) {
    if (typeof window === 'undefined') return false;
    const databaseConfig = readDatabaseConfig();
    if (!databaseConfig.enabled || !databaseConfig.url || !databaseConfig.apiKey) {
        return false;
    }

    if (shouldUseCustomHttpAdapter(databaseConfig)) {
        await upsertRestRecord(databaseConfig, accessKey, content, updatedAt);
        return true;
    }

    const client = await getSupabaseClient(databaseConfig);
    if (!client) return false;
    const { error } = await client
        .from(databaseConfig.tableName || DEFAULT_TABLE_NAME)
        .upsert({ user_key: accessKey, content, updated_at: updatedAt }, { onConflict: 'user_key' });

    if (error) {
        throw error;
    }
    return true;
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
        overtimeRecords: [],
        leaveRecords: [],
        accessKey: null,
        syncStatus: 'idle',
        lastCloudStr: ''
    });

    let saveTimer = null;
    // Cloud load lifecycle. Local writes are held while the first GET is in
    // flight; otherwise a two-second debounce can upsert a one-task blob over
    // the full cloud record before it has even been read.
    let loadState = 'idle'; // idle | loading | ready | disabled
    let pendingLocalChange = false;
    // Last cloud document we know about. Used as the baseline for the per-item
    // merge so offline edits/deletions can be told apart from cloud changes.
    let localCloudSnapshotStr = '';
    // 用户最近一次"任务相关操作"的时间戳，用于心跳空闲检测。
    // 仅记录用户主动的数据变更；自动生成（checkScheduled）不计入。
    let lastActivityAt = Date.now();
    let lastHeartbeatAt = 0;
    let heartbeatRunning = false;
    // When worklog records move to their own encrypted v2 record, the task
    // blob must stop carrying them in plaintext. Initialize from settings before
    // the first cloud read so a reload cannot re-upload the old plaintext blob.
    let worklogCloudEncrypted = false;
    if (typeof window !== 'undefined') {
        try {
            const savedSettings = JSON.parse(localStorage.getItem('planpro_system_settings') || '{}');
            worklogCloudEncrypted = savedSettings.syncWorklog === true;
        } catch {
            worklogCloudEncrypted = false;
        }
    }

    function cloudData(state) {
        return {
            tasks: state.tasks,
            templates: state.templates,
            scheduledTasks: state.scheduledTasks,
            overtimeRecords: worklogCloudEncrypted ? [] : (state.overtimeRecords || []),
            leaveRecords: worklogCloudEncrypted ? [] : (state.leaveRecords || [])
        };
    }

    function mergeRemoteWorklog(current, remoteData) {
        if (!worklogCloudEncrypted) return remoteData;
        return {
            ...remoteData,
            overtimeRecords: current.overtimeRecords || [],
            leaveRecords: current.leaveRecords || []
        };
    }

    function markActivity() {
        lastActivityAt = Date.now();
    }

    function getTableName() {
        return readDatabaseConfig().tableName || DEFAULT_TABLE_NAME;
    }

    /**
     * Local copy of the task data. Tasks used to live only in memory until the
     * cloud write succeeded, so anything created while the backend was down
     * disappeared on reload. Every mutation now writes this cache first.
     */
    function readLocalCache(accessKey) {
        if (typeof window === 'undefined' || !accessKey) return null;
        try {
            const raw = localStorage.getItem(LOCAL_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || parsed.accessKey !== accessKey) return null;
            return {
                accessKey,
                tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
                templates: Array.isArray(parsed.templates) ? parsed.templates : [],
                scheduledTasks: Array.isArray(parsed.scheduledTasks) ? parsed.scheduledTasks : [],
                overtimeRecords: Array.isArray(parsed.overtimeRecords) ? parsed.overtimeRecords : [],
                leaveRecords: Array.isArray(parsed.leaveRecords) ? parsed.leaveRecords : [],
                cloudSnapshot: typeof parsed.cloudSnapshot === 'string' ? parsed.cloudSnapshot : '',
                savedAt: Number(parsed.savedAt) || 0
            };
        } catch (error) {
            console.warn('Failed to read local task cache:', error?.message || error);
            return null;
        }
    }

    function persistLocalCache(state, cloudSnapshot = localCloudSnapshotStr) {
        if (typeof window === 'undefined' || !state?.accessKey) return;
        try {
            localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({
                accessKey: state.accessKey,
                tasks: state.tasks || [],
                templates: state.templates || [],
                scheduledTasks: state.scheduledTasks || [],
                overtimeRecords: state.overtimeRecords || [],
                leaveRecords: state.leaveRecords || [],
                cloudSnapshot: cloudSnapshot || '',
                savedAt: Date.now()
            }));
        } catch (error) {
            console.warn('Failed to persist local task cache:', error?.message || error);
            // The snapshot can be as large as the task list itself. If quota is
            // tight, keep the current data and drop the baseline; a later
            // reconnect still merges cloud-only items, it just cannot detect
            // offline deletions.
            try {
                localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({
                    accessKey: state.accessKey,
                    tasks: state.tasks || [],
                    templates: state.templates || [],
                    scheduledTasks: state.scheduledTasks || [],
                    overtimeRecords: state.overtimeRecords || [],
                    leaveRecords: state.leaveRecords || [],
                    cloudSnapshot: '',
                    savedAt: Date.now()
                }));
            } catch {
                // Storage is full; nothing else we can do locally.
            }
        }
    }

    function clearLocalCache() {
        if (typeof window === 'undefined') return;
        try {
            localStorage.removeItem(LOCAL_CACHE_KEY);
        } catch {
            // ignore
        }
    }

    function parseSnapshot(value) {
        if (!value) return null;
        try {
            const parsed = JSON.parse(value);
            return normalizeSyncPayload(parsed);
        } catch {
            return null;
        }
    }

    function getPureDataString(data) {
        const copy = JSON.parse(JSON.stringify(data));
        ['tasks', 'templates', 'scheduledTasks', 'overtimeRecords', 'leaveRecords'].forEach(key => {
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
        if (loadState === 'loading') return;
        const databaseConfig = readDatabaseConfig();
        if (!databaseConfig.enabled || !databaseConfig.url || !databaseConfig.apiKey) {
            loadState = 'disabled';
            update(s => ({ ...s, syncStatus: 'idle' }));
            return;
        }
        loadState = 'loading';
        pendingLocalChange = false;
        const baselineStr = localCloudSnapshotStr || '';
        const baselineData = parseSnapshot(baselineStr);
        update(s => ({ ...s, syncStatus: 'syncing' }));
        try {
            const data = await loadCloudRecord(accessKey);
            const current = get({ subscribe });
            const localData = cloudData(current);
            const localStr = getPureDataString(localData);
            const hasLocalChanges = localStr !== baselineStr;

            if (data && data.content) {
                const remoteData = normalizeSyncPayload(data.content);
                const remoteCloudData = cloudData(remoteData);
                const remoteStr = getPureDataString(remoteCloudData);
                loadState = 'ready';
                pendingLocalChange = false;

                if (remoteStr === localStr) {
                    localCloudSnapshotStr = remoteStr;
                    update(s => ({ ...s, syncStatus: 'done', lastCloudStr: remoteStr }));
                    persistLocalCache(current, remoteStr);
                    return;
                }

                if (!hasLocalChanges) {
                    // No offline work: the cloud document is authoritative.
                    const applied = mergeRemoteWorklog(current, remoteData);
                    localCloudSnapshotStr = remoteStr;
                    update(s => ({
                        ...s,
                        tasks: applied.tasks,
                        templates: applied.templates,
                        scheduledTasks: applied.scheduledTasks,
                        overtimeRecords: applied.overtimeRecords,
                        leaveRecords: applied.leaveRecords,
                        syncStatus: 'done',
                        lastCloudStr: remoteStr
                    }));
                    persistLocalCache({ ...current, ...applied }, remoteStr);
                    return;
                }

                // Offline work exists. Merge per item instead of letting the
                // pull wipe the newly created/changed tasks, then push the merge.
                const merged = mergeSyncState(localData, remoteCloudData, baselineData);
                const mergedFull = mergeRemoteWorklog(current, merged);
                const mergedState = { ...current, ...mergedFull };
                const mergedStr = getPureDataString(merged);
                localCloudSnapshotStr = remoteStr;
                update(s => ({ ...s, ...mergedFull, syncStatus: 'idle', lastCloudStr: remoteStr }));
                persistLocalCache(mergedState, remoteStr);
                if (mergedStr !== remoteStr) {
                    saveData(get({ subscribe }));
                }
            } else {
                loadState = 'ready';
                pendingLocalChange = false;
                // No cloud record yet: keep the local cache and upload it.
                localCloudSnapshotStr = '';
                update(s => ({ ...s, syncStatus: 'idle', lastCloudStr: '' }));
                persistLocalCache(current, '');
                if (localStr !== getPureDataString({ tasks: [], templates: [], scheduledTasks: [], overtimeRecords: [], leaveRecords: [] })) {
                    saveData(get({ subscribe }));
                }
            }
        } catch (e) {
            loadState = 'ready';
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

        // Always keep a local copy first. If the cloud write fails (offline,
        // backend down, quota) the user's new tasks still survive a reload.
        persistLocalCache(state);

        if (loadState === 'loading') {
            // Defer until the initial GET settles; loadData() merges/re-saves
            // after it detects edits made while loading.
            pendingLocalChange = true;
            return;
        }

        const databaseConfig = readDatabaseConfig();
        if (!databaseConfig.enabled || !databaseConfig.url || !databaseConfig.apiKey) {
            // Nothing was uploaded. Keep lastCloudStr untouched so a later
            // enable/heartbeat pushes these edits instead of trusting them as synced.
            return;
        }

        // Cloud was disabled when the session started and has just been enabled.
        // Pull + merge before the first upload so the local task list does not
        // blindly replace an existing cloud document.
        if (loadState === 'disabled') {
            loadState = 'idle';
            loadData(state.accessKey);
            return;
        }

        const currentPureStr = getPureDataString(cloudData(state));

        if (currentPureStr === state.lastCloudStr) {
            localCloudSnapshotStr = currentPureStr;
            persistLocalCache(state, currentPureStr);
            return;
        }

        // Every mutator calls saveData() from inside its own update() callback, so a
        // synchronous update() here would be clobbered by the outer callback's return
        // value and the syncing indicator would never light. Defer past that return.
        queueMicrotask(() => update(s => ({ ...s, syncStatus: 'syncing' })));

        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            try {
                const nowTimestamp = Date.now();
                const rawData = JSON.parse(currentPureStr);
                const uploaded = await saveCloudRecord(state.accessKey, rawData, nowTimestamp);
                if (uploaded === false) {
                    // Sync backend unavailable: do not claim the data is cloud-current.
                    update(s => ({ ...s, syncStatus: 'idle' }));
                    return;
                }
                localCloudSnapshotStr = currentPureStr;
                persistLocalCache(state, currentPureStr);
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
        if (heartbeatRunning || loadState === 'loading') return;

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
            const localData = cloudData(state);
            const localPureStr = getPureDataString(localData);
            const baselineStr = localCloudSnapshotStr || '';
            const localDirty = localPureStr !== baselineStr;

            const data = await loadCloudRecord(state.accessKey);
            // A missing record is not the same as an intentionally emptied one:
            // never wipe the local list just because the row disappeared.
            if (!data && !localDirty) {
                lastHeartbeatAt = Date.now();
                return;
            }
            const remoteData = data?.content
                ? normalizeSyncPayload(data.content)
                : { tasks: [], templates: [], scheduledTasks: [], overtimeRecords: [], leaveRecords: [] };
            const remoteCloudData = cloudData(remoteData);
            const remoteStr = getPureDataString(remoteCloudData);

            if (!localDirty) {
                if (remoteStr !== localPureStr) {
                    const applied = mergeRemoteWorklog(state, remoteData);
                    localCloudSnapshotStr = remoteStr;
                    update(s => ({
                        ...s,
                        tasks: applied.tasks,
                        templates: applied.templates,
                        scheduledTasks: applied.scheduledTasks,
                        overtimeRecords: applied.overtimeRecords,
                        leaveRecords: applied.leaveRecords,
                        syncStatus: 'done',
                        lastCloudStr: remoteStr
                    }));
                    persistLocalCache({ ...state, ...applied }, remoteStr);
                    setTimeout(() => update(s => s.syncStatus === 'done' ? { ...s, syncStatus: 'idle' } : s), 3000);
                } else {
                    localCloudSnapshotStr = remoteStr;
                    persistLocalCache(state, remoteStr);
                }
                lastHeartbeatAt = Date.now();
                return;
            }

            // Unsynced local work: merge with the cloud copy before uploading so
            // neither the offline tasks nor another device's changes disappear.
            update(s => ({ ...s, syncStatus: 'syncing' }));
            const merged = mergeSyncState(localData, remoteCloudData, parseSnapshot(baselineStr));
            const mergedFull = mergeRemoteWorklog(state, merged);
            const mergedStr = getPureDataString(merged);
            const mergedState = { ...state, ...mergedFull };
            update(s => ({ ...s, ...mergedFull }));
            localCloudSnapshotStr = remoteStr;
            persistLocalCache(mergedState, remoteStr);

            if (mergedStr !== remoteStr) {
                const uploaded = await saveCloudRecord(state.accessKey, merged, Date.now());
                if (uploaded === false) {
                    update(s => ({ ...s, syncStatus: 'idle' }));
                    lastHeartbeatAt = Date.now();
                    return;
                }
                localCloudSnapshotStr = mergedStr;
                persistLocalCache(mergedState, mergedStr);
                update(s => ({ ...s, syncStatus: 'done', lastCloudStr: mergedStr }));
            } else {
                update(s => ({ ...s, syncStatus: 'done', lastCloudStr: remoteStr }));
            }
            setTimeout(() => update(s => s.syncStatus === 'done' ? { ...s, syncStatus: 'idle' } : s), 3000);
            lastHeartbeatAt = Date.now();
        } catch (e) {
            console.error('Heartbeat sync error:', e);
            // Pull failed. If there is unsynced local data, still attempt an
            // upload rather than leaving it stranded (best effort).
            const localData = cloudData(state);
            const localPureStr = getPureDataString(localData);
            if (localPureStr !== (localCloudSnapshotStr || '')) {
                try {
                    const uploaded = await saveCloudRecord(state.accessKey, localData, Date.now());
                    if (uploaded !== false) {
                        localCloudSnapshotStr = localPureStr;
                        persistLocalCache(state, localPureStr);
                        update(s => ({ ...s, syncStatus: 'done', lastCloudStr: localPureStr }));
                    } else {
                        update(s => ({ ...s, syncStatus: 'error' }));
                    }
                } catch (pushError) {
                    console.error('Heartbeat push fallback failed:', pushError);
                    update(s => ({ ...s, syncStatus: 'error' }));
                }
            } else {
                update(s => ({ ...s, syncStatus: 'error' }));
            }
        } finally {
            heartbeatRunning = false;
        }
    }

    function checkScheduledTasks(state) {
        const result = buildScheduledInstances(state, new Date());
        if (!result.changed) {
            return state;
        }
        const nextState = {
            ...state,
            tasks: result.instances.length > 0 ? [...state.tasks, ...result.instances] : state.tasks,
            scheduledTasks: result.scheduledTasks
        };
        saveData(nextState);
        return nextState;
    }

    return {
        subscribe,
        set,
        update,
        login: (key) => {
            if (typeof window === 'undefined') return;
            localStorage.setItem('planpro_access_key', key);
            // Never show another account's cached tasks.
            try {
                const raw = localStorage.getItem(LOCAL_CACHE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed?.accessKey !== key) clearLocalCache();
                }
            } catch {
                clearLocalCache();
            }
            const cache = readLocalCache(key);
            localCloudSnapshotStr = cache?.cloudSnapshot || '';
            update(s => ({
                ...s,
                accessKey: key,
                tasks: cache?.tasks || [],
                templates: cache?.templates || [],
                scheduledTasks: cache?.scheduledTasks || [],
                overtimeRecords: cache?.overtimeRecords || [],
                leaveRecords: cache?.leaveRecords || [],
                lastCloudStr: cache?.cloudSnapshot || '',
                syncStatus: 'idle'
            }));
            loadData(key);
        },
        logout: () => {
            if (typeof window === 'undefined') return;
            localStorage.removeItem('planpro_access_key');
            clearLocalCache();
            localCloudSnapshotStr = '';
            loadState = 'idle';
            pendingLocalChange = false;
            if (saveTimer) {
                clearTimeout(saveTimer);
                saveTimer = null;
            }
            set({ tasks: [], templates: [], scheduledTasks: [], overtimeRecords: [], leaveRecords: [], accessKey: null, syncStatus: 'idle', lastCloudStr: '' });
        },
        loadFromLocal: () => {
            if (typeof window === 'undefined') return;
            const savedKey = localStorage.getItem('planpro_access_key');
            if (!savedKey) return;
            const cache = readLocalCache(savedKey);
            localCloudSnapshotStr = cache?.cloudSnapshot || '';
            update(s => ({
                ...s,
                accessKey: savedKey,
                ...(cache ? {
                    tasks: cache.tasks,
                    templates: cache.templates,
                    scheduledTasks: cache.scheduledTasks,
                    overtimeRecords: cache.overtimeRecords || [],
                    leaveRecords: cache.leaveRecords || []
                } : {}),
                lastCloudStr: cache?.cloudSnapshot || ''
            }));
            loadData(savedKey);
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
        checkScheduled: () => update(s => checkScheduledTasks(s)),
        addOvertimeRecord: (record) => update(s => {
            markActivity();
            const newState = { ...s, overtimeRecords: [...(s.overtimeRecords || []), record] };
            saveData(newState);
            return newState;
        }),
        updateOvertimeRecord: (id, updates) => update(s => {
            markActivity();
            const overtimeRecords = (s.overtimeRecords || []).map(record => (
                record.id === id ? { ...record, ...updates } : record
            ));
            const newState = { ...s, overtimeRecords };
            saveData(newState);
            return newState;
        }),
        deleteOvertimeRecord: (id) => update(s => {
            markActivity();
            const newState = {
                ...s,
                overtimeRecords: (s.overtimeRecords || []).filter(record => record.id !== id)
            };
            saveData(newState);
            return newState;
        }),
        addLeaveRecord: (record) => update(s => {
            markActivity();
            const newState = { ...s, leaveRecords: [...(s.leaveRecords || []), record] };
            saveData(newState);
            return newState;
        }),
        updateLeaveRecord: (id, updates) => update(s => {
            markActivity();
            const leaveRecords = (s.leaveRecords || []).map(record => (
                record.id === id ? { ...record, ...updates } : record
            ));
            const newState = { ...s, leaveRecords };
            saveData(newState);
            return newState;
        }),
        deleteLeaveRecord: (id) => update(s => {
            markActivity();
            const newState = {
                ...s,
                leaveRecords: (s.leaveRecords || []).filter(record => record.id !== id)
            };
            saveData(newState);
            return newState;
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
            clearLocalCache();
            localCloudSnapshotStr = '';
            set({ tasks: [], templates: [], scheduledTasks: [], overtimeRecords: [], leaveRecords: [], accessKey: null, syncStatus: 'idle', lastCloudStr: '' });
        },
        exportData: (state) => {
            return JSON.stringify({
                tasks: state.tasks,
                templates: state.templates,
                scheduledTasks: state.scheduledTasks,
                overtimeRecords: state.overtimeRecords,
                leaveRecords: state.leaveRecords
            }, null, 2);
        },
        importData: (jsonStr) => {
            try {
                const json = JSON.parse(jsonStr);
                if (!json || typeof json !== 'object' || Array.isArray(json)) {
                    throw new Error('备份文件格式不正确');
                }

                const cleanList = (value, predicate) => (
                    Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && predicate(item)) : null
                );
                const importedTasks = cleanList(json.tasks, item => (
                    typeof item.title === 'string' &&
                    typeof item.date === 'string' &&
                    item.date.length > 0
                ));
                const importedTemplates = cleanList(json.templates, item => typeof item.title === 'string');
                const importedScheduled = cleanList(json.scheduledTasks, item => typeof item.title === 'string');
                const importedOvertime = cleanList(json.overtimeRecords, item => (
                    typeof item.date === 'string' && item.date.length > 0
                ))?.map(normalizeOvertimeRecord);
                const importedLeave = cleanList(json.leaveRecords, item => (
                    typeof item.startDate === 'string' && item.startDate.length > 0
                ))?.map(normalizeLeaveRecord);

                if (!importedTasks && !importedTemplates && !importedScheduled && !importedOvertime && !importedLeave) {
                    throw new Error('备份文件里没有可导入的任务、模板、定时任务、加班或请假记录');
                }

                const rawCount = ['tasks', 'templates', 'scheduledTasks', 'overtimeRecords', 'leaveRecords']
                    .reduce((sum, key) => sum + (Array.isArray(json[key]) ? json[key].length : 0), 0);
                const cleanCount = (importedTasks?.length || 0)
                    + (importedTemplates?.length || 0)
                    + (importedScheduled?.length || 0)
                    + (importedOvertime?.length || 0)
                    + (importedLeave?.length || 0);

                update(s => {
                    markActivity();
                    const newState = {
                        ...s,
                        tasks: importedTasks ?? s.tasks,
                        templates: importedTemplates ?? s.templates,
                        scheduledTasks: importedScheduled ?? s.scheduledTasks,
                        overtimeRecords: importedOvertime ?? s.overtimeRecords,
                        leaveRecords: importedLeave ?? s.leaveRecords
                    };
                    saveData(newState);
                    return newState;
                });
                return { success: true, skipped: Math.max(0, rawCount - cleanCount) };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },
        markActivity,
        heartbeatSync,
        setWorklogCloudEncrypted: (enabled) => {
            worklogCloudEncrypted = enabled === true;
            // Rewrite the task blob without plaintext worklog fields. The
            // encrypted worklog record is uploaded separately.
            if (worklogCloudEncrypted) {
                saveData(get({ subscribe }));
            }
        },
        replaceWorklogRecords: (overtimeRecords, leaveRecords) => update(s => {
            const next = {
                ...s,
                overtimeRecords: Array.isArray(overtimeRecords) ? overtimeRecords : [],
                leaveRecords: Array.isArray(leaveRecords) ? leaveRecords : []
            };
            persistLocalCache(next, s.lastCloudStr || '');
            return next;
        }),
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

const getToday = () => typeof window !== 'undefined' ? formatLocalDate(new Date()) : '2024-01-01';

export const today = writable(getToday());
export const viewDate = writable(getToday());
export const currentView = writable('dashboard');
export const activeTask = writable(null);

export const activeTasks = derived(
    [taskStore, viewDate, today],
    ([$store, $viewDate, $today]) => {
        const nowText = formatLocalDateTime(new Date());
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
            const aOver = a.deadline && a.deadline < nowText ? 1 : 0;
            const bOver = b.deadline && b.deadline < nowText ? 1 : 0;
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
        const targetDay = parseLocalDate($viewDate).getDay();
        return $store.scheduledTasks
            .filter(s => s.enabled && normalizeRepeatDays(s.repeatDays).includes(targetDay))
            .map(s => ({ ...s, id: 'preview_' + s.id, status: 'todo', isPreview: true }));
    }
);

export const enabledScheduledCount = derived(
    taskStore,
    $store => $store.scheduledTasks.filter(t => t.enabled).length
);
