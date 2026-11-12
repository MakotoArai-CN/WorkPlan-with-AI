import { expect, test } from 'bun:test';
import { runOnDemandAssistant as runToolLoop } from '../src/lib/utils/ai-on-demand.js';
import { describeOperation } from '../src/lib/utils/ai-operation-policy.js';
import { READ_APP_DATA_TOOL, queryApplicationData } from '../src/lib/utils/ai-app-query.js';

// Existing application-tool fixtures are adapters over the generic executor.
function runOnDemandAssistant({ readData, executeAction, ...options }) {
    return runToolLoop({ limits: { maxCalls: 8, maxRounds: 5, contextCharacters: 47000, observationCharacters: 19000 }, ...options, describeOperation, executeTool: async (call, args) => {
        if (call.name === 'workplan_read_data') {
            const query = await readData(args);
            return { ...query, lease: { source: args.source, id: query.data?.note?.id || args.id } };
        }
        const result = await executeAction({ ...call, arguments: JSON.stringify(args) });
        return { data: result?.toolData || result, applied: result?.applied === true,
            card: result?.type && result.type !== 'text' ? result : null };
    } });
}

function stores() {
    let state = { activeNoteId: 'a', notes: [{ id: 'a', title: 'Selected', content: 'ONLY_SELECTED_BODY' },
        { id: 'b', title: 'Other', content: 'OTHER_PRIVATE_BODY' }, { id: 'locked', title: 'Locked', content: 'LOCKED_SECRET', aiLocked: true }] };
    let projects = { tasks: [{ id: 'task-1', title: 'One', note: 'task body' }] };
    const access = { context: { activeNoteId: 'a' }, getNotes: () => state, getProjects: async () => projects,
        getProjectsSnapshot: () => projects, overtimeEnabled: () => false };
    return { access, get state() { return state; }, set state(next) { state = next; }, get projects() { return projects; }, set projects(next) { projects = next; } };
}

test('native model chooses when to query: plain response never touches application data', async () => {
    let queries = 0;
    const result = await runOnDemandAssistant({ messages: [{ role: 'user', content: 'hello' }], tools: [READ_APP_DATA_TOOL],
        isCurrent: () => true, readData: async () => { queries++; throw new Error('unexpected read'); }, executeAction: async () => {},
        callModel: async messages => {
            expect(messages[0]).toEqual({ role: 'user', content: 'hello' });
            expect(messages.at(-1).content).toContain('剩余');
            return { content: 'hello back', toolCalls: [] };
        } });
    expect(queries).toBe(0);
    expect(result.content).toBe('hello back');
});

test('read result is sent in native tool protocol before the model generates the answer', async () => {
    const fixture = stores();
    let round = 0;
    const result = await runOnDemandAssistant({ messages: [{ role: 'user', content: 'help with this note' }], tools: [READ_APP_DATA_TOOL],
        isCurrent: () => true, readData: args => queryApplicationData(args, fixture.access), executeAction: async () => {},
        callModel: async messages => {
            if (!round++) {
                expect(JSON.stringify(messages)).not.toContain('ONLY_SELECTED_BODY');
                return { toolCalls: [{ id: 'read-a', name: 'workplan_read_data', arguments: '{"source":"current_note"}' }] };
            }
            const tool = messages.filter(message => message.role === 'tool').at(-1);
            expect(tool.tool_call_id).toBe('read-a');
            expect(messages.find(message => message.tool_calls)?.tool_calls[0].function.name).toBe('workplan_read_data');
            expect(tool.content).toContain('ONLY_SELECTED_BODY');
            expect(JSON.stringify(messages)).not.toContain('OTHER_PRIVATE_BODY');
            expect(JSON.stringify(messages)).not.toContain('LOCKED_SECRET');
            return { content: 'grounded answer', toolCalls: [] };
        } });
    expect(result.content).toBe('grounded answer');
    expect(round).toBe(2);
});

