import { describe, test, expect, beforeEach } from 'bun:test';
import CryptoJS from 'crypto-js';
import {
    encrypt,
    decrypt,
    hashPassword,
    verifyPassword,
    verifierNeedsUpgrade,
    beginSessionWrapping,
    endSessionWrapping,
    encryptSessionData,
    decryptSessionData,
    needsMigration,
    migrateEncryption
} from '../src/lib/utils/crypto.js';

/** Flip one hex character at `index` so the value changes but stays well-formed. */
function tamperField(parts, index) {
    const copy = [...parts];
    const chars = copy[index].split('');
    chars[0] = chars[0] === 'a' ? 'b' : 'a';
    copy[index] = chars.join('');
    return copy.join(':');
}

/** Build a ciphertext in the pre-hardening v2 format (single key, no MAC). */
function legacyEncryptV2(plaintext, password) {
    const salt = CryptoJS.lib.WordArray.random(16).toString();
    const iv = CryptoJS.lib.WordArray.random(16);
    const key = CryptoJS.PBKDF2(password, salt, {
        keySize: 256 / 32,
        iterations: 10000,
        hasher: CryptoJS.algo.SHA256
    });
    const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });
    return `v2:${salt}:${iv.toString()}:${encrypted.ciphertext.toString()}`;
}

describe('encrypt / decrypt', () => {
    test('round trips a value', () => {
        const ciphertext = encrypt('hunter2', 'master-pw');
        expect(ciphertext.startsWith('v3:')).toBe(true);
        expect(decrypt(ciphertext, 'master-pw')).toBe('hunter2');
    });

    test('rejects the wrong password', () => {
        expect(decrypt(encrypt('hunter2', 'master-pw'), 'wrong')).toBeNull();
    });

    test('preserves unicode exactly', () => {
        expect(decrypt(encrypt('密码🔐ok', 'm'), 'm')).toBe('密码🔐ok');
    });

    test('uses a fresh salt per call', () => {
        expect(encrypt('x', 'm')).not.toBe(encrypt('x', 'm'));
    });
});

describe('tamper detection', () => {
    // AES-CBC is malleable; without the MAC these mutations decrypt silently.
    const password = 'master-pw';
    let parts;

    beforeEach(() => {
        parts = encrypt('hunter2', password).split(':');
    });

    test('rejects a modified ciphertext', () => {
        expect(decrypt(tamperField(parts, 3), password)).toBeNull();
    });

    test('rejects a modified IV', () => {
        expect(decrypt(tamperField(parts, 2), password)).toBeNull();
    });

    test('rejects a modified MAC', () => {
        expect(decrypt(tamperField(parts, 4), password)).toBeNull();
    });
});

describe('legacy vault compatibility', () => {
    const password = 'old-pw';

    test('decrypts the v2 format', () => {
        expect(decrypt(legacyEncryptV2('legacy-secret', password), password)).toBe('legacy-secret');
    });

    test('decrypts the original unversioned format', () => {
        const v1 = legacyEncryptV2('legacy-secret', password).slice('v2:'.length);
        expect(decrypt(v1, password)).toBe('legacy-secret');
    });

    test('flags old formats for migration but not the current one', () => {
        expect(needsMigration(legacyEncryptV2('x', password))).toBe(true);
        expect(needsMigration(encrypt('x', password))).toBe(false);
    });

    test('migrates to v3 without altering the plaintext', () => {
        const migrated = migrateEncryption(legacyEncryptV2('legacy-secret', password), password);
        expect(migrated.startsWith('v3:')).toBe(true);
        expect(decrypt(migrated, password)).toBe('legacy-secret');
    });
});

describe('master password verifier', () => {
    test('accepts the correct password and rejects others', async () => {
        const stored = await hashPassword('correct-horse');
        expect(stored.startsWith('v2:')).toBe(true);
        expect(await verifyPassword('correct-horse', stored)).toBe(true);
        expect(await verifyPassword('nope', stored)).toBe(false);
    });

    test('is salted, so equal passwords hash differently', async () => {
        expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
    });

    test('still verifies legacy unsalted SHA-256 and flags it for upgrade', async () => {
        const legacy = CryptoJS.SHA256('legacy-master').toString();
        expect(await verifyPassword('legacy-master', legacy)).toBe(true);
        expect(await verifyPassword('bad', legacy)).toBe(false);
        expect(verifierNeedsUpgrade(legacy)).toBe(true);
        expect(verifierNeedsUpgrade(await hashPassword('x'))).toBe(false);
    });
});

describe('session wrapping', () => {
    // The wrapping key lives only in memory, so persisted state alone must never
    // be enough to recover the master password.
    beforeEach(() => endSessionWrapping());

    test('cannot encrypt without an active wrapping key', () => {
        expect(encryptSessionData({ a: 1 })).toBeNull();
    });

    test('round trips within the same session', () => {
        beginSessionWrapping();
        const blob = encryptSessionData({ token: 't', key: 'master-pw' });
        expect(decryptSessionData(blob).key).toBe('master-pw');
    });

    test('cannot be decrypted after the key is discarded', () => {
        beginSessionWrapping();
        const blob = encryptSessionData({ token: 't', key: 'master-pw' });
        endSessionWrapping();
        expect(decryptSessionData(blob)).toBeNull();
    });

    test('cannot be decrypted by a different session key', () => {
        beginSessionWrapping();
        const blob = encryptSessionData({ token: 't', key: 'master-pw' });
        beginSessionWrapping();
        expect(decryptSessionData(blob)).toBeNull();
    });
});
