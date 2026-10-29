import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './runtime.js';

const SNAPSHOT_FORMAT = 'workplan-local-db';
const SNAPSHOT_VERSION = 1;
const PREFIX = 'planpro_';
const MARKER_KEY = 'planpro_db_saved_at';
const HYDRATED_FLAG = 'workplan_db_hydrated_once';
const EXCLUDED = new Set(['planpro_passwords_session', MARKER_KEY]);
function hasWorkingCopy(keys) {
    if (typeof keys?.planpro_access_key === 'string' && keys.planpro_access_key.trim()) {
        return true;
    }
    try {
        const cache = JSON.parse(keys?.planpro_tasks_local_cache || '{}');
        return Array.isArray(cache.tasks) && cache.tasks.length > 0;
    } catch {
        return false;
    }
}

let mirroring = false;
let hydrating = false;
let timer = null;
let installed = false;
let memoryMode = false;
let memoryKeys = new Map();

function collectKeys() {
    if (memoryMode) return Object.fromEntries(memoryKeys.entries());
    const keys = {};
    if (typeof localStorage === 'undefined') return keys;
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || !key.startsWith(PREFIX) || EXCLUDED.has(key)) continue;
        const value = localStorage.getItem(key);
        if (typeof value === 'string') keys[key] = value;
    }
    return keys;
}

function applyKeys(keys) {
    if (!keys || typeof keys !== 'object') return 0;
    const allowed = Object.entries(keys).filter(
        ([key, value]) => key.startsWith(PREFIX) && !EXCLUDED.has(key) && typeof value === 'string'
    );
    for (const [key, value] of allowed) localStorage.setItem(key, value);
    return allowed.length;
}

function buildSnapshot(keys = collectKeys()) {
    return {
        format: SNAPSHOT_FORMAT,
        version: SNAPSHOT_VERSION,
        savedAt: Date.now(),
        keys
    };
}

function readSnapshot(raw) {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed?.format !== SNAPSHOT_FORMAT || !parsed.keys || typeof parsed.keys !== 'object') return null;
        return parsed;
    } catch {
        return null;
    }
}

async function saveSnapshot(keys = collectKeys()) {
    if (!isTauriRuntime) return null;
    const snapshot = buildSnapshot(keys);
    const info = await invoke('local_db_save', { content: JSON.stringify(snapshot) });
    localStorage.setItem(MARKER_KEY, String(snapshot.savedAt));
    return info;
}

function scheduleMirror() {
    if (!isTauriRuntime || mirroring || hydrating) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
        timer = null;
        try {
            await saveSnapshot();
        } catch (error) {
            console.warn('[LocalDB] mirror save failed:', error);
        }
    }, 700);
}

async function activateMemoryStorage() {
    if (memoryMode || typeof localStorage === 'undefined') return;
    memoryKeys = new Map();
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || !key.startsWith(PREFIX) || EXCLUDED.has(key)) continue;
        const value = localStorage.getItem(key);
        if (typeof value === 'string') memoryKeys.set(key, value);
    }
    memoryMode = true;
    if (!hasWorkingCopy(Object.fromEntries(memoryKeys.entries()))) {
        // A stray connector/theme key without an access key or task cache is not
        // a complete working copy. Keep WebView storage and let the next launch
        // finish hydrating instead of overwriting the database with a partial map.
        memoryMode = false;
        return false;
    }
    // Flush the in-memory snapshot before dropping the WebView copy. This also
    // covers the case where localStorage was newer than the on-disk database.
    let flushed = false;
    try {
        await saveSnapshot();
        flushed = true;
    } catch (error) {
        console.warn('[LocalDB] initial memory flush failed:', error);
    }
    if (!flushed) {
        // Keep the WebView copy if the database cannot be written; losing data
        // is worse than temporarily duplicating it.
        memoryMode = false;
        return false;
    }
    // The in-memory map is now the source of truth. Remove business data from
    // WebView storage so it is not duplicated on disk.
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.startsWith(PREFIX) && !EXCLUDED.has(key)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
    return true;
}