test('query leases reject late answers after note selection, lock or content changes', async () => {
    for (const mutate of [fixture => { fixture.state = { ...fixture.state, activeNoteId: 'b' }; },
        fixture => { fixture.state = { ...fixture.state, notes: fixture.state.notes.map(note => note.id === 'a' ? { ...note, aiLocked: true } : note) }; },
        fixture => { fixture.state = { ...fixture.state, notes: fixture.state.notes.map(note => note.id === 'a' ? { ...note, content: 'Changed' } : note) }; }]) {
        const fixture = stores();
        let count = 0;
        await expect(runOnDemandAssistant({ messages: [], tools: [READ_APP_DATA_TOOL], isCurrent: () => true,
            readData: args => queryApplicationData(args, fixture.access), executeAction: async () => {},
            callModel: async () => {
                if (!count++) return { toolCalls: [{ name: 'workplan_read_data', arguments: '{"source":"current_note"}' }] };
                mutate(fixture);
                return { content: 'stale result', toolCalls: [] };
            } })).rejects.toThrow('数据已改变');
    }
});

test('queries hide locked records, page summaries without full text and bound single-note content', async () => {
    const fixture = stores();
    const list = await queryApplicationData({ source: 'notes', limit: 1, offset: 1 }, fixture.access);
    expect(list.data.records).toEqual([{ id: 'b', title: 'Other', category: '' }]);
    expect(JSON.stringify(list)).not.toContain('PRIVATE_BODY');
    expect((await queryApplicationData({ source: 'notes', id: 'locked' }, fixture.access)).data.error).toBeTruthy();
    expect((await queryApplicationData({ source: 'current_note' }, fixture.access)).data.note.id).toBe('a');
    expect((await queryApplicationData({ source: 'overtime' }, fixture.access)).data.error).toBeTruthy();
    expect((await queryApplicationData({ source: 'vault' }, fixture.access)).data.error).toBeTruthy();
    fixture.state = { ...fixture.state, notes: [{ id: 'a', content: 'x'.repeat(20000) }] };
    const one = await queryApplicationData({ source: 'current_note' }, fixture.access);
    expect(one.data.note.content.length).toBe(8000);
    expect(one.data.note.truncated).toBe(true);
    const tail = await queryApplicationData({ source: 'current_note', content_offset: 16000 }, fixture.access);
    expect(tail.data.note.content.length).toBe(4000);
    expect(tail.data.note.truncated).toBe(false);
    fixture.state = { ...fixture.state, activeNoteId: null };
    expect((await queryApplicationData({ source: 'current_note' }, fixture.access)).data.error).toContain('没有选中');
});

test('model errors, invalid calls and budgets never fall back to a second routing system', async () => {
    let actions = 0;
    const base = { messages: [], tools: [READ_APP_DATA_TOOL], isCurrent: () => true,
        readData: async () => ({ data: [] }), executeAction: async () => { actions++; } };
    await expect(runOnDemandAssistant({ ...base, callModel: async () => ({ toolCalls: [{ name: 'workplan_read_data', arguments: '{"source":"vault"}' }] }) })).rejects.toThrow('无效');
    await expect(runOnDemandAssistant({ ...base, callModel: async () => { throw new Error('HTTP 401'); } })).rejects.toThrow('401');
    const exhausted = await runOnDemandAssistant({ ...base, callModel: async () => ({ toolCalls: [{ name: 'workplan_read_data', arguments: '{"source":"tasks"}' }] }) });
    expect(exhausted.toolLimited).toBe(true);
    expect(exhausted.content).toContain('实际获取');
    expect(actions).toBe(0);
});

