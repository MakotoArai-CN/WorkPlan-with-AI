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
const { ensureVaultEntryKey, encryptVaultPayload, decryptVaultPayload } = await import('../src/lib/utils/vault-entry.js');

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
        const raw = JSON.parse(localStorage.getItem('workplan_passwords'));
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

    test('changes the master transactionally and survives lock/reload', async () => {
        // Keep an old-key debounced save outstanding while changing the master.
        passwordsStore.updatePassword(currentEntry().id, { notes: 'pending edit' });
        const result = await passwordsStore.changeMasterPassword(MASTER, 'new-unusual-master-2026');
        expect(result.success).toBe(true);
        await flush();
        passwordsStore.lock();
        passwordsStore.load();
        expect(await passwordsStore.unlock(MASTER)).toBe(false);
        expect(await passwordsStore.unlock('new-unusual-master-2026')).toBe(true);
        expect(currentEntry().notes).toBe('pending edit');
        expect(passwordsStore.decryptPassword(currentEntry().password)).toBe('gh-secret');
    });

    test('a lock during master derivation cannot reopen the session', async () => {
        const changing = passwordsStore.changeMasterPassword(MASTER, 'new-unusual-master-2026');
        passwordsStore.lock();
        const result = await changing;
        expect(result.success).toBe(false);
        passwordsStore.load();
        expect(await passwordsStore.unlock(MASTER)).toBe(true);
    });

    test('a stale verification cannot increment the next account protection state', async () => {
        localStorage.setItem('workplan_vault_protection', JSON.stringify({ enabled: true, failures: 5, lockedUntil: 0 }));
        const unlocking = passwordsStore.unlock('incorrect master');
        passwordsStore.suspendForAccountSwitch();
        localStorage.setItem('workplan_vault_protection', JSON.stringify({ enabled: true, failures: 0, lockedUntil: 0 }));
        expect(await unlocking).toBe(false);
        expect(passwordsStore.getProtection().failures).toBe(0);
    });

    test('master verification persists cooldown and only a correct master resets failures', async () => {
        expect((await passwordsStore.setProtection(true, MASTER)).success).toBe(true);
        passwordsStore.lock();
        for (let attempt = 0; attempt < 6; attempt++) expect(await passwordsStore.unlock('incorrect master')).toBe(false);
        expect(passwordsStore.getProtection().failures).toBe(6);
        expect(passwordsStore.getProtection().lockedUntil).toBeGreaterThan(Date.now());
        await expect(passwordsStore.unlock(MASTER)).rejects.toThrow('强制冷静');
        expect(passwordsStore.getProtection().failures).toBe(6);
        localStorage.setItem('workplan_vault_protection', JSON.stringify({ ...passwordsStore.getProtection(), lockedUntil: 0 }));
        expect(await passwordsStore.unlock(MASTER)).toBe(true);
        expect(passwordsStore.getProtection().failures).toBe(0);
    });

    test('saving another row reuses unchanged metadata ciphertext', async () => {
        const previous = JSON.parse(localStorage.getItem('workplan_passwords'))[0];
        passwordsStore.addPassword({ title: 'Second', password: 'another-secret' });
        await flush();
        const unchanged = JSON.parse(localStorage.getItem('workplan_passwords')).find(row => row.id === previous.id);
        expect(unchanged.meta).toBe(previous.meta);
        expect(unchanged.password).toBe(previous.password);
    });

    test('entry key cache never reuses a key for a different master', async () => {
        const first = await ensureVaultEntryKey(MASTER);
        const second = await ensureVaultEntryKey('different-secret');
        expect(second).not.toBe(first);
        expect(decryptVaultPayload(encryptVaultPayload('secret', first), second)).toBeNull();
    });

    test('a failed verifier write restores both the old ciphertext and live key', async () => {
        const original = localStorage.setItem;
        let failed = false;
        localStorage.setItem = (key, value) => {
            if (key === 'workplan_master_hash' && value !== localStorage.getItem(key) && !failed) {
                failed = true;
                throw new Error('simulated storage failure');
            }
            return original(key, value);
        };
        try {
            expect((await passwordsStore.changeMasterPassword(MASTER, 'another-unusual-master-2026')).success).toBe(false);
        } finally { localStorage.setItem = original; }
        expect(passwordsStore.decryptPassword(currentEntry().password)).toBe('gh-secret');
        passwordsStore.lock();
        passwordsStore.load();
        expect(await passwordsStore.unlock(MASTER)).toBe(true);
        expect(passwordsStore.decryptPassword(currentEntry().password)).toBe('gh-secret');
    });
});

describe('legacy vault migration', () => {
    test('migrates v3 rows to v4 while preserving all fields', async () => {
        localStorage.clear();
        sessionStorage.clear();
        passwordsStore.clearAll();
        localStorage.setItem('workplan_master_hash', await hashPassword(MASTER));
        localStorage.setItem('workplan_passwords', JSON.stringify([{
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
        const raw = JSON.parse(localStorage.getItem('workplan_passwords'));
        expect(raw[0].meta.startsWith('v4:')).toBe(true);
        expect(raw[0].password.startsWith('v4:')).toBe(true);
        expect(raw[0].title).toBeUndefined();
        expect(JSON.stringify(raw)).not.toContain('Legacy GitHub');
    });
});
