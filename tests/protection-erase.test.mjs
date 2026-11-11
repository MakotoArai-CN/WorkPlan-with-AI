import { beforeEach, expect, mock, test } from 'bun:test';

// All destructive I/O is mocked. Never point these tests at a real app DB.
const values = new Map();
globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    clear: () => values.clear()
};
let deleted = [];
let offline = false;
let reloaded = 0;
globalThis.location = { reload: () => reloaded++ };
mock.module('../src/lib/stores/tasks.js', () => ({
    readDatabaseConfig: () => ({ url: 'https://cloud.invalid', apiKey: 'test-only', enabled: false }),
    waitForCloudWrites: async () => {},
    loadCloudRecord: async () => null,
    saveCloudRecord: async () => false,
    deleteCloudRecord: async key => {
        if (offline) throw new Error('offline');
        deleted.push(key);
    }
}));
mock.module('../src/lib/utils/local-db.js', () => ({
    flushLocalDatabase: async () => {},
    eraseLocalDatabase: async pending => {
        values.clear();
        values.set('workplan_protection_erase', JSON.stringify(pending));
    },
    persistEraseJournal: async pending => {
        values.set('workplan_protection_erase', JSON.stringify(pending));
    }
}));
const { executeProtectionErase, retryPendingErase, resumeProtectionErase, readPendingErase, cloudRecordErased } = await import('../src/lib/utils/vault-protection.js');

beforeEach(() => { values.clear(); deleted = []; offline = false; reloaded = 0; });

test('erases local content silently, persists offline deletes, retries every cloud namespace', async () => {
    localStorage.setItem('workplan_access_key', 'test-account');
    localStorage.setItem('workplan_passwords', 'secret data');
    await executeProtectionErase();
    expect(reloaded).toBe(1);
    expect(localStorage.getItem('workplan_passwords')).toBeNull();
    expect(readPendingErase().localErased).toBe(true);
    expect(readPendingErase().databaseConfig.enabled).toBe(false);
    expect(cloudRecordErased('any-key')).toBe(true);
    offline = true;
    await retryPendingErase();
    expect(readPendingErase().records).toHaveLength(8);
    offline = false;
    await retryPendingErase();
    expect(deleted).toHaveLength(8);
    expect(readPendingErase()).toBeNull();
    // Keep a non-secret tombstone: automatic backup recovery must stay disabled.
    expect(JSON.parse(localStorage.getItem('workplan_protection_erase')).completed).toBe(true);
});

test('restarts an interrupted local erase before starting cloud retries', async () => {
    localStorage.setItem('workplan_protection_erase', JSON.stringify({ records: ['test-account'], localErased: false }));
    localStorage.setItem('workplan_passwords', 'stale working copy');
    await retryPendingErase();
    expect(deleted).toHaveLength(0);
    expect(await resumeProtectionErase()).toBe(true);
    expect(localStorage.getItem('workplan_passwords')).toBeNull();
    expect(readPendingErase().localErased).toBe(true);
    expect(reloaded).toBe(1);
});

test('failure 11 persisted before a crash still triggers local erase on startup', async () => {
    localStorage.setItem('workplan_vault_protection', JSON.stringify({ enabled: true, failures: 11, lockedUntil: 0 }));
    expect(await resumeProtectionErase()).toBe(true);
    expect(reloaded).toBe(1);
    expect(localStorage.getItem('workplan_vault_protection')).toBeNull();
});
