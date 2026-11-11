export const PROTECTION_KEY = 'workplan_vault_protection';
export const ERASE_KEY = 'workplan_protection_erase';

export function readProtection() {
    try {
        const value = JSON.parse(localStorage.getItem(PROTECTION_KEY) || '{}');
        return { enabled: value.enabled === true, failures: Math.max(0, Number(value.failures) || 0), lockedUntil: Number(value.lockedUntil) || 0 };
    } catch {
        return { enabled: false, failures: 0, lockedUntil: 0 };
    }
}

export function writeProtection(value) {
    localStorage.setItem(PROTECTION_KEY, JSON.stringify(value));
}

export function nextProtectionFailure(state, now = Date.now()) {
    if (!state.enabled || now < state.lockedUntil) return state;
    const failures = state.failures + 1;
    const minutes = failures === 6 ? 5 : failures === 7 ? 10 : failures >= 8 ? 30 : 0;
    return { ...state, failures, lockedUntil: minutes ? now + minutes * 60000 : 0 };
}

export function readPendingErase() {
    try {
        const value = JSON.parse(localStorage.getItem(ERASE_KEY) || 'null');
        return value?.completed ? null : value;
    } catch { return null; }
}

export function cloudRecordErased(key) {
    return !!readPendingErase();
}

export function eraseRecordKeys(accessKey) {
    if (!accessKey) return [];
    return [accessKey, `__workplan_key_bundle_v2__:${accessKey}`,
        ...['notes', 'vault', 'worklog'].flatMap(domain => [
            `__workplan_secure_${domain}_v1__:${accessKey}`,
            `__workplan_secure_${domain}_v2__:${accessKey}`
        ])];
}

let retrying = null;

// Keep a durable deletion journal, not vault content. Offline deletes retry on boot/online.
export function retryPendingErase() {
    if (retrying) return retrying;
    retrying = (async () => {
        const pending = readPendingErase();
        if (!pending) return;
        // A crash may have happened after journaling but before removing backups.
        if (!pending.localErased) return;
        const { deleteCloudRecord, waitForCloudWrites } = await import('../stores/tasks.js');
        await waitForCloudWrites();
        const results = await Promise.allSettled(pending.records.map(key => deleteCloudRecord(key, pending.databaseConfig)));
        const remaining = pending.records.filter((_, index) => results[index].status === 'rejected');
        const { persistEraseJournal } = await import('./local-db.js');
        await persistEraseJournal(remaining.length ? { ...pending, records: remaining } : { completed: true, createdAt: pending.createdAt });
    })().finally(() => { retrying = null; });
    return retrying;
}

export async function executeProtectionErase() {
    const { readDatabaseConfig, waitForCloudWrites } = await import('../stores/tasks.js');
    const databaseConfig = readDatabaseConfig();
    const pending = readPendingErase() || {
        records: databaseConfig.url && databaseConfig.apiKey ? eraseRecordKeys(localStorage.getItem('workplan_access_key')) : [],
        databaseConfig, createdAt: Date.now(), localErased: false
    };
    // Fence cloud reads/writes before yielding or touching the local database.
    localStorage.setItem(ERASE_KEY, JSON.stringify(pending));
    const { eraseLocalDatabase } = await import('./local-db.js');
    await eraseLocalDatabase(pending);
    const { persistEraseJournal } = await import('./local-db.js');
    await persistEraseJournal({ ...pending, localErased: true });
    await waitForCloudWrites();
    // Boot retries cloud deletion after all old in-memory stores are gone.
    location.reload();
}

export async function resumeProtectionErase() {
    const pending = readPendingErase();
    const protection = readProtection();
    if ((pending && !pending.localErased) || (protection.enabled && protection.failures > 10)) {
        await executeProtectionErase();
        return true;
    }
    return false;
}