test('query followed by an explicitly confirmed update can complete without treating its own write as stale', async () => {
    const fixture = stores();
    const updateTool = { type: 'function', function: { name: 'workplan_notes_action', parameters: {
        type: 'object', properties: { action: { type: 'string', enum: ['update'] }, id: { type: 'string' } }, required: ['action', 'id']
    } } };
    let round = 0;
    const result = await runOnDemandAssistant({ messages: [], tools: [READ_APP_DATA_TOOL, updateTool], isCurrent: () => true,
        readData: args => queryApplicationData(args, fixture.access),
        executeAction: async () => {
            fixture.state = { ...fixture.state, notes: fixture.state.notes.map(note => note.id === 'a' ? { ...note, content: 'Confirmed update' } : note) };
            return { role: 'assistant', type: 'text', applied: true, content: '已确认修改' };
        },
        callModel: async () => {
            if (!round++) return { toolCalls: [{ id: 'read', name: 'workplan_read_data', arguments: '{"source":"current_note"}' }] };
            if (round === 2) return { toolCalls: [{ id: 'update', name: 'workplan_notes_action', arguments: '{"action":"update","id":"a"}' }] };
            return { content: '根据确认结果完成回复', toolCalls: [] };
        }
    });
    expect(result.content).toContain('确认结果');
    expect(fixture.state.notes[0].content).toBe('Confirmed update');
});

test('eight successful reads followed by more calls retain results and finish with tools disabled', async () => {
    let reads = 0, finalized = 0;
    const result = await runOnDemandAssistant({ messages: [{role:'user',content:'桌面的GPT项目还能用吗？'}], tools: [READ_APP_DATA_TOOL],
        isCurrent: () => true, executeAction: async () => {throw Error('unexpected write');},
        readData: async args => {reads++;return {data:{id:args.id,content:'PROJECT_README_OBSERVED'}};},
        callModel: async () => ({toolCalls:Array.from({length:4},(_,i)=>({id:`read-${reads+i}`,name:'workplan_read_data',arguments:JSON.stringify({source:'tasks',id:String(reads+i)})}))}),
        finalizeModel: async messages => {
            finalized++;expect(messages.at(-1).content).toContain('禁止继续调用');
            expect(JSON.stringify(messages)).toContain('PROJECT_README_OBSERVED');
            return '已检查项目说明；没有运行项目，仍需确认依赖。';
        }
    });
    expect(reads).toBe(8);expect(finalized).toBe(1);
    expect(result.type).toBe('text');expect(result.toolLimited).toBe(true);expect(result.content).toContain('已检查项目说明');
});

test('repeated native reads reuse the exact observed result and stop without repeated execution', async () => {
    let reads=0,models=0;
    const result=await runOnDemandAssistant({messages:[],tools:[READ_APP_DATA_TOOL],isCurrent:()=>true,executeAction:async()=>{},
        readData:async()=>{reads++;return{data:{content:'ONE_REAL_READ'}};},
        callModel:async()=>({toolCalls:[{id:`read-${models++}`,name:'workplan_read_data',arguments:'{"source":"current_note"}'}]}),
        finalizeModel:async messages=>{expect(messages.some(message=>message.role==='tool'&&JSON.parse(message.content).cached)).toBe(true);return '已复用一次读取的结果。';}
    });
    expect(reads).toBe(1);expect(models).toBe(2);expect(result.toolLimited).toBe(true);
});

test('an oversized new tool batch executes nothing and still ends with an honest bounded reply', async () => {
    let reads=0;
    const result=await runOnDemandAssistant({messages:[],tools:[READ_APP_DATA_TOOL],isCurrent:()=>true,executeAction:async()=>{throw Error('unexpected');},
        readData:async()=>{reads++;return{data:[]};},
        callModel:async()=>({toolCalls:Array(9).fill({name:'workplan_read_data',arguments:'{"source":"tasks"}'})}),
        finalizeModel:async()=> '本轮没有执行这一批查询，请先选定目标目录。'
    });
    expect(reads).toBe(0);expect(result.type).toBe('text');expect(result.toolLimited).toBe(true);
});

