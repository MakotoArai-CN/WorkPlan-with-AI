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

const { initLocalDatabase } = await import('../src/lib/utils/local-db.js');

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
});
