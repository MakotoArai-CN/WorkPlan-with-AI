import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

test('Android bridge combines complete counts across authorized roots without stopping at the page size', () => {
    const script = `
        import {mock} from 'bun:test';
        import assert from 'node:assert/strict';
        mock.module('./src/lib/utils/runtime.js',()=>({isAndroidRuntime:()=>true,isTauriRuntime:false}));
        const requests=[];
        globalThis.window={WorkPlanAndroid:{searchTree(){throw Error('legacy search');},searchTreeReport(root,relative,query,limit,json){
            const options=JSON.parse(json);requests.push({root,limit,options});
            return JSON.stringify({ok:true,entries:options.summaryOnly?[]:[{path:root+'/file'}],totalMatched:10,countComplete:true,counts:{files:10,directories:0,byExtension:{md:10}},truncated:false});
        }}};
        const {searchLocalFilesDetailed}=await import('./src/lib/utils/local-file-tools.js');
        const roots=['content://root-a','content://root-b'];
        const page=await searchLocalFilesDetailed({trustedDirectories:roots,maxResults:1,kind:'file'});
        assert.equal(page.totalMatched,20);assert.equal(page.counts.files,20);assert.equal(page.counts.byExtension.md,20);
        assert.equal(page.countComplete,true);assert.equal(page.hasMore,true);assert.equal(page.nextOffset,1);
        assert.equal(requests.length,2);assert.equal(requests[1].options.summaryOnly,true);
        const summary=await searchLocalFilesDetailed({root:roots[0],summaryOnly:true,extensions:['md']});
        assert.equal(summary.totalMatched,10);assert.equal(summary.entries.length,0);
        assert.equal(requests.at(-1).options.summaryOnly,true);assert.deepEqual(requests.at(-1).options.extensions,['md']);
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000 });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
});

test('Android source generator includes independent counting rather than a page-size scan stop', () => {
    const source = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
    const report = source.slice(source.indexOf('fun searchTreeReport'), source.indexOf('fun readTextFile'));
    expect(report).toContain('countComplete');
    expect(report).toContain('totalMatched');
    expect(report).toContain('summaryOnly');
    expect(report).not.toContain('if (entries.length() >= maxResults) return');
});
