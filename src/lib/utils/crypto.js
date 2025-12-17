import CryptoJS from 'crypto-js';

const SALT_LENGTH = 16;
const IV_LENGTH = 16;
const KEY_SIZE = 256;
const ITERATIONS = 10000;

function generateSalt() {
    return CryptoJS.lib.WordArray.random(SALT_LENGTH).toString();
}

function generateIV() {
    return CryptoJS.lib.WordArray.random(IV_LENGTH);
}

function deriveKey(password, salt) {
    return CryptoJS.PBKDF2(password, salt, {
        keySize: KEY_SIZE / 32,
        iterations: ITERATIONS
    });
}

export function encrypt(plaintext, password) {
    if (!plaintext || !password) return null;
    try {
        const salt = generateSalt();
        const iv = generateIV();
        const key = deriveKey(password, salt);
        const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
            iv: iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });
        return salt + ':' + iv.toString() + ':' + encrypted.ciphertext.toString();
    } catch (e) {
        console.error('Encryption failed:', e);
        return null;
    }
}

export function decrypt(ciphertext, password) {
    if (!ciphertext || !password) return null;
    try {
        const parts = ciphertext.split(':');
        if (parts.length !== 3) return null;
        const salt = parts[0];
        const iv = CryptoJS.enc.Hex.parse(parts[1]);
        const encrypted = parts[2];
        const key = deriveKey(password, salt);
        const decrypted = CryptoJS.AES.decrypt(
            { ciphertext: CryptoJS.enc.Hex.parse(encrypted) },
            key,
            {
                iv: iv,
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            }
        );
        return decrypted.toString(CryptoJS.enc.Utf8);
    } catch (e) {
        console.error('Decryption failed:', e);
        return null;
    }
}

export function hashPassword(password) {
    return CryptoJS.SHA256(password).toString();
}

export function verifyPassword(password, hash) {
    return hashPassword(password) === hash;
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