import { beforeEach, describe, expect, test } from 'bun:test';

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

const {
    stashCurrentAccount,
    clearAccountScopedData,
    restoreAccountData
} = await import('../src/lib/utils/account-scope.js');

describe('account-scoped local data', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    test('stashes notes/passwords/worklog and clears them from the live account', () => {
        localStorage.setItem('planpro_access_key', 'account-a');
        localStorage.setItem('planpro_notes', '[{"id":"n1"}]');
        localStorage.setItem('planpro_passwords', '[{"id":"p1"}]');
        localStorage.setItem('planpro_system_settings', JSON.stringify({
            theme: 'light',
            overtimeConfig: { salaryActuals: [{ amount: 4313 }] }
        }));

        stashCurrentAccount('account-a');
        clearAccountScopedData();

        expect(localStorage.getItem('planpro_notes')).toBeNull();
        expect(localStorage.getItem('planpro_passwords')).toBeNull();
        const settings = JSON.parse(localStorage.getItem('planpro_system_settings'));
        expect(settings.theme).toBe('light');
        expect(settings.overtimeConfig).toBeUndefined();

        restoreAccountData('account-a');
        expect(localStorage.getItem('planpro_notes')).toContain('n1');
        expect(localStorage.getItem('planpro_passwords')).toContain('p1');
        const restored = JSON.parse(localStorage.getItem('planpro_system_settings'));
        expect(restored.overtimeConfig.salaryActuals[0].amount).toBe(4313);
    });

    test('a new account with no stash starts with empty scoped data', () => {
        localStorage.setItem('planpro_access_key', 'account-a');
        localStorage.setItem('planpro_notes', '[{"id":"old"}]');
        stashCurrentAccount('account-a');
        clearAccountScopedData();
        expect(restoreAccountData('account-b')).toBe(false);
        expect(localStorage.getItem('planpro_notes')).toBeNull();
    });
});
