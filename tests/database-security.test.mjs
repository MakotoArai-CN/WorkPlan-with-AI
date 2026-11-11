import { describe, expect, test } from 'bun:test';
import { assertCloudRecordKey, assertPublicDatabaseKey, isPrivilegedDatabaseKey } from '../src/lib/utils/database-security.js';
import { fileURLToPath } from 'node:url';

function jwt(role) {
    return `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.test-signature`;
}

describe('public database client credentials', () => {
    test('rejects Supabase secret and privileged-role JWT keys', () => {
        for (const key of ['sb_secret_test-only', `  ${jwt('service_role')}  `, jwt('postgres'), jwt('supabase_admin'), jwt('authenticator')]) {
            expect(isPrivilegedDatabaseKey(key)).toBe(true);
            expect(() => assertPublicDatabaseKey({ apiKey: key, useCustomConfig: true })).toThrow(/禁止/);
        }
    });

    test('allows publishable, anon and opaque gateway credentials without assuming opaque tokens are safe', () => {
        for (const key of ['sb_publishable_test-only', jwt('anon'), 'test-gateway-token']) {
            expect(isPrivilegedDatabaseKey(key)).toBe(false);
            expect(() => assertPublicDatabaseKey({ apiKey: key })).not.toThrow();
        }
    });

    test('bounds and validates per-record bearer headers', () => {
        for (const key of [null, undefined, '', ' ', 'line\nbreak', 'x'.repeat(513)]) {
            expect(() => assertCloudRecordKey(key)).toThrow();
        }
        for (const key of ['user_account_random', '__workplan_secure_vault_v2__:user_account_random']) {
            expect(() => assertCloudRecordKey(key)).not.toThrow();
        }
    });

    test('custom HTTP read/write/delete reject privileged keys before any network request', () => {
        const script = `
            import assert from 'node:assert/strict';
            globalThis.window = globalThis;
            const key = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url') + '.test';
            const config = {enabled:true,useCustomConfig:true,url:'https://cloud.invalid',apiKey:key};
            globalThis.localStorage = {getItem:name => name === 'workplan_system_settings' ? JSON.stringify({databaseConfig:config}) : null};
            let requests = 0;
            globalThis.fetch = async () => {requests++; throw new Error('Unexpected network request');};
            const {loadCloudRecord,saveCloudRecord,deleteCloudRecord} = await import('./src/lib/stores/tasks.js');
            await assert.rejects(() => loadCloudRecord('test-account'), /service_role/);
            await assert.rejects(() => saveCloudRecord('test-account',{},0), /service_role/);
            await assert.rejects(() => deleteCloudRecord('test-account',config), /service_role/);
            assert.equal(requests,0);
        `;
        const result = Bun.spawnSync([process.execPath, '--eval', script], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
        expect(result.stderr.toString()).toBe('');
        expect(result.exitCode).toBe(0);
    });
});
