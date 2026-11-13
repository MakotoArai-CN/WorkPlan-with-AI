import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AGREEMENT_VERSION } from '../src/lib/utils/agreement-version.js';

test('all shipped policies identify the current version and cover current data flows', () => {
    for (const language of ['zh', 'en', 'ja']) {
        const policy = JSON.parse(readFileSync(new URL(`../src/lib/i18n/${language}.json`, import.meta.url), 'utf8')).agreement_page;
        expect(policy.updated_at).toContain(AGREEMENT_VERSION);
        expect(policy.updated_at).toContain('2026');
        expect(policy.sharing_desc).toContain('GitHub');
        expect(policy.ai_desc.length).toBeGreaterThan(150);
        expect(policy.storage_desc.length).toBeGreaterThan(100);
    }
    const zh = JSON.parse(readFileSync(new URL('../src/lib/i18n/zh.json', import.meta.url), 'utf8')).agreement_page;
    for (const term of ['历史', '回执', '递归', '设置中关闭']) expect(zh.ai_desc).toContain(term);
    expect(zh.security_desc).toContain('不会因输错密码自动删除数据库');
    expect(zh.security_desc).toContain('加密包装');
    expect(zh.rights_desc).toContain('第三方已收到的数据不会因此自动清除');
    expect(zh.disclaimer_desc).toContain('不排除法律不允许排除的责任');
    expect(zh.changes_desc).not.toContain('继续使用视为');
});

for (const version of ['1.1', AGREEMENT_VERSION]) test(`agreement acceptance survives only for the current policy (${version})`, () => {
    const script = `
        import {get} from 'svelte/store';
        import assert from 'node:assert/strict';
        const data=new Map([['workplan_system_settings',JSON.stringify({agreementAccepted:true,agreementVersion:${JSON.stringify(version)},theme:'frosted',syncNotes:true})]]);
        globalThis.window={};
        globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
        const {settingsStore}=await import('./src/lib/stores/settings.js');
        const before=get(settingsStore);
        assert.equal(before.agreementAccepted,${version === AGREEMENT_VERSION});
        assert.equal(before.showAgreement,${version !== AGREEMENT_VERSION});
        assert.equal(before.theme,'frosted');assert.equal(before.syncNotes,true);
        settingsStore.acceptAgreement();
        assert.equal(settingsStore.isAgreementAccepted(),true);
        const saved=JSON.parse(data.get('workplan_system_settings'));
        assert.equal(saved.agreementVersion,${JSON.stringify(AGREEMENT_VERSION)});
        assert.equal(saved.theme,'frosted');assert.equal(saved.syncNotes,true);
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000 });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
});
