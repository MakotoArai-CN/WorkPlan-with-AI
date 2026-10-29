import { writable, derived, get } from 'svelte/store';
import {
    encrypt,
    decrypt,
    hashPassword,
    verifyPassword,
    verifierNeedsUpgrade,
    generateSessionToken,
    encryptSessionData,
    decryptSessionData,
    beginSessionWrapping,
    endSessionWrapping,
    needsMigration,
    migrateEncryption,
    deriveSyncSecret
} from '../utils/crypto.js';
import {
    ensureVaultEntryKey,
    encryptVaultEntryFields,
    decryptVaultEntryFields,
    encryptVaultPayload,
    decryptVaultPayload,
    getVaultMeta,
    resetVaultKeyCache
} from '../utils/vault-entry.js';
import {
    getDeviceKey,
    composeVaultSecret,
    isDeviceBindingEnabled,
    enableDeviceBinding,
    disableDeviceBinding,
    readBindingKey,
    storeBindingEnvelope,
    markDeviceBindingEnabled,
    bindingKeyFromRecoveryCode,
    normalizeRecoveryCode,
    generateRecoveryCode,
    clearDeviceKeyCache,
    enablePin,
    unlockWithPin,
    clearPin,
    isPinEnabled,
    getPinAttemptsRemaining,
    isBiometricSupported,
    getBiometricStatus,
    isBiometricEnabled,
    authenticateBiometric,
    enableBiometric,
    disableBiometric
} from '../utils/device-auth.js';

const STORAGE_KEY = 'planpro_passwords';
const MASTER_KEY = 'planpro_master_hash';
const SESSION_KEY = 'planpro_passwords_session';
const SETTINGS_KEY = 'planpro_passwords_settings';

