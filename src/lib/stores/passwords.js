import { writable, derived, get } from 'svelte/store';
import { encrypt, decrypt, hashPassword, verifyPassword, generateSessionToken, encryptSessionData, decryptSessionData } from '../utils/crypto.js';

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

    let currentMasterPassword = null;
    let sessionToken = null;
    let saveTimer = null;

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
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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

        const encryptedSession = sessionStorage.getItem(SESSION_KEY);
        let sessionUnlocked = false;

        if (settings.rememberSession && encryptedSession && masterHash) {
            try {
                const sessionData = decryptSessionData(encryptedSession, masterHash);
                if (sessionData && sessionData.token && sessionData.key) {
                    sessionToken = sessionData.token;
                    currentMasterPassword = sessionData.key;
                    sessionUnlocked = true;
                }
            } catch {
                sessionStorage.removeItem(SESSION_KEY);
            }
        }

        set({
            passwords,
            categories: ['默认', '社交', '工作', '金融', '购物', 'Cookie', 'API密钥', '服务器', '邮箱', '数据库', '其他'],
            isUnlocked: sessionUnlocked,
            masterPasswordHash: masterHash,
            rememberSession: settings.rememberSession || false,
            initialized: true
        });
    }

    function save(state) {
        if (typeof window === 'undefined') return;
        if (saveTimer) {
            clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(() => {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.passwords));
            if (state.masterPasswordHash) {
                localStorage.setItem(MASTER_KEY, state.masterPasswordHash);
            }
            saveSettings({ rememberSession: state.rememberSession });
        }, 100);
    }

    function saveImmediate(state) {
        if (typeof window === 'undefined') return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.passwords));
        if (state.masterPasswordHash) {
            localStorage.setItem(MASTER_KEY, state.masterPasswordHash);
        }
        saveSettings({ rememberSession: state.rememberSession });
    }

    function saveSession(password, hash) {
        if (typeof window === 'undefined') return;
        const state = get({ subscribe });
        if (state.rememberSession && password && hash) {
            sessionToken = generateSessionToken();
            const sessionData = { token: sessionToken, key: password };
            const encrypted = encryptSessionData(sessionData, hash);
            if (encrypted) {
                sessionStorage.setItem(SESSION_KEY, encrypted);
            }
        }
    }

    function clearSession() {
        if (typeof window === 'undefined') return;
        sessionStorage.removeItem(SESSION_KEY);
        sessionToken = null;
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
            if (!encryptedSession || !state.masterPasswordHash) return false;

            try {
                const sessionData = decryptSessionData(encryptedSession, state.masterPasswordHash);
                return !!(sessionData && sessionData.token && sessionData.key);
            } catch {
                return false;
            }
        },
        restoreSession: () => {
            const state = get({ subscribe });
            if (!state.rememberSession) return false;

            const encryptedSession = sessionStorage.getItem(SESSION_KEY);
            if (!encryptedSession || !state.masterPasswordHash) return false;

            try {
                const sessionData = decryptSessionData(encryptedSession, state.masterPasswordHash);
                if (sessionData && sessionData.token && sessionData.key) {
                    sessionToken = sessionData.token;
                    currentMasterPassword = sessionData.key;
                    update(s => ({ ...s, isUnlocked: true }));
                    return true;
                }
            } catch {
                sessionStorage.removeItem(SESSION_KEY);
            }
            return false;
        },
        setMasterPassword: (password) => update(s => {
            const hash = hashPassword(password);
            currentMasterPassword = password;
            const newState = { ...s, masterPasswordHash: hash, isUnlocked: true };
            saveImmediate(newState);
            saveSession(password, hash);
            return newState;
        }),
        unlock: (password) => {
            const state = get({ subscribe });
            if (verifyPassword(password, state.masterPasswordHash)) {
                currentMasterPassword = password;
                update(s => ({ ...s, isUnlocked: true }));
                saveSession(password, state.masterPasswordHash);
                return true;
            }
            return false;
        },
        lock: () => {
            const state = get({ subscribe });
            if (!state.rememberSession) {
                currentMasterPassword = null;
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
            } else if (currentMasterPassword && s.masterPasswordHash) {
                saveSession(currentMasterPassword, s.masterPasswordHash);
            }
            return newState;
        }),
        addPassword: (entry) => update(s => {
            if (!currentMasterPassword) return s;
            const encryptedPassword = encrypt(entry.password, currentMasterPassword);
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
            if (!currentMasterPassword) return 0;
            const encryptedEntries = entries.map(entry => ({
                id: (Date.now() + Math.random()).toString(),
                title: entry.title || '',
                username: entry.username || '',
                password: encrypt(entry.password, currentMasterPassword),
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
                    newEntry.password = encrypt(updates.password, currentMasterPassword);
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
            if (!currentMasterPassword) return null;
            return decrypt(encryptedPassword, currentMasterPassword);
        },
        getMasterPassword: () => currentMasterPassword,
        addCategory: (category) => update(s => {
            if (s.categories.includes(category)) return s;
            return { ...s, categories: [...s.categories, category] };
        }),
        clearAll: () => {
            currentMasterPassword = null;
            sessionToken = null;
            clearSession();
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
        changeMasterPassword: (oldPassword, newPassword) => {
            const state = get({ subscribe });

            if (!verifyPassword(oldPassword, state.masterPasswordHash)) {
                return { success: false, error: '原密码错误' };
            }

            if (!newPassword || newPassword.length < 8) {
                return { success: false, error: '新密码至少需要8个字符' };
            }

            const decryptedPasswords = state.passwords.map(p => ({
                ...p,
                password: decrypt(p.password, oldPassword) || ''
            }));

            const newHash = hashPassword(newPassword);

            const reEncryptedPasswords = decryptedPasswords.map(p => ({
                ...p,
                password: encrypt(p.password, newPassword),
                updatedAt: new Date().toISOString()
            }));

            currentMasterPassword = newPassword;

            update(s => {
                const newState = {
                    ...s,
                    passwords: reEncryptedPasswords,
                    masterPasswordHash: newHash
                };
                saveImmediate(newState);
                return newState;
            });

            clearSession();
            if (state.rememberSession) {
                saveSession(newPassword, newHash);
            }

            return { success: true };
        },
        getDecryptedPasswords: (ids = null) => {
            const state = get({ subscribe });
            if (!currentMasterPassword) return [];
            let passwords = state.passwords;
            if (ids && Array.isArray(ids) && ids.length > 0) {
                passwords = passwords.filter(p => ids.includes(p.id));
            }
            return passwords.map(p => ({
                ...p,
                password: decrypt(p.password, currentMasterPassword) || '解密失败'
            }));
        }
    };
}

export const passwordsStore = createPasswordsStore();
export const isPasswordsUnlocked = derived(passwordsStore, $store => $store.isUnlocked);
export const passwordsList = derived(passwordsStore, $store => $store.passwords);
export const passwordCategories = derived(passwordsStore, $store => $store.categories);
export const rememberSession = derived(passwordsStore, $store => $store.rememberSession);