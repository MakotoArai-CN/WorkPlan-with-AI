import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { validateVaultMeta } from '../src/lib/utils/vault-entry.js';

const valid = { version: 2, salt: 'ab'.repeat(16), iterations: 600000 };

test('vault metadata accepts only supported versions, canonical salts and bounded KDF work', () => {
    expect(validateVaultMeta(valid)).toBe(valid);
    expect(validateVaultMeta({ ...valid, iterations: 2000000 }).iterations).toBe(2000000);
    for (const meta of [null, [], {}, { ...valid, version: 1 }, { ...valid, salt: '' }, { ...valid, salt: 'x'.repeat(32) },
        { ...valid, salt: 'ab'.repeat(15) }, { ...valid, iterations: 1 }, { ...valid, iterations: 599999 },
        { ...valid, iterations: 2000001 }, { ...valid, iterations: Infinity }, { ...valid, iterations: 600000.5 },
        { ...valid, iterations: '600000' }]) {
        expect(() => validateVaultMeta(meta)).toThrow();
    }
});

test('invalid metadata and entry salts fail before KDF or storage writes; missing metadata still recovers', () => {
    const result = Bun.spawnSync([process.execPath, '--eval', `
        import assert from 'node:assert/strict';
        const values = new Map();
        let writes = 0, derivations = 0;
        globalThis.localStorage = { getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes++;values.set(key,String(value));} };
        globalThis.crypto = { subtle: {
            importKey:async()=>({}),
            deriveBits:async(params)=>{derivations++;assert.equal(params.iterations,600000);return new ArrayBuffer(64);}
        }};
        const {ensureVaultEntryKey}=await import('./src/lib/utils/vault-entry.js');
        for(const raw of ['broken','',JSON.stringify({...${JSON.stringify(valid)},iterations:1}),JSON.stringify({...${JSON.stringify(valid)},iterations:4294967295})]){
            values.set('workplan_vault_meta',raw);
            await assert.rejects(ensureVaultEntryKey('synthetic master'));
            assert.equal(values.get('workplan_vault_meta'),raw);
        }
        assert.equal(derivations,0);assert.equal(writes,0);
        values.delete('workplan_vault_meta');
        await assert.rejects(ensureVaultEntryKey('synthetic master','bad-salt'));
        assert.equal(writes,0);
        await ensureVaultEntryKey('synthetic master','ab'.repeat(16));
        assert.equal(derivations,1);assert.equal(writes,1);
        assert.equal(JSON.parse(values.get('workplan_vault_meta')).salt,'ab'.repeat(16));
    `], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
});