function createPasswordsStore() {
    const { subscribe, set, update } = writable({
        passwords: [],
        categories: ['默认', '社交', '工作', '金融', '购物', 'Cookie', 'API密钥', '服务器', '邮箱', '数据库', '其他'],
        isUnlocked: false,
        masterPasswordHash: null,
        rememberSession: false,
        initialized: false
    });

    // The master password as typed by the user. Used for verification and re-wrapping,
    // never directly as the encryption secret once device binding is on.
    let currentMasterPassword = null;
    // The secret entries are actually encrypted with: master password, plus the device
    // key when binding is enabled. Kept separate so the ~10 encrypt/decrypt call sites
    // cannot accidentally bypass the binding.
    let vaultSecret = null;
    let vaultEntryKey = null;
    let sessionToken = null;
    let saveTimer = null;
    let migrationDone = false;

    /** Recompute the vault secret from the master password and current binding state. */
    async function deriveVaultSecret(masterPassword) {
        if (!masterPassword) return null;
        if (!isDeviceBindingEnabled()) return masterPassword;
        const bindingKey = await readBindingKey();
        // If binding is on but the envelope cannot be opened on this device, fail
        // closed rather than silently falling back to a weaker secret. The user can
        // still get in with their recovery code.
        if (!bindingKey) {
            throw new Error('设备密钥不可用，请使用恢复码恢复此密码库');
        }
        return composeVaultSecret(masterPassword, bindingKey);
    }

    async function setActiveSecrets(masterPassword) {
        currentMasterPassword = masterPassword;
        vaultSecret = await deriveVaultSecret(masterPassword);
        const state = get({ subscribe });
        const salt = (state.passwords || []).find(entry => entry.kdfSalt)?.kdfSalt || '';
        vaultEntryKey = await ensureVaultEntryKey(vaultSecret, salt);
        return vaultSecret;
    }

    function clearActiveSecrets() {
        currentMasterPassword = null;
        vaultSecret = null;
        vaultEntryKey = null;
        resetVaultKeyCache();
    }

    function encodeEntryForStorage(entry) {
        if (!vaultEntryKey) return entry;
        const meta = {
            title: entry.title || '',
            username: entry.username || '',
            url: entry.url || '',
            category: entry.category || '默认',
            notes: entry.notes || ''
        };
        const password = String(entry.password || '').startsWith('v4:')
            ? entry.password
            : encryptVaultPayload(entry.password || '', vaultEntryKey);
        return {
            id: entry.id,
            meta: encryptVaultEntryFields(meta, vaultEntryKey),
            password,
            kdfSalt: getVaultMeta()?.salt || '',
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            schema: 2
        };
    }

    function encodePasswordsForStorage(list = []) {
        return list.map(encodeEntryForStorage);
    }

    function decryptEntryPassword(value) {
        if (!value) return null;
        if (String(value).startsWith('v4:')) return decryptVaultPayload(value, vaultEntryKey);
        return decrypt(value, vaultSecret);
    }

    async function hydrateVaultEntries() {
        if (!vaultSecret || !vaultEntryKey) return;
        const state = get({ subscribe });
        let changed = false;
        const hydrated = state.passwords.map(entry => {
            let next = { ...entry };
            if (entry.meta) {
                const meta = decryptVaultEntryFields(entry.meta, vaultEntryKey);
                if (meta) next = { ...next, ...meta };
                delete next.meta;
            } else {
                changed = true;
            }
            const password = String(next.password || '');
            if (password && !password.startsWith('v4:')) {
                const plain = decrypt(password, vaultSecret);
                if (plain !== null) {
                    next.password = encryptVaultPayload(plain, vaultEntryKey);
                    changed = true;
                }
            }
            return next;
        });
        const nextState = { ...state, passwords: hydrated };
        update(() => nextState);
        if (changed) saveImmediate(nextState);
        migrationDone = true;
    }

    function loadSettings() {
        if (typeof window === 'undefined') return {};
        try {
            const saved = localStorage.getItem(SETTINGS_KEY);
            return saved ? JSON.parse(saved) : {};
        } catch {
            return {};
        }
    }

    function saveSettings(settings) {
        if (typeof window === 'undefined') return;
        const current = loadSettings();
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
    }

    function load() {
        if (typeof window === 'undefined') return;
        const currentState = get({ subscribe });
        if (currentState.initialized && currentState.isUnlocked) {
            return;
        }

        const masterHash = localStorage.getItem(MASTER_KEY);
        const settings = loadSettings();
        const saved = localStorage.getItem(STORAGE_KEY);
        let passwords = [];

        if (saved) {
            try {
                passwords = JSON.parse(saved);
            } catch (e) {
                console.error('Failed to load passwords:', e);
            }
        }

        // A session can only be resumed while the in-memory wrapping key still exists
        // (same page lifetime). After a full reload the blob is undecryptable by design,
        // so drop it rather than leaving dead state behind.
        const encryptedSession = sessionStorage.getItem(SESSION_KEY);
        let sessionUnlocked = false;

        if (settings.rememberSession && encryptedSession) {
            const sessionData = decryptSessionData(encryptedSession);
            if (sessionData && sessionData.token && sessionData.key) {
                sessionToken = sessionData.token;
                currentMasterPassword = sessionData.key;
                sessionUnlocked = true;
            } else {
                sessionStorage.removeItem(SESSION_KEY);
            }
        }

        set({
            passwords,
            categories: Array.isArray(settings.categories) && settings.categories.length > 0
                ? settings.categories
                : ['默认', '社交', '工作', '金融', '购物', 'Cookie', 'API密钥', '服务器', '邮箱', '数据库', '其他'],
            isUnlocked: sessionUnlocked,
            masterPasswordHash: masterHash,
            rememberSession: settings.rememberSession || false,
            initialized: true
        });

        if (sessionUnlocked && !migrationDone) {
            void hydrateVaultEntries();
        }
    }

    function save(state) {
        if (typeof window === 'undefined') return;
        if (saveTimer) {
            clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(() => {
            if (!vaultEntryKey) return;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(encodePasswordsForStorage(state.passwords)));
            if (state.masterPasswordHash) {
                localStorage.setItem(MASTER_KEY, state.masterPasswordHash);
            }
            saveSettings({ rememberSession: state.rememberSession });
        }, 100);
    }

    function saveImmediate(state) {
        if (typeof window === 'undefined') return;
        if (!vaultEntryKey) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(encodePasswordsForStorage(state.passwords)));
        if (state.masterPasswordHash) {
            localStorage.setItem(MASTER_KEY, state.masterPasswordHash);
        }
        saveSettings({ rememberSession: state.rememberSession });
    }

    function saveSession(password) {
        if (typeof window === 'undefined') return;
        const state = get({ subscribe });
        if (state.rememberSession && password) {
            sessionToken = generateSessionToken();
            // Fresh wrapping key per persisted session, held only in memory.
            beginSessionWrapping();
            const encrypted = encryptSessionData({ token: sessionToken, key: password });
            if (encrypted) {
                sessionStorage.setItem(SESSION_KEY, encrypted);
            }
        }
    }

    function clearSession() {
        if (typeof window === 'undefined') return;
        sessionStorage.removeItem(SESSION_KEY);
        sessionToken = null;
        endSessionWrapping();
    }

    /**
     * Shared tail of the PIN and biometric unlock paths.
     *
     * Both layer-3 methods recover the same thing (the master password out of a
     * device-bound wrapper), so the vault-side work is identical. Keeping it in one
     * place means a fix to the unlock sequence cannot apply to only one of them.
     *
     * Takes the {success, masterPassword, ...} shape returned by unlockWithPin and
     * authenticateBiometric, and passes failures through untouched so the caller
     * still sees error codes like 'wrong_pin' and attemptsRemaining.
     */
    async function completeQuickUnlock(result) {
        if (!result?.success) {
            return result;
        }

        try {
            await setActiveSecrets(result.masterPassword);
        } catch (e) {
            clearActiveSecrets();
            return { success: false, error: 'no_device_key', attemptsRemaining: 0 };
        }

        await hydrateVaultEntries();
        update(s => ({ ...s, isUnlocked: true }));
        saveSession(result.masterPassword);
        return { success: true };
    }

    return {
        subscribe,
        load,
        hasMasterPassword: () => {
            const state = get({ subscribe });
            return !!state.masterPasswordHash;
        },
        isSessionValid: () => {
            const state = get({ subscribe });
            if (!state.rememberSession) return false;
            if (state.isUnlocked && currentMasterPassword && sessionToken) return true;
            const encryptedSession = sessionStorage.getItem(SESSION_KEY);
            if (!encryptedSession) return false;
            const sessionData = decryptSessionData(encryptedSession);
            return !!(sessionData && sessionData.token && sessionData.key);
        },
        restoreSession: async () => {
            const state = get({ subscribe });
            if (!state.rememberSession) return false;
            const encryptedSession = sessionStorage.getItem(SESSION_KEY);
            if (!encryptedSession) return false;

            const sessionData = decryptSessionData(encryptedSession);
            if (sessionData && sessionData.token && sessionData.key) {
                sessionToken = sessionData.token;
                try {
                    await setActiveSecrets(sessionData.key);
                } catch (e) {
                    // Device binding is on but the device key is unavailable.
                    console.warn('Failed to restore session:', e);
                    clearActiveSecrets();
                    sessionStorage.removeItem(SESSION_KEY);
                    return false;
                }
                await hydrateVaultEntries();
                update(s => ({ ...s, isUnlocked: true }));
                return true;
            }

            // Unwrapping key is gone (e.g. after a reload) — the vault stays locked.
            sessionStorage.removeItem(SESSION_KEY);
            return false;
        },
        setMasterPassword: async (password) => {
            const hash = await hashPassword(password);
            await setActiveSecrets(password);
            let newState;
            update(s => {
                newState = { ...s, masterPasswordHash: hash, isUnlocked: true };
                saveImmediate(newState);
                return newState;
            });
            saveSession(password);
            return newState;
        },
        unlock: async (password) => {
            const state = get({ subscribe });
            if (!(await verifyPassword(password, state.masterPasswordHash))) {
                return false;
            }

            await setActiveSecrets(password);
            await hydrateVaultEntries();

            // Transparently re-hash legacy verifiers (unsalted SHA-256 / low-iteration
            // PBKDF2) now that we hold the correct plaintext password.
            if (verifierNeedsUpgrade(state.masterPasswordHash)) {
                try {
                    const upgraded = await hashPassword(password);
                    update(s => {
                        const next = { ...s, masterPasswordHash: upgraded, isUnlocked: true };
                        saveImmediate(next);
                        return next;
                    });
                } catch (e) {
                    console.warn('Failed to upgrade master password verifier:', e);
                    update(s => ({ ...s, isUnlocked: true }));
                }
            } else {
                update(s => ({ ...s, isUnlocked: true }));
            }

            saveSession(password);
            return true;
        },
        lock: () => {
            const state = get({ subscribe });
            // An explicit lock must drop the decrypted key material from memory
            // even when "remember session" is on (that flag only keeps the
            // encrypted session blob for the next app start).
            clearActiveSecrets();
            if (!state.rememberSession) {
                sessionToken = null;
                clearSession();
            }
            update(s => ({ ...s, isUnlocked: false }));
        },
        setRememberSession: (value) => update(s => {
            const newState = { ...s, rememberSession: value };
            saveSettings({ rememberSession: value });
            if (!value) {
                clearSession();
            } else if (currentMasterPassword) {
                saveSession(currentMasterPassword);
            }
            return newState;
        }),
        addPassword: (entry) => update(s => {
            if (!vaultSecret) return s;
            const encryptedPassword = vaultEntryKey ? encryptVaultPayload(entry.password, vaultEntryKey) : encrypt(entry.password, vaultSecret);
            const newEntry = {
                id: Date.now().toString(),
                title: entry.title || '',
                username: entry.username || '',
                password: encryptedPassword,
                url: entry.url || '',
                category: entry.category || '默认',
                notes: entry.notes || '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            const newState = { ...s, passwords: [newEntry, ...s.passwords] };
            save(newState);
            return newState;
        }),
        addPasswordsBatch: (entries) => {
            if (!vaultSecret) return 0;
            const encryptedEntries = entries.map(entry => ({
                id: (Date.now() + Math.random()).toString(),
                title: entry.title || '',
                username: entry.username || '',
                password: vaultEntryKey ? encryptVaultPayload(entry.password, vaultEntryKey) : encrypt(entry.password, vaultSecret),
                url: entry.url || '',
                category: entry.category || '默认',
                notes: entry.notes || '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }));
            update(s => {
                const newState = { ...s, passwords: [...encryptedEntries, ...s.passwords] };
                saveImmediate(newState);
                return newState;
            });
            return encryptedEntries.length;
        },
        updatePassword: (id, updates) => update(s => {
            if (!currentMasterPassword) return s;
            const passwords = s.passwords.map(p => {
                if (p.id !== id) return p;
                const newEntry = { ...p, ...updates, updatedAt: new Date().toISOString() };
                if (updates.password) {
                    newEntry.password = vaultEntryKey ? encryptVaultPayload(updates.password, vaultEntryKey) : encrypt(updates.password, vaultSecret);
                }
                return newEntry;
            });
            const newState = { ...s, passwords };
            save(newState);
            return newState;
        }),
        deletePassword: (id) => update(s => {
            const passwords = s.passwords.filter(p => p.id !== id);
            const newState = { ...s, passwords };
            save(newState);
            return newState;
        }),
        decryptPassword: (encryptedPassword) => {
            if (!vaultSecret) return null;
            return decryptEntryPassword(encryptedPassword);
        },
        getMasterPassword: () => currentMasterPassword,
        /**
         * Encrypted entries and categories for cloud sync. Entries are already
         * encrypted under the vault secret; the sync layer wraps the whole
         * payload again with a device-bound key before uploading.
         */
        getSyncPayload: () => {
            if (!vaultSecret) return null;
            const state = get({ subscribe });
            return {
                passwords: encodePasswordsForStorage(state.passwords),
                categories: state.categories
            };
        },
        /**
         * Plaintext entries for the portable v2 envelope. The outer envelope is
         * encrypted by secure-sync-v2; local storage keeps its own encryption.
         */
        getPortableSyncPayload: () => {
            if (!vaultSecret) return null;
            const state = get({ subscribe });
            const passwords = state.passwords.map(entry => {
                if (!entry.password) return { ...entry, password: '' };
                const plain = decryptEntryPassword(entry.password);
                if (plain === null) {
                    throw new Error(`无法解密密码条目“${entry.title || entry.id}”`);
                }
                return { ...entry, password: plain };
            });
            return { passwords, categories: [...state.categories] };
        },
        /** Convert a legacy v1 payload (local ciphertext) into plaintext. */
        decryptSyncPayload: (payload) => {
            if (!vaultSecret || !payload || !Array.isArray(payload.passwords)) return null;
            const passwords = payload.passwords.map(entry => {
                if (!entry.password) return { ...entry, password: '' };
                const plain = decryptEntryPassword(entry.password);
                if (plain === null) {
                    throw new Error(`无法解密旧云端条目“${entry.title || entry.id}”`);
                }
                return { ...entry, password: plain };
            });
            return { passwords, categories: payload.categories || [] };
        },
        /** Write a plaintext v2 payload back using this device's local vault key. */
        replaceFromPortableSync: (payload) => {
            if (!vaultSecret || !payload || !Array.isArray(payload.passwords)) {
                return { success: false, error: '密码库未解锁或同步数据无效' };
            }
            const passwords = payload.passwords
                .filter(entry => entry && typeof entry.id === 'string' && typeof entry.password === 'string')
                .map(entry => ({
                    ...entry,
                    password: entry.password ? (vaultEntryKey ? encryptVaultPayload(entry.password, vaultEntryKey) : encrypt(entry.password, vaultSecret)) : ''
                }));
            const categories = Array.isArray(payload.categories) && payload.categories.length > 0
                ? payload.categories
                : get({ subscribe }).categories;
            update(s => {
                const next = { ...s, passwords, categories };
                saveImmediate(next);
                return next;
            });
            return { success: true, count: passwords.length };
        },
        /** Replace local entries with a decrypted remote snapshot (same vault secret). */
        replaceFromSync: (payload) => {
            if (!vaultSecret || !payload || !Array.isArray(payload.passwords)) {
                return { success: false, error: '密码库未解锁或同步数据无效' };
            }
            const passwords = payload.passwords.filter(entry => (
                entry && typeof entry.id === 'string' && typeof entry.password === 'string'
            ));
            const categories = Array.isArray(payload.categories) && payload.categories.length > 0
                ? payload.categories
                : get({ subscribe }).categories;
            update(s => {
                const next = { ...s, passwords, categories };
                saveImmediate(next);
                return next;
            });
            return { success: true, count: passwords.length };
        },
        /** A derived secret for sync encryption; never exposes the master password. */
        getSyncSecret: async (accessKey) => {
            if (!vaultSecret) return null;
            const deviceKey = await getDeviceKey();
            return deriveSyncSecret(vaultSecret, deviceKey || '', accessKey || '');
        },
        addCategory: (category) => update(s => {
            if (s.categories.includes(category)) return s;
            const categories = [...s.categories, category];
            saveSettings({ categories });
            return { ...s, categories };
        }),
        clearAll: () => {
            clearActiveSecrets();
            sessionToken = null;
            migrationDone = false;
            clearSession();
            // A new vault must not inherit the previous vault's unlock paths:
            // otherwise the old PIN/recovery code can still unlock (or bind) it.
            try {
                disableDeviceBinding();
            } catch (error) {
                console.warn('Failed to disable device binding during clear:', error);
            }
            try {
                disableBiometric();
            } catch (error) {
                console.warn('Failed to disable biometric during clear:', error);
            }
            endSessionWrapping();
            if (typeof window !== 'undefined') {
                localStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem(MASTER_KEY);
                localStorage.removeItem(SETTINGS_KEY);
            }
            set({
                passwords: [],
                categories: ['默认', '社交', '工作', '金融', '购物', 'Cookie', 'API密钥', '服务器', '邮箱', '数据库', '其他'],
                isUnlocked: false,
                masterPasswordHash: null,
                rememberSession: false,
                initialized: false
            });
        },
        changeMasterPassword: async (oldPassword, newPassword) => {
            const state = get({ subscribe });
            if (!(await verifyPassword(oldPassword, state.masterPasswordHash))) {
                return { success: false, error: '原密码错误' };
            }
            if (!newPassword || newPassword.length < 8) {
                return { success: false, error: '新密码至少需要8个字符' };
            }

            const BATCH_SIZE = 50;
            const passwords = state.passwords;
            const reEncryptedPasswords = [];
            const failedPasswords = [];
            const now = new Date().toISOString();

            // Re-encrypt against the derived secrets, not the raw passwords: with
            // device binding on, using the bare password here would write entries the
            // vault can never read back.
            let oldSecret;
            let newSecret;
            try {
                oldSecret = await deriveVaultSecret(oldPassword);
                newSecret = await deriveVaultSecret(newPassword);
            } catch (e) {
                return { success: false, error: e.message || '设备密钥不可用' };
            }

            const decryptedEntries = [];
            for (let i = 0; i < passwords.length; i += BATCH_SIZE) {
                await new Promise(resolve => setTimeout(resolve, 0));
                const batch = passwords.slice(i, i + BATCH_SIZE);
                for (const p of batch) {
                    const plain = decryptEntryPassword(p.password);
                    if (plain === null) {
                        // Never rewrite an entry we could not read: encrypt('') is
                        // null and would permanently destroy the stored secret.
                        failedPasswords.push(p.title || p.id);
                        continue;
                    }
                    decryptedEntries.push({ entry: p, plain });
                }
            }

            if (failedPasswords.length > 0) {
                return {
                    success: false,
                    error: `有 ${failedPasswords.length} 条记录无法用当前主密码解密，已取消修改（未改动任何数据）`
                };
            }

            const newHash = await hashPassword(newPassword);
            // Re-derive the fast entry key under the new master before writing.
            // Metadata is re-encrypted by saveImmediate().
            resetVaultKeyCache();
            vaultSecret = newSecret;
            vaultEntryKey = await ensureVaultEntryKey(newSecret);
            for (const { entry, plain } of decryptedEntries) {
                reEncryptedPasswords.push({
                    ...entry,
                    password: plain === '' ? '' : encryptVaultPayload(plain, vaultEntryKey),
                    updatedAt: now
                });
            }
            await setActiveSecrets(newPassword);

            try {
                update(s => {
                    const newState = { ...s, passwords: reEncryptedPasswords, masterPasswordHash: newHash };
                    saveImmediate(newState);
                    return newState;
                });
            } catch (error) {
                // Nothing reached disk: keep the old master usable in this session.
                currentMasterPassword = oldPassword;
                vaultSecret = oldSecret;
                resetVaultKeyCache();
                vaultEntryKey = await ensureVaultEntryKey(oldSecret);
                return { success: false, error: `主密码更新保存失败：${error.message || error}` };
            }

            // Any PIN wrapper holds the old master password; drop it so the user
            // re-enrolls rather than silently unlocking with a stale secret.
            clearPin();
            clearSession();
            if (state.rememberSession) {
                saveSession(newPassword);
            }

            let syncWarning = '';
            try {
                const accessKey = typeof localStorage !== 'undefined'
                    ? localStorage.getItem('planpro_access_key')
                    : '';
                if (accessKey) {
                    const { rewrapAccountKey } = await import('../utils/secure-sync-v2.js');
                    await rewrapAccountKey({ accessKey, oldPassword, newPassword });
                }
            } catch (error) {
                syncWarning = `主密码已修改，但云端同步密钥未能重新包裹：${error.message || error}`;
                console.warn(syncWarning);
            }

            return syncWarning ? { success: true, syncWarning } : { success: true };
        },
        getDecryptedPasswords: (ids = null) => {
            const state = get({ subscribe });
            if (!vaultSecret) return [];
            let passwords = state.passwords;
            if (ids && Array.isArray(ids) && ids.length > 0) {
                passwords = passwords.filter(p => ids.includes(p.id));
            }
            return passwords.map(p => ({
                ...p,
                password: decryptEntryPassword(p.password) || '解密失败'
            }));
        },

        // --- Device binding ---------------------------------------------------

        isDeviceBindingEnabled,

        /**
         * Bind the vault to this device.
         *
         * Every entry is re-encrypted under master-password + device-key, so a copy of
         * the stored data cannot be opened elsewhere. Returns the one-time recovery
         * code, which the caller must display exactly once.
         */
        enableDeviceBinding: async () => {
            const state = get({ subscribe });
            if (!state.isUnlocked || !currentMasterPassword) {
                return { success: false, error: '请先解锁密码库' };
            }
            if (isDeviceBindingEnabled()) {
                return { success: false, error: '设备绑定已启用' };
            }

            let recoveryCode;
            let bindingKey;
            try {
                // Arm the binding flag only after the entries are rewritten.
                ({ recoveryCode, bindingKey } = await enableDeviceBinding({ deferFlag: true }));
            } catch (e) {
                return { success: false, error: e.message || '设备绑定失败' };
            }

            // Re-encrypt from the plain master password to the bound secret.
            const boundSecret = composeVaultSecret(currentMasterPassword, bindingKey);
            const now = new Date().toISOString();
            const plains = state.passwords.map(p => ({ entry: p, plain: decryptEntryPassword(p.password) }));
            if (plains.some(item => item.plain === null)) {
                return { success: false, error: '有密码条目无法解密，已取消设备绑定' };
            }
            resetVaultKeyCache();
            vaultSecret = boundSecret;
            vaultEntryKey = await ensureVaultEntryKey(boundSecret);
            const rebound = plains.map(({ entry, plain }) => ({
                ...entry,
                password: encryptVaultPayload(plain, vaultEntryKey),
                updatedAt: now
            }));
            try {
                update(s => {
                    const next = { ...s, passwords: rebound };
                    saveImmediate(next);
                    return next;
                });
                markDeviceBindingEnabled();
            } catch (error) {
                // Entries were not persisted: stay usable under the master alone.
                vaultSecret = currentMasterPassword;
                return { success: false, error: `设备绑定保存失败：${error.message || error}` };
            }

            // The PIN wrapper is device-bound too; force re-enrollment.
            clearPin();

            return { success: true, recoveryCode };
        },

        /** Remove device binding, re-encrypting entries under the master password alone. */
        disableDeviceBinding: async () => {
            const state = get({ subscribe });
            if (!state.isUnlocked || !currentMasterPassword || !vaultSecret) {
                return { success: false, error: '请先解锁密码库' };
            }
            if (!isDeviceBindingEnabled()) {
                return { success: false, error: '设备绑定未启用' };
            }

            const now = new Date().toISOString();
            const plains = state.passwords.map(p => ({ entry: p, plain: decryptEntryPassword(p.password) }));
            if (plains.some(item => item.plain === null)) {
                return { success: false, error: '有密码条目无法解密，已取消解除绑定' };
            }
            disableDeviceBinding();
            resetVaultKeyCache();
            vaultSecret = currentMasterPassword;
            vaultEntryKey = await ensureVaultEntryKey(vaultSecret);
            const unbound = plains.map(({ entry, plain }) => ({
                ...entry,
                password: encryptVaultPayload(plain, vaultEntryKey),
                updatedAt: now
            }));
            update(s => {
                const next = { ...s, passwords: unbound };
                saveImmediate(next);
                return next;
            });

            return { success: true };
        },

        /**
         * Rebind a vault to this machine after a reinstall or hardware change.
         *
         * The recovery code unwraps the *previous* device key, which is only used to
         * decrypt existing entries; they are immediately re-encrypted against the
         * current device and a fresh recovery code is issued.
         */
        recoverWithCode: async (recoveryCode, masterPassword) => {
            const state = get({ subscribe });

            if (!(await verifyPassword(masterPassword, state.masterPasswordHash))) {
                return { success: false, error: '主密码错误' };
            }

            const oldBindingKey = bindingKeyFromRecoveryCode(recoveryCode);
            if (!oldBindingKey) {
                return { success: false, error: '恢复码无效' };
            }

            const oldSecret = composeVaultSecret(masterPassword, oldBindingKey);

            // Confirm the recovered key actually opens the vault before rewriting it.
            // v4 entries are opened by the cached entry key; legacy entries fall back
            // to the old per-entry PBKDF2 format.
            resetVaultKeyCache();
            const recoverySalt = state.passwords.find(p => p.kdfSalt)?.kdfSalt || '';
            const recoveredEntryKey = await ensureVaultEntryKey(oldSecret, recoverySalt);
            const sample = state.passwords.find(p => p.password);
            const sampleOk = !sample || (String(sample.password).startsWith('v4:')
                ? decryptVaultPayload(sample.password, recoveredEntryKey) !== null
                : decrypt(sample.password, oldSecret) !== null);
            if (!sampleOk) {
                resetVaultKeyCache();
                return { success: false, error: '恢复码与当前数据不匹配' };
            }

            clearDeviceKeyCache();
            const newDeviceKey = await getDeviceKey();
            if (!newDeviceKey) {
                return { success: false, error: '当前环境不支持设备绑定' };
            }

            // The binding key is kept as-is so the code the user saved stays valid;
            // only the envelope is re-wrapped for this device. Entries therefore do
            // not need re-encrypting, which also means nothing is lost if this step
            // is interrupted.
            if (!storeBindingEnvelope(oldBindingKey, newDeviceKey)) {
                return { success: false, error: '绑定到本设备失败' };
            }
            // Restoring the envelope is not enough: without the flag the next
            // unlock derives the bare master and cannot decrypt the entries.
            markDeviceBindingEnabled();

            currentMasterPassword = masterPassword;
            vaultSecret = oldSecret;
            vaultEntryKey = recoveredEntryKey;
            clearPin();

            await hydrateVaultEntries();
            update(s => ({ ...s, isUnlocked: true }));

            const normalizedCode = normalizeRecoveryCode(recoveryCode);
            const displayCode = normalizedCode.replace(/(.{4})(?=.)/g, '$1-');
            return { success: true, recoveryCode: displayCode };
        },

        /**
         * Issue a new recovery code, invalidating the old one.
         *
         * Because the code *is* the binding key, this necessarily re-encrypts every
         * entry — a new code cannot open data bound to the previous one.
         */
        regenerateRecoveryCode: async () => {
            const state = get({ subscribe });
            if (!isDeviceBindingEnabled()) {
                return { success: false, error: '设备绑定未启用' };
            }
            if (!state.isUnlocked || !currentMasterPassword || !vaultSecret) {
                return { success: false, error: '请先解锁密码库' };
            }
            const deviceKey = await getDeviceKey();
            if (!deviceKey) {
                return { success: false, error: '设备密钥不可用' };
            }

            const recoveryCode = generateRecoveryCode();
            const nextBindingKey = bindingKeyFromRecoveryCode(recoveryCode);
            const nextSecret = composeVaultSecret(currentMasterPassword, nextBindingKey);

            const now = new Date().toISOString();
            const plains = state.passwords.map(p => ({ entry: p, plain: decryptEntryPassword(p.password) }));
            if (plains.some(item => item.plain === null)) {
                return { success: false, error: '有密码条目无法解密，已取消生成恢复码' };
            }

            if (!storeBindingEnvelope(nextBindingKey, deviceKey)) {
                return { success: false, error: '生成恢复码失败' };
            }

            resetVaultKeyCache();
            vaultSecret = nextSecret;
            vaultEntryKey = await ensureVaultEntryKey(nextSecret);
            const rebound = plains.map(({ entry, plain }) => ({
                ...entry,
                password: encryptVaultPayload(plain, vaultEntryKey),
                updatedAt: now
            }));
            update(s => {
                const next = { ...s, passwords: rebound };
                saveImmediate(next);
                return next;
            });

            return { success: true, recoveryCode };
        },

        // --- PIN quick-unlock -------------------------------------------------

        isPinEnabled,
        getPinAttemptsRemaining,

        enablePin: async (pin) => {
            const state = get({ subscribe });
            if (!state.isUnlocked || !currentMasterPassword) {
                return { success: false, error: '请先解锁密码库' };
            }
            try {
                await enablePin(pin, currentMasterPassword);
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message || 'PIN 设置失败' };
            }
        },

        disablePin: () => {
            clearPin();
            return { success: true };
        },

        /** Unlock via PIN. Falls back to the master password once attempts run out. */
        unlockWithPin: async (pin) => {
            const result = await unlockWithPin(pin);
            return await completeQuickUnlock(result);
        },

        // --- Biometric unlock (Android only) ----------------------------------

        isBiometricSupported,
        getBiometricStatus,
        isBiometricEnabled,

        /**
         * Turn on biometric unlock. Requires the vault to be unlocked and the PIN
         * to already be set, since biometric gates the existing PIN wrapper rather
         * than holding a secret of its own.
         */
        enableBiometric: async (pin) => {
            const state = get({ subscribe });
            if (!state.isUnlocked) {
                return { success: false, error: '请先解锁密码库' };
            }
            return await enableBiometric(pin);
        },

        disableBiometric: () => {
            disableBiometric();
            return { success: true };
        },

        /** Prompt the OS for biometrics and unlock on success. */
        unlockWithBiometric: async (reason) => {
            const result = await authenticateBiometric(reason);
            return await completeQuickUnlock(result);
        }
    };
}

export const passwordsStore = createPasswordsStore();
export const isPasswordsUnlocked = derived(passwordsStore, $store => $store.isUnlocked);
export const passwordsList = derived(passwordsStore, $store => $store.passwords);
export const passwordCategories = derived(passwordsStore, $store => $store.categories);
export const rememberSession = derived(passwordsStore, $store => $store.rememberSession);