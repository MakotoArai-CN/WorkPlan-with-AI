import { getLocalDatabaseKeys, replaceLocalDatabaseKeys } from './local-db.js';

const BACKUP_FORMAT = 'workplan-secure-backup';
const BACKUP_DATA_FORMAT = 'workplan-backup-data';
const BACKUP_VERSION = 1;
const BACKUP_PREFIX = 'planpro_';
const EXCLUDED_KEYS = new Set(['planpro_passwords_session', 'planpro_login_tip_index']);
// Binds the package to this application. It is combined with the user's backup
// password before PBKDF2, so a raw JSON dump cannot be opened by another app.
const APPLICATION_SECRET = 'WorkPlan::LocalVault::Backup::v1';

function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function deriveBackupKey(password, salt, iterations) {
    const material = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(`${APPLICATION_SECRET}\u0000${password}`),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export function collectLocalBackupPayload() {
    if (typeof localStorage === 'undefined') {
        throw new Error('当前环境不支持本地备份');
    }
    const keys = {};
    // In desktop memory mode the browser's localStorage only contains a small
    // marker; the real notes/tasks/passwords live in the local DB memory map.
    for (const [key, value] of Object.entries(getLocalDatabaseKeys())) {
        if (!key.startsWith(BACKUP_PREFIX) || EXCLUDED_KEYS.has(key)) continue;
        if (typeof value === 'string') keys[key] = value;
    }
    return {
        format: BACKUP_DATA_FORMAT,
        version: BACKUP_VERSION,
        capturedAt: new Date().toISOString(),
        appVersion: typeof __WORKPLAN_VERSION__ !== 'undefined' ? __WORKPLAN_VERSION__ : '0.0.0',
        keys
    };
}

export function validateBackupData(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('备份内容格式不正确');
    if (payload.format !== BACKUP_DATA_FORMAT) throw new Error('不是 WorkPlan 数据备份');
    if (!payload.keys || typeof payload.keys !== 'object' || Array.isArray(payload.keys)) {
        throw new Error('备份内容缺少数据');
    }
    const keys = {};
    for (const [key, value] of Object.entries(payload.keys)) {
        if (!key.startsWith(BACKUP_PREFIX) || EXCLUDED_KEYS.has(key)) continue;
        if (typeof value !== 'string') throw new Error(`备份字段格式不正确：${key}`);
        keys[key] = value;
    }
    if (!Object.keys(keys).length) throw new Error('备份内容为空');
    return keys;
}

export async function applyLocalBackupPayload(payload) {
    const keys = validateBackupData(payload);
    if (typeof localStorage === 'undefined') throw new Error('当前环境不支持本地恢复');
    return replaceLocalDatabaseKeys(keys);
}

export async function createEncryptedBackup(payload, password) {
    if (!password || String(password).length < 8) throw new Error('备份主密码至少需要 8 位');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const iterations = 210000;
    const key = await deriveBackupKey(String(password), salt, iterations);
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(JSON.stringify(payload))
    );
    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        app: 'WorkPlan Cloud',
        createdAt: new Date().toISOString(),
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(salt) },
        cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
        payload: bytesToBase64(new Uint8Array(ciphertext))
    };
}

export function isEncryptedBackup(value) {
    return Boolean(value && typeof value === 'object' && value.format === BACKUP_FORMAT);
}

export async function openEncryptedBackup(packageValue, password) {
    if (!isEncryptedBackup(packageValue)) throw new Error('不是 WorkPlan 加密备份包');
    if (Number(packageValue.version) > BACKUP_VERSION) throw new Error('备份包版本过高，请升级应用');
    try {
        const salt = base64ToBytes(packageValue.kdf?.salt || '');
        const iv = base64ToBytes(packageValue.cipher?.iv || '');
        const iterations = Number(packageValue.kdf?.iterations) || 210000;
        const key = await deriveBackupKey(String(password || ''), salt, iterations);
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            base64ToBytes(packageValue.payload || '')
        );
        const payload = JSON.parse(new TextDecoder().decode(plaintext));
        validateBackupData(payload);
        return payload;
    } catch {
        throw new Error('主密码错误，或备份包已损坏');
    }
}

export function backupFileName(date = new Date()) {
    const stamp = date.toISOString().slice(0, 10);
    return `WorkPlan_Backup_${stamp}.wpb`;
}
