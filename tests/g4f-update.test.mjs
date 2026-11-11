import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function probe(body) {
    const script = `
        import assert from 'node:assert/strict';
        globalThis.window = {};
        globalThis.localStorage = {getItem:()=>null};
        globalThis.fetch = async()=>{throw new Error('Unexpected real API request');};
        const {createG4FClient,streamChatWithG4F,G4F_PROVIDER_CATALOG}=await import('./src/lib/utils/g4f-client.js');
        ${body}
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
}

test('updated SDK provider classes and routes preserve explicit endpoints and retired profiles', () => probe(`
    const community=await createG4FClient('g4f-community',{apiKey:'synthetic-qa'});
    assert.equal(community.constructor.name,'Pollinations');
    assert.equal(community.baseUrl,'https://community.g4f.space');
    assert.equal((await createG4FClient('g4f-community')).baseUrl,'https://g4f.space/api/community');
    assert.equal((await createG4FClient('g4f-ollama',{apiKey:'synthetic-qa'})).baseUrl,'https://ollama.g4f.space');
    assert.equal((await createG4FClient('g4f-pollinations',{baseUrl:'http://127.0.0.1:1234/v1'})).baseUrl,'http://127.0.0.1:1234/v1');
    assert.ok(!G4F_PROVIDER_CATALOG.some(provider=>provider.id==='g4f-orcarouter'));
    await assert.rejects(createG4FClient('g4f-orcarouter'),/OrcaRouter/);
    assert.equal((await createG4FClient('g4f-orcarouter',{baseUrl:'https://custom.invalid/v1'})).baseUrl,'https://custom.invalid/v1');
`));

test('updated SDK ignores cake-credit usage-only chunks and forwards cancellation without leaking payload logs', () => probe(`
    const encoder=new TextEncoder();
    const controller=new AbortController();
    let requests=0, logs=0;
    console.log=()=>logs++;
    const result=await streamChatWithG4F('g4f-default','auto',[{role:'user',content:'synthetic confidential prompt'}],{
        baseUrl:'https://fixture.invalid/v1',sleep:1,signal:controller.signal,
        fetchFn:async(url,options)=>{
            requests++;assert.equal(options.signal,controller.signal);
            assert.ok(!JSON.parse(options.body).signal);
            return new Response(new ReadableStream({start(out){
                out.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hello"}}]}\\n\\ndata: [DONE]\\n\\n'));out.close();
            }}),{headers:{'content-type':'text/event-stream','x-cake-cost':'0.01'}});
        }
    },()=>{});
    assert.equal(result,'hello');assert.equal(requests,1);assert.equal(logs,0);
`));

test('release and quality checkout the same reviewed SDK revision from the configured submodule repository', () => {
    for (const file of ['release.yml', 'quality.yml', 'linux-portable.yml']) {
        const text = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
        expect(text).toContain('MakotoArai-CN/g4f.dev');
        expect(text).toContain('d9de8c2c5691a8e21b2d6fc60e7f38ae9a2382d0');
    }
    expect(readFileSync(new URL('../.gitmodules', import.meta.url), 'utf8')).toContain('path = g4f.dev');
});
