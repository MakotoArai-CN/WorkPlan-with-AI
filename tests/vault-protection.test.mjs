import { describe, test, expect } from 'bun:test';
import { nextProtectionFailure, eraseRecordKeys } from '../src/lib/utils/vault-protection.js';
import { validateMasterPassword } from '../src/lib/utils/master-password-policy.js';

describe('master password policy', () => {
    test('rejects common dictionary bases with predictable punctuation and number suffixes', () => {
        for (const password of ['letmein!', 'football1', 'sunshine2026!', 'iloveyou!', 'monkey123!']) {
            expect(validateMasterPassword(password)).toBe('weak');
        }
        expect(validateMasterPassword('sunshine through cedar leaves')).toBeNull();
    });
    test('rejects common passwords, repetitions and normalized variants', () => {
        for (const password of ['12345678', 'Password123!', 'P@ssw0rd', 'qwertyuiop', 'aaaaaaaa', '12121212', 'admin2026', ' password123 ']) {
            expect(validateMasterPassword(password)).toBe('weak');
        }
        expect(validateMasterPassword('short')).toBe('too_short');
        expect(validateMasterPassword('a-long-unusual-phrase-2026')).toBeNull();
    });
});

describe('opt-in absolute protection', () => {
    test('disabled policy never increments attempts', () => {
        const disabled = { enabled: false, failures: 0, lockedUntil: 0 };
        expect(nextProtectionFailure(disabled, 1)).toBe(disabled);
    });

    test('exact thresholds survive expiry; cooldown submissions do not count', () => {
        let state = { enabled: true, failures: 0, lockedUntil: 0 };
        let now = 1000;
        for (let attempt = 1; attempt <= 11; attempt++) {
            state = nextProtectionFailure(state, now);
            expect(state.failures).toBe(attempt);
            const minutes = attempt <= 5 ? 0 : attempt === 6 ? 5 : attempt === 7 ? 10 : 30;
            expect(state.lockedUntil).toBe(minutes ? now + minutes * 60000 : 0);
            if (minutes) {
                expect(nextProtectionFailure(state, now + 1)).toBe(state);
                now = state.lockedUntil;
            }
        }
        expect(state.failures > 10).toBe(true);
    });

    test('cloud erase covers tasks, both secure formats and account key bundle', () => {
        const keys = eraseRecordKeys('account');
        expect(keys).toHaveLength(8);
        expect(new Set(keys).size).toBe(8);
        expect(keys).toContain('account');
        expect(keys).toContain('__workplan_key_bundle_v2__:account');
        for (const domain of ['notes', 'vault', 'worklog']) {
            expect(keys).toContain(`__workplan_secure_${domain}_v1__:account`);
            expect(keys).toContain(`__workplan_secure_${domain}_v2__:account`);
        }
        expect(eraseRecordKeys('')).toEqual([]);
    });
});
