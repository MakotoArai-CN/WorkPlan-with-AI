import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

for (const scenario of ['success', 'lock', 'encryption_failure', 'decrypt_lock']) {
    test(`large master-key rotation yields without exposing partial state (${scenario})`, () => {
        const script = `
            import {mock} from 'bun:test';import assert from 'node:assert/strict';import {get} from 'svelte/store';
            const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)}};
            globalThis.localStorage=storage();globalThis.sessionStorage=storage();globalThis.window=globalThis;
            mock.module('./src/lib/utils/runtime.js',()=>({isTauriRuntime:false,isAndroidRuntime:()=>false}));
            mock.module('./src/lib/utils/local-db.js',()=>({flushLocalDatabase:async()=>{}}));
            const original={...await import('./src/lib/utils/vault-entry.js')};
            const oldMaster='Fixture-Original-Master!729',newMaster='Fixture-Replacement-Master!483';
            let stagedKey,encrypted=0,encoded=0,yields=0,decryptYields=0,workClock=0,stageActive=false,rotationActive=false;
            const nativeNow=performance.now.bind(performance);
            Object.defineProperty(performance,'now',{value:()=>nativeNow()+workClock,configurable:true});
            mock.module('./src/lib/utils/vault-entry.js',()=>({...original,
                ensureVaultEntryKey:async(secret,salt)=>{const key=await original.ensureVaultEntryKey(secret,salt);if(secret===newMaster){stagedKey=key;stageActive=true;}return key;},
                decryptVaultPayload:(value,key)=>{if(rotationActive&&!stageActive)workClock+=4;return original.decryptVaultPayload(value,key);},
                encryptVaultPayload:(value,key)=>{if(stageActive&&key===stagedKey){encrypted++;workClock+=4;if(${JSON.stringify(scenario)}==='encryption_failure'&&encrypted===11)return null;}return original.encryptVaultPayload(value,key);},
                encryptVaultEntryFields:(value,key)=>{if(stageActive&&key===stagedKey){encoded++;workClock+=4;}return original.encryptVaultEntryFields(value,key);}
            }));
            const {passwordsStore}=await import('./src/lib/stores/passwords.js');
            await passwordsStore.setMasterPassword(oldMaster);
            const entries=Array.from({length:240},(_,i)=>({title:'Fixture '+i,password:'synthetic-secret-'+i,username:'user-'+i,notes:'metadata-'+i}));
            assert.equal(passwordsStore.addPasswordsBatch(entries),entries.length);
            await new Promise(r=>setTimeout(r,180));
            const beforeEntries=localStorage.getItem('workplan_passwords'),beforeHash=localStorage.getItem('workplan_master_hash');
            const nativeTimeout=setTimeout;
            globalThis.setTimeout=(fn,ms,...args)=>nativeTimeout(()=>{
                if(rotationActive&&!stageActive&&ms===0){decryptYields++;if(${JSON.stringify(scenario)}==='decrypt_lock'&&decryptYields===1)passwordsStore.lock();}
                if(stageActive&&ms===0){yields++;assert.equal(localStorage.getItem('workplan_passwords'),beforeEntries);assert.equal(localStorage.getItem('workplan_master_hash'),beforeHash);if(${JSON.stringify(scenario)}==='lock'&&yields===1)passwordsStore.lock();}
                fn(...args);
            },ms);
            rotationActive=true;
            const result=await passwordsStore.changeMasterPassword(oldMaster,newMaster);
            globalThis.setTimeout=nativeTimeout;stageActive=false;rotationActive=false;
            assert.ok(decryptYields>0,'rotation must yield during old-key decryption');
            if(${JSON.stringify(scenario)}!=='decrypt_lock')assert.ok(yields>0,'rotation must yield during new-key encryption');
            if(${JSON.stringify(scenario)}==='success'){
                assert.equal(result.success,true);assert.equal(encrypted,entries.length*2,'one password and one metadata encryption per row');assert.equal(encoded,entries.length,'metadata must be prepared only once');
                passwordsStore.lock();passwordsStore.load();assert.equal(await passwordsStore.unlock(oldMaster),false);assert.equal(await passwordsStore.unlock(newMaster),true);
            }else{
                assert.equal(result.success,false);assert.equal(localStorage.getItem('workplan_passwords'),beforeEntries);assert.equal(localStorage.getItem('workplan_master_hash'),beforeHash);
                if(['lock','decrypt_lock'].includes(${JSON.stringify(scenario)}))assert.equal(get(passwordsStore).isUnlocked,false);
                passwordsStore.lock();passwordsStore.load();assert.equal(await passwordsStore.unlock(oldMaster),true);
            }
            const rows=get(passwordsStore).passwords;assert.equal(rows.length,entries.length);
            for(let i=0;i<rows.length;i++){assert.equal(rows[i].title,entries[i].title);assert.equal(rows[i].notes,entries[i].notes);assert.equal(passwordsStore.decryptPassword(rows[i].password),entries[i].password);}
        `;
        const result = Bun.spawnSync([process.execPath, '--eval', script], {
            cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 30000
        });
        expect(result.stderr.toString()).toBe('');
        expect(result.exitCode).toBe(0);
    });
}
