import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './runtime.js';
import { ERASE_KEY } from './vault-protection.js';

const SNAPSHOT_FORMAT = 'workplan-local-db';
const SNAPSHOT_VERSION = 1;
const PREFIX = 'workplan_';
const MARKER_KEY = 'workplan_db_saved_at';
const LEGACY_PREFIX = 'planpro_';
const EXCLUDED = new Set(['workplan_passwords_session', MARKER_KEY]);

/**
 * Older builds persisted every key under `planpro_`. A snapshot written by
 * those builds must still hydrate into the current `workplan_` namespace;
 * dropping the legacy keys here is what emptied the account after the rename.
 */
function normalizeKey(key) {
    return key.startsWith(LEGACY_PREFIX) ? PREFIX + key.slice(LEGACY_PREFIX.length) : key;
}

function normalizeKeys(keys) {
    const result = {};
    const source = keys && typeof keys === 'object' ? keys : {};
    // New keys win over legacy ones, but legacy keys fill any gap.
    for (const [key, value] of Object.entries(source)) {
        if (typeof value !== 'string') continue;
        const target = normalizeKey(key);
        if (!target.startsWith(PREFIX) || EXCLUDED.has(target)) continue;
        if (key.startsWith(LEGACY_PREFIX) && result[target] !== undefined) continue;
        result[target] = value;
    }
    return result;
}

/** Business data that must never be silently replaced by an empty snapshot. */
function hasBusinessData(keys) {
    const normalized = normalizeKeys(keys);
    return Object.keys(normalized).some((key) => (
        key === 'workplan_access_key'
        || key.startsWith('workplan_account_stash::')
        || key === 'workplan_notes'
        || key === 'workplan_passwords'
        || key === 'workplan_tasks_local_cache'
        || key === 'workplan_ai_chat_history'
        || key === 'workplan_ai_chat_sessions'
        || key === 'workplan_vault_meta'
        || key === 'workplan_master_hash'
    ));
}

function hasWorkingCopy(keys) {
    const normalized = normalizeKeys(keys);
    if (typeof normalized.workplan_access_key === 'string' && normalized.workplan_access_key.trim()) {
        return true;
    }
    try {
        const cache = JSON.parse(normalized.workplan_tasks_local_cache || '{}');
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
// True once a readable snapshot has been loaded from disk. After that the
// database is the source of truth and the mirror must stay active even when
// the snapshot holds no access key (for example right after logout).
let dbAuthoritative = false;
// Serialize writes so an older snapshot can never land after a newer one.
let saveChain = Promise.resolve();
// Original Storage#setItem, kept so a failed database write can still leave a
// WebView copy behind instead of losing the pending change.
let originalSetItem = null;
let originalRemoveItem = null;
let erasing = false;
let persistedKeys = null;

function restoreWebViewCopy() {
    if (!originalSetItem || typeof localStorage === 'undefined') return;
    for (const [key, value] of memoryKeys) {
        try {
            originalSetItem.call(localStorage, key, value);
        } catch {
            // Ignore quota errors; there is nothing else to try.
        }
    }
}

function enqueueSave(keysProvider = collectKeys) {
    const run = saveChain
        .catch(() => {})
        .then(() => saveSnapshot(keysProvider()));
    saveChain = run.catch(() => {});
    return run;
}

function collectKeys() {
    if (memoryMode) return normalizeKeys(Object.fromEntries(memoryKeys.entries()));
    const keys = {};
    if (typeof localStorage === 'undefined') return keys;
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || (!key.startsWith(PREFIX) && !key.startsWith(LEGACY_PREFIX))) continue;
        const normalized = normalizeKey(key);
        if (EXCLUDED.has(normalized)) continue;
        const value = localStorage.getItem(key);
        if (typeof value === 'string') keys[normalized] = value;
    }
    return keys;
}

function applyKeys(keys) {
    if (!keys || typeof keys !== 'object') return 0;
    const allowed = Object.entries(normalizeKeys(keys));
    // Count only keys that actually changed. A repeat pass over an already
    // applied snapshot must report 0, otherwise the caller reloads forever.
    let changed = 0;
    for (const [key, value] of allowed) {
        if (localStorage.getItem(key) === value) continue;
        localStorage.setItem(key, value);
        changed += 1;
    }
    return changed;
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
    const fingerprint = JSON.stringify(keys);
    if (fingerprint === persistedKeys) return null;
    const snapshot = buildSnapshot(keys);
    const info = await invoke('local_db_save', { content: JSON.stringify(snapshot) });
    persistedKeys = fingerprint;
    localStorage.setItem(MARKER_KEY, String(snapshot.savedAt));
    return info;
}

