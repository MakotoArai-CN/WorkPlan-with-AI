// Opt-in encrypted cloud sync for notes and the password vault.
//
// Threat model: the cloud provider only ever receives an AES-GCM envelope. The
// key is derived from a device-bound secret (and, for the vault, the unlocked
// master password), so a database dump alone is not enough to read the data.
// Trade-off: this is device-bound, not a portable backup: a reinstall or another
// device needs the original device key/recovery path. The UI says so explicitly.

import { get, writable } from 'svelte/store';
import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { notesStore } from '../stores/notes.js';
import { passwordsStore } from '../stores/passwords.js';
import { settingsStore } from '../stores/settings.js';
import { taskStore, loadCloudRecord, saveCloudRecord } from '../stores/tasks.js';
import { getDeviceKey } from './device-auth.js';
import { deriveSyncSecret } from './crypto.js';

const ENVELOPE_VERSION = 1;
const KDF_ITERATIONS = 210_000;
const DEBOUNCE_MS = 1800;

export const secureSyncStatus = writable({
    notes: 'idle',
    passwords: 'idle',
    lastNotesAt: null,
    lastPasswordsAt: null,
    error: ''
});

let suppressNotes = 0;
let suppressPasswords = 0;
let notesTimer = null;
let passwordsTimer = null;
let lastNotesHash = '';
let lastPasswordsHash = '';
let initialized = false;

function recordKey(kind, accessKey) {
    return `__workplan_secure_${kind}_v1__:${accessKey}`;
}

function base64FromBytes(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function bytesFromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function deriveAesKey(secret, salt, iterations = KDF_ITERATIONS) {
    if (!globalThis.crypto?.subtle) {
        throw new Error('当前环境不支持 WebCrypto，无法加密同步');
    }
    const material = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function encryptEnvelope(payload, secret) {
    const compressed = gzipSync(strToU8(JSON.stringify(payload)));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(secret, salt);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, compressed);
    return {
        v: ENVELOPE_VERSION,
        alg: 'AES-GCM',
        kdf: 'PBKDF2-SHA256',
        iterations: KDF_ITERATIONS,
        salt: base64FromBytes(salt),
        iv: base64FromBytes(iv),
        ciphertext: base64FromBytes(new Uint8Array(ciphertext)),
        compressed: true,
        savedAt: Date.now()
    };
}

async function decryptEnvelope(envelope, secret) {
    if (!envelope || envelope.v !== ENVELOPE_VERSION || !envelope.ciphertext) {
        throw new Error('云端同步数据格式无效');
    }
    const salt = bytesFromBase64(envelope.salt);
    const iv = bytesFromBase64(envelope.iv);
    const key = await deriveAesKey(secret, salt, envelope.iterations || KDF_ITERATIONS);
    const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        bytesFromBase64(envelope.ciphertext)
    );
    const bytes = new Uint8Array(plain);
    const json = envelope.compressed ? strFromU8(gunzipSync(bytes)) : strFromU8(bytes);
    return JSON.parse(json);
}

function getAccessKey() {
    const key = get(taskStore)?.accessKey;
    if (!key) throw new Error('请先设置访问密钥');
    return key;
}

async function notesSecret() {
    let deviceKey = await getDeviceKey();
    if (!deviceKey) {
        // Browser / web demo has no hardware device key. Use a random seed that
        // never leaves this origin; still device-bound, just not hardware-backed.
        deviceKey = localStorage.getItem('planpro_notes_sync_seed');
        if (!deviceKey) {
            const bytes = crypto.getRandomValues(new Uint8Array(32));
            deviceKey = base64FromBytes(bytes);
            localStorage.setItem('planpro_notes_sync_seed', deviceKey);
        }
    }
    return deriveSyncSecret('notes', getAccessKey(), deviceKey);
}

async function vaultSecret() {
    const secret = await passwordsStore.getSyncSecret(getAccessKey());
    if (!secret) throw new Error('请先解锁密码库');
    return secret;
}

