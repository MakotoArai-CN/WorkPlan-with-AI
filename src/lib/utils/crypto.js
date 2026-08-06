import CryptoJS from 'crypto-js';

const SALT_LENGTH = 16;
const IV_LENGTH = 16;
const KEY_SIZE = 256;
const ITERATIONS_NEW = 10000;
const ITERATIONS_OLD = 10000;

function generateSalt() {
    return CryptoJS.lib.WordArray.random(SALT_LENGTH).toString();
}

function generateIV() {
    return CryptoJS.lib.WordArray.random(IV_LENGTH);
}

// Derives 512 bits and splits them: the first 256 encrypt, the last 256 authenticate.
// AES-CBC on its own is malleable — without a MAC an attacker who can write to
// localStorage can flip ciphertext bits and have the result silently accepted.
function deriveKeyPair(password, salt, iterations = ITERATIONS_NEW) {
    const bits = CryptoJS.PBKDF2(password, salt, {
        keySize: (KEY_SIZE * 2) / 32,
        iterations: iterations,
        hasher: CryptoJS.algo.SHA256
    });
    const words = bits.words;
    return {
        encKey: CryptoJS.lib.WordArray.create(words.slice(0, KEY_SIZE / 32)),
        macKey: CryptoJS.lib.WordArray.create(words.slice(KEY_SIZE / 32))
    };
}

function deriveKey(password, salt, iterations = ITERATIONS_NEW) {
    return CryptoJS.PBKDF2(password, salt, {
        keySize: KEY_SIZE / 32,
        iterations: iterations,
        hasher: CryptoJS.algo.SHA256
    });
}

/** Authenticate the exact bytes we will parse back out (encrypt-then-MAC). */
function computeMac(macKey, saltHex, ivHex, ciphertextHex) {
    return CryptoJS.HmacSHA256(`${saltHex}:${ivHex}:${ciphertextHex}`, macKey).toString();
}

export function encrypt(plaintext, password) {
    if (!plaintext || !password) return null;
    try {
        const salt = generateSalt();
        const iv = generateIV();
        const { encKey, macKey } = deriveKeyPair(password, salt, ITERATIONS_NEW);
        const encrypted = CryptoJS.AES.encrypt(plaintext, encKey, {
            iv: iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });
        const ivHex = iv.toString();
        const ciphertextHex = encrypted.ciphertext.toString();
        const mac = computeMac(macKey, salt, ivHex, ciphertextHex);
        return `v3:${salt}:${ivHex}:${ciphertextHex}:${mac}`;
    } catch (e) {
        console.error('Encryption failed:', e);
        return null;
    }
}

/** Authenticated format: verify the MAC before touching the ciphertext. */
function decryptAuthenticated(ciphertext, password) {
    try {
        const parts = ciphertext.split(':');
        if (parts.length !== 5 || parts[0] !== 'v3') return null;
        const [, salt, ivHex, encryptedHex, mac] = parts;

        const { encKey, macKey } = deriveKeyPair(password, salt, ITERATIONS_NEW);
        const expectedMac = computeMac(macKey, salt, ivHex, encryptedHex);
        if (!timingSafeEqual(expectedMac, mac)) {
            return null;
        }

        const decrypted = CryptoJS.AES.decrypt(
            { ciphertext: CryptoJS.enc.Hex.parse(encryptedHex) },
            encKey,
            {
                iv: CryptoJS.enc.Hex.parse(ivHex),
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            }
        );
        const result = decrypted.toString(CryptoJS.enc.Utf8);
        return result && result.length > 0 ? result : null;
    } catch {
        return null;
    }
}

function decryptWithIterations(ciphertext, password, iterations) {
    try {
        const parts = ciphertext.split(':');
        let salt, ivHex, encrypted;

        if (parts.length === 4 && parts[0] === 'v2') {
            salt = parts[1];
            ivHex = parts[2];
            encrypted = parts[3];
        } else if (parts.length === 3) {
            salt = parts[0];
            ivHex = parts[1];
            encrypted = parts[2];
        } else {
            return null;
        }

        const iv = CryptoJS.enc.Hex.parse(ivHex);
        const key = deriveKey(password, salt, iterations);
        const decrypted = CryptoJS.AES.decrypt(
            { ciphertext: CryptoJS.enc.Hex.parse(encrypted) },
            key,
            {
                iv: iv,
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            }
        );
        const result = decrypted.toString(CryptoJS.enc.Utf8);
        if (result && result.length > 0) {
            return result;
        }
        return null;
    } catch (e) {
        return null;
    }
}

export function decrypt(ciphertext, password) {
    if (!ciphertext || !password) return null;

    if (ciphertext.startsWith('v3:')) {
        return decryptAuthenticated(ciphertext, password);
    }

    if (ciphertext.startsWith('v2:')) {
        return decryptWithIterations(ciphertext, password, ITERATIONS_NEW);
    }

    let result = decryptWithIterations(ciphertext, password, ITERATIONS_NEW);
    if (result) return result;

    result = decryptWithIterations(ciphertext, password, ITERATIONS_OLD);
    return result;
}

