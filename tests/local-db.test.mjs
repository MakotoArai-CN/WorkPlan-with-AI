import { describe, test, expect, beforeEach, mock } from 'bun:test';

function createStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        clear: () => map.clear(),
        key: (i) => [...map.keys()][i],
        get length() { return map.size; }
    };
}
globalThis.localStorage = createStorage();
globalThis.sessionStorage = createStorage();
globalThis.window = globalThis;

let dbContent = null;
let writes = [];
let recoverContent = null;
mock.module('@tauri-apps/api/core', () => ({
    invoke: async (cmd, args) => {
        if (cmd === 'local_db_load') return dbContent;
        if (cmd === 'local_db_recover') return recoverContent;
        if (cmd === 'local_db_save') {
            dbContent = args.content;
            writes.push(JSON.parse(args.content));
            return { path: 'C:/Users/test/.workplan/data.json', backupDir: 'C:/Users/test/.workplan/backups', exists: true, bytes: args.content.length, savedAt: Date.now() / 1000, backups: 1 };
        }
        throw new Error(`unexpected ${cmd}`);
    }
}));
mock.module('../src/lib/utils/runtime.js', () => ({ isTauriRuntime: true, isAndroidRuntime: () => false }));

const { initLocalDatabase, installLocalDatabaseMirror, flushLocalDatabase } = await import('../src/lib/utils/local-db.js');
const { collectLocalBackupPayload } = await import('../src/lib/utils/backup-package.js');

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    dbContent = null;
    writes = [];
    recoverContent = null;
});

