const STASH_PREFIX = 'planpro_account_stash::';
const SCOPED_KEYS = [
    'planpro_notes',
    'planpro_passwords',
    'planpro_master_hash',
    'planpro_passwords_settings',
    'planpro_passwords_session',
    'planpro_ai_chat_sessions',
    'planpro_ai_chat_history',
    'planpro_connector_config',
    'planpro_tasks_local_cache'
];

function readSettings() {
    try {
        return JSON.parse(localStorage.getItem('planpro_system_settings') || '{}');
    } catch {
        return {};
    }
}

function writeSettings(settings) {
    localStorage.setItem('planpro_system_settings', JSON.stringify(settings));
}

/**
 * Account-scoped data is kept in fixed localStorage keys for compatibility.
 * Before switching accounts we move it into a per-access-key stash, so the
 * next account cannot see or sync another account's notes/passwords/worklog.
 */
export function stashCurrentAccount(accessKey) {
    if (!accessKey || typeof localStorage === 'undefined') return false;
    const data = { version: 1, savedAt: new Date().toISOString(), keys: {} };
    for (const key of SCOPED_KEYS) {
        const value = localStorage.getItem(key);
        if (typeof value === 'string') data.keys[key] = value;
    }
    const settings = readSettings();
    if (settings.overtimeConfig) {
        data.overtimeConfig = settings.overtimeConfig;
        delete settings.overtimeConfig;
        writeSettings(settings);
    }
    localStorage.setItem(`${STASH_PREFIX}${accessKey}`, JSON.stringify(data));
    return true;
}

export function clearAccountScopedData() {
    if (typeof localStorage === 'undefined') return;
    for (const key of SCOPED_KEYS) localStorage.removeItem(key);
    try {
        sessionStorage.removeItem('planpro_passwords_session');
    } catch {
        // sessionStorage may be unavailable in restricted WebViews.
    }
    const settings = readSettings();
    if (settings.overtimeConfig) {
        delete settings.overtimeConfig;
        writeSettings(settings);
    }
}

export function restoreAccountData(accessKey) {
    if (!accessKey || typeof localStorage === 'undefined') return false;
    let raw;
    try {
        raw = localStorage.getItem(`${STASH_PREFIX}${accessKey}`);
    } catch {
        return false;
    }
    if (!raw) return false;
    try {
        const data = JSON.parse(raw);
        if (data?.keys && typeof data.keys === 'object') {
            for (const [key, value] of Object.entries(data.keys)) {
                if (SCOPED_KEYS.includes(key) && typeof value === 'string') {
                    localStorage.setItem(key, value);
                }
            }
        }
        if (data?.overtimeConfig) {
            const settings = readSettings();
            settings.overtimeConfig = data.overtimeConfig;
            writeSettings(settings);
        }
        return true;
    } catch {
        return false;
    }
}

export function clearAccountStash(accessKey) {
    if (!accessKey || typeof localStorage === 'undefined') return;
    localStorage.removeItem(`${STASH_PREFIX}${accessKey}`);
}
