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

test('download-only Linux packages are saved, never opened as executables, and source retries reset progress', () => {
    const script = `
        import {mock} from 'bun:test';import assert from 'node:assert/strict';import {get} from 'svelte/store';
        let progress,finish,opens=0;
        mock.module('@tauri-apps/api/core',()=>({Channel:class {},invoke:async(command,args)=>{
            if(command==='download_update'){progress=args.progress;return new Promise(resolve=>{finish=resolve;});}
            if(command==='open_downloaded_update'){opens++;return {opened:true};}
            throw Error('Unexpected command '+command);
        }}));
        const api=await import('./src/lib/stores/updates.js');
        api.updateDialog.set({show:true,data:{has_update:true,latest_version:'0.6.0',download:{name:'workplan-bin-0.6.0-1-x86_64.pkg.tar.zst',size:100,download_only:true}}});
        const job=api.downloadUpdate();const id=get(api.updateDownload).id;
        progress.onmessage({id,attempt:0,received:80,stage:'downloading'});
        progress.onmessage({id,attempt:1,received:0,stage:'downloading'});assert.equal(get(api.updateDownload).received,0);
        progress.onmessage({id,attempt:0,received:95,stage:'downloading'});assert.equal(get(api.updateDownload).received,0);
        finish({id,name:'workplan-bin-0.6.0-1-x86_64.pkg.tar.zst',size:100,verified:true,download_only:true,saved_path:'/home/fixture/Downloads/workplan.pkg.tar.zst'});await job;
        assert.equal(get(api.updateDownload).downloadOnly,true);assert.equal(get(api.updateDownload).savedPath,'/home/fixture/Downloads/workplan.pkg.tar.zst');
        progress.onmessage({id,attempt:1,received:20,stage:'downloading'});assert.equal(get(api.updateDownload).stage,'ready');
        await api.openDownloadedUpdate();assert.equal(opens,0);
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000 });
    expect(result.stderr.toString()).toBe(''); expect(result.exitCode).toBe(0);
});

test('a late cancellation error cannot revive a completed download or overwrite a newer attempt', () => {
    const script = `
        import {mock} from 'bun:test';import assert from 'node:assert/strict';import {get} from 'svelte/store';
        let finish,rejectCancel;
        mock.module('@tauri-apps/api/core',()=>({Channel:class {},invoke:async(command)=>{
            if(command==='download_update')return new Promise(resolve=>{finish=resolve;});
            if(command==='cancel_update_download')return new Promise((_,reject)=>{rejectCancel=reject;});
            throw Error('Unexpected command '+command);
        }}));
        const api=await import('./src/lib/stores/updates.js');
        api.updateDialog.set({data:{has_update:true,latest_version:'0.6.0',download:{name:'fixture.exe',size:100}}});
        const active=api.downloadUpdate();const activeId=get(api.updateDownload).id;
        const failedCancellation=api.cancelUpdateDownload();
        rejectCancel(Error('Cancellation command unavailable'));await failedCancellation;
        assert.equal(get(api.updateDownload).stage,'downloading');
        assert.equal(get(api.updateDownload).error,'Cancellation command unavailable');
        finish({id:activeId,name:'fixture.exe',size:100,verified:true});await active;
        for(const newAttempt of [false,true]){
            const job=api.downloadUpdate();const id=get(api.updateDownload).id;
            const cancellation=api.cancelUpdateDownload();const fail=rejectCancel;
            finish({id,name:'fixture.exe',size:100,verified:true});await job;
            assert.equal(get(api.updateDownload).stage,'idle');
            let next;
            if(newAttempt)next=api.downloadUpdate();
            const before={...get(api.updateDownload)};
            fail(Error('Late cancellation transport error'));await cancellation;
            assert.deepEqual(get(api.updateDownload),before);
            if(next){finish({id:before.id,name:'fixture.exe',size:100,verified:true});await next;}
        }
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000 });
    expect(result.stderr.toString()).toBe(''); expect(result.exitCode).toBe(0);
});

test('Android download automatically hands a verified APK to the system bridge exactly once', () => {
    const script = `
        import {mock} from 'bun:test';import assert from 'node:assert/strict';import {get} from 'svelte/store';
        let finish,verifiedOpens=0,installs=[];
        globalThis.window={WorkPlanAndroid:{installUpdate:path=>{installs.push(path);return JSON.stringify({ok:true,opened:true});}}};
        mock.module('@tauri-apps/api/core',()=>({Channel:class {},invoke:async(command,args)=>{
            if(command==='download_update')return new Promise(resolve=>{finish=resolve;});
            if(command==='open_downloaded_update'){verifiedOpens++;return {android_path:'/isolated/cache/updates/fixture.apk'};}
            throw Error('Unexpected command '+command);
        }}));
        const api=await import('./src/lib/stores/updates.js');
        api.updateDialog.set({data:{has_update:true,latest_version:'0.6.0',download:{name:'fixture.apk',size:100}}});
        const job=api.downloadUpdate();const id=get(api.updateDownload).id;
        assert.equal(installs.length,0);finish({id,name:'fixture.apk',size:100,verified:true});await job;
        assert.equal(verifiedOpens,1);assert.deepEqual(installs,['/isolated/cache/updates/fixture.apk']);
        assert.equal(get(api.updateDownload).stage,'ready');
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000 });
    expect(result.stderr.toString()).toBe(''); expect(result.exitCode).toBe(0);
});

test('failed downloads open only the official version-specific release page, cancellation never does', () => {
    const script = `
        import {mock} from 'bun:test';import assert from 'node:assert/strict';import {get} from 'svelte/store';
        let reject,external=[];
        mock.module('./src/lib/utils/open-external.js',()=>({openExternalUrl:async url=>{external.push(url);return true;}}));
        mock.module('@tauri-apps/api/core',()=>({Channel:class {},invoke:async command=>{
            if(command==='download_update')return new Promise((_,fail)=>{reject=fail;});
            if(command==='cancel_update_download')return;
            throw Error('Unexpected command '+command);
        }}));
        const api=await import('./src/lib/stores/updates.js');
        api.updateDialog.set({data:{has_update:true,latest_version:'0.6.0',release_url:'https://attacker.invalid',download:{name:'fixture',size:100}}});
        let job=api.downloadUpdate();reject(Error('Every transport failed'));await job;
        assert.deepEqual(external,['https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/tag/v0.6.0']);
        job=api.downloadUpdate();await api.cancelUpdateDownload();reject(Error('canceled'));await job;
        assert.equal(external.length,1);assert.equal(get(api.updateDownload).stage,'idle');
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000 });
    expect(result.stderr.toString()).toBe(''); expect(result.exitCode).toBe(0);
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
    const hook = readFileSync(new URL('../src-tauri/installer-hooks.nsh', import.meta.url), 'utf8');
    expect(hook.indexOf('${If} $UpdateMode = 1')).toBeLessThan(hook.indexOf('RMDir /r'));
    expect(hook).toContain('IfSilent workplan_keep_local_data');
    expect(hook).toContain('MB_DEFBUTTON2');
    const native = readFileSync(new URL('../src-tauri/src/windows_update.rs', import.meta.url), 'utf8');
    expect(native.includes('/S /UPDATE /D=')).toBe(true);
});