test('if final response fails, actual acquired facts are returned rather than discarded as a budget error', async () => {
    let reads=0;
    const result=await runOnDemandAssistant({messages:[],tools:[READ_APP_DATA_TOOL],isCurrent:()=>true,executeAction:async()=>{},
        readData:async()=>{reads++;return{data:{path:'Desktop/GPT/README.md',content:'ACTUAL_PROJECT_REQUIREMENT'}};},
        callModel:async()=>({toolCalls:[{name:'workplan_read_data',arguments:'{"source":"tasks"}'}]}),
        finalizeModel:async()=>{throw Error('synthetic final model outage');}
    });
    expect(reads).toBe(1);expect(result.content).toContain('ACTUAL_PROJECT_REQUIREMENT');expect(result.content).toContain('尚不能');
});

test('cancellation during the final no-tool response cannot publish stale acquired facts', async () => {
    let current=true;
    let count=0;
    await expect(runOnDemandAssistant({messages:[],tools:[READ_APP_DATA_TOOL],isCurrent:()=>current,executeAction:async()=>{},
        readData:async()=>({data:'PRIVATE_FACT'}),
        callModel:async()=>({toolCalls:count++ ? Array(9).fill({name:'workplan_read_data',arguments:'{"source":"tasks"}'})
            : [{name:'workplan_read_data',arguments:'{"source":"tasks"}'}]}),
        finalizeModel:async()=>{current=false;return 'stale answer';}
    })).rejects.toThrow('取消');
});

test('an already authorized file result seeds the native continuation rather than performing the original scan twice', async () => {
    const fileTool={type:'function',function:{name:'workplan_local_file',parameters:{type:'object',properties:{operation:{type:'string'},root:{type:'string'},query:{type:'string'},response_goal:{type:'string'}},required:['operation']}}};
    let scans=0,models=0;
    const result=await runOnDemandAssistant({messages:[{role:'user',content:'桌面的GPT项目还能用吗？'}],tools:[fileTool],isCurrent:()=>true,readData:async()=>{},
        initialResult:{name:'workplan_local_file',arguments:'{"operation":"search","root":"C:/Users/fixture/OneDrive/Desktop","query":"GPT"}',
            aliases:[{operation:'search',root:'~/Desktop',query:'gpt'}],data:{root:'OneDrive/Desktop',entries:[{path:'OneDrive/Desktop/GPT/README.md'}]}},
        executeAction:async()=>{scans++;return{type:'text',content:'should not re-scan'};},
        callModel:async messages=>{
            models++;expect(JSON.stringify(messages)).toContain('OneDrive/Desktop/GPT/README.md');
            return{toolCalls:[{id:'retry-scan',name:'workplan_local_file',arguments:'{"query":"gpt","response_goal":"different model wording","root":"~/Desktop","operation":"search"}'}]};
        },finalizeModel:async()=> '目录已找到，仅检查文件，不代表项目已运行。'
    });
    expect(scans).toBe(0);expect(models).toBe(1);expect(result.content).toContain('目录已找到');
});

test('oversized result context truncates observed data and stops additional work instead of losing the answer', async () => {
    let reads=0;
    const result=await runOnDemandAssistant({messages:[],tools:[READ_APP_DATA_TOOL],isCurrent:()=>true,executeAction:async()=>{},
        callModel:async()=>({toolCalls:Array.from({length:4},(_,i)=>({id:'big-'+i,name:'workplan_read_data',arguments:JSON.stringify({source:'tasks',id:String(i)})}))}),
        readData:async()=>{reads++;return{data:{content:'LARGE_OBSERVED_FACT '+('"'.repeat(100000))}};},
        finalizeModel:async messages=>{
            const results=messages.filter(message=>message.role==='tool');
            expect(JSON.stringify(results).length).toBeLessThan(56000);
            expect(JSON.stringify(results)).toContain('LARGE_OBSERVED_FACT');
            expect(results.some(message=>message.content.includes('truncated'))).toBe(true);
            return '已保留本次读取的截断结果。';
        }
    });
    expect(reads).toBeLessThanOrEqual(4);expect(result.toolLimited).toBe(true);expect(result.content).toContain('截断结果');
});

