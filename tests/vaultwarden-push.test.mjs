import { afterEach, describe, expect, mock, test } from 'bun:test';

mock.module('../src/lib/utils/runtime.js', () => ({ isTauriRuntime: false }));
const { importFromVaultwarden, pushToVaultwarden } = await import('../src/lib/utils/vaultwarden.js');

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const originalFetch = globalThis.fetch;

function toBase64(bytes) {
    return Buffer.from(bytes).toString('base64');
}

function fromBase64(value) {
    return new Uint8Array(Buffer.from(value, 'base64'));
}

function concat(...arrays) {
    const total = arrays.reduce((sum, array) => sum + array.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const array of arrays) {
        output.set(array, offset);
        offset += array.length;
    }
    return output;
}

async function pbkdf2(password, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' },
        key,
        256
    );
    return new Uint8Array(bits);
}

async function hkdfExpand(prk, info, length) {
    const hmacKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const infoBytes = encoder.encode(info);
    let previous = new Uint8Array(0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (let counter = 1; offset < length; counter += 1) {
        const block = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, concat(previous, infoBytes, new Uint8Array([counter]))));
        const needed = Math.min(block.length, length - offset);
        output.set(block.subarray(0, needed), offset);
        offset += needed;
        previous = block;
    }
    return output;
}

async function encryptString(value, key) {
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-CBC', iv },
        await crypto.subtle.importKey('raw', key.subarray(0, 32), 'AES-CBC', false, ['encrypt']),
        encoder.encode(String(value))
    ));
    if (key.length >= 64) {
        const mac = new Uint8Array(await crypto.subtle.sign(
            'HMAC',
            await crypto.subtle.importKey('raw', key.subarray(32, 64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
            concat(iv, ciphertext)
        ));
        return `2.${toBase64(iv)}|${toBase64(ciphertext)}|${toBase64(mac)}`;
    }
    return `0.${toBase64(iv)}|${toBase64(ciphertext)}`;
}

async function decryptString(value, key) {
    const dot = value.indexOf('.');
    const parts = value.slice(dot + 1).split('|');
    const iv = fromBase64(parts[0]);
    const ciphertext = fromBase64(parts[1]);
    const plain = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv },
        await crypto.subtle.importKey('raw', key.subarray(0, 32), 'AES-CBC', false, ['decrypt']),
        ciphertext
    );
    return decoder.decode(plain);
}

async function makeServer(existing = []) {
    const email = 'user@example.com';
    const password = 'correct horse battery staple';
    const userKey = crypto.getRandomValues(new Uint8Array(64));
    const masterKey = await pbkdf2(password, email.toLowerCase(), 1);
    const stretchedKey = concat(
        await hkdfExpand(masterKey, 'enc', 32),
        await hkdfExpand(masterKey, 'mac', 32)
    );
    const encryptedUserKey = await encryptString(toBase64(userKey), stretchedKey);
    const pushedBodies = [];

    globalThis.fetch = async (input, options = {}) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/identity/accounts/prelogin')) {
            return Response.json({ Kdf: 0, KdfIterations: 1 });
        }
        if (path.endsWith('/identity/connect/token')) {
            return Response.json({ access_token: 'test-token', Key: encryptedUserKey });
        }
        if (path.endsWith('/api/sync')) {
            const ciphers = await Promise.all(existing.map(async item => ({
                type: 1,
                name: await encryptString(item.title, userKey),
                login: { username: await encryptString(item.username, userKey) }
            })));
            return Response.json({ ciphers });
        }
        if (path.endsWith('/api/ciphers') && options.method === 'POST') {
            pushedBodies.push(JSON.parse(options.body));
            return Response.json({ id: `new-${pushedBodies.length}` });
        }
        throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    };

    return { email, password, userKey, pushedBodies };
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('Vaultwarden push', () => {
    test('encrypts a WorkPlan login and POSTs it as a Bitwarden cipher', async () => {
        const server = await makeServer();
        const result = await pushToVaultwarden({
            baseUrl: 'https://vault.example.com',
            email: server.email,
            masterPassword: server.password,
            items: [{
                title: 'Example',
                username: 'alice',
                password: 's3cret',
                url: 'https://example.com',
                notes: 'hello\nTOTP: JBSWY3DPEHPK3PXP'
            }]
        });

        expect(result).toMatchObject({ pushed: 1, skipped: 0, failed: 0, total: 1 });
        const body = server.pushedBodies[0];
        expect(body.type).toBe(1);
        expect(await decryptString(body.name, server.userKey)).toBe('Example');
        expect(await decryptString(body.login.username, server.userKey)).toBe('alice');
        expect(await decryptString(body.login.password, server.userKey)).toBe('s3cret');
        expect(await decryptString(body.login.uris[0].uri, server.userKey)).toBe('https://example.com');
        expect(await decryptString(body.notes, server.userKey)).toBe('hello');
        expect(await decryptString(body.login.totp, server.userKey)).toBe('JBSWY3DPEHPK3PXP');
    });

    test('still imports existing login ciphers', async () => {
        const server = await makeServer([{ title: 'Example', username: 'alice' }]);
        const imported = await importFromVaultwarden({
            baseUrl: 'https://vault.example.com',
            email: server.email,
            masterPassword: server.password
        });
        expect(imported.items).toHaveLength(1);
        expect(imported.items[0]).toMatchObject({ title: 'Example', username: 'alice' });
    });

    test('skips an existing title + username pair', async () => {
        const server = await makeServer([{ title: 'Example', username: 'alice' }]);
        const result = await pushToVaultwarden({
            baseUrl: 'https://vault.example.com',
            email: server.email,
            masterPassword: server.password,
            items: [{ title: 'Example', username: 'alice', password: 's3cret', url: 'https://example.com' }]
        });

        expect(result).toMatchObject({ pushed: 0, skipped: 1, failed: 0, total: 1 });
        expect(server.pushedBodies).toHaveLength(0);
    });
});
