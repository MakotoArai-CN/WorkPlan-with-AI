import { zlibSync, unzlibSync, strToU8, strFromU8 } from 'fflate';

const PREFIX = 'WPC1:';

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
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * Compress a JSON value for localStorage. Small values stay plain JSON so the
 * prefix/base64 overhead cannot make storage larger than it was before.
 */
export function packLocalJson(value) {
    const json = JSON.stringify(value);
    try {
        const compressed = bytesToBase64(zlibSync(strToU8(json), { level: 6 }));
        const packed = PREFIX + compressed;
        return packed.length < json.length ? packed : json;
    } catch {
        return json;
    }
}

export function unpackLocalJson(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    if (!raw.startsWith(PREFIX)) return JSON.parse(raw);
    return JSON.parse(strFromU8(unzlibSync(base64ToBytes(raw.slice(PREFIX.length)))));
}

export function isPackedLocalJson(raw) {
    return typeof raw === 'string' && raw.startsWith(PREFIX);
}