test('budget recovery is identical across notes, tasks, schedules and worklog queries', async () => {
    for (const source of ['current_note', 'notes', 'tasks', 'templates', 'scheduled', 'overtime', 'leave']) {
        let queries=0, finalCalls=0;
        const result=await runOnDemandAssistant({messages:[{role:'user',content:'请根据所需数据回答当前问题'}],tools:[READ_APP_DATA_TOOL],isCurrent:()=>true,
            executeAction:async()=>{throw Error('unexpected action');},
            readData:async args=>{queries++;return{data:{source:args.source,id:args.id,value:'ACTUAL_'+source}};},
            callModel:async()=>({toolCalls:Array.from({length:4},(_,index)=>({id:'q-'+(queries+index),name:'workplan_read_data',arguments:JSON.stringify({source,id:String(queries+index)})}))}),
            finalizeModel:async messages=>{
                finalCalls++;
                expect(JSON.stringify(messages)).toContain('ACTUAL_'+source);
                expect(messages.at(-1).content).not.toContain('目录');
                expect(messages.at(-1).content).not.toContain('项目');
                return '依据已返回的数据完成回答，未验证事项已注明。';
            }
        });
        expect(queries).toBe(8);expect(finalCalls).toBe(1);expect(result.toolLimited).toBe(true);
    }
});

test('a failed read becomes a structured observation and cannot discard a preceding success', async () => {
    let round=0;
    const result=await runOnDemandAssistant({messages:[],tools:[READ_APP_DATA_TOOL],isCurrent:()=>true,executeAction:async()=>{},
        readData:async args=>{if(args.id==='bad')throw Error('synthetic read failure');return{data:{id:args.id,value:'SAVED_SUCCESS'}};},
        callModel:async messages=>{
            if(!round++)return{toolCalls:['ok','bad'].map((id,index)=>({id:'q'+index,name:'workplan_read_data',arguments:JSON.stringify({source:'tasks',id})}))};
            const evidence=messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content).untrusted_data);
            expect(evidence[0].value).toBe('SAVED_SUCCESS');expect(evidence[1].status).toBe('failed');expect(evidence[1].error).toContain('read failure');
            return{toolCalls:[],content:'一项查询成功，另一项失败；未丢弃已知信息。'};
        }
    });
    expect(result.content).toContain('一项查询成功');
});

test('invalid or blank follow-up model responses retain prior data instead of asking the user to start over', async () => {
    for(const followUp of [{toolCalls:[{name:'workplan_read_data',arguments:'{"source":"vault"}'}]}, {content:'',toolCalls:[]}, null, {toolCalls:{}}, {content:{}}]){
        let round=0;
        const result=await runOnDemandAssistant({messages:[],tools:[READ_APP_DATA_TOOL],isCurrent:()=>true,executeAction:async()=>{},
            readData:async()=>({data:{value:'KNOWN_RESULT'}}),
            callModel:async()=>!round++?{toolCalls:[{id:'valid',name:'workplan_read_data',arguments:'{"source":"tasks"}'}]}:followUp,
            finalizeModel:async messages=>{expect(JSON.stringify(messages)).toContain('KNOWN_RESULT');return '基于已取得数据回答。';}
        });
        expect(result.toolLimited).toBe(true);expect(result.content).toBe('基于已取得数据回答。');
    }
});

test('a mutation failure stops later mutations and preserves confirmed outcomes without replay', async () => {
    const definition={type:'function',function:{name:'workplan_notes_action',parameters:{type:'object',properties:{action:{type:'string'},id:{type:'string'},message:{type:'string'}},required:['action','id']}}};
    let writes=0;
    const result=await runOnDemandAssistant({messages:[],tools:[definition],isCurrent:()=>true,readData:async()=>{},
        callModel:async()=>({toolCalls:['first','failed','later'].map((id,index)=>({id:'action-'+index,name:'workplan_notes_action',arguments:JSON.stringify({action:'update',id})}))}),
        executeAction:async call=>{writes++;if(JSON.parse(call.arguments).id==='failed')throw Error('write result uncertain');return{type:'text',applied:true,content:'CONFIRMED_FIRST_CHANGE'};},
        finalizeModel:async messages=>{
            expect(JSON.stringify(messages)).toContain('CONFIRMED_FIRST_CHANGE');
            expect(JSON.stringify(messages)).toContain('unknown_verify_before_retry');
            return '首项已完成，次项结果未确认，后续未执行。';
        }
    });
    expect(writes).toBe(2);expect(result.content).toContain('后续未执行');
    expect(result.content).not.toContain('操作状态：');
});

