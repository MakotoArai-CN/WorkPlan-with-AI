import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

function scenario(body) {
    const script = `
        import {mock} from 'bun:test';
        import assert from 'node:assert/strict';
        import {get} from 'svelte/store';
        const events=[];
        let finish, install=async()=>({opened:true}), save=async()=>{}, handoff=async()=>{}, receipt=null;
        mock.module('./src/lib/utils/local-db.js',()=>({prepareLocalDatabaseForUpdate:async()=>{events.push('save');await save();}}));
        mock.module('@tauri-apps/api/core',()=>({Channel:class {},invoke:async(command,args)=>{
            if(command==='download_update')return new Promise(resolve=>{finish=resolve});
            if(command==='open_downloaded_update'){events.push('install');return install(args);}
            if(command==='complete_update_handoff'){events.push('handoff');return handoff(args);}
            if(command==='get_update_install_status')return receipt;
            throw Error('Unexpected command: '+command);
        }}));
        const api=await import('./src/lib/stores/updates.js');
        function begin(kind='nsis',automatic=true){
            api.updateDialog.set({show:true,data:{has_update:true,latest_version:'0.6.0',download:{name:'fixture',size:4}}});
            const pending=api.downloadUpdate(), id=get(api.updateDownload).id;
            finish({id,name:'fixture',size:4,verified:true,download_only:['deb','rpm','arch'].includes(kind),saved_path:'/isolated/fixture',installation:{kind,automatic,requires_exit:['nsis','msi'].includes(kind),manual_command:'quoted fixture command'}});
            return pending;
        }
        ${body}
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], {
        cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000,
    });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
}

test('verified supported downloads save data and hand off automatically, including Linux download-directory packages', () => {
    for (const kind of ['nsis', 'msi', 'deb', 'rpm', 'arch', 'appimage']) {
        scenario(`
            install=async()=>(${['nsis', 'msi'].includes(kind) ? '{opened:true,exit_required:true}' : '{opened:true,installed:true,restart_required:true}'});
            await begin('${kind}');
            assert.deepEqual(events,['save','install','save','handoff']);
            assert.equal(get(api.updateDownload).stage,'handoff');
        `);
    }
});

test('failed saves, rejected authorization and failed installers never request exit', () => {
    scenario(`
        save=async()=>{throw Error('disk full')};
        await begin();
        assert.deepEqual(events,['save']);
        assert.equal(get(api.updateDownload).stage,'ready');
        assert.equal(get(api.updateDownload).error,'disk full');
        assert.equal(get(api.updateDownload).installation.manual_command,'quoted fixture command');
        save=async()=>{};events.length=0;
        install=async()=>({canceled:true});
        await api.openDownloadedUpdate();
        assert.deepEqual(events,['save','install']);
        assert.equal(get(api.updateDownload).canceled,true);
        events.length=0;install=async()=>{throw Error('installer failed')};
        await api.openDownloadedUpdate();
        assert.deepEqual(events,['save','install']);
        assert.equal(get(api.updateDownload).stage,'ready');
        assert.equal(get(api.updateDownload).error,'installer failed');
    `);
});

test('manual fallback preserves the package and command, opens only on request, and flushes before opening', () => {
    scenario(`
        await begin('unknown',false);
        assert.deepEqual(events,[]);
        assert.equal(get(api.updateDownload).savedPath,'/isolated/fixture');
        install=async args=>{assert.equal(args.manual,true);return {opened:true}};
        await api.openDownloadedUpdate(true);
        assert.deepEqual(events,['save','install']);
        assert.equal(get(api.updateDownload).stage,'ready');
    `);
});

test('handoff retry never reruns an installer after a successful transaction', () => {
    scenario(`
        install=async()=>({opened:true,installed:true,restart_required:true});
        handoff=async()=>{throw Error('IPC unavailable')};
        await begin('deb');
        assert.equal(get(api.updateDownload).pendingHandoff,true);
        assert.equal(get(api.updateDownload).stage,'ready');
        events.length=0;handoff=async()=>{};
        await api.openDownloadedUpdate();
        assert.deepEqual(events,['save','handoff']);
        assert.equal(get(api.updateDownload).stage,'handoff');
    `);
});

test('mounted editor buffers flush before database saves, and a failed editor flush blocks installation', () => {
    scenario(`
        const unregister=api.registerUpdatePreparation(()=>{events.push('editor');throw Error('note save failed')});
        await begin();
        assert.deepEqual(events,['editor']);
        assert.equal(get(api.updateDownload).error,'note save failed');
        unregister();events.length=0;
        await api.openDownloadedUpdate();
        assert.deepEqual(events,['save','install']);
    `);
});

test('installation deduplicates while the dialog closes and late progress cannot restore downloading', () => {
    scenario(`
        let installed;
        install=()=>new Promise(resolve=>{installed=resolve});
        const job=begin('msi');
        for(let i=0;i<20 && !installed;i++)await new Promise(r=>setTimeout(r,0));
        api.closeUpdateDialog();
        await api.openDownloadedUpdate();
        assert.deepEqual(events,['save','install']);
        assert.equal(get(api.updateDialog).show,false);
        installed({opened:true,exit_required:true});await job;
        assert.deepEqual(events,['save','install','save','handoff']);
    `);
});

test('DMG opening is not reported as installed, while a persisted failed Windows install reopens the existing dialog', () => {
    scenario(`
        await begin('dmg');
        assert.deepEqual(events,['save','install']);
        assert.equal(get(api.updateDownload).stage,'ready');
        api.closeUpdateDialog();
        receipt={state:'failed',message:'Installer exited with code 1603'};
        await api.resumeUpdateInstallation();
        assert.equal(get(api.updateDialog).show,true);
        assert.equal(get(api.updateDialog).error,'Installer exited with code 1603');
    `);
});

test('Android installation plans save before opening the OS installer and never request a process exit', () => {
    scenario(`
        globalThis.window={WorkPlanAndroid:{installUpdate:()=>{events.push('android');return JSON.stringify({ok:true,permission_required:true})}}};
        install=async()=>({android_path:'/isolated/update.apk'});
        await begin('apk');
        assert.deepEqual(events,['save','install','android']);
        assert.equal(get(api.updateDownload).stage,'ready');
        assert.equal(get(api.updateDownload).permissionRequired,true);
    `);
});

test('a failed install after restart retains a manual recovery command without treating it as verified or automatically replaying it', () => {
    scenario(`
        api.closeUpdateDialog();
        receipt={state:'failed',version:'0.6.0',message:'Installer failed',recovery:{name:'fixture.exe',saved_path:'/isolated/fixture.exe',installation:{kind:'nsis',automatic:false,manual_command:'quoted recovery command'}}};
        await api.resumeUpdateInstallation();
        assert.equal(get(api.updateDialog).installationError,true);
        assert.equal(get(api.updateDialog).data.latest_version,'0.6.0');
        assert.equal(get(api.updateDownload).recovered,true);
        assert.equal(get(api.updateDownload).installation.manual_command,'quoted recovery command');
        await api.openDownloadedUpdate(true);
        assert.deepEqual(events,[]);
    `);
});

test('all shipped locales include the update action and fallback strings', () => {
    for (const locale of ['zh', 'en', 'ja']) {
        const { settings } = JSON.parse(readFileSync(new URL(`../src/lib/i18n/${locale}.json`, import.meta.url), 'utf8'));
        for (const key of ['update_installing','update_handoff','update_installation_type','update_installation_unknown','update_install_canceled','update_copy_command','update_command_copied','update_install_now']) {
            expect(typeof settings[key]).toBe('string');
            expect(settings[key].length).toBeGreaterThan(0);
        }
    }
});
