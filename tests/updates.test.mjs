import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('update checks deduplicate, settle errors, preserve closed state and fence late results after viewing local notes', () => {
    const script = `
        import assert from 'node:assert/strict';
        import {mock} from 'bun:test';
        import {get} from 'svelte/store';
        let calls=0, release;
        mock.module('@tauri-apps/api/core',()=>({Channel:class {},invoke:async command=>{
            assert.equal(command,'check_update');calls++;return new Promise(resolve=>{release=resolve;});
        }}));
        const {checkForUpdates,updateDialog,closeUpdateDialog,showCurrentReleaseNotes}=await import('./src/lib/stores/updates.js');
        const a=checkForUpdates(), b=checkForUpdates();
        assert.equal(calls,1);assert.equal(a,b);assert.equal(get(updateDialog).loading,true);
        closeUpdateDialog();release({latest_version:'0.5.17',release_notes:'public'});await a;
        assert.equal(get(updateDialog).show,false);assert.equal(get(updateDialog).data.latest_version,'0.5.17');
        const old=checkForUpdates();const oldRelease=release;
        showCurrentReleaseNotes();assert.equal(get(updateDialog).currentOnly,true);
        const newer=checkForUpdates();const newRelease=release;
        oldRelease({latest_version:'0.5.16'});await old;
        assert.equal(get(updateDialog).data,null);assert.equal(get(updateDialog).loading,true);
        newRelease({latest_version:'0.5.18'});await newer;
        assert.equal(get(updateDialog).data.latest_version,'0.5.18');assert.equal(get(updateDialog).loading,false);
        mock.module('@tauri-apps/api/core',()=>({Channel:class {},invoke:async()=>{throw new Error('synthetic network outage');}}));
        await checkForUpdates();assert.ok(get(updateDialog).error.includes('synthetic network outage'));assert.equal(get(updateDialog).loading,false);
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
});