function notesPayload() {
    const state = get(notesStore);
    const includeLocked = !!get(settingsStore).syncLockedNotes;
    const notes = state.notes.filter(note => includeLocked || !note.aiLocked);
    return {
        notes,
        categories: state.categories,
        lockedExcluded: state.notes.length - notes.length,
        includeLocked,
        savedAt: Date.now()
    };
}

function mergeNotes(localNotes, remoteNotes) {
    const map = new Map();
    for (const note of Array.isArray(localNotes) ? localNotes : []) {
        if (note?.id) map.set(note.id, note);
    }
    for (const note of Array.isArray(remoteNotes) ? remoteNotes : []) {
        if (!note?.id) continue;
        const existing = map.get(note.id);
        if (!existing) {
            map.set(note.id, note);
            continue;
        }
        const localTime = Date.parse(existing.updatedAt || existing.createdAt || 0) || 0;
        const remoteTime = Date.parse(note.updatedAt || note.createdAt || 0) || 0;
        if (remoteTime > localTime) map.set(note.id, note);
    }
    return [...map.values()];
}

function mergeVault(local, remote) {
    const map = new Map();
    for (const entry of local?.passwords || []) {
        if (entry?.id) map.set(entry.id, entry);
    }
    for (const entry of remote?.passwords || []) {
        if (!entry?.id) continue;
        const existing = map.get(entry.id);
        if (!existing) {
            map.set(entry.id, entry);
            continue;
        }
        const localTime = Date.parse(existing.updatedAt || 0) || 0;
        const remoteTime = Date.parse(entry.updatedAt || 0) || 0;
        if (remoteTime > localTime) map.set(entry.id, entry);
    }
    const categories = [...new Set([...(local?.categories || []), ...(remote?.categories || [])])];
    return { passwords: [...map.values()], categories };
}

function hash(value) {
    return JSON.stringify(value);
}

async function upload(kind, envelope) {
    const accessKey = getAccessKey();
    const ok = await saveCloudRecord(recordKey(kind, accessKey), envelope, Date.now());
    if (!ok) throw new Error('云数据库未启用或不可用');
}

export async function syncNotesNow({ manual = false } = {}) {
    const settings = get(settingsStore);
    if (!settings.syncNotes && !manual) return { success: false, skipped: true };
    secureSyncStatus.update(s => ({ ...s, notes: 'syncing', error: '' }));
    suppressNotes += 1;
    try {
        const accessKey = getAccessKey();
        const secret = await notesSecret();
        const local = notesPayload();
        const localState = get(notesStore);
        const lockedLocalNotes = localState.notes.filter(note => note.aiLocked && !get(settingsStore).syncLockedNotes);
        const cloud = await loadCloudRecord(recordKey('notes', accessKey));
        let finalPayload = local;

        if (cloud?.content?.ciphertext) {
            let remote;
            try {
                remote = await decryptEnvelope(cloud.content, secret);
            } catch {
                throw new Error('云端笔记无法用当前设备密钥解密，已停止同步以免覆盖');
            }
            const remoteNotes = local.includeLocked
                ? remote.notes
                : (remote.notes || []).filter(note => !note.aiLocked);
            const mergedNotes = mergeNotes(local.notes, remoteNotes);
            const categories = [...new Set([...(local.categories || []), ...(remote.categories || [])])];
            finalPayload = {
                notes: mergedNotes,
                categories,
                lockedExcluded: local.lockedExcluded,
                savedAt: Date.now()
            };
        }

        const mergedAllNotes = [...lockedLocalNotes, ...finalPayload.notes];
        if (hash({ notes: mergedAllNotes, categories: finalPayload.categories })
            !== hash({ notes: localState.notes, categories: localState.categories })) {
            // Keep locked notes locally; they are excluded from the upload on purpose.
            notesStore.replaceAll(mergedAllNotes, finalPayload.categories);
        }
        lastNotesHash = hash({ notes: mergedAllNotes, categories: finalPayload.categories });

        const envelope = await encryptEnvelope(finalPayload, secret);
        await upload('notes', envelope);
        secureSyncStatus.update(s => ({
            ...s,
            notes: 'done',
            lastNotesAt: Date.now(),
            error: ''
        }));
        return { success: true, count: finalPayload.notes.length };
    } catch (error) {
        secureSyncStatus.update(s => ({ ...s, notes: 'error', error: error.message || String(error) }));
        return { success: false, error: error.message || String(error) };
    } finally {
        suppressNotes -= 1;
    }
}

