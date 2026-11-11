import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

function runIsolated(body) {
    const result = Bun.spawnSync([process.execPath, '--eval', `
        import assert from 'node:assert/strict';
        import { mock } from 'bun:test';
        const disk = new Map();
        class TestStorage {
            constructor(values = new Map()) { this.values = values; }
            getItem(key) { return this.values.get(String(key)) ?? null; }
            setItem(key, value) { this.values.set(String(key), String(value)); }
            removeItem(key) { this.values.delete(String(key)); }
            clear() { this.values.clear(); }
            key(index) { return [...this.values.keys()][index] ?? null; }
            get length() { return this.values.size; }
        }
        globalThis.Storage = TestStorage;
        globalThis.localStorage = new TestStorage(disk);
        globalThis.sessionStorage = new TestStorage();
        globalThis.window = { localStorage, addEventListener() {} };
        globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
        let currentSnapshot = null;
        let restoredSnapshot = null;
        let failSaves = false;
        const writes = [];
        const restoreRequests = [];
        mock.module('@tauri-apps/api/core', () => ({ invoke: async (command, args) => {
            if (command === 'local_db_load') return currentSnapshot;
            if (command === 'local_db_recover') return null;
            if (command === 'local_db_restore') {
                restoreRequests.push(args);
                currentSnapshot = restoredSnapshot;
                return restoredSnapshot;
            }
            if (command === 'local_db_save') {
                if (failSaves) throw new Error('synthetic write failure');
                currentSnapshot = args.content;
                writes.push(JSON.parse(args.content));
                return {};
            }
            if (command === 'vault_verify_master') {
                const { verifyPassword } = await import('./src/lib/utils/crypto.js');
                const verifier = JSON.parse(currentSnapshot).keys.workplan_master_hash;
                return { valid: await verifyPassword(args.password, verifier), attempted: true, retryAfterMs: 0 };
            }
            throw new Error('Unexpected command: ' + command);
        } }));
        mock.module('./src/lib/utils/runtime.js', () => ({ isTauriRuntime: true, isAndroidRuntime: () => false }));
        const db = await import('./src/lib/utils/local-db.js');
        function snapshot(keys) {
            return JSON.stringify({ format: 'workplan-local-db', version: 1, keys });
        }
        ${body}
    `], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
}

test('legacy-only WebView data survives first-boot migration and memory activation', () => {
    runIsolated(`
        localStorage.setItem('planpro_access_key', 'legacy-account');
        localStorage.setItem('planpro_notes', '[{"id":"legacy-note"}]');
        const result = await db.initLocalDatabase();
        assert.equal(result.migrated, true);
        assert.equal(localStorage.getItem('workplan_access_key'), 'legacy-account');
        assert.equal(localStorage.getItem('workplan_notes'), '[{"id":"legacy-note"}]');
        await db.installLocalDatabaseMirror();
        assert.equal(localStorage.getItem('workplan_access_key'), 'legacy-account');
        assert.equal(localStorage.getItem('workplan_notes'), '[{"id":"legacy-note"}]');
        assert.equal(db.getLocalDatabaseKeys().workplan_access_key, 'legacy-account');
        assert.ok(writes.length > 0);
        assert.ok(writes.every(write => write.keys.workplan_access_key === 'legacy-account'));
        assert.equal(disk.has('planpro_access_key'), false);
        assert.equal(disk.has('planpro_notes'), false);
        assert.equal(disk.has('workplan_access_key'), false);
    `);
});

for (const legacyFirst of [true, false]) {
    test(`modern WebView keys win regardless of storage insertion order (${legacyFirst})`, () => {
        runIsolated(`
            const oldKeys = [['planpro_access_key', 'old-account'], ['planpro_notes', 'old-notes']];
            const newKeys = [['workplan_access_key', 'current-account'], ['workplan_notes', 'current-notes']];
            for (const [key, value] of ${legacyFirst} ? [...oldKeys, ...newKeys] : [...newKeys, ...oldKeys]) {
                localStorage.setItem(key, value);
            }
            assert.equal(db.getLocalDatabaseKeys().workplan_access_key, 'current-account');
            assert.equal(db.getLocalDatabaseKeys().workplan_notes, 'current-notes');
            await db.initLocalDatabase();
            await db.installLocalDatabaseMirror();
            assert.equal(localStorage.getItem('workplan_access_key'), 'current-account');
            assert.equal(localStorage.getItem('workplan_notes'), 'current-notes');
            assert.ok(writes.every(write => write.keys.workplan_access_key === 'current-account'));
        `);
    });
}

test('a legacy WebView SHA verifier and v3 vault survive migration, unlock and reload', () => {
    runIsolated(`
        const CryptoJS = (await import('crypto-js')).default;
        const { encrypt } = await import('./src/lib/utils/crypto.js');
        const master = 'synthetic legacy master phrase';
        const verifier = CryptoJS.SHA256(master).toString();
        const ciphertext = encrypt('synthetic legacy stored secret', master);
        const vault = JSON.stringify([{ id: 'legacy-entry', title: 'Legacy title', username: 'legacy-user',
            password: ciphertext, notes: 'Legacy note', category: 'Legacy category' }]);
        localStorage.setItem('planpro_access_key', 'legacy-vault-account');
        localStorage.setItem('planpro_master_hash', verifier);
        localStorage.setItem('planpro_passwords', vault);
        await db.initLocalDatabase();
        await db.installLocalDatabaseMirror();
        assert.equal(localStorage.getItem('workplan_master_hash'), verifier);
        assert.equal(localStorage.getItem('workplan_passwords'), vault);
        assert.equal(writes.at(-1).keys.workplan_master_hash, verifier);
        assert.equal(writes.at(-1).keys.workplan_passwords, vault);
        const { passwordsStore } = await import('./src/lib/stores/passwords.js');
        const { get } = await import('svelte/store');
        passwordsStore.load();
        assert.equal(await passwordsStore.unlock(master), true);
        assert.equal(get(passwordsStore).passwords[0].title, 'Legacy title');
        assert.equal(passwordsStore.decryptPassword(get(passwordsStore).passwords[0].password), 'synthetic legacy stored secret');
        await new Promise(resolve => setTimeout(resolve, 350));
        await db.flushLocalDatabase();
        const stored = JSON.parse(writes.at(-1).keys.workplan_passwords)[0];
        assert.ok(stored.password.startsWith('v4:'));
        assert.ok(stored.meta.startsWith('v4:'));
        assert.equal(stored.title, undefined);
        assert.ok(writes.at(-1).keys.workplan_master_hash.startsWith('v2:'));
        passwordsStore.lock();
        passwordsStore.load();
        assert.equal(await passwordsStore.unlock(master), true);
        const reloaded = get(passwordsStore).passwords[0];
        assert.equal(reloaded.title, 'Legacy title');
        assert.equal(reloaded.username, 'legacy-user');
        assert.equal(reloaded.notes, 'Legacy note');
        assert.equal(passwordsStore.decryptPassword(reloaded.password), 'synthetic legacy stored secret');
        assert.equal(disk.has('planpro_master_hash'), false);
        assert.equal(disk.has('workplan_passwords'), false);
        passwordsStore.lock();
        await db.flushLocalDatabase();
    `);
});

test('legacy WebView working copy wins over an older readable database', () => {
    runIsolated(`
        currentSnapshot = snapshot({ workplan_access_key: 'database-account', workplan_notes: 'database-notes' });
        localStorage.setItem('planpro_access_key', 'webview-account');
        localStorage.setItem('planpro_notes', 'webview-notes');
        await db.initLocalDatabase();
        assert.equal(localStorage.getItem('workplan_access_key'), 'webview-account');
        await db.installLocalDatabaseMirror();
        assert.equal(localStorage.getItem('workplan_notes'), 'webview-notes');
        assert.equal(writes.at(-1).keys.workplan_access_key, 'webview-account');
    `);
});

test('legacy notes without an account survive an empty database boot', () => {
    runIsolated(`
        localStorage.setItem('planpro_notes', 'standalone-notes');
        await db.initLocalDatabase();
        assert.equal(localStorage.getItem('workplan_notes'), 'standalone-notes');
        await db.installLocalDatabaseMirror();
        assert.equal(localStorage.getItem('workplan_notes'), 'standalone-notes');
        assert.equal(writes.at(-1).keys.workplan_notes, 'standalone-notes');
    `);
});

test('a failed initial mirror flush retains both legacy and normalized working copies', () => {
    runIsolated(`
        currentSnapshot = snapshot({ workplan_access_key: 'database-account' });
        localStorage.setItem('planpro_access_key', 'webview-account');
        localStorage.setItem('planpro_notes', 'webview-notes');
        await db.initLocalDatabase();
        failSaves = true;
        console.warn = () => {};
        await db.installLocalDatabaseMirror();
        assert.equal(disk.get('planpro_access_key'), 'webview-account');
        assert.equal(disk.get('workplan_access_key'), 'webview-account');
        assert.equal(db.getLocalDatabaseKeys().workplan_notes, 'webview-notes');
        assert.equal(writes.length, 0);
        failSaves = false;
        await db.installLocalDatabaseMirror();
        assert.equal(localStorage.getItem('workplan_access_key'), 'webview-account');
        assert.equal(writes.at(-1).keys.workplan_notes, 'webview-notes');
    `);
});

test('an erase journal also removes legacy WebView keys before memory activation', () => {
    runIsolated(`
        const journal = JSON.stringify({ localErased: true, records: ['old-account'] });
        currentSnapshot = snapshot({ workplan_protection_erase: journal });
        localStorage.setItem('planpro_access_key', 'stale-account');
        localStorage.setItem('planpro_notes', 'stale-notes');
        await db.initLocalDatabase();
        await db.installLocalDatabaseMirror();
        assert.equal(localStorage.getItem('workplan_access_key'), null);
        assert.equal(localStorage.getItem('workplan_notes'), null);
        assert.equal(disk.has('planpro_access_key'), false);
        assert.equal(db.getLocalDatabaseKeys().workplan_protection_erase, journal);
        assert.ok(writes.every(write => !('workplan_access_key' in write.keys)));
    `);
});

test('replacement normalizes legacy keys and removes stale values in both namespaces', () => {
    runIsolated(`
        localStorage.setItem('planpro_access_key', 'stale-account');
        localStorage.setItem('workplan_notes', 'stale-notes');
        localStorage.setItem('unrelated', 'keep-me');
        const count = await db.replaceLocalDatabaseKeys({
            workplan_access_key: 'current-account',
            planpro_access_key: 'old-account',
            planpro_notes: 'restored-notes'
        });
        assert.equal(count, 2);
        assert.equal(localStorage.getItem('workplan_access_key'), 'current-account');
        assert.equal(localStorage.getItem('workplan_notes'), 'restored-notes');
        assert.equal(localStorage.getItem('planpro_access_key'), null);
        assert.equal(localStorage.getItem('unrelated'), 'keep-me');
    `);
});

test('invalid or empty replacement payloads do not modify the working copy', () => {
    runIsolated(`
        localStorage.setItem('workplan_access_key', 'keep-account');
        const before = [...disk];
        for (const keys of [null, [], {}, { unrelated: 'value' }, { planpro_notes: [] },
            { workplan_access_key: 'partial', planpro_notes: null }]) {
            await assert.rejects(db.replaceLocalDatabaseKeys(keys));
            assert.deepEqual([...disk], before);
        }
        assert.equal(writes.length, 0);
    `);
});

test('an encrypted legacy JSON backup restores into the active desktop memory mirror', () => {
    runIsolated(`
        const backup = await import('./src/lib/utils/backup-package.js');
        const payload = { format: 'workplan-backup-data', version: 1, keys: {
            planpro_access_key: 'restored-account', planpro_notes: 'restored-notes',
            planpro_passwords_session: 'excluded-session', planpro_login_tip_index: 'excluded-tip'
        } };
        const encrypted = await backup.createEncryptedBackup(payload, 'synthetic backup phrase');
        const opened = await backup.openEncryptedBackup(encrypted, 'synthetic backup phrase');
        assert.deepEqual(backup.validateBackupData(opened), {
            workplan_access_key: 'restored-account', workplan_notes: 'restored-notes'
        });
        localStorage.setItem('workplan_access_key', 'previous-account');
        localStorage.setItem('workplan_passwords', 'previous-vault');
        await db.initLocalDatabase();
        await db.installLocalDatabaseMirror();
        await backup.applyLocalBackupPayload(opened);
        assert.equal(localStorage.getItem('workplan_access_key'), 'restored-account');
        assert.equal(localStorage.getItem('workplan_notes'), 'restored-notes');
        assert.equal(localStorage.getItem('workplan_passwords'), null);
        assert.equal(writes.at(-1).keys.workplan_access_key, 'restored-account');
        assert.equal(writes.at(-1).keys.workplan_passwords, undefined);
        assert.equal(writes.at(-1).keys.planpro_notes, undefined);
        assert.equal(disk.has('workplan_notes'), false);
    `);
});

test('native restore replaces the whole account and only requests key recovery explicitly', () => {
    runIsolated(`
        localStorage.setItem('workplan_access_key', 'previous-account');
        localStorage.setItem('workplan_master_hash', 'previous-master-hash');
        localStorage.setItem('workplan_passwords', '[{"id":"previous-entry"}]');
        localStorage.setItem('workplan_pin_wrapper', 'previous-pin-wrapper');
        localStorage.setItem('workplan_pin_attempts', '4');
        localStorage.setItem('workplan_device_binding', 'previous-binding');
        await db.initLocalDatabase();
        await db.installLocalDatabaseMirror();
        const { passwordsStore } = await import('./src/lib/stores/passwords.js');
        passwordsStore.load();
        assert.equal(passwordsStore.hasMasterPassword(), true);
        restoredSnapshot = snapshot({ planpro_access_key: 'restored-account', planpro_notes: 'restored-notes' });
        await db.restoreLocalDatabase('synthetic-backup.wpb', 'synthetic backup phrase');
        assert.equal(restoreRequests[0].allowKeyRecovery, false);
        assert.equal(restoreRequests[0].passphrase, 'synthetic backup phrase');
        assert.deepEqual(db.getLocalDatabaseKeys(), {
            workplan_access_key: 'restored-account', workplan_notes: 'restored-notes'
        });
        assert.deepEqual(writes.at(-1).keys, db.getLocalDatabaseKeys());
        for (const key of ['workplan_master_hash', 'workplan_passwords', 'workplan_pin_wrapper',
            'workplan_pin_attempts', 'workplan_device_binding']) assert.equal(localStorage.getItem(key), null);
        passwordsStore.load();
        assert.equal(passwordsStore.hasMasterPassword(), false);
        await db.restoreLocalDatabase('synthetic-backup.wpb', 'synthetic backup phrase', true);
        assert.equal(restoreRequests[1].allowKeyRecovery, true);
    `);
});

for (const legacyFirst of [true, false]) {
    test(`backup validation favors modern keys regardless of order (${legacyFirst})`, () => {
        runIsolated(`
            const { validateBackupData } = await import('./src/lib/utils/backup-package.js');
            const legacy = ['planpro_notes', 'old-notes'];
            const modern = ['workplan_notes', 'current-notes'];
            const keys = Object.fromEntries(${legacyFirst} ? [legacy, modern] : [modern, legacy]);
            assert.deepEqual(validateBackupData({ format: 'workplan-backup-data', version: 1, keys }), {
                workplan_notes: 'current-notes'
            });
        `);
    });
}
