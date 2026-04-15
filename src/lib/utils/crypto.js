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

function deriveKey(password, salt, iterations = ITERATIONS_NEW) {
    return CryptoJS.PBKDF2(password, salt, {
        keySize: KEY_SIZE / 32,
        iterations: iterations,
        hasher: CryptoJS.algo.SHA256
    });
}

export function encrypt(plaintext, password) {
    if (!plaintext || !password) return null;
    try {
        const salt = generateSalt();
        const iv = generateIV();
        const key = deriveKey(password, salt, ITERATIONS_NEW);
        const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
            iv: iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });
        return 'v2:' + salt + ':' + iv.toString() + ':' + encrypted.ciphertext.toString();
    } catch (e) {
        console.error('Encryption failed:', e);
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
    return !ciphertext.startsWith('v2:');
}

export function migrateEncryption(ciphertext, password) {
    if (!ciphertext || !password) return null;
    if (ciphertext.startsWith('v2:')) return ciphertext;
    
    const decrypted = decrypt(ciphertext, password);
    if (!decrypted) return null;
    
    return encrypt(decrypted, password);
}

export function hashPassword(password) {
    return CryptoJS.SHA256(password).toString();
}

export function verifyPassword(password, storedHash) {
    if (!storedHash || !password) return false;
    const parts = storedHash.split(':');
    if (parts.length === 2) {
        const [salt, hash] = parts;
        const computed = CryptoJS.PBKDF2(password, salt, {
            keySize: 256 / 32,
            iterations: ITERATIONS_OLD,
            hasher: CryptoJS.algo.SHA256
        }).toString();
        if (computed === hash) return true;
    }
    return CryptoJS.SHA256(password).toString() === storedHash;
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

export function encryptSessionData(data, masterHash) {
    if (!data || !masterHash) return null;
    try {
        const jsonStr = JSON.stringify(data);
        const encrypted = CryptoJS.AES.encrypt(jsonStr, masterHash).toString();
        return encrypted;
    } catch (e) {
        return null;
    }
}

export function decryptSessionData(encryptedData, masterHash) {
    if (!encryptedData || !masterHash) return null;
    try {
        const decrypted = CryptoJS.AES.decrypt(encryptedData, masterHash);
        const jsonStr = decrypted.toString(CryptoJS.enc.Utf8);
        return JSON.parse(jsonStr);
    } catch (e) {
        return null;
    }
}