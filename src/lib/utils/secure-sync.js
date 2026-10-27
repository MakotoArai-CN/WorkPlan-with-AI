// Opt-in encrypted cloud sync for notes, the password vault and worklog.
//
// Threat model: the cloud provider only ever receives AES-GCM envelopes. A
// random account key is wrapped by a key derived from the password-vault master
// password; the master password is never uploaded. The same access key and
// master password can restore the data on another device.
//
// The v1 device-bound envelopes are still readable on the original device and
// are migrated to v2 the first time a v2 sync runs. They cannot be decrypted on
// a new device without the old device key.

import { get, writable } from 'svelte/store';
import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { notesStore } from '../stores/notes.js';
import { passwordsStore } from '../stores/passwords.js';
import { settingsStore } from '../stores/settings.js';
import { taskStore, loadCloudRecord, saveCloudRecord } from '../stores/tasks.js';
import { getDeviceKey } from './device-auth.js';
import { deriveSyncSecret } from './crypto.js';
import {
    getAccountKey,
    encryptDomainPayload,
    decryptDomainPayload,
    domainRecordKey,
    clearPortableKeyCache
} from './secure-sync-v2.js';

const ENVELOPE_VERSION = 1;
const KDF_ITERATIONS = 210_000;
const DEBOUNCE_MS = 1800;

export const secureSyncStatus = writable({
    notes: 'idle',
    passwords: 'idle',
    worklog: 'idle',
    lastNotesAt: null,
    lastPasswordsAt: null,
    lastWorklogAt: null,
    error: ''
});

let suppressNotes = 0;
let suppressPasswords = 0;
let notesTimer = null;
let passwordsTimer = null;
let worklogTimer = null;
let lastNotesHash = '';
let lastPasswordsHash = '';
let lastWorklogHash = '';
let suppressWorklog = 0;
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

