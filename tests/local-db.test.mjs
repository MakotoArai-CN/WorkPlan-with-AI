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
mock.module('@tauri-apps/api/core', () => ({
    invoke: async (cmd, args) => {
        if (cmd === 'local_db_load') return dbContent;
        if (cmd === 'local_db_save') {
            dbContent = args.content;
            writes.push(JSON.parse(args.content));
            return { path: 'C:/Users/test/.workplan/data.json', backupDir: 'C:/Users/test/.workplan/backups', exists: true, bytes: args.content.length, savedAt: Date.now() / 1000, backups: 1 };
        }
        throw new Error(`unexpected ${cmd}`);
    }
}));
mock.module('../src/lib/utils/runtime.js', () => ({ isTauriRuntime: true, isAndroidRuntime: () => false }));

const { initLocalDatabase, installLocalDatabaseMirror } = await import('../src/lib/utils/local-db.js');
const { collectLocalBackupPayload } = await import('../src/lib/utils/backup-package.js');

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    dbContent = null;
    writes = [];
});

describe('home-directory local database', () => {
    test('migrates existing localStorage into the database on first boot', async () => {
        localStorage.setItem('planpro_access_key', 'abc');
        localStorage.setItem('planpro_notes', '[]');
        const result = await initLocalDatabase();
        expect(result.migrated).toBe(true);
        expect(writes.length).toBe(1);
        expect(writes[0].format).toBe('workplan-local-db');
        expect(writes[0].keys.planpro_access_key).toBe('abc');
        expect(localStorage.getItem('planpro_db_saved_at')).toBeTruthy();
    });

    test('hydrates an empty local storage from the database and requests one reload', async () => {
        dbContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 123456,
            keys: { planpro_access_key: 'restored', planpro_notes: '[{"id":"n1"}]' }
        });
        const result = await initLocalDatabase();
        expect(result.reloaded).toBe(true);
        expect(localStorage.getItem('planpro_access_key')).toBe('restored');
        expect(localStorage.getItem('planpro_notes')).toContain('n1');
    });

    test('a lone incidental key does not block database hydration', async () => {
        dbContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 123456,
            keys: {
                planpro_access_key: 'from-db',
                planpro_tasks_local_cache: '{"tasks":[{"id":"db-task"}]}'
            }
        });
        localStorage.setItem('planpro_connector_config', '{"enabled":false}');
        const result = await initLocalDatabase();
        expect(result.reloaded).toBe(true);
        expect(localStorage.getItem('planpro_access_key')).toBe('from-db');
        expect(localStorage.getItem('planpro_tasks_local_cache')).toContain('db-task');
    });

    test('never overwrites a non-empty WebView working copy with a newer DB timestamp', async () => {
        dbContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 999999,
            keys: { planpro_access_key: 'from-db' }
        });
        localStorage.setItem('planpro_db_saved_at', '1');
        localStorage.setItem('planpro_access_key', 'local-current');
        const result = await initLocalDatabase();
        expect(result.reloaded).toBe(false);
        expect(localStorage.getItem('planpro_access_key')).toBe('local-current');
    });

    test('does not rehydrate repeatedly after the marker matches', async () => {
        dbContent = JSON.stringify({
            format: 'workplan-local-db',
            version: 1,
            savedAt: 123456,
            keys: { planpro_access_key: 'restored' }
        });
        localStorage.setItem('planpro_db_saved_at', '123456');
        localStorage.setItem('planpro_access_key', 'local-newer');
        const result = await initLocalDatabase();
        expect(result.reloaded).toBe(false);
        expect(localStorage.getItem('planpro_access_key')).toBe('local-newer');
    });

    test('memory mode backup includes notes that are no longer in WebView storage', async () => {
        localStorage.clear();
        sessionStorage.clear();
        dbContent = null;
        writes = [];
        localStorage.setItem('planpro_access_key', 'memory-backup');
        localStorage.setItem('planpro_notes', JSON.stringify([{ id: 'n1', title: '内存笔记', content: 'secret' }]));
        const migrated = await initLocalDatabase();
        expect(migrated.migrated).toBe(true);
        await installLocalDatabaseMirror();
        expect(localStorage.getItem('planpro_notes')).toBeNull();
        const payload = collectLocalBackupPayload();
        expect(payload.keys.planpro_notes).toContain('内存笔记');
        expect(payload.keys.planpro_access_key).toBe('memory-backup');
    });
});
