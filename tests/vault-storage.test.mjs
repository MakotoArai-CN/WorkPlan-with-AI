import { describe, test, expect, beforeEach, mock } from 'bun:test';

// Storage-level guarantees for the v4 vault format:
// - metadata and password are both ciphertext at rest
// - a reload/unlock restores the list
// - a legacy v3 vault is migrated in place without losing fields
function createStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        clear: () => map.clear()
    };
}
globalThis.localStorage = createStorage();
globalThis.sessionStorage = createStorage();
globalThis.window = globalThis;
mock.module('@tauri-apps/api/core', () => ({ invoke: async () => 'test-device' }));
mock.module('../src/lib/utils/runtime.js', () => ({ isTauriRuntime: true, isAndroidRuntime: () => false }));
const { encrypt, hashPassword } = await import('../src/lib/utils/crypto.js');
const { passwordsStore } = await import('../src/lib/stores/passwords.js');

const MASTER = 'my-master-password-2026';

async function flush() {
    await new Promise(resolve => setTimeout(resolve, 180));
}

function currentEntry() {
    let entry;
    passwordsStore.subscribe((s) => (entry = s.passwords[0]))();
    return entry;
}

describe('v4 vault at rest', () => {
    beforeEach(async () => {
        localStorage.clear();
        sessionStorage.clear();
        passwordsStore.clearAll();
        await passwordsStore.setMasterPassword(MASTER);
        passwordsStore.addPassword({ title: 'GitHub', username: 'me', password: 'gh-secret', notes: 'secret note' });
        await flush();
    });

    test('encrypts metadata and password, never plaintext titles', async () => {
        const raw = JSON.parse(localStorage.getItem('planpro_passwords'));
        expect(raw[0].title).toBeUndefined();
        expect(raw[0].username).toBeUndefined();
        expect(raw[0].notes).toBeUndefined();
        expect(raw[0].meta.startsWith('v4:')).toBe(true);
        expect(raw[0].password.startsWith('v4:')).toBe(true);
        expect(raw[0].kdfSalt).toBeTruthy();
        expect(JSON.stringify(raw)).not.toContain('GitHub');
        expect(JSON.stringify(raw)).not.toContain('gh-secret');
    });

    test('restores metadata and secret after lock/reload/unlock', async () => {
        passwordsStore.lock();
        passwordsStore.load();
        expect(await passwordsStore.unlock(MASTER)).toBe(true);
        const entry = currentEntry();
        expect(entry.title).toBe('GitHub');
        expect(entry.username).toBe('me');
        expect(passwordsStore.decryptPassword(entry.password)).toBe('gh-secret');
    });
});

describe('legacy vault migration', () => {
    test('migrates v3 rows to v4 while preserving all fields', async () => {
        localStorage.clear();
        sessionStorage.clear();
        passwordsStore.clearAll();
        localStorage.setItem('planpro_master_hash', await hashPassword(MASTER));
        localStorage.setItem('planpro_passwords', JSON.stringify([{
            id: 'legacy-1',
            title: 'Legacy GitHub',
            username: 'old-user',
            password: encrypt('legacy-secret', MASTER),
            url: 'https://github.com',
            category: '工作',
            notes: 'legacy note',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        }]));
        passwordsStore.load();
        expect(await passwordsStore.unlock(MASTER)).toBe(true);

        const entry = currentEntry();
        expect(entry.title).toBe('Legacy GitHub');
        expect(entry.username).toBe('old-user');
        expect(passwordsStore.decryptPassword(entry.password)).toBe('legacy-secret');

        await flush();
        const raw = JSON.parse(localStorage.getItem('planpro_passwords'));
        expect(raw[0].meta.startsWith('v4:')).toBe(true);
        expect(raw[0].password.startsWith('v4:')).toBe(true);
        expect(raw[0].title).toBeUndefined();
        expect(JSON.stringify(raw)).not.toContain('Legacy GitHub');
    });
});