function scheduleMirror() {
    if (!isTauriRuntime || mirroring || hydrating || erasing) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
        timer = null;
        try {
            await enqueueSave();
        } catch (error) {
            console.warn('[LocalDB] mirror save failed:', error);
        }
    }, 250);
}

async function flushPendingMirror() {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    if (!isTauriRuntime || hydrating || erasing) return null;
    const keys = collectKeys();
    return enqueueSave(() => keys);
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
    // An empty snapshot is a legitimate state (logged out). Only refuse to
    // take over when the database could not be read and the WebView copy is
    // itself incomplete, because then flushing would overwrite good data.
    if (!dbAuthoritative && !hasWorkingCopy(Object.fromEntries(memoryKeys.entries()))) {
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
        await enqueueSave();
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
        if (key && (key.startsWith(PREFIX) || key.startsWith(LEGACY_PREFIX))) keys.push(key);
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
    originalSetItem = originalSet;
    originalRemoveItem = originalRemove;
    const isLocal = (self) => self === window.localStorage;
    Storage.prototype.getItem = function (key) {
        if (isLocal(this) && String(key).startsWith(PREFIX) && !EXCLUDED.has(key)) {
            return memoryKeys.has(String(key)) ? memoryKeys.get(String(key)) : null;
        }
        return originalGet.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
        if (isLocal(this) && erasing && String(key).startsWith(PREFIX) && key !== ERASE_KEY) return;
        if (isLocal(this) && String(key).startsWith(PREFIX) && key !== MARKER_KEY) {
            if (memoryKeys.get(String(key)) === String(value)) return;
            memoryKeys.set(String(key), String(value));
            scheduleMirror();
            return;
        }
        return originalSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
        if (isLocal(this) && erasing && String(key).startsWith(PREFIX) && key !== ERASE_KEY) return;
        if (isLocal(this) && String(key).startsWith(PREFIX) && key !== MARKER_KEY) {
            memoryKeys.delete(String(key));
            scheduleMirror();
            return;
        }
        return originalRemove.call(this, key);
    };
    Storage.prototype.clear = function () {
        if (isLocal(this)) {
            if (erasing) return;
            memoryKeys.clear();
            scheduleMirror();
            return;
        }
        return originalClear.call(this);
    };
    // Best-effort flush for the last writes before the window goes away.
    window.addEventListener('pagehide', () => {
        void flushPendingMirror();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void flushPendingMirror();
    });
}

/**
 * Load the home-directory database before stores make decisions.
 * - DB absent + localStorage present -> migrate localStorage into DB (Rust keeps a backup).
 * - DB present + local storage empty/older -> hydrate before explicitly loading stores.
 */
export async function initLocalDatabase() {
    if (!isTauriRuntime) return { supported: false, migrated: false, reloaded: false };
    hydrating = true;
    try {
        let raw = await invoke('local_db_load');
        let snapshot = readSnapshot(raw);
        let recoveredFromBackup = false;
        // A rename bug once flushed only incidental keys over a good snapshot.
        // If the current snapshot has no business data but a backup still has
        // an account, restore that backup instead of accepting the empty state.
        if (!snapshot || (!snapshot.keys?.[ERASE_KEY] && !hasBusinessData(snapshot.keys))) {
            try {
                const recovered = await invoke('local_db_recover');
                const recoveredSnapshot = readSnapshot(recovered);
                if (recoveredSnapshot && hasBusinessData(recoveredSnapshot.keys)) {
                    snapshot = recoveredSnapshot;
                    raw = recovered;
                    recoveredFromBackup = true;
                }
            } catch (error) {
                console.warn('[LocalDB] backup recovery failed:', error);
            }
        }
        const localKeys = collectKeys();
        const hasLocal = hasWorkingCopy(localKeys);
        if (!snapshot) {
            dbAuthoritative = true;
            persistedKeys = null;
            if (hasLocal) {
                await enqueueSave(() => localKeys);
                return { supported: true, migrated: true, reloaded: false };
            }
            return { supported: true, migrated: false, reloaded: false, empty: true };
        }

        dbAuthoritative = true;
        // A recovered backup is not necessarily the current on-disk snapshot.
        persistedKeys = recoveredFromBackup ? null : JSON.stringify(normalizeKeys(snapshot.keys));
        if (snapshot.keys?.[ERASE_KEY]) {
            // A deliberate wipe always wins over a stale WebView working copy.
            let journal;
            try { journal = JSON.parse(snapshot.keys[ERASE_KEY]); } catch { journal = null; }
            if (journal && (!journal.completed || Object.keys(snapshot.keys).length === 1)) {
                const existing = Object.keys(localKeys);
                for (const key of existing) localStorage.removeItem(key);
                applyKeys(snapshot.keys);
                return { supported: true, migrated: false, reloaded: false };
            }
        }
        if (hasLocal) {
            // Writes are mirrored continuously, so an existing WebView copy is
            // the current working copy. Never overwrite it with the database.
            return { supported: true, migrated: false, reloaded: false };
        }

        const changed = applyKeys(snapshot.keys);
        localStorage.setItem(MARKER_KEY, String(Number(snapshot.savedAt) || Date.now()));
        if (changed === 0) {
            return { supported: true, migrated: false, reloaded: false, applied: 0 };
        }
        // The layout re-reads import-time settings/connector state explicitly.
        // A second full WebView boot is unnecessary, even for partial snapshots.
        return { supported: true, migrated: false, reloaded: false, applied: changed };
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
            await enqueueSave();
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

export async function flushLocalDatabase() {
    if (erasing) return null;
    if (!isTauriRuntime) return null;
    try {
        return await flushPendingMirror();
    } catch (error) {
        console.warn('[LocalDB] flush failed:', error);
        // Keep a WebView copy so a failed database write cannot drop the
        // pending change; the next launch migrates it back into the database.
        if (memoryMode) restoreWebViewCopy();
        return null;
    }
}

export async function persistEraseJournal(pending) {
    if (pending) localStorage.setItem(ERASE_KEY, JSON.stringify(pending));
    else localStorage.removeItem(ERASE_KEY);
    if (isTauriRuntime) await enqueueSave();
}

export async function eraseLocalDatabase(pending) {
    erasing = true;
    if (timer) clearTimeout(timer);
    timer = null;
    await saveChain.catch(() => {});
    const keys = { [ERASE_KEY]: JSON.stringify(pending) };
    if (isTauriRuntime) {
        await invoke('local_db_erase', { content: JSON.stringify(buildSnapshot(keys)) });
        persistedKeys = JSON.stringify(keys);
    }
    // Use the original methods: normal writes are fenced while erasing.
    memoryKeys = new Map(Object.entries(keys));
    const remove = originalRemoveItem;
    // Bypass the fence only for synchronous removal of the WebView working copy.
    const existing = [];
    for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith(PREFIX) || key?.startsWith(LEGACY_PREFIX)) existing.push(key);
    }
    for (const key of existing) {
        if (remove) remove.call(localStorage, key);
        else localStorage.removeItem(key);
    }
    localStorage.setItem(ERASE_KEY, keys[ERASE_KEY]);
    sessionStorage.clear();
    if (timer) clearTimeout(timer);
    timer = null;
    erasing = true;
}

export async function localDatabaseInfo() {
    if (!isTauriRuntime) return null;
    return invoke('local_db_info');
}

export async function exportLocalDatabase(destination) {
    if (!isTauriRuntime) throw new Error('仅桌面版支持本地数据库备份');
    await flushPendingMirror();
    return invoke('local_db_backup', { destination });
}

export async function restoreLocalDatabase(source) {
    if (!isTauriRuntime) throw new Error('仅桌面版支持本地数据库恢复');
    const content = await invoke('local_db_restore', { source });
    const snapshot = readSnapshot(content);
    if (!snapshot) throw new Error('备份文件格式不正确');
    applyKeys(snapshot.keys);
    localStorage.setItem(MARKER_KEY, String(snapshot.savedAt || Date.now()));
    await flushPendingMirror();
    return snapshot;
}

export async function openLocalDatabaseFolder() {
    if (!isTauriRuntime) return;
    return invoke('local_db_open_folder');
}
