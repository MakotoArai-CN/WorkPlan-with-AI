import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { installerBitmap } from '../packaging/installer-art.mjs';

test('download state is independent of dialog closure, deduplicates, cancels, and only opens verified packages', () => {
    const script = `
        import {mock} from 'bun:test';import assert from 'node:assert/strict';import {get} from 'svelte/store';
        let calls=[],channel,complete,fail,opens=0,cancels=0;
        mock.module('@tauri-apps/api/core',()=>({Channel:class {},invoke:async(command,args)=>{
            calls.push(command);
            if(command==='download_update'){channel=args.progress;return new Promise((resolve,reject)=>{complete=resolve;fail=reject;});}
            if(command==='cancel_update_download'){cancels++;return;}
            if(command==='open_downloaded_update'){opens++;return {opened:true};}
            throw Error('Unexpected command '+command);
        }}));
        const api=await import('./src/lib/stores/updates.js');
        const info={has_update:true,latest_version:'0.6.0',download:{name:'fixture.exe',size:100}};
        api.updateDialog.set({show:true,data:info});
        const pending=api.downloadUpdate();assert.equal(pending,api.downloadUpdate());
        let state=get(api.updateDownload);const first=state.id;
        channel.onmessage({id:first,received:30,total:100,stage:'downloading'});assert.equal(get(api.updateDownload).received,30);
        channel.onmessage({id:'stale',received:90});assert.equal(get(api.updateDownload).received,30);
        api.closeUpdateDialog();assert.equal(get(api.updateDialog).show,false);
        api.checkForUpdates();assert.equal(get(api.updateDialog).show,true);assert.equal(calls.filter(x=>x==='check_update').length,0);
        await api.openDownloadedUpdate();assert.equal(opens,0);
        await api.cancelUpdateDownload();assert.equal(cancels,1);
        channel.onmessage({id:first,received:50});assert.equal(get(api.updateDownload).stage,'canceling');
        fail(Error('canceled'));await pending;assert.equal(get(api.updateDownload).stage,'idle');
        const next=api.downloadUpdate();const id=get(api.updateDownload).id;assert.notEqual(id,first);
        channel.onmessage({id,received:100,stage:'verifying'});assert.equal(get(api.updateDownload).stage,'verifying');
        complete({id,name:'fixture.exe',size:100,verified:true});await next;
        assert.equal(get(api.updateDownload).stage,'ready');
        await Promise.all([api.openDownloadedUpdate(),api.openDownloadedUpdate()]);assert.equal(opens,1);assert.equal(get(api.updateDownload).stage,'ready');
        const invalid=api.downloadUpdate();complete({id:get(api.updateDownload).id,verified:false});await invalid;
        assert.equal(get(api.updateDownload).stage,'error');await api.openDownloadedUpdate();assert.equal(opens,1);
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000 });
    expect(result.stderr.toString()).toBe(''); expect(result.exitCode).toBe(0);
});

test('Android update handoff is app-cache scoped, uses a non-exported provider, and requires system confirmation', () => {
    const source = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
    expect(source).toContain('File(cacheDir, "updates").canonicalFile');
    expect(source).toContain('file.parentFile != root');
    expect(source).toContain('archive.packageName != packageName');
    expect(source).toContain('ACTION_MANAGE_UNKNOWN_APP_SOURCES');
    expect(source).toContain('application/vnd.android.package-archive');
    expect(source).toContain('path="updates/"');
    expect(source).toContain('android:exported="false" android:grantUriPermissions="true"');
    expect(source).not.toContain('INSTALL_REPLACE_EXISTING');
});

test('NSIS artwork is deterministic, correct-sized BMP and does not replace standard installer logic', () => {
    const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    expect(config.bundle.windows.nsis.template).toBeUndefined();
    expect(config.bundle.windows.nsis.installerHooks).toBe('installer-hooks.nsh');
    for (const [key, width, height, sidebar] of [['headerImage',150,57,false],['sidebarImage',164,314,true]]) {
        const asset = readFileSync(new URL('../src-tauri/' + config.bundle.windows.nsis[key], import.meta.url));
        expect(asset.toString('ascii',0,2)).toBe('BM');
        expect(asset.readInt32LE(18)).toBe(width);expect(asset.readInt32LE(22)).toBe(height);
        expect(asset.equals(installerBitmap(width,height,sidebar))).toBe(true);
    }
});
