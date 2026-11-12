import { expect, test } from 'bun:test';
import { READ_APP_DATA_TOOL, runOnDemandAssistant } from '../src/lib/utils/ai-on-demand.js';
import { queryApplicationData } from '../src/lib/utils/ai-app-query.js';

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
            aliases:[{operation:'search',root:'Desktop',query:'GPT'}],data:{root:'OneDrive/Desktop',entries:[{path:'OneDrive/Desktop/GPT/README.md'}]}},
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
