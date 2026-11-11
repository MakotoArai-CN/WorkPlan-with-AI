import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { g4fHttpStatus, g4fRequiresUserAction } from '../src/lib/utils/g4f-errors.js';

function isolated(body) {
    const script = `
        import assert from 'node:assert/strict';
        globalThis.window = {};
        globalThis.localStorage = {getItem:key=>key==='workplan_locale'?'zh':null};
        globalThis.fetch=async()=>{throw new Error('Unexpected real API request');};
        const {chatWithG4F,streamChatWithG4F}=await import('./src/lib/utils/g4f-client.js');
        ${body}
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
}

test('G4F recognizes quota and authentication HTTP status without confusing unrelated numbers', () => {
    expect(g4fHttpStatus(new Error('Status 402: No cake credits'))).toBe(402);
    expect(g4fHttpStatus({ status: 403 })).toBe(403);
    expect(g4fHttpStatus(new Error('Model 402 failed'))).toBeNull();
    expect(g4fRequiresUserAction(new Error('HTTP 401: invalid key'))).toBe(true);
    expect(g4fRequiresUserAction(new Error('HTTP 503: unavailable'))).toBe(false);
});

test('402 cake credit failures make only one request in both chat modes and preserve useful guidance', () => isolated(`
    for(const method of [chatWithG4F,streamChatWithG4F]){
        let requests=0, published=0;
        await assert.rejects(method('g4f-default','auto',[{role:'user',content:'fixture'}],{
            baseUrl:'https://fixture.invalid/v1',sleep:1,
            fetchFn:async()=>{requests++;return Response.json({error:{message:'No cake credits. Bake proof-of-work cakes at g4f.dev/chat'}},{status:402});}
        },()=>published++),error=>{
            assert.equal(error.status,402);assert.equal(error.code,'g4f_credit_required');
            assert.ok(error.message.includes('匿名'));assert.ok(error.message.includes('API Key'));return true;
        });
        assert.equal(requests,1);assert.equal(published,0);
    }
`));

test('member API keys are forwarded and an authentication refusal is never retried as anonymous', () => isolated(`
    let requests=0;
    const key='synthetic-member-key';
    await assert.rejects(chatWithG4F('g4f-default','auto',[],{
        baseUrl:'https://fixture.invalid/v1',apiKey:key,sleep:1,
        fetchFn:async(url,options)=>{
            requests++;assert.equal(options.headers.Authorization,'Bearer '+key);
            return Response.json({error:{message:'Invalid credential '+key}},{status:401});
        }
    }),error=>{assert.equal(error.status,401);assert.ok(!error.message.includes(key));return true;});
    assert.equal(requests,1);
`));

test('non-cake 402 errors do not falsely promise proof-of-work will fix provider billing', () => isolated(`
    const {g4fRequestError}=await import('./src/lib/utils/g4f-errors.js');
    const error=g4fRequestError(new Error('Status 402: model billing limit'));
    assert.equal(error.status,402);assert.ok(!error.message.includes('工作量证明'));assert.ok(error.message.includes('余额'));
`));
