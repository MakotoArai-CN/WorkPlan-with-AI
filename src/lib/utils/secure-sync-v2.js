// Portable end-to-end encryption for secure sync.
//
// The account key is random and wrapped by a key derived from the password
// vault master password. The wrapped key is the only thing the cloud sees;
// every synced domain uses a subkey derived from the account key, so a second
// device only needs the same access key and master password.

import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { loadCloudRecord, saveCloudRecord } from '../stores/tasks.js';

export const KEY_BUNDLE_VERSION = 2;
export const ENVELOPE_VERSION = 2;
export const KDF_ITERATIONS = 600_000;

const KEY_BUNDLE_PREFIX = '__workplan_key_bundle_v2__';
const ENVELOPE_PREFIX = '__workplan_secure';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let cached = null; // { accessKey, savedAt, accountKey }

export function base64FromBytes(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

export function bytesFromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function requireWebCrypto() {
    if (!globalThis.crypto?.subtle) {
        throw new Error('当前环境不支持 WebCrypto，无法加密同步');
    }
}

export function keyBundleRecordKey(accessKey) {
    return `${KEY_BUNDLE_PREFIX}:${accessKey}`;
}

export function domainRecordKey(domain, accessKey) {
    return `${ENVELOPE_PREFIX}_${domain}_v2__:${accessKey}`;
}

async function deriveKek(masterPassword, salt, iterations) {
    requireWebCrypto();
    const material = await crypto.subtle.importKey(
        'raw',
        encoder.encode(masterPassword),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations,
            hash: 'SHA-256'
        },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

function keyBundleAad(accessKey) {
    return encoder.encode(`workplan-key-bundle-v2|${accessKey}`);
}

export async function wrapAccountKey(accountKey, masterPassword, accessKey, iterations = KDF_ITERATIONS) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const kek = await deriveKek(masterPassword, salt, iterations);
    const wrapped = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: keyBundleAad(accessKey) },
        kek,
        accountKey
    );
    return {
        v: KEY_BUNDLE_VERSION,
        alg: 'AES-GCM',
        kdf: 'PBKDF2-SHA256',
        iterations,
        salt: base64FromBytes(salt),
        iv: base64FromBytes(iv),
        wrappedKey: base64FromBytes(new Uint8Array(wrapped)),
        savedAt: Date.now()
    };
}

export async function unwrapAccountKey(bundle, masterPassword, accessKey) {
    if (!bundle || bundle.v !== KEY_BUNDLE_VERSION || !bundle.wrappedKey) {
        throw new Error('云端密钥包格式无效');
    }
    const iterations = Number(bundle.iterations) || KDF_ITERATIONS;
    const kek = await deriveKek(masterPassword, bytesFromBase64(bundle.salt), iterations);
    try {
        const plain = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: bytesFromBase64(bundle.iv),
                additionalData: keyBundleAad(accessKey)
            },
            kek,
            bytesFromBase64(bundle.wrappedKey)
        );
        const accountKey = new Uint8Array(plain);
        if (accountKey.length !== 32) throw new Error('账号密钥长度异常');
        return accountKey;
    } catch {
        throw new Error('主密码与云端密钥包不匹配');
    }
}

export async function loadKeyBundle(accessKey) {
    const record = await loadCloudRecord(keyBundleRecordKey(accessKey));
    return record?.content || null;
}

export async function saveKeyBundle(accessKey, bundle) {
    const ok = await saveCloudRecord(keyBundleRecordKey(accessKey), bundle, Date.now());
    if (ok === false) throw new Error('云数据库未启用或不可用');
    return bundle;
}

export function clearPortableKeyCache() {
    cached = null;
}

/**
 * Fetch and unwrap the account key. On first use it creates a random key and
 * uploads the wrapped bundle. The master password is never uploaded.
 */
export async function getAccountKey({ masterPassword, accessKey, create = true }) {
    requireWebCrypto();
    if (!masterPassword) throw new Error('请先解锁密码库');
    if (!accessKey) throw new Error('请先设置访问密钥');

    const bundle = await loadKeyBundle(accessKey);
    if (bundle) {
        if (cached && cached.accessKey === accessKey && cached.savedAt === bundle.savedAt) {
            return cached.accountKey;
        }
        const accountKey = await unwrapAccountKey(bundle, masterPassword, accessKey);
        cached = { accessKey, savedAt: bundle.savedAt, accountKey };
        return accountKey;
    }
    if (!create) return null;

    const accountKey = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapAccountKey(accountKey, masterPassword, accessKey);
    await saveKeyBundle(accessKey, wrapped);
    cached = { accessKey, savedAt: wrapped.savedAt, accountKey };
    return accountKey;
}

export async function rewrapAccountKey({ accessKey, oldPassword, newPassword }) {
    const bundle = await loadKeyBundle(accessKey);
    if (!bundle) return { success: false, skipped: true };
    const accountKey = await unwrapAccountKey(bundle, oldPassword, accessKey);
    const rewrapped = await wrapAccountKey(accountKey, newPassword, accessKey, bundle.iterations);
    await saveKeyBundle(accessKey, rewrapped);
    cached = { accessKey, savedAt: rewrapped.savedAt, accountKey };
    return { success: true };
}

async function deriveDomainKey(accountKey, domain) {
    const base = await crypto.subtle.importKey(
        'raw',
        accountKey,
        'HKDF',
        false,
        ['deriveKey']
    );
    return await crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new Uint8Array(0),
            info: encoder.encode(`workplan/${domain}`)
        },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

function envelopeAad(domain, accessKey) {
    return encoder.encode(`workplan-envelope-v2|${domain}|${accessKey}`);
}

export async function encryptDomainPayload(payload, { accountKey, domain, accessKey }) {
    const compressed = gzipSync(strToU8(JSON.stringify(payload)));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveDomainKey(accountKey, domain);
    const ciphertext = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv,
            additionalData: envelopeAad(domain, accessKey)
        },
        key,
        compressed
    );
    return {
        v: ENVELOPE_VERSION,
        alg: 'AES-GCM',
        kdf: 'HKDF-SHA256',
        domain,
        iv: base64FromBytes(iv),
        ciphertext: base64FromBytes(new Uint8Array(ciphertext)),
        compressed: true,
        savedAt: Date.now()
    };
}

export async function decryptDomainPayload(envelope, { accountKey, domain, accessKey }) {
    if (!envelope || envelope.v !== ENVELOPE_VERSION || !envelope.ciphertext) {
        throw new Error('云端同步数据格式无效');
    }
    if (envelope.domain && envelope.domain !== domain) {
        throw new Error('云端同步数据类型不匹配');
    }
    const key = await deriveDomainKey(accountKey, domain);
    const plain = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: bytesFromBase64(envelope.iv),
            additionalData: envelopeAad(domain, accessKey)
        },
        key,
        bytesFromBase64(envelope.ciphertext)
    );
    const bytes = new Uint8Array(plain);
    const json = envelope.compressed ? strFromU8(gunzipSync(bytes)) : decoder.decode(bytes);
    return JSON.parse(json);
}
