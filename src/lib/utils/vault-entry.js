import CryptoJS from 'crypto-js';

// One expensive KDF pass per unlock; per-entry encryption is fast AES-CBC/HMAC.
// WebCrypto PBKDF2 at 600k is both stronger and faster than CryptoJS's repeated
// 10k-per-field derivation, so viewing/copying a password stays instant.
const META_KEY = 'workplan_vault_meta';
const FORMAT = 'v4';
const ITERATIONS = 600000;
const MAX_ITERATIONS = 2000000;
const SALT_BYTES = 16;

let cached = null;

function randomHex(bytes) {
    return CryptoJS.lib.WordArray.random(bytes).toString();
}

function hexToBytes(hex) {
    const clean = String(hex || '');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}

export function validateVaultMeta(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta) || meta.version !== 2
        || typeof meta.salt !== 'string' || !/^[0-9a-f]{32}$/i.test(meta.salt)
        || !Number.isInteger(meta.iterations) || meta.iterations < ITERATIONS || meta.iterations > MAX_ITERATIONS) {
        throw new Error('密码库密钥参数损坏或不受支持，请恢复原始元数据或备份；未改动密码数据');
    }
    return meta;
}

function readMeta() {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(META_KEY);
    if (raw === null) return null;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('密码库密钥参数不是有效JSON，未改动密码数据');
    }
    return validateVaultMeta(parsed);
}

function writeMeta(meta) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export function getVaultMeta() {
    return readMeta();
}

export function resetVaultKeyCache() {
    cached = null;
}

export function rotateVaultMeta() {
    const meta = { version: 2, salt: randomHex(SALT_BYTES), iterations: ITERATIONS, createdAt: new Date().toISOString() };
    writeMeta(meta);
    cached = null;
    return meta;
}

async function deriveKeyPair(secret, meta) {
    const material = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(String(secret)),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: hexToBytes(meta.salt),
            iterations: meta.iterations,
            hash: 'SHA-256'
        },
        material,
        512
    );
    const words = CryptoJS.lib.WordArray.create(new Uint8Array(bits));
    return {
        encKey: CryptoJS.lib.WordArray.create(words.words.slice(0, 8)),
        macKey: CryptoJS.lib.WordArray.create(words.words.slice(8, 16))
    };
}

export async function ensureVaultEntryKey(secret, saltOverride = '') {
    if (!secret) return null;
    let meta = readMeta();
    if (saltOverride !== '' && (typeof saltOverride !== 'string' || !/^[0-9a-f]{32}$/i.test(saltOverride))) {
        throw new Error('密码条目的密钥盐无效，未改动密码数据');
    }
    if (saltOverride && meta?.salt !== saltOverride) {
        // Recovery may only have the encrypted entries, so every entry carries
        // the public KDF salt. Persist it again for future unlocks.
        meta = { version: 2, salt: saltOverride, iterations: ITERATIONS, createdAt: new Date().toISOString() };
        writeMeta(meta);
    } else if (!meta) {
        meta = rotateVaultMeta();
    }
    if (cached && cached.secret === secret && cached.salt === meta.salt && cached.iterations === meta.iterations) {
        return cached.key;
    }
    const key = await deriveKeyPair(secret, meta);
    cached = { secret, salt: meta.salt, iterations: meta.iterations, key };
    return key;
}

function macFor(macKey, ivHex, ciphertextHex) {
    return CryptoJS.HmacSHA256(`${FORMAT}:${ivHex}:${ciphertextHex}`, macKey).toString();
}

export function encryptVaultPayload(plaintext, key) {
    if (!key) return null;
    try {
        const iv = CryptoJS.lib.WordArray.random(16);
        const encrypted = CryptoJS.AES.encrypt(String(plaintext), key.encKey, {
            iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });
        const ivHex = iv.toString();
        const ciphertextHex = encrypted.ciphertext.toString();
        return `${FORMAT}:${ivHex}:${ciphertextHex}:${macFor(key.macKey, ivHex, ciphertextHex)}`;
    } catch {
        return null;
    }
}

export function decryptVaultPayload(value, key) {
    if (!key || typeof value !== 'string') return null;
    try {
        const parts = value.split(':');
        if (parts.length !== 4 || parts[0] !== FORMAT) return null;
        const [, ivHex, ciphertextHex, mac] = parts;
        const expected = macFor(key.macKey, ivHex, ciphertextHex);
        if (expected.length !== mac.length) return null;
        let diff = 0;
        for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
        if (diff !== 0) return null;
        const decrypted = CryptoJS.AES.decrypt(
            { ciphertext: CryptoJS.enc.Hex.parse(ciphertextHex) },
            key.encKey,
            { iv: CryptoJS.enc.Hex.parse(ivHex), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
        );
        const result = decrypted.toString(CryptoJS.enc.Utf8);
        return result && result.length > 0 ? result : null;
    } catch {
        return null;
    }
}

export function encryptVaultEntryFields(fields, key) {
    return encryptVaultPayload(JSON.stringify(fields), key);
}

export function decryptVaultEntryFields(value, key) {
    const plain = decryptVaultPayload(value, key);
    if (!plain) return null;
    try {
        const parsed = JSON.parse(plain);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

export { ITERATIONS as VAULT_KDF_ITERATIONS };