test('shared tool-loop policies never hardcode a particular question, directory or business conclusion', () => {
    const source = require('node:fs').readFileSync(new URL('../src/lib/utils/ai-on-demand.js', import.meta.url), 'utf8');
    const finish = source.slice(source.indexOf('const finish ='), source.indexOf('if (initialResult)'));
    for (const specific of ['GPT', '项目可以运行', '项目目录', 'README', 'package.json', '桌面']) {
        expect(finish).not.toContain(specific);
    }
    expect(source).not.toContain('workplan_');
});

const recordTools = ['lookup_record', 'change_record'].map(name => ({ type: 'function', function: {
    name, parameters: { type: 'object', properties: { key: { type: 'string' }, explanation: { type: 'string' } }, required: ['key'] }
} }));
const recordCall = (name, key, id, explanation = '') => ({ name, id, arguments: JSON.stringify({ key, explanation }) });
const recordPolicy = (call, args) => ({ identity: { key: args.key }, readOnly: call.name === 'lookup_record',
    invalidates: [{ source: 'records', id: args.key }] });

test('a confirmed mutation receipt is summarized with tools disabled and never re-executes the operation', async () => {
    let finalizations = 0;
    const result = await runToolLoop({ messages: [], tools: recordTools, isCurrent: () => true, describeOperation: recordPolicy,
        initialResult: { name: 'change_record', arguments: '{"key":"a"}', applied: true, data: { status: 'completed', receipt: 'REAL_RECEIPT' } },
        executeTool: async () => { throw Error('Mutation must not be executed again'); },
        callModel: async () => { throw Error('Tools must not be requested after confirmation'); },
        finalizeModel: async messages => { finalizations++; expect(JSON.stringify(messages)).toContain('REAL_RECEIPT'); return 'Confirmed completed change.'; }
    });
    expect(finalizations).toBe(1); expect(result.applied).toBe(true); expect(result.toolLimited).toBe(false);
});

test('arbitrary tool adapters share deduplication, lease invalidation and read-after-write freshness', async () => {
    let round = 0, reads = 0, writes = 0, revision = 0;
    const result = await runToolLoop({ messages: [], tools: recordTools, isCurrent: () => true, describeOperation: recordPolicy,
        executeTool: async (call, args) => {
            if (call.name === 'change_record') { writes++; revision++; return { applied: true, data: { revision } }; }
            reads++;
            const observed = revision;
            return { data: { revision }, lease: { source: 'records', id: args.key }, isCurrent: () => revision === observed };
        },
        callModel: async messages => {
            if (!round++) return { toolCalls: [recordCall('lookup_record', 'a', 'read-first')] };
            if (round === 2) return { toolCalls: [recordCall('change_record', 'a', 'write-first'),
                recordCall('change_record', 'a', 'write-again', 'different wording'), recordCall('lookup_record', 'a', 'read-latest')] };
            const results = messages.filter(message => message.role === 'tool');
            expect(JSON.parse(results.at(-1).content).untrusted_data.revision).toBe(1);
            expect(JSON.parse(results.at(-2).content).cached).toBe(true);
            return { content: 'Current record confirmed.' };
        }
    });
    expect(reads).toBe(2); expect(writes).toBe(1); expect(result.content).toBe('Current record confirmed.');
});

