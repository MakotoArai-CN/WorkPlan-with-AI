export const PROTECTION_KEY = 'workplan_vault_protection';
// Retained only to cancel pre-v2 deletion journals and prevent backup resurrection.
export const ERASE_KEY = 'workplan_protection_erase';
export const PROTECTION_ACTIONS = ['cooldown', 'disable_quick_unlock'];

export function readProtection() {
    try {
        const value = JSON.parse(localStorage.getItem(PROTECTION_KEY) || '{}');
        // A destructive v1 policy is never silently carried into the new scheme.
        if (value.version !== 2) return { version: 2, enabled: false, action: 'cooldown', failures: 0, lockedUntil: 0 };
        return {
            version: 2, enabled: value.enabled === true,
            action: PROTECTION_ACTIONS.includes(value.action) ? value.action : 'cooldown',
            failures: Math.max(0, Math.floor(Number(value.failures) || 0)),
            lockedUntil: Math.max(0, Number(value.lockedUntil) || 0)
        };
    } catch {
        return { version: 2, enabled: false, action: 'cooldown', failures: 0, lockedUntil: 0 };
    }
}

export function writeProtection(value) {
    localStorage.setItem(PROTECTION_KEY, JSON.stringify({ ...value, version: 2 }));
}

export function nextProtectionFailure(state, now = Date.now()) {
    if (!state.enabled || now < state.lockedUntil) return state;
    const failures = state.failures + 1;
    const minutes = failures === 6 ? 5 : failures === 7 ? 10 : failures >= 8 ? 30 : 0;
    return { ...state, failures, lockedUntil: minutes ? now + minutes * 60000 : 0 };
}

export function migrateLegacyProtection() {
    const state = readProtection();
    writeProtection(state);
    try {
        const old = JSON.parse(localStorage.getItem(ERASE_KEY) || 'null');
        if (old && !old.completed) {
            // Drop the cloud credentials and cancel every queued destructive action.
            localStorage.setItem(ERASE_KEY, JSON.stringify({ completed: true, canceled: true, createdAt: old.createdAt }));
        }
    } catch {
        localStorage.removeItem(ERASE_KEY);
    }
    return state;
}

// Compatibility with existing sync/UI callers: automated deletion is retired.
export function readPendingErase() { return null; }
export function cloudRecordErased() { return false; }