export async function installLocalDatabaseMirror() {
    if (!isTauriRuntime || installed || typeof localStorage === 'undefined') return;
    const activated = await activateMemoryStorage();
    if (!activated) return;
    installed = true;
    if (typeof Storage === 'undefined') return;
    const originalSet = Storage.prototype.setItem;
    const originalGet = Storage.prototype.getItem;
    const originalRemove = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;
    const isLocal = (self) => self === window.localStorage;
    Storage.prototype.getItem = function (key) {
        if (isLocal(this) && String(key).startsWith(PREFIX) && !EXCLUDED.has(key)) {
            return memoryKeys.has(String(key)) ? memoryKeys.get(String(key)) : null;
        }
        return originalGet.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
        if (isLocal(this) && String(key).startsWith(PREFIX) && key !== MARKER_KEY) {
            memoryKeys.set(String(key), String(value));
            scheduleMirror();
            return;
        }
        return originalSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
        if (isLocal(this) && String(key).startsWith(PREFIX) && key !== MARKER_KEY) {
            memoryKeys.delete(String(key));
            scheduleMirror();
            return;
        }
        return originalRemove.call(this, key);
    };
    Storage.prototype.clear = function () {
        if (isLocal(this)) {
            memoryKeys.clear();
            scheduleMirror();
            return;
        }
        return originalClear.call(this);
    };
}

/**
 * Load the home-directory database before stores make decisions.
 * - DB absent + localStorage present -> migrate localStorage into DB (Rust keeps a backup).
 * - DB present + local storage empty/older -> hydrate localStorage, then reload once.
 */
export async function initLocalDatabase() {
    if (!isTauriRuntime) return { supported: false, migrated: false, reloaded: false };
    hydrating = true;
    try {
        const raw = await invoke('local_db_load');
        const localKeys = collectKeys();
        const hasLocal = hasWorkingCopy(localKeys);
        const snapshot = readSnapshot(raw);
        if (!snapshot) {
            if (hasLocal) {
                await saveSnapshot(localKeys);
                return { supported: true, migrated: true, reloaded: false };
            }
            return { supported: true, migrated: false, reloaded: false, empty: true };
        }

        // If WebView still has business data, it is the current working copy
        // (writes are mirrored continuously). Never overwrite it merely because
        // the database's timestamp is a few milliseconds newer.
        if (hasLocal) {
            return { supported: true, migrated: false, reloaded: false };
        }

        const applied = applyKeys(snapshot.keys);
        localStorage.setItem(MARKER_KEY, String(Number(snapshot.savedAt) || Date.now()));
        if (applied > 0) {
            // Stores have not read the database yet; one reload lets them
            // initialize from it. The next pass activates memory storage and
            // removes this temporary WebView copy.
            sessionStorage.setItem(HYDRATED_FLAG, '1');
            return { supported: true, migrated: false, reloaded: true, applied };
        }
        return { supported: true, migrated: false, reloaded: false, applied: 0 };
    } catch (error) {
        console.warn('[LocalDB] initialization failed:', error);
        return { supported: true, error: String(error?.message || error), migrated: false, reloaded: false };
    } finally {
        hydrating = false;
    }
}

export function getLocalDatabaseKeys() {
    return collectKeys();
}

/**
 * Replace all WorkPlan keys with a restored backup. In memory mode this must
 * flush the new snapshot to the encrypted DB before the caller reloads.
 */
export async function replaceLocalDatabaseKeys(keys = {}) {
    const allowed = Object.entries(keys).filter(
        ([key, value]) => key.startsWith(PREFIX) && !EXCLUDED.has(key) && typeof value === 'string'
    );
    if (memoryMode) {
        const previous = new Map(memoryKeys);
        memoryKeys = new Map(allowed);
        try {
            await saveSnapshot();
        } catch (error) {
            memoryKeys = previous;
            throw error;
        }
        return allowed.length;
    }
    const existing = [];
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.startsWith(PREFIX)) existing.push(key);
    }
    for (const key of existing) localStorage.removeItem(key);
    for (const [key, value] of allowed) localStorage.setItem(key, value);
    return allowed.length;
}

export async function localDatabaseInfo() {
    if (!isTauriRuntime) return null;
    return invoke('local_db_info');
}

export async function exportLocalDatabase(destination) {
    if (!isTauriRuntime) throw new Error('仅桌面版支持本地数据库备份');
    await saveSnapshot();
    return invoke('local_db_backup', { destination });
}

export async function restoreLocalDatabase(source) {
    if (!isTauriRuntime) throw new Error('仅桌面版支持本地数据库恢复');
    const content = await invoke('local_db_restore', { source });
    const snapshot = readSnapshot(content);
    if (!snapshot) throw new Error('备份文件格式不正确');
    applyKeys(snapshot.keys);
    localStorage.setItem(MARKER_KEY, String(snapshot.savedAt || Date.now()));
    return snapshot;
}

export async function openLocalDatabaseFolder() {
    if (!isTauriRuntime) return;
    return invoke('local_db_open_folder');
}
