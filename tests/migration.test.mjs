// Simulates an existing user's vault upgrading to the hardened formats,
// mirroring what passwords.js does on unlock() and migrateAllPasswords().
import { describe, test, expect } from 'bun:test';
import CryptoJS from 'crypto-js';
import {
    decrypt,
    hashPassword,
    verifyPassword,
    verifierNeedsUpgrade,
    needsMigration,
    migrateEncryption
} from '../src/lib/utils/crypto.js';

const MASTER = 'my-old-master-password';

/** Encrypt exactly as the pre-hardening code did. */
function legacyEncrypt(plaintext, password) {
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

const SECRETS = ['gh-secret-123', 'p@ssw0rd!<>&', '密码🔐'];

function buildLegacyVault() {
    return SECRETS.map((secret, i) => ({
        id: String(i + 1),
        password: legacyEncrypt(secret, MASTER)
    }));
}

const legacyMasterHash = CryptoJS.SHA256(MASTER).toString();

describe('existing user unlocks an old vault', () => {
    test('the legacy verifier accepts the real password', async () => {
        expect(await verifyPassword(MASTER, legacyMasterHash)).toBe(true);
    });

    test('the legacy verifier rejects a wrong password', async () => {
        expect(await verifyPassword('wrong', legacyMasterHash)).toBe(false);
    });

    test('the legacy verifier is flagged for upgrade', () => {
        expect(verifierNeedsUpgrade(legacyMasterHash)).toBe(true);
    });
});

describe('verifier is transparently upgraded on unlock', () => {
    test('the upgraded verifier still accepts the same password', async () => {
        const upgraded = await hashPassword(MASTER);
        expect(upgraded.startsWith('v2:')).toBe(true);
        expect(await verifyPassword(MASTER, upgraded)).toBe(true);
        expect(await verifyPassword('wrong', upgraded)).toBe(false);
    });

    test('the upgraded verifier no longer needs upgrading', async () => {
        const upgraded = await hashPassword(MASTER);
        expect(verifierNeedsUpgrade(upgraded)).toBe(false);
        expect(upgraded).not.toBe(legacyMasterHash);
    });
});

describe('stored entries survive migration', () => {
    test('every legacy entry decrypts before migration', () => {
        const vault = buildLegacyVault();
        expect(vault.map((e) => decrypt(e.password, MASTER))).toEqual(SECRETS);
    });

    test('every entry migrates to v3 with its plaintext intact', () => {
        for (const entry of buildLegacyVault()) {
            const before = decrypt(entry.password, MASTER);
            expect(needsMigration(entry.password)).toBe(true);

            const migrated = migrateEncryption(entry.password, MASTER);
            expect(migrated.startsWith('v3:')).toBe(true);
            expect(decrypt(migrated, MASTER)).toBe(before);
        }
    });

    test('migration is idempotent', () => {
        const migrated = migrateEncryption(buildLegacyVault()[0].password, MASTER);
        expect(migrateEncryption(migrated, MASTER)).toBe(migrated);
    });
});

describe('migrated vault is tamper-evident', () => {
    test('a bit flip in a migrated entry is rejected', () => {
        const migrated = migrateEncryption(buildLegacyVault()[0].password, MASTER);
        const parts = migrated.split(':');
        const chars = parts[3].split('');
        chars[0] = chars[0] === 'a' ? 'b' : 'a';
        parts[3] = chars.join('');
        expect(decrypt(parts.join(':'), MASTER)).toBeNull();
    });
});
