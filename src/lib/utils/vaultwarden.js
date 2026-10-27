// Read-only Vaultwarden / Bitwarden import.
//
// This is a small Bitwarden-compatible client limited to the password import
// path: PBKDF2 accounts, password grant, /api/sync, and login ciphers. It does
// not write back to Vaultwarden and deliberately does not persist the master
// password. Argon2 accounts are rejected with an actionable message.

import { isTauriRuntime } from './runtime.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function trimBaseUrl(value) {
    const url = String(value || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) throw new Error('服务器地址必须以 http:// 或 https:// 开头');
    return url;
}

function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(String(value || '').replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function concatBytes(...arrays) {
    const total = arrays.reduce((sum, array) => sum + array.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const array of arrays) {
        out.set(array, offset);
        offset += array.length;
    }
    return out;
}

async function httpFetch(url, options = {}) {
    if (isTauriRuntime) {
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        return await tauriFetch(url, options);
    }
    return await fetch(url, options);
}

async function pbkdf2(password, salt, iterations, length = 32) {
    const key = await crypto.subtle.importKey(
        'raw',
        typeof password === 'string' ? encoder.encode(password) : password,
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: typeof salt === 'string' ? encoder.encode(salt) : salt,
            iterations,
            hash: 'SHA-256'
        },
        key,
        length * 8
    );
    return new Uint8Array(bits);
}

