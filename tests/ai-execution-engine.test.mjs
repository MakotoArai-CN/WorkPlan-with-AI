import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

function runProbe(script) {
    const result = Bun.spawnSync([process.execPath, '--eval', `
        import {mock} from 'bun:test';
        import assert from 'node:assert/strict';
        let calls=[];
        let response='fixture output';
        let complete;
        mock.module('./src/lib/utils/ai-providers.js',()=>({callAI:async(...args)=>{calls.push(['ai',...args]);return typeof response==='function'?await response(...args):response;}}));
        mock.module('./src/lib/utils/web-search.js',()=>({searchWeb:async(args)=>{calls.push(['search',args]);return [];},fetchWebContent:async()=>''}));
        mock.module('./src/lib/utils/local-file-tools.js',()=>({readSelectedTextFiles:async(args)=>{calls.push(['read',args]);return [{name:'fixture',content:'api_key=private-fixture-value\\nordinary text'}];}}));
        mock.module('./src/lib/utils/ai-media-generation.js',()=>({generateImage:async(args)=>{calls.push(['image',args]);return {url:'https://images.invalid/fixture.png'};}}));
        const {validatePlanSteps,decomposeIntoSteps,executePlan,cancelPlan,getTaskCreateResults}=await import('./src/lib/utils/ai-execution-engine.js');
        const plan=steps=>({id:crypto.randomUUID(),steps:steps.map((step,index)=>({index,status:'pending',...step}))});
        ${script}
    `], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
}

test('plan validation enforces step budgets, real types and previous-only dependencies', () => runProbe(`
    assert.throws(()=>validatePlanSteps(Array.from({length:7},()=>({type:'summarize'}))),/1至6/);
    assert.throws(()=>validatePlanSteps([{type:'run_shell',params:{}}]),/未知/);
    assert.throws(()=>validatePlanSteps([{type:'content_generation',params:{context_from_steps:[0]}}]),/先前/);
    assert.throws(()=>validatePlanSteps([{type:'file_read',params:{paths:'C:/secret'}}]),/参数/);
    assert.throws(()=>validatePlanSteps([{type:'web_fetch',params:{url:'file:///secret'}}]),/HTTP/);
    assert.equal(validatePlanSteps([{type:'content_generation',params:{prompt:'hello'}}]).length,1);
`));

test('a model cannot authorize file reads or billable media and secrets are excluded after approval', () => runProbe(`
    const blocked=plan([{type:'file_read',params:{paths:['C:/notes.md']}},{type:'image_generation',params:{prompt:'a small tree'}}]);
    await executePlan(blocked);
    assert.equal(blocked.status,'partial');
    assert.deepEqual(calls,[]);
    const approved=plan([{type:'file_read',params:{paths:['C:/notes.md','C:/project/.env','C:/Users/a/.workplan/.local-db-key']}}]);
    await executePlan(approved,{authorizeStep:async()=>true});
    assert.equal(approved.status,'done');
    assert.deepEqual(calls[0][1].paths,['C:/notes.md']);
    assert.equal(approved.steps[0].result.blockedPaths.length,2);
    assert.ok(!approved.steps[0].result.files[0].content.includes('private-fixture-value'));
`));

test('cancellation while a request is pending rejects its late result and all dependent tasks', () => runProbe(`
    response=()=>new Promise(resolve=>{complete=resolve;});
    const current=plan([{type:'content_generation',params:{prompt:'draft'}},{type:'task_create',params:{title:'should never appear',context_from_steps:[0]}}]);
    let started;
    const begun=new Promise(resolve=>{started=resolve;});
    let finished=0;
    const running=executePlan(current,{onStepStart:()=>started(),onStepComplete:()=>finished++});
    await begun;
    await new Promise(resolve=>setTimeout(resolve,0));
    cancelPlan(current.id);
    await running;
    assert.equal(current.status,'cancelled');
    assert.equal(finished,0);
    assert.deepEqual(getTaskCreateResults(current),[]);
    complete('too late');
    await Promise.resolve();
    assert.equal(current.steps[0].result,null);
`));

test('cancel during approval never executes the approved operation', () => runProbe(`
    let approve;
    const current=plan([{type:'file_read',params:{paths:['C:/notes.md']}}]);
    const controller=new AbortController();
    const running=executePlan(current,{signal:controller.signal,authorizeStep:()=>new Promise(resolve=>{approve=resolve;})});
    await Promise.resolve();
    controller.abort();
    await running;
    approve(true);
    await Promise.resolve();
    assert.equal(current.status,'cancelled');
    assert.deepEqual(calls,[]);
`));

test('failed prerequisite skips dependent work, preserves separate work and does not fabricate success', () => runProbe(`
    const current=plan([{type:'file_read',params:{paths:['C:/notes.md']}},{type:'task_create',params:{title:'dependent',context_from_steps:[0]}},{type:'content_generation',params:{prompt:'independent'}}]);
    await executePlan(current);
    assert.equal(current.status,'partial');
    assert.equal(current.steps[1].status,'failed');
    assert.equal(current.steps[2].status,'done');
    assert.deepEqual(getTaskCreateResults(current),[]);
    assert.equal(calls.length,1);
`));

test('invalid model plans visibly degrade to harmless content, not partial tool plans', () => runProbe(`
    response=JSON.stringify({steps:[{type:'file_delete',params:{path:'C:/data'}}]});
    const current=await decomposeIntoSteps('Research a topic',{});
    assert.equal(current.degraded,true);
    assert.equal(current.steps[0].type,'content_generation');
    assert.equal(current.steps.length,1);
`));

test('double-running a plan is rejected until the first run is cancelled', () => runProbe(`
    response=()=>new Promise(resolve=>{complete=resolve;});
    const current=plan([{type:'content_generation',params:{prompt:'slow'}}]);
    const running=executePlan(current);
    await assert.rejects(executePlan(current),/already running/);
    cancelPlan(current.id);
    await running;
    await assert.rejects(executePlan(current),/already completed/);
`));

test('approval sees an immutable copy and later plan edits cannot change the requested file', () => runProbe(`
    let authorize;
    const current=plan([{type:'file_read',params:{paths:['C:/approved.md']}}]);
    const running=executePlan(current,{authorizeStep:request=>{
        assert.ok(Object.isFrozen(request));assert.ok(Object.isFrozen(request.params.paths));
        return new Promise(resolve=>{authorize=resolve;});
    }});
    await Promise.resolve();
    current.steps[0].params.paths[0]='C:/different.md';
    authorize(true);
    await running;
    assert.deepEqual(calls[0][1].paths,['C:/approved.md']);
`));

test('a model cannot invent an external fetch URL outside the original request or search results', () => runProbe(`
    const blocked=plan([{type:'web_fetch',params:{url:'https://attacker.invalid/collect'}}]);
    await executePlan(blocked,{userMessage:'summarize my notes'});
    assert.equal(blocked.status,'partial');
    assert.ok(blocked.steps[0].error.includes('授权'));
    const allowed=plan([{type:'web_fetch',params:{url:'https://docs.invalid/article'}}]);
    await executePlan(allowed,{userMessage:'Summarize https://docs.invalid/article'});
    assert.equal(allowed.status,'done');
`));

test('cancelled plans never return earlier task proposals for confirmation', () => runProbe(`
    const completed={type:'task_create',status:'done',result:{task:{title:'Do not propose'}}};
    assert.deepEqual(getTaskCreateResults({status:'cancelled',steps:[completed]}),[]);
    assert.deepEqual(getTaskCreateResults(null),[]);
    assert.equal(getTaskCreateResults({status:'done',steps:[completed]}).length,1);
`));
