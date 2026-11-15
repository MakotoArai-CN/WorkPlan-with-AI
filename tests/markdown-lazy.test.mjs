import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

test('production chunk rules do not force diagrams into the ordinary editor bundle', () => {
    const config = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
    const editorRule = config.slice(config.indexOf("id.includes('@milkdown/')"), config.indexOf("return 'editor-stack'"));
    expect(editorRule).toContain("id.includes('marked')");
    expect(editorRule).not.toContain("id.includes('mermaid')");
});

for (const retry of [false, true]) {
    test(`Markdown loads diagrams only on demand, shares initialization and handles retry (${retry})`, () => {
        const script = `
            import {mock} from 'bun:test';
            import assert from 'node:assert/strict';
            let initialized=0,renders=0,fail=${retry},mounted=true;
            const scheduled=[];
            const element={classList:{add(){},remove(){}},replaceChildren(){},innerHTML:''};
            globalThis.window={};
            globalThis.document={getElementById:()=>mounted?element:null,createElement:()=>({})};
            globalThis.setTimeout=callback=>{scheduled.push(callback);return scheduled.length;};
            console.warn=()=>{};
            mock.module('./src/lib/utils/safe-html.js',()=>({sanitizeHtml:value=>value,sanitizeDiagramSvg:value=>value}));
            mock.module('mermaid',()=>({default:{
                initialize:options=>{
                    initialized++;
                    assert.equal(options.securityLevel,'strict');
                    assert.equal(options.htmlLabels,false);
                    assert.equal(options.flowchart.htmlLabels,false);
                    if(fail){fail=false;throw Error('Temporary diagram initialization failure');}
                },
                render:async()=>{renders++;return {svg:'<svg></svg>'};}
            }}));
            const {renderMarkdown}=await import('./src/lib/utils/markdown.js');
            await new Promise(resolve=>setImmediate(resolve));
            renderMarkdown('# Heading\\n\\n**Ordinary text**');
            renderMarkdown('~~~js\\nconst a = 1;\\n~~~');
            assert.equal(initialized,0);assert.equal(scheduled.length,0);
            const diagram='\\x60\\x60\\x60mermaid\\ngraph TD; A-->B;\\n\\x60\\x60\\x60';
            renderMarkdown(diagram);mounted=false;
            await scheduled.shift()();assert.equal(initialized,0);
            mounted=true;
            renderMarkdown(diagram);renderMarkdown(diagram);
            await Promise.all(scheduled.splice(0).map(callback=>callback()));
            assert.equal(initialized,1);
            assert.equal(renders,${retry ? 0 : 2});
            renderMarkdown(diagram);await scheduled.shift()();
            assert.equal(initialized,${retry ? 2 : 1});
            assert.equal(renders,${retry ? 1 : 3});
        `;
        const result = Bun.spawnSync([process.execPath, '--eval', script], {
            cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000
        });
        expect(result.stderr.toString()).toBe('');
        expect(result.exitCode).toBe(0);
    });
}