describe('home-directory local database', () => {
    test('migrates existing localStorage into the database on first boot', async () => {
        localStorage.setItem('workplan_access_key', 'abc');
        localStorage.setItem('workplan_notes', '[]');
        const result = await initLocalDatabase();
        expect(result.migrated).toBe(true);
        expect(writes.length).toBe(1);
        expect(writes[0].format).toBe('workplan-local-db');
        expect(writes[0].keys.workplan_access_key).toBe('abc');
        expect(localStorage.getItem('workplan_db_saved_at')).toBeTruthy();
    });

    test('hydrates an empty local storage from the database and requests one reload', async () => {
        dbContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 123456,
            keys: { workplan_access_key: 'restored', workplan_notes: '[{"id":"n1"}]' }
        });
        const result = await initLocalDatabase();
        expect(result.reloaded).toBe(true);
        expect(localStorage.getItem('workplan_access_key')).toBe('restored');
        expect(localStorage.getItem('workplan_notes')).toContain('n1');
    });

    test('a lone incidental key does not block database hydration', async () => {
        dbContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 123456,
            keys: {
                workplan_access_key: 'from-db',
                workplan_tasks_local_cache: '{"tasks":[{"id":"db-task"}]}'
            }
        });
        localStorage.setItem('workplan_connector_config', '{"enabled":false}');
        const result = await initLocalDatabase();
        expect(result.reloaded).toBe(true);
        expect(localStorage.getItem('workplan_access_key')).toBe('from-db');
        expect(localStorage.getItem('workplan_tasks_local_cache')).toContain('db-task');
    });

    test('never overwrites a non-empty WebView working copy with a newer DB timestamp', async () => {
        dbContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 999999,
            keys: { workplan_access_key: 'from-db' }
        });
        localStorage.setItem('workplan_db_saved_at', '1');
        localStorage.setItem('workplan_access_key', 'local-current');
        const result = await initLocalDatabase();
        expect(result.reloaded).toBe(false);
        expect(localStorage.getItem('workplan_access_key')).toBe('local-current');
    });

    test('does not rehydrate repeatedly after the marker matches', async () => {
        dbContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 123456,
            keys: { workplan_access_key: 'restored' }
        });
        localStorage.setItem('workplan_db_saved_at', '123456');
        localStorage.setItem('workplan_access_key', 'local-newer');
        const result = await initLocalDatabase();
        expect(result.reloaded).toBe(false);
        expect(localStorage.getItem('workplan_access_key')).toBe('local-newer');
    });

    test('logged-out snapshot without an access key does not reload on every boot', async () => {
        // Reproduces the logout loop: the database keeps settings but no access
        // key, so the WebView copy never becomes a "working copy" again.
        localStorage.clear();
        sessionStorage.clear();
        dbContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 111,
            keys: {
                workplan_system_settings: '{"theme":"dark"}',
                'workplan_account_stash::old': '{"version":1,"keys":{}}'
            }
        });
        const first = await initLocalDatabase();
        expect(first.reloaded).toBe(true);
        // The reloaded app re-reads the same snapshot; it must not loop.
        const second = await initLocalDatabase();
        expect(second.reloaded).toBe(false);
        expect(second.applied).toBe(0);
    });

    test('an already-applied snapshot reports zero changes even without a session flag', async () => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('workplan_system_settings', '{"theme":"dark"}');
        dbContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 222,
            keys: { workplan_system_settings: '{"theme":"dark"}' }
        });
        const result = await initLocalDatabase();
        expect(result.reloaded).toBe(false);
        expect(result.applied).toBe(0);
    });

    test('flushing persists a fresh access key instead of waiting for the debounce', async () => {
        // Mirrors the login flow: write the key, flush, then reload.
        localStorage.setItem('workplan_access_key', 'fresh-login');
        const before = writes.length;
        await flushLocalDatabase();
        expect(writes.length).toBe(before + 1);
        expect(writes.at(-1).keys.workplan_access_key).toBe('fresh-login');
    });

    test('a legacy planpro_ snapshot hydrates into workplan_ keys', async () => {
        // Regression: after the key rename, the old snapshot was filtered out
        // by the prefix check and the account vanished behind the login screen.
        dbContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 777,
            keys: {
                planpro_access_key: 'user_legacy',
                planpro_notes: '[{"id":"n1","title":"旧笔记"}]',
                planpro_system_settings: '{"theme":"dark"}'
            }
        });
        const first = await initLocalDatabase();
        expect(first.reloaded).toBe(true);
        expect(localStorage.getItem('workplan_access_key')).toBe('user_legacy');
        expect(localStorage.getItem('workplan_notes')).toContain('旧笔记');
        expect(localStorage.getItem('planpro_access_key')).toBeNull();
        // Next boot must not loop: the normalised keys are a working copy.
        const second = await initLocalDatabase();
        expect(second.reloaded).toBe(false);
        expect(localStorage.getItem('workplan_access_key')).toBe('user_legacy');
    });

    test('new workplan_ keys win over legacy planpro_ keys in one snapshot', async () => {
        dbContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 888,
            keys: {
                planpro_access_key: 'old_account',
                workplan_access_key: 'current_account'
            }
        });
        await initLocalDatabase();
        expect(localStorage.getItem('workplan_access_key')).toBe('current_account');
    });

    test('recovers the account from a backup when the live snapshot is empty', async () => {
        // Only incidental keys survived the buggy flush.
        dbContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 999,
            keys: {
                workplan_login_tip_index: '3',
                workplan_connector_config: '{}'
            }
        });
        recoverContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 500,
            keys: {
                planpro_access_key: 'recovered_account',
                planpro_tasks_local_cache: '{"accessKey":"recovered_account","tasks":[]}',
                planpro_notes: '[{"id":"n2"}]'
            }
        });
        const result = await initLocalDatabase();
        expect(result.reloaded).toBe(true);
        expect(localStorage.getItem('workplan_access_key')).toBe('recovered_account');
        expect(localStorage.getItem('workplan_notes')).toContain('n2');
    });

    test('a deliberate logout is not overwritten by backup recovery', async () => {
        // Logged-out snapshots still hold stashed account data, so they count
        // as business data and must not trigger a resurrection of the account.
        dbContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 1000,
            keys: {
                workplan_system_settings: '{"theme":"auto"}',
                'workplan_account_stash::old_key': '{"version":1,"keys":{}}'
            }
        });
        recoverContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 400,
            keys: { planpro_access_key: 'should_not_come_back' }
        });
        await initLocalDatabase();
        expect(localStorage.getItem('workplan_access_key')).toBeNull();
    });

    test('memory mode backup includes notes that are no longer in WebView storage', async () => {
        localStorage.clear();
        sessionStorage.clear();
        dbContent = null;
        writes = [];
        localStorage.setItem('workplan_access_key', 'memory-backup');
        localStorage.setItem('workplan_notes', JSON.stringify([{ id: 'n1', title: '内存笔记', content: 'secret' }]));
        const migrated = await initLocalDatabase();
        expect(migrated.migrated).toBe(true);
        await installLocalDatabaseMirror();
        expect(localStorage.getItem('workplan_notes')).toBeNull();
        const payload = collectLocalBackupPayload();
        expect(payload.keys.workplan_notes).toContain('内存笔记');
        expect(payload.keys.workplan_access_key).toBe('memory-backup');
    });
});
