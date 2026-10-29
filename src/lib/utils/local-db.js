import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './runtime.js';

const SNAPSHOT_FORMAT = 'workplan-local-db';
const SNAPSHOT_VERSION = 1;
const PREFIX = 'planpro_';
const MARKER_KEY = 'planpro_db_saved_at';
const HYDRATED_FLAG = 'workplan_db_hydrated_once';
const EXCLUDED = new Set(['planpro_passwords_session', MARKER_KEY]);

let mirroring = false;
let hydrating = false;
let timer = null;
let installed = false;

function collectKeys() {
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

export function installLocalDatabaseMirror() {
    if (!isTauriRuntime || installed || typeof localStorage === 'undefined') return;
    installed = true;
    mirroring = true;
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;
    Storage.prototype.setItem = function (key, value) {
        originalSet.call(this, key, value);
        if (String(key).startsWith(PREFIX) && key !== MARKER_KEY) scheduleMirror();
    };
    Storage.prototype.removeItem = function (key) {
        originalRemove.call(this, key);
        if (String(key).startsWith(PREFIX) && key !== MARKER_KEY) scheduleMirror();
    };
    Storage.prototype.clear = function () {
        originalClear.call(this);
        scheduleMirror();
    };
    mirroring = false;
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
        const hasLocal = Object.keys(localKeys).length > 0;
        const snapshot = readSnapshot(raw);
        if (!snapshot) {
            if (hasLocal) {
                await saveSnapshot(localKeys);
                return { supported: true, migrated: true, reloaded: false };
            }
            return { supported: true, migrated: false, reloaded: false, empty: true };
        }

        const dbSaved = Number(snapshot.savedAt) || 0;
        const localSaved = Number(localStorage.getItem(MARKER_KEY)) || 0;
        if (hasLocal && localSaved >= dbSaved) {
            return { supported: true, migrated: false, reloaded: false };
        }

        if (!hasLocal || dbSaved > localSaved) {
            const applied = applyKeys(snapshot.keys);
            localStorage.setItem(MARKER_KEY, String(dbSaved));
            if (applied > 0) {
                const alreadyReloaded = sessionStorage.getItem(HYDRATED_FLAG) === '1';
                if (!alreadyReloaded) {
                    sessionStorage.setItem(HYDRATED_FLAG, '1');
                    return { supported: true, migrated: false, reloaded: true, applied };
                }
            }
        }
        return { supported: true, migrated: false, reloaded: false, applied: 0 };
    } catch (error) {
        console.warn('[LocalDB] initialization failed:', error);
        return { supported: true, error: String(error?.message || error), migrated: false, reloaded: false };
    } finally {
        hydrating = false;
    }
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
