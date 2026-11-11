import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

// Isolate module mocks: other suites import the real sync module later.
function checkDelete(blocked) {
    const script = `
        import { mock } from 'bun:test';
        import assert from 'node:assert/strict';
        globalThis.window = globalThis;
        globalThis.localStorage = { getItem: () => null };
        let rows = [{id: 1}, {id: 2}, {id: 3}];
        let deleted = [];
        mock.module('@supabase/supabase-js', () => ({ createClient: () => ({
            from: () => ({
                select: () => ({ eq: () => ({ limit: async () => ({data: rows.slice(0, 2)}) }) }),
                delete: () => ({ in: async (column, ids) => {
                    assert.equal(column, 'id');
                    deleted.push(...ids);
                    if (!${blocked}) rows = rows.filter(row => !ids.includes(row.id));
                    return {error: null};
                } })
            })
        }) }));
        const { deleteCloudRecord } = await import('./src/lib/stores/tasks.js');
        const operation = () => deleteCloudRecord('test-account', {url: 'https://cloud.invalid', apiKey: 'test-only'});
        if (${blocked}) {
            await assert.rejects(operation, /delete permissions/);
            assert.equal(rows.length, 3);
        } else {
            await operation();
            assert.deepEqual(deleted, [1, 2, 3]);
            assert.equal(rows.length, 0);
        }
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
}

test('cloud erase deletes every duplicate record across response pages', () => checkDelete(false));
test('cloud erase detects a silently rejected delete rather than declaring success', () => checkDelete(true));

test('custom HTTP cloud erase verifies removal and retains rejected deletion for retry', () => {
    const script = `
        import assert from 'node:assert/strict';
        globalThis.window = globalThis;
        globalThis.localStorage = {getItem: () => null};
        let blocked = true;
        let present = true;
        globalThis.fetch = async (url, options) => {
            assert.equal(options.headers['x-workplan-key'], 'test-account');
            if (options.method === 'DELETE') {
                if (!blocked) present = false;
                return new Response(null, {status: 204});
            }
            return Response.json(present ? [{content: {}}] : []);
        };
        const {deleteCloudRecord} = await import('./src/lib/stores/tasks.js');
        const operation = () => deleteCloudRecord('test-account', {url: 'https://cloud.invalid', apiKey: 'test-only', useCustomConfig: true});
        await assert.rejects(operation, /delete permissions/);
        blocked = false;
        await operation();
        assert.equal(present, false);
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], {cwd: fileURLToPath(new URL('..', import.meta.url))});
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
});
