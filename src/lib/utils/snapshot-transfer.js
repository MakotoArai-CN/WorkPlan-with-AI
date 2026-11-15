const CHUNK_UNITS = 16 * 1024;
const MAX_UNITS = 64 * 1024 * 1024;
const SESSION_KEY = 'workplan_snapshot_transfer';

function rememberedTransfer() {
    try {
        const id = globalThis.sessionStorage?.getItem(SESSION_KEY);
        return /^[0-9a-f]{32}$/.test(id || '') ? id : null;
    } catch { return null; }
}

function rememberTransfer(id) {
    try { globalThis.sessionStorage?.setItem(SESSION_KEY, id); } catch {}
}

function forgetTransfer(id) {
    try {
        if (globalThis.sessionStorage?.getItem(SESSION_KEY) === id) {
            globalThis.sessionStorage.removeItem(SESSION_KEY);
        }
    } catch {}
}

function chunkEnd(value, offset) {
    let end = Math.min(value.length, offset + CHUNK_UNITS);
    // JSON/Rust strings cannot carry a split UTF-16 surrogate pair.
    const code = value.charCodeAt(end - 1);
    if (end < value.length && code >= 0xd800 && code <= 0xdbff) end--;
    return end;
}

export async function saveSnapshotTransfer(snapshot, invoke, { signal } = {}) {
    const entries = Object.entries(snapshot.keys);
    const units = entries.reduce((sum, [key, value]) => sum + key.length + value.length, 0);
    if (units > MAX_UNITS) throw new Error('Snapshot exceeds 64MB');
    const check = () => {
        if (signal?.aborted) throw new Error('Snapshot transfer canceled');
    };
    check();
    const { default: CryptoJS } = await import('crypto-js');
    const hash = CryptoJS.algo.SHA256.create();
    const encoder = new TextEncoder();
    const number = value => {
        const bytes = new Uint8Array(8);
        new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
        return CryptoJS.lib.WordArray.create(bytes);
    };
    let id;
    const abort = () => {
        if (id) void invoke('local_db_transfer_abort', { id }).catch(() => {});
    };
    try {
        check();
        const abandoned = rememberedTransfer();
        if (abandoned) {
            await invoke('local_db_transfer_abort', { id: abandoned });
            forgetTransfer(abandoned);
            check();
        }
        id = await invoke('local_db_transfer_begin', { savedAt: snapshot.savedAt, entries: entries.length, units });
        rememberTransfer(id);
        signal?.addEventListener('abort', abort, { once: true });
        for (let index = 0; index < entries.length; index++) {
            const [key, value] = entries[index];
            const keyBytes = encoder.encode(key);
            hash.update(number(keyBytes.length));
            hash.update(CryptoJS.lib.WordArray.create(keyBytes));
            hash.update(number(value.length));
            let offset = 0;
            do {
                check();
                const end = chunkEnd(value, offset);
                const data = value.slice(offset, end);
                hash.update(CryptoJS.lib.WordArray.create(encoder.encode(data)));
                await invoke('local_db_transfer_append', { id, index, key, offset, length: value.length, data, last: end === value.length });
                offset = end;
                // IPC promises may resolve in one microtask turn on desktop.
                // Explicitly yield so hashing/transmission cannot starve input.
                await new Promise(resolve => setTimeout(resolve, 0));
            } while (offset < value.length);
        }
        check();
        const result = await invoke('local_db_transfer_commit', { id, digest: hash.finalize().toString() });
        forgetTransfer(id);
        return result;
    } catch (error) {
        if (id) {
            try {
                await invoke('local_db_transfer_abort', { id });
                forgetTransfer(id);
            } catch {}
        }
        throw error;
    } finally {
        signal?.removeEventListener('abort', abort);
    }
}

export function needsSnapshotTransfer(keys) {
    let units = 0;
    for (const [key, value] of Object.entries(keys)) {
        // Very large legacy key names retain the existing direct IPC path.
        if (key.length > CHUNK_UNITS) return false;
        units += key.length + value.length;
    }
    return units > 64 * 1024;
}
