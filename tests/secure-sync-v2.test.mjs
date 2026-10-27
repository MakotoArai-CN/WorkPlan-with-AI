import { describe, expect, test } from 'bun:test';
import {
    KDF_ITERATIONS,
    wrapAccountKey,
    unwrapAccountKey,
    encryptDomainPayload,
    decryptDomainPayload
} from '../src/lib/utils/secure-sync-v2.js';

const accountKey = new Uint8Array(32).fill(7);
const accessKey = 'test-access-key-0123456789';

describe('portable secure sync key bundle', () => {
    test('wraps and unwraps the same account key with the master password', async () => {
        const bundle = await wrapAccountKey(accountKey, 'correct horse battery', accessKey, 10_000);
        const unwrapped = await unwrapAccountKey(bundle, 'correct horse battery', accessKey);
        expect([...unwrapped]).toEqual([...accountKey]);
        expect(bundle.v).toBe(2);
        expect(bundle.iterations).toBe(10_000);
        expect(bundle.wrappedKey).not.toContain('correct horse');
    });

    test('rejects a wrong master password or access key', async () => {
        const bundle = await wrapAccountKey(accountKey, 'correct horse battery', accessKey, 10_000);
        await expect(unwrapAccountKey(bundle, 'wrong password', accessKey)).rejects.toThrow();
        await expect(unwrapAccountKey(bundle, 'correct horse battery', 'other-access-key')).rejects.toThrow();
    });

    test('uses a strong default KDF iteration count', () => {
        expect(KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    });
});

describe('portable secure sync envelopes', () => {
    test('encrypts and decrypts a domain payload', async () => {
        const payload = { notes: [{ id: 'n1', title: 'private' }], categories: ['work'] };
        const envelope = await encryptDomainPayload(payload, {
            accountKey,
            domain: 'notes',
            accessKey
        });
        expect(envelope.v).toBe(2);
        expect(envelope.domain).toBe('notes');
        expect(envelope.ciphertext).not.toContain('private');
        const plain = await decryptDomainPayload(envelope, {
            accountKey,
            domain: 'notes',
            accessKey
        });
        expect(plain).toEqual(payload);
    });

    test('cannot move a notes envelope into the vault domain', async () => {
        const envelope = await encryptDomainPayload({ secret: 'notes only' }, {
            accountKey,
            domain: 'notes',
            accessKey
        });
        await expect(decryptDomainPayload(envelope, {
            accountKey,
            domain: 'vault',
            accessKey
        })).rejects.toThrow();
    });

    test('cannot decrypt with another account key', async () => {
        const envelope = await encryptDomainPayload({ secret: 'value' }, {
            accountKey,
            domain: 'worklog',
            accessKey
        });
        await expect(decryptDomainPayload(envelope, {
            accountKey: new Uint8Array(32).fill(8),
            domain: 'worklog',
            accessKey
        })).rejects.toThrow();
    });
});