export function needsMigration(ciphertext) {
    if (!ciphertext) return false;
    return !ciphertext.startsWith('v3:');
}

export function migrateEncryption(ciphertext, password) {
    if (!ciphertext || !password) return null;
    if (ciphertext.startsWith('v3:')) return ciphertext;

    const decrypted = decrypt(ciphertext, password);
    if (!decrypted) return null;

    return encrypt(decrypted, password);
}

// --- Master password verifier -------------------------------------------------
//
// The verifier is stored in localStorage, so it must be expensive to attack offline
// and must never double as an encryption key (see encryptSessionData below).
//
// Verification uses native WebCrypto rather than CryptoJS: the pure-JS PBKDF2 needs
// ~12s for 600k iterations, while WebCrypto does the same in ~120ms, which is what
// makes an OWASP-strength iteration count affordable here.
const VERIFIER_ITERATIONS = 600000;
const VERIFIER_PREFIX = 'v2';

function toHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

function fromHex(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function randomHex(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return toHex(bytes.buffer);
}

async function pbkdf2Hex(password, saltHex, iterations) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' },
        key,
        256
    );
    return toHex(bits);
}

/** Constant-time string comparison, so verification does not leak the hash byte by byte. */
function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
        return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

/** Produce a salted, high-iteration verifier: "v2:<salt>:<iterations>:<hash>". */
export async function hashPassword(password) {
    const salt = randomHex(16);
    const hash = await pbkdf2Hex(password, salt, VERIFIER_ITERATIONS);
    return `${VERIFIER_PREFIX}:${salt}:${VERIFIER_ITERATIONS}:${hash}`;
}

export async function verifyPassword(password, storedHash) {
    if (!storedHash || !password) return false;

    const parts = String(storedHash).split(':');

    if (parts[0] === VERIFIER_PREFIX && parts.length === 4) {
        const [, salt, iterations, expected] = parts;
        const iterCount = Number(iterations);
        if (!Number.isFinite(iterCount) || iterCount <= 0) return false;
        const computed = await pbkdf2Hex(password, salt, iterCount);
        return timingSafeEqual(computed, expected);
    }

    // Legacy formats, kept so existing vaults still unlock. Both are weak; callers
    // should re-hash with hashPassword() after a successful legacy verification.
    if (parts.length === 2) {
        const [salt, hash] = parts;
        const computed = CryptoJS.PBKDF2(password, salt, {
            keySize: 256 / 32,
            iterations: ITERATIONS_OLD,
            hasher: CryptoJS.algo.SHA256
        }).toString();
        if (timingSafeEqual(computed, hash)) return true;
    }

    // Original format: unsalted single-round SHA-256.
    return timingSafeEqual(CryptoJS.SHA256(password).toString(), String(storedHash));
}

/** True when the stored verifier predates the salted high-iteration format. */
export function verifierNeedsUpgrade(storedHash) {
    if (!storedHash) return false;
    return !String(storedHash).startsWith(`${VERIFIER_PREFIX}:`);
}

export function generatePassword(length = 16, options = {}) {
    const {
        includeUppercase = true,
        includeLowercase = true,
        includeNumbers = true,
        includeSymbols = true
    } = options;
    let chars = '';
    if (includeUppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (includeLowercase) chars += 'abcdefghijklmnopqrstuvwxyz';
    if (includeNumbers) chars += '0123456789';
    if (includeSymbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';
    if (!chars) chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    const randomValues = new Uint32Array(length);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) {
        password += chars[randomValues[i] % chars.length];
    }
    return password;
}

export function generateSessionToken() {
    return CryptoJS.lib.WordArray.random(32).toString();
}

// --- Session persistence ------------------------------------------------------
//
// "Remember session" must survive a reload without leaving the master password
// recoverable from disk. Previously the session blob was encrypted with the master
// hash, which lives in localStorage — so anyone reading localStorage could decrypt
// sessionStorage and recover the master password in plaintext.
//
// Now the wrapping key is generated per session and held only in memory. It never
// touches localStorage or sessionStorage, so persisted state alone is not enough to
// unwrap the session; a reload without the in-memory key simply requires unlocking.
let sessionWrappingKey = null;

export function beginSessionWrapping() {
    sessionWrappingKey = randomHex(32);
    return sessionWrappingKey;
}

export function resumeSessionWrapping(key) {
    sessionWrappingKey = key || null;
}

export function endSessionWrapping() {
    sessionWrappingKey = null;
}

export function hasSessionWrappingKey() {
    return Boolean(sessionWrappingKey);
}

export function encryptSessionData(data) {
    if (!data || !sessionWrappingKey) return null;
    try {
        return encrypt(JSON.stringify(data), sessionWrappingKey);
    } catch {
        return null;
    }
}

export function decryptSessionData(encryptedData) {
    if (!encryptedData || !sessionWrappingKey) return null;
    try {
        const jsonStr = decrypt(encryptedData, sessionWrappingKey);
        return jsonStr ? JSON.parse(jsonStr) : null;
    } catch {
        return null;
    }
}