export async function syncPasswordsNow({ manual = false } = {}) {
    const settings = get(settingsStore);
    if (!settings.syncPasswords && !manual) return { success: false, skipped: true };
    secureSyncStatus.update(s => ({ ...s, passwords: 'syncing', error: '' }));
    suppressPasswords += 1;
    try {
        const accessKey = getAccessKey();
        const secret = await vaultSecret();
        const local = passwordsStore.getSyncPayload();
        if (!local) throw new Error('请先解锁密码库');
        const cloud = await loadCloudRecord(recordKey('vault', accessKey));
        let finalPayload = local;

        if (cloud?.content?.ciphertext) {
            let remote;
            try {
                remote = await decryptEnvelope(cloud.content, secret);
            } catch {
                throw new Error('云端密码库无法用当前主密码/设备解密，已停止同步');
            }
            finalPayload = mergeVault(local, remote);
            const localHash = hash(local);
            const mergedHash = hash(finalPayload);
            if (mergedHash !== localHash) {
                passwordsStore.replaceFromSync(finalPayload);
            }
        }

        lastPasswordsHash = hash(finalPayload);
        const envelope = await encryptEnvelope(finalPayload, secret);
        await upload('vault', envelope);
        secureSyncStatus.update(s => ({
            ...s,
            passwords: 'done',
            lastPasswordsAt: Date.now(),
            error: ''
        }));
        return { success: true, count: finalPayload.passwords.length };
    } catch (error) {
        secureSyncStatus.update(s => ({ ...s, passwords: 'error', error: error.message || String(error) }));
        return { success: false, error: error.message || String(error) };
    } finally {
        suppressPasswords -= 1;
    }
}

function scheduleNotesSync() {
    if (suppressNotes > 0) return;
    if (!get(settingsStore).syncNotes) return;
    if (notesTimer) clearTimeout(notesTimer);
    notesTimer = setTimeout(() => {
        notesTimer = null;
        const payload = notesPayload();
        const currentHash = hash({ notes: payload.notes, categories: payload.categories });
        if (currentHash === lastNotesHash) return;
        syncNotesNow();
    }, DEBOUNCE_MS);
}

function schedulePasswordsSync() {
    if (suppressPasswords > 0) return;
    if (!get(settingsStore).syncPasswords) return;
    const vault = get(passwordsStore);
    if (!vault.isUnlocked) return;
    if (passwordsTimer) clearTimeout(passwordsTimer);
    passwordsTimer = setTimeout(() => {
        passwordsTimer = null;
        const payload = passwordsStore.getSyncPayload();
        if (!payload) return;
        const currentHash = hash({ passwords: payload.passwords, categories: payload.categories });
        if (currentHash === lastPasswordsHash) return;
        syncPasswordsNow();
    }, DEBOUNCE_MS);
}

/** Call once after notes/passwords/settings stores have loaded. */
export function initSecureSync() {
    if (initialized || typeof window === 'undefined') return () => {};
    initialized = true;

    const initialNotes = notesPayload();
    lastNotesHash = hash({ notes: initialNotes.notes, categories: initialNotes.categories });

    const unsubscribeNotes = notesStore.subscribe(() => scheduleNotesSync());
    const unsubscribePasswords = passwordsStore.subscribe(() => schedulePasswordsSync());

    if (get(settingsStore).syncNotes) {
        setTimeout(() => syncNotesNow(), 900);
    }
    if (get(settingsStore).syncPasswords && get(passwordsStore).isUnlocked) {
        setTimeout(() => syncPasswordsNow(), 900);
    }

    return () => {
        initialized = false;
        unsubscribeNotes();
        unsubscribePasswords();
        if (notesTimer) clearTimeout(notesTimer);
        if (passwordsTimer) clearTimeout(passwordsTimer);
    };
}
