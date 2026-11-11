import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

// Other suites mock runtime and native modules globally; keep transport probes
// in a child process so they use only synthetic responses and never real APIs.
function runProbe(script) {
    const result = Bun.spawnSync([process.execPath, '--eval', `
        import assert from 'node:assert/strict';
        import { callAI, callAIWithMessages, callAIWithMessagesAndTools, callAIWithMessagesStream } from './src/lib/utils/ai-providers.js';
        const config = {provider:'custom', customEndpoint:'https://model.invalid/v1/chat/completions', customModel:'fixture', temperature:0};
        ${script}
    `], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
}

test('provider request retains temperature zero and passes an abort signal', () => runProbe(`
    const controller = new AbortController();
    globalThis.fetch = async (url, options) => {
        assert.equal(JSON.parse(options.body).temperature, 0);
        assert.ok(options.signal);
        return Response.json({choices:[{message:{content:'ok'}}]});
    };
    assert.equal(await callAI(config,'hello','system',{signal:controller.signal}), 'ok');
    controller.abort();
    await assert.rejects(callAIWithMessages(config,[],{signal:controller.signal}), {name:'AbortError'});
`));

test('streams OpenAI SSE, Ollama JSONL and Gemini JSON without duplicate requests', () => runProbe(`
    const encoder = new TextEncoder();
    let count = 0;
    let payload = 'data:{"choices":[{"delta":{"content":"Hi"}}]}\\n\\ndata: {"choices":[{"delta":{"content":" there"}}]}\\n\\ndata: [DONE]\\n\\n';
    let type = 'text/event-stream';
    globalThis.fetch = async () => {
        count++;
        return new Response(new ReadableStream({start(c){
            c.enqueue(encoder.encode(payload.slice(0,12)));c.enqueue(encoder.encode(payload.slice(12)));c.close();
        }}),{headers:{'content-type':type}});
    };
    const received=[];
    assert.equal(await callAIWithMessagesStream(config,[],(delta)=>received.push(delta)),'Hi there');
    assert.deepEqual(received,['Hi',' there']);
    payload='{"message":{"content":"local"}}\\n{"message":{"content":" model"}}';type='application/x-ndjson';
    assert.equal(await callAIWithMessagesStream({provider:'ollama',model:'fixture'},[],()=>{}),'local model');
    payload=JSON.stringify({candidates:[{content:{parts:[{thought:true,text:'hidden'},{text:'visible'},{text:' answer'}]}}]});type='application/json';
    assert.equal(await callAIWithMessagesStream({provider:'google',apiKey:'fixture-key'},[],()=>{}),'visible answer');
    assert.equal(count,3);
`));

test('HTTP rate errors, malformed JSON and stream errors never silently resend', () => runProbe(`
    let count=0;
    const key='fixture-private-secret';
    globalThis.fetch=async()=>{count++;return Response.json({error:{message:'rate '+key}},{status:429});};
    await assert.rejects(callAIWithMessagesStream({...config,apiKey:key},[],()=>{}), error=>error.status===429 && !error.message.includes(key));
    assert.equal(count,1);
    globalThis.fetch=async()=>{count++;return new Response('not JSON',{headers:{'content-type':'application/json'}});};
    await assert.rejects(callAIWithMessagesStream(config,[],()=>{}), /invalid JSON/);
    assert.equal(count,2);
    globalThis.fetch=async()=>{count++;return new Response('data: {"error":{"message":"denied"}}\\n\\n',{headers:{'content-type':'text/event-stream'}});};
    await assert.rejects(callAIWithMessagesStream(config,[],()=>{}), /denied/);
    assert.equal(count,3);
`));

test('valid tool calls survive unchanged while oversized and duplicate identities reject', () => runProbe(`
    let calls=[{id:'call_1',type:'function',function:{name:'workplan_query',arguments:'{"q":"today"}'}}];
    globalThis.fetch=async()=>Response.json({choices:[{message:{content:null,tool_calls:calls}}]});
    const good=await callAIWithMessagesAndTools(config,[],[]);
    assert.equal(good.toolCalls[0].arguments,'{"q":"today"}');
    calls=[calls[0],calls[0]];
    await assert.rejects(callAIWithMessagesAndTools(config,[],[]),/repeated/);
    calls=[{id:'different',function:{name:'workplan_query',arguments:'x'.repeat(32001)}}];
    await assert.rejects(callAIWithMessagesAndTools(config,[],[]),/arguments/);
`));

test('tool unsupported fallback is not triggered by auth errors mentioning tools', () => runProbe(`
    globalThis.fetch=async()=>Response.json({error:{message:'Unauthorized to use tools'}},{status:401});
    await assert.rejects(callAIWithMessagesAndTools(config,[],[]), error=>error.status===401 && !error.nativeToolUnsupported);
    globalThis.fetch=async()=>Response.json({error:{message:'tools are not supported'}},{status:400});
    await assert.rejects(callAIWithMessagesAndTools(config,[],[]), error=>error.nativeToolUnsupported===true);
`));

test('Anthropic text blocks and Gemini visible parts all reach the assistant', () => runProbe(`
    globalThis.fetch=async()=>Response.json({content:[{type:'thinking',thinking:'private'},{type:'text',text:'one '},{type:'text',text:'two'}]});
    assert.equal(await callAIWithMessages({provider:'anthropic',apiKey:'fixture'},[{role:'user',content:'x'}]),'one two');
    globalThis.fetch=async()=>Response.json({candidates:[{content:{parts:[{text:'one '},{thought:true,text:'not-visible'},{text:'two'}]}}]});
    assert.equal(await callAIWithMessages({provider:'google',apiKey:'fixture'},[]),'one two');
`));

test('abort cancels a pending stream reader and never publishes late text or retries', () => runProbe(`
    let count=0, canceled=false, publishCount=0;
    globalThis.fetch=async()=>{count++;return new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'content-type':'text/event-stream'}});};
    const controller=new AbortController();
    const running=callAIWithMessagesStream(config,[],()=>publishCount++,{signal:controller.signal});
    await new Promise(resolve=>setTimeout(resolve,0));
    controller.abort();
    assert.equal(await running,'');
    assert.equal(count,1);
    assert.equal(publishCount,0);
    assert.equal(canceled,true);
`));

test('Baidu authentication cache never reuses a token across configured credentials', () => runProbe(`
    let oauth=0;
    globalThis.fetch=async(url,options)=>{
        if(url.includes('/oauth/')){oauth++;return Response.json({access_token:'token-'+oauth,expires_in:3600});}
        assert.equal(new URL(url).searchParams.get('access_token'),'token-'+oauth);
        return Response.json({result:'ok'});
    };
    await callAI({provider:'baidu',apiKey:'first-key',secretKey:'first-secret'},'hello','');
    await callAI({provider:'baidu',apiKey:'second-key',secretKey:'second-secret'},'hello','');
    await callAI({provider:'baidu',apiKey:'second-key',secretKey:'second-secret'},'hello','');
    assert.equal(oauth,2);
`));

test('browser media requests use configured base paths and honor cancellation', () => runProbe(`
    const {generateImage,generateAudio}=await import('./src/lib/utils/ai-media-generation.js');
    let urls=[];
    globalThis.fetch=async(url,options)=>{
        urls.push(new URL(url).pathname);
        assert.ok(options.signal);
        if(url.includes('/images/')) return Response.json({data:[{b64_json:'YWJjZA=='}]});
        return new Response(new Uint8Array([97,98,99,100]));
    };
    const image=await generateImage({provider:'custom',customEndpoint:'https://media.invalid/v1?proxy=ok',prompt:'small tree'});
    assert.equal(image.base64Data,'YWJjZA==');
    const audio=await generateAudio({provider:'custom',customEndpoint:'https://media.invalid',text:'hello'});
    assert.equal(audio.base64Data,'YWJjZA==');
    assert.deepEqual(urls,['/v1/images/generations','/v1/audio/speech']);
    const controller=new AbortController();controller.abort();
    await assert.rejects(generateImage({provider:'custom',customEndpoint:'https://media.invalid',prompt:'small tree',signal:controller.signal}),{name:'AbortError'});
    assert.equal(urls.length,2);
`));