// Bitwarden's stretchKey uses HKDF-Expand without HKDF-Extract. WebCrypto's
// HKDF always extracts, so implement RFC 5869 expand directly over HMAC.
async function hkdfExpand(prk, info, length) {
    const hmacKey = await crypto.subtle.importKey(
        'raw',
        prk,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const infoBytes = encoder.encode(info);
    let previous = new Uint8Array(0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (let counter = 1; offset < length; counter += 1) {
        const data = concatBytes(previous, infoBytes, new Uint8Array([counter]));
        const signature = await crypto.subtle.sign('HMAC', hmacKey, data);
        previous = new Uint8Array(signature);
        const needed = Math.min(previous.length, length - offset);
        output.set(previous.subarray(0, needed), offset);
        offset += needed;
    }
    return output;
}

async function decryptEncString(value, key) {
    if (!value) return '';
    const dot = String(value).indexOf('.');
    if (dot < 0) return String(value);
    const type = Number(value.slice(0, dot));
    const parts = value.slice(dot + 1).split('|');
    const iv = base64ToBytes(parts[0]);
    const ciphertext = base64ToBytes(parts[1]);

    if (type === 0) {
        if (key.length < 32) throw new Error('Vaultwarden 密钥长度无效');
        return decoder.decode(await crypto.subtle.decrypt(
            { name: 'AES-CBC', iv },
            await crypto.subtle.importKey('raw', key.subarray(0, 32), 'AES-CBC', false, ['decrypt']),
            ciphertext
        ));
    }

    if (type === 2) {
        if (key.length < 64) throw new Error('Vaultwarden 密钥长度无效');
        const encKey = key.subarray(0, 32);
        const macKey = key.subarray(32, 64);
        const mac = base64ToBytes(parts[2]);
        const hmacKey = await crypto.subtle.importKey(
            'raw',
            macKey,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );
        const valid = await crypto.subtle.verify(
            'HMAC',
            hmacKey,
            mac,
            concatBytes(iv, ciphertext)
        );
        if (!valid) throw new Error('Vaultwarden 数据校验失败（MAC 不匹配）');
        return decoder.decode(await crypto.subtle.decrypt(
            { name: 'AES-CBC', iv },
            await crypto.subtle.importKey('raw', encKey, 'AES-CBC', false, ['decrypt']),
            ciphertext
        ));
    }

    throw new Error(`暂不支持 Vaultwarden 加密类型 ${type}`);
}

async function deriveMasterKey(password, email, kdf, iterations) {
    if (Number(kdf) !== 0) {
        throw new Error('当前仅支持 PBKDF2 的 Vaultwarden 账户；请在 Vaultwarden 中把 KDF 改为 PBKDF2 后重试（Argon2 暂未支持）');
    }
    const safeIterations = Number(iterations) || 600000;
    return await pbkdf2(password, email.toLowerCase(), safeIterations, 32);
}

async function stretchMasterKey(masterKey) {
    const encKey = await hkdfExpand(masterKey, 'enc', 32);
    const macKey = await hkdfExpand(masterKey, 'mac', 32);
    return concatBytes(encKey, macKey);
}

async function hashMasterPassword(password, masterKey) {
    const bits = await pbkdf2(password, masterKey, 1, 32);
    return bytesToBase64(bits);
}

async function requestJson(url, options) {
    const response = await httpFetch(url, options);
    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }
    if (!response.ok) {
        if (payload?.TwoFactorRequired || payload?.twoFactorRequired) {
            throw new Error('该账户开启了两步验证，暂不支持直接导入；请使用未开启 2FA 的账户或 Bitwarden API Key');
        }
        const message = payload?.error_description || payload?.message || payload?.error || text || `HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }
    return payload;
}

export async function importFromVaultwarden({ baseUrl, email, masterPassword }) {
    const server = trimBaseUrl(baseUrl);
    const normalizedEmail = String(email || '').trim();
    if (!normalizedEmail || !masterPassword) {
        throw new Error('请填写邮箱和主密码');
    }

    const prelogin = await requestJson(`${server}/identity/accounts/prelogin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: normalizedEmail })
    });
    const kdf = prelogin?.Kdf ?? prelogin?.kdf ?? 0;
    const iterations = prelogin?.KdfIterations ?? prelogin?.kdfIterations ?? 600000;

    const masterKey = await deriveMasterKey(masterPassword, normalizedEmail, kdf, iterations);
    const passwordHash = await hashMasterPassword(masterPassword, masterKey);

    const deviceIdentifier = crypto.randomUUID();
    const tokenBody = new URLSearchParams({
        grant_type: 'password',
        username: normalizedEmail,
        password: passwordHash,
        scope: 'api offline_access',
        client_id: 'web',
        deviceType: '10',
        deviceIdentifier,
        deviceName: 'WorkPlan'
    });

    const token = await requestJson(`${server}/identity/connect/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
            Accept: 'application/json'
        },
        body: tokenBody.toString()
    });

    const encryptedUserKey = token?.Key || token?.key;
    if (!encryptedUserKey) throw new Error('Vaultwarden 登录成功但没有返回密钥');
    const accessToken = token?.access_token;
    if (!accessToken) throw new Error('Vaultwarden 登录成功但没有返回 access_token');

    const stretchedKey = await stretchMasterKey(masterKey);
    const userKey = await decryptEncString(encryptedUserKey, stretchedKey);
    const userKeyBytes = base64ToBytes(userKey);
    if (userKeyBytes.length !== 32 && userKeyBytes.length !== 64) {
        throw new Error('Vaultwarden 用户密钥长度无效');
    }

    const sync = await requestJson(`${server}/api/sync`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json'
        }
    });

    const folders = new Map();
    for (const folder of sync?.folders || []) {
        try {
            folders.set(folder.id, await decryptEncString(folder.name, userKeyBytes));
        } catch {
            folders.set(folder.id, '');
        }
    }

    const orgKeys = new Map();
    for (const org of sync?.organizations || sync?.profile?.organizations || []) {
        if (!org?.id || !org?.key) continue;
        try {
            orgKeys.set(org.id, base64ToBytes(await decryptEncString(org.key, userKeyBytes)));
        } catch {
            // An unreadable organization key only means those items are skipped.
        }
    }

    const items = [];
    let skipped = 0;
    for (const cipher of sync?.ciphers || []) {
        if (!cipher || cipher.deletedDate || Number(cipher.type) !== 1) {
            skipped += 1;
            continue;
        }
        const key = cipher.organizationId ? orgKeys.get(cipher.organizationId) : userKeyBytes;
        if (!key) {
            skipped += 1;
            continue;
        }
        try {
            const title = await decryptEncString(cipher.name, key);
            const username = await decryptEncString(cipher.login?.username, key);
            const password = await decryptEncString(cipher.login?.password, key);
            const notes = await decryptEncString(cipher.notes, key);
            const totp = await decryptEncString(cipher.login?.totp, key);
            let url = '';
            for (const uri of cipher.login?.uris || []) {
                const value = await decryptEncString(uri?.uri, key);
                if (value) {
                    url = value;
                    break;
                }
            }
            items.push({
                title: title || '未命名条目',
                username,
                password,
                url,
                category: folders.get(cipher.folderId) || 'Vaultwarden',
                notes: [notes, totp ? `TOTP: ${totp}` : ''].filter(Boolean).join('\n')
            });
        } catch {
            skipped += 1;
        }
    }

    return { items, skipped, total: (sync?.ciphers || []).length };
}

export const importFromBitwarden = importFromVaultwarden;
