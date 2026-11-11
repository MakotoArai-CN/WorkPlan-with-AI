import { beforeEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { migrateLegacyProtection, readProtection, readPendingErase, cloudRecordErased } from '../src/lib/utils/vault-protection.js';

const values = new Map();
globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
};
beforeEach(() => values.clear());

test('upgrade disables destructive v1 settings without touching vault or account data', () => {
    localStorage.setItem('workplan_vault_protection', JSON.stringify({ enabled: true, failures: 11, lockedUntil: 0 }));
    localStorage.setItem('workplan_passwords', 'preserved vault ciphertext');
    localStorage.setItem('workplan_access_key', 'preserved-account');
    expect(readProtection().enabled).toBe(false);
    migrateLegacyProtection();
    expect(readProtection().version).toBe(2);
    expect(readProtection().enabled).toBe(false);
    expect(localStorage.getItem('workplan_passwords')).toBe('preserved vault ciphertext');
    expect(localStorage.getItem('workplan_access_key')).toBe('preserved-account');
});

test('upgrade cancels unfinished cloud deletion and discards stored cloud credentials', () => {
    localStorage.setItem('workplan_protection_erase', JSON.stringify({ records: ['old-account'], localErased: true, databaseConfig: { apiKey: 'old-credential' } }));
    migrateLegacyProtection();
    const canceled = JSON.parse(localStorage.getItem('workplan_protection_erase'));
    expect(canceled.completed).toBe(true);
    expect(canceled.canceled).toBe(true);
    expect(canceled.databaseConfig).toBeUndefined();
    expect(canceled.records).toBeUndefined();
    expect(readPendingErase()).toBeNull();
    expect(cloudRecordErased('any-record')).toBe(false);
});

test('new version has no automatic erase implementation or registered destructive native command', () => {
    const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    expect(read('src/lib/utils/vault-protection.js')).not.toContain('deleteCloudRecord');
    expect(read('src/lib/stores/passwords.js')).not.toContain('executeProtectionErase');
    expect(read('src-tauri/src/lib.rs')).not.toContain('local_db::local_db_erase');
    expect(read('src-tauri/src/local_db.rs')).not.toContain('fn local_db_erase');
});