async function portableAccountKey() {
    const masterPassword = passwordsStore.getMasterPassword();
    if (!masterPassword) throw new Error('请先解锁密码库，同步密钥由主密码派生');
    return await getAccountKey({
        masterPassword,
        accessKey: getAccessKey(),
        create: true
    });
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
        const accountKey = await portableAccountKey();
        const local = notesPayload();
        const localState = get(notesStore);
        const lockedLocalNotes = localState.notes.filter(note => note.aiLocked && !get(settingsStore).syncLockedNotes);
        const cloud = await loadCloudRecord(domainRecordKey('notes', accessKey));
        const legacyCloud = cloud?.content?.ciphertext
            ? null
            : await loadCloudRecord(recordKey('notes', accessKey));
        let finalPayload = local;

        const sourceEnvelope = cloud?.content?.ciphertext
            ? cloud.content
            : (legacyCloud?.content?.ciphertext ? legacyCloud.content : null);
        if (sourceEnvelope) {
            let remote;
            if (sourceEnvelope.v === 2) {
                try {
                    remote = await decryptDomainPayload(sourceEnvelope, {
                        accountKey,
                        domain: 'notes',
                        accessKey
                    });
                } catch {
                    throw new Error('云端笔记无法用当前主密码解密，已停止同步以免覆盖');
                }
            } else {
                // One-time migration from the old device-bound v1 envelope.
                try {
                    remote = await decryptEnvelope(sourceEnvelope, await notesSecret());
                } catch {
                    throw new Error('云端笔记是旧版设备加密数据，请先在原设备登录并开启同步完成迁移');
                }
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

        const envelope = await encryptDomainPayload(finalPayload, {
            accountKey,
            domain: 'notes',
            accessKey
        });
        const ok = await saveCloudRecord(domainRecordKey('notes', accessKey), envelope, Date.now());
        if (!ok) throw new Error('云数据库未启用或不可用');
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
        const accountKey = await portableAccountKey();
        const local = passwordsStore.getPortableSyncPayload();
        if (!local) throw new Error('请先解锁密码库');
        const cloud = await loadCloudRecord(domainRecordKey('vault', accessKey));
        const legacyCloud = cloud?.content?.ciphertext
            ? null
            : await loadCloudRecord(recordKey('vault', accessKey));
        let finalPayload = local;

        const sourceEnvelope = cloud?.content?.ciphertext
            ? cloud.content
            : (legacyCloud?.content?.ciphertext ? legacyCloud.content : null);
        if (sourceEnvelope) {
            let remote;
            if (sourceEnvelope.v === 2) {
                try {
                    remote = await decryptDomainPayload(sourceEnvelope, {
                        accountKey,
                        domain: 'vault',
                        accessKey
                    });
                } catch {
                    throw new Error('云端密码库无法用当前主密码解密，已停止同步');
                }
            } else {
                // One-time migration from the old device-bound v1 envelope.
                try {
                    const legacy = await decryptEnvelope(sourceEnvelope, await vaultSecret());
                    remote = passwordsStore.decryptSyncPayload(legacy);
                } catch {
                    throw new Error('云端密码库是旧版设备加密数据，请先在原设备登录并开启同步完成迁移');
                }
                if (!remote) throw new Error('旧版云端密码库数据无效');
            }
            finalPayload = mergeVault(local, remote);
            if (hash(finalPayload) !== hash(local)) {
                passwordsStore.replaceFromPortableSync(finalPayload);
            }
        }

        lastPasswordsHash = hash(finalPayload);
        const envelope = await encryptDomainPayload(finalPayload, {
            accountKey,
            domain: 'vault',
            accessKey
        });
        const ok = await saveCloudRecord(domainRecordKey('vault', accessKey), envelope, Date.now());
        if (!ok) throw new Error('云数据库未启用或不可用');
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

function worklogPayload() {
    const state = get(taskStore);
    return {
        overtimeRecords: state.overtimeRecords || [],
        leaveRecords: state.leaveRecords || [],
        savedAt: Date.now()
    };
}

function mergeWorklog(local, remote) {
    const mergeList = (localList, remoteList) => {
        const map = new Map();
        for (const record of Array.isArray(localList) ? localList : []) {
            if (record?.id) map.set(record.id, record);
        }
        for (const record of Array.isArray(remoteList) ? remoteList : []) {
            if (!record?.id) continue;
            const existing = map.get(record.id);
            if (!existing) {
                map.set(record.id, record);
                continue;
            }
            const localTime = Date.parse(existing.updatedAt || existing.createdAt || 0) || 0;
            const remoteTime = Date.parse(record.updatedAt || record.createdAt || 0) || 0;
            if (remoteTime > localTime) map.set(record.id, record);
        }
        return [...map.values()];
    };
    return {
        overtimeRecords: mergeList(local.overtimeRecords, remote.overtimeRecords),
        leaveRecords: mergeList(local.leaveRecords, remote.leaveRecords)
    };
}

export async function syncWorklogNow({ manual = false } = {}) {
    const settings = get(settingsStore);
    if (!settings.syncWorklog && !manual) return { success: false, skipped: true };
    secureSyncStatus.update(s => ({ ...s, worklog: 'syncing', error: '' }));
    suppressWorklog += 1;
    try {
        const accessKey = getAccessKey();
        const accountKey = await portableAccountKey();
        const local = worklogPayload();
        const cloud = await loadCloudRecord(domainRecordKey('worklog', accessKey));
        let remote = null;

        if (cloud?.content?.ciphertext) {
            if (cloud.content.v === 2) {
                try {
                    remote = await decryptDomainPayload(cloud.content, {
                        accountKey,
                        domain: 'worklog',
                        accessKey
                    });
                } catch {
                    throw new Error('云端工时记录无法用当前主密码解密，已停止同步');
                }
            } else {
                throw new Error('云端工时记录格式无效，已停止同步');
            }
        }

        // First v2 run: the old task blob may still contain plaintext worklog.
        if (!remote) {
            const taskCloud = await loadCloudRecord(accessKey);
            if (taskCloud?.content) {
                remote = {
                    overtimeRecords: Array.isArray(taskCloud.content.overtimeRecords)
                        ? taskCloud.content.overtimeRecords
                        : [],
                    leaveRecords: Array.isArray(taskCloud.content.leaveRecords)
                        ? taskCloud.content.leaveRecords
                        : []
                };
            }
        }

        const finalPayload = remote ? mergeWorklog(local, remote) : local;
        const changed = hash(finalPayload) !== hash(local);
        if (changed) taskStore.replaceWorklogRecords(finalPayload.overtimeRecords, finalPayload.leaveRecords);
        lastWorklogHash = hash({ ...finalPayload, savedAt: undefined });

        const envelope = await encryptDomainPayload(finalPayload, {
            accountKey,
            domain: 'worklog',
            accessKey
        });
        const ok = await saveCloudRecord(domainRecordKey('worklog', accessKey), envelope, Date.now());
        if (!ok) throw new Error('云数据库未启用或不可用');

        // After the encrypted copy is safely uploaded, strip the plaintext
        // worklog fields from the task blob.
        taskStore.setWorklogCloudEncrypted(true);
        secureSyncStatus.update(s => ({
            ...s,
            worklog: 'done',
            lastWorklogAt: Date.now(),
            error: ''
        }));
        return {
            success: true,
            count: finalPayload.overtimeRecords.length + finalPayload.leaveRecords.length
        };
    } catch (error) {
        secureSyncStatus.update(s => ({ ...s, worklog: 'error', error: error.message || String(error) }));
        return { success: false, error: error.message || String(error) };
    } finally {
        suppressWorklog -= 1;
    }
}

function scheduleWorklogSync() {
    if (suppressWorklog > 0) return;
    if (!get(settingsStore).syncWorklog) return;
    if (worklogTimer) clearTimeout(worklogTimer);
    worklogTimer = setTimeout(() => {
        worklogTimer = null;
        const payload = worklogPayload();
        const currentHash = hash({ ...payload, savedAt: undefined });
        if (currentHash === lastWorklogHash) return;
        syncWorklogNow();
    }, DEBOUNCE_MS);
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
        let payload = null;
        try {
            payload = passwordsStore.getPortableSyncPayload();
        } catch {
            return;
        }
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
    let wasUnlocked = !!get(passwordsStore).isUnlocked;

    const unsubscribeNotes = notesStore.subscribe(() => scheduleNotesSync());
    const unsubscribePasswords = passwordsStore.subscribe((vault) => {
        const unlocked = !!vault?.isUnlocked;
        if (!unlocked) clearPortableKeyCache();
        if (unlocked && !wasUnlocked) {
            // Notes and worklog need the master password too; retry them when
            // the vault is unlocked after a cold start.
            setTimeout(() => {
                if (get(settingsStore).syncNotes) syncNotesNow();
                if (get(settingsStore).syncWorklog) syncWorklogNow();
            }, 700);
        }
        wasUnlocked = unlocked;
        schedulePasswordsSync();
    });
    const unsubscribeWorklog = taskStore.subscribe(() => scheduleWorklogSync());

    if (get(settingsStore).syncNotes) {
        setTimeout(() => syncNotesNow(), 900);
    }
    if (get(settingsStore).syncPasswords && get(passwordsStore).isUnlocked) {
        setTimeout(() => syncPasswordsNow(), 900);
    }
    if (get(settingsStore).syncWorklog) {
        setTimeout(() => syncWorklogNow(), 900);
    }

    return () => {
        initialized = false;
        unsubscribeNotes();
        unsubscribePasswords();
        unsubscribeWorklog();
        if (notesTimer) clearTimeout(notesTimer);
        if (passwordsTimer) clearTimeout(passwordsTimer);
        if (worklogTimer) clearTimeout(worklogTimer);
    };
}
