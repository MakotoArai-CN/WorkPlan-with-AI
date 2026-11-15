import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

test('editor icons use a shared external script and survive Vditor removing its marker', () => {
    const script = `
        import assert from 'node:assert/strict';
        const nodes=[];let created=0;
        globalThis.document={
            getElementById:id=>nodes.find(node=>node.id===id),
            createElement:()=>{created++;return {remove(){const i=nodes.indexOf(this);if(i>=0)nodes.splice(i,1);}};},
            head:{appendChild(node){nodes.push(node);}}
        };
        const {ensureVditorIcons}=await import('./src/lib/utils/notes-editor.js');
        const first=ensureVditorIcons();assert.equal(first,ensureVditorIcons());
        assert.equal(created,1);const failed=nodes[0];
        assert.equal(failed.src,'/vendor/vditor/dist/js/icons/material.js');
        assert.equal(failed.text,undefined);assert.equal(failed.textContent,undefined);
        const rejected=assert.rejects(first,/Unable to load editor icons/);failed.onerror();await rejected;
        assert.equal(nodes.length,0);
        const next=ensureVditorIcons();assert.equal(created,2);
        const loaded=nodes[0];loaded.onload();await next;
        await ensureVditorIcons();assert.equal(created,2);assert.equal(nodes.length,1);
        loaded.remove();assert.equal(nodes.length,0);
        await ensureVditorIcons();assert.equal(created,2);assert.equal(nodes[0],loaded);
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], {
        cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000
    });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
    const notes = readFileSync(new URL('../src/lib/components/Notes.svelte', import.meta.url), 'utf8');
    expect(notes.indexOf('await ensureVditorIcons()')).toBeLessThan(notes.indexOf('const instance = new Vditor('));
});