test('actual execution limits hold when a write invalidates a cached read in the same batch', async () => {
    let round = 0, executions = 0;
    const result = await runToolLoop({ limits: { maxCalls: 8 }, messages: [], tools: recordTools, isCurrent: () => true, describeOperation: recordPolicy,
        executeTool: async call => { executions++; return { data: { executed: executions }, applied: call.name === 'change_record' }; },
        callModel: async () => {
            if (!round++) return { toolCalls: [0, 1, 2, 3].map(key => recordCall('lookup_record', String(key), 'r' + key)) };
            if (round === 2) return { toolCalls: [4, 5, 6].map(key => recordCall('lookup_record', String(key), 'r' + key)) };
            return { toolCalls: [recordCall('change_record', '0', 'write'), recordCall('lookup_record', '0', 'invalidated-read')] };
        },
        finalizeModel: async messages => {
            const replies = messages.filter(message => message.role === 'tool');
            expect(replies).toHaveLength(9);
            expect(JSON.parse(replies.at(-1).content).untrusted_data.status).toBe('not_executed');
            return 'Completed within the execution limit.';
        }
    });
    expect(executions).toBe(8); expect(result.toolLimited).toBe(true);
});

test('arbitrary mutation failures close every tool-call ID without replaying or inventing UI status text', async () => {
    let executions = 0;
    const result = await runToolLoop({ messages: [], tools: recordTools, isCurrent: () => true, describeOperation: recordPolicy,
        callModel: async () => ({ toolCalls: ['first', 'second', 'third'].map(key => recordCall('change_record', key, key)) }),
        executeTool: async () => { if (++executions === 2) throw Error('unconfirmed change'); return { data: { receipt: 'CONFIRMED_RECEIPT' }, applied: true }; },
        finalizeModel: async messages => {
            const replies = messages.filter(message => message.role === 'tool');
            expect(replies.map(message => message.tool_call_id)).toEqual(['first', 'second', 'third']);
            expect(JSON.parse(replies[0].content).untrusted_data.receipt).toBe('CONFIRMED_RECEIPT');
            expect(JSON.parse(replies[1].content).untrusted_data.effect).toBe('unknown_verify_before_retry');
            expect(JSON.parse(replies[2].content).untrusted_data.status).toBe('not_executed');
            return 'First confirmed; second uncertain; third not executed.';
        }
    });
    expect(executions).toBe(2); expect(result.content).toBe('First confirmed; second uncertain; third not executed.');
});

test('malformed final responses cannot discard observations from arbitrary tools', async () => {
    for (const finalResponse of [null, { content: {} }, { content: 42 }, { toolCalls: [] }]) {
        let round = 0;
        const result = await runToolLoop({ messages: [], tools: recordTools, isCurrent: () => true, describeOperation: recordPolicy,
            executeTool: async () => ({ data: { receipt: 'REAL_OBSERVATION' } }),
            callModel: async () => ({ toolCalls: [recordCall('lookup_record', 'a', 'read-' + round++)] }),
            finalizeModel: async () => finalResponse
        });
        expect(result.content).toContain('REAL_OBSERVATION');
        expect(result.toolLimited).toBe(true);
    }
});

test('default execution capacity retains a 30k-token-sized observation and continues beyond eight calls', async () => {
    let executed = 0, rounds = 0;
    const content = '真实内容'.repeat(7500);
    const result = await runToolLoop({ messages: [], tools: recordTools, isCurrent: () => true, describeOperation: recordPolicy,
        executeTool: async () => ({ data: { sequence: ++executed, content } }),
        callModel: async messages => {
            if (rounds++ < 4) return { toolCalls: Array.from({ length: 3 }, (_, index) => recordCall('lookup_record', String(executed + index), 'q-' + (executed + index))) };
            const results = messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content).untrusted_data);
            expect(results).toHaveLength(12);
            for (const observation of results) expect(observation.content).toBe(content);
            return { content: 'All twelve observations retained.' };
        }
    });
    expect(executed).toBe(12); expect(result.toolLimited).not.toBe(true);
});
