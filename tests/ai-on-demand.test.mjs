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
            expect(messages).toEqual([{ role: 'user', content: 'hello' }]);
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
            expect(messages.at(-1).role).toBe('tool');
            expect(messages.at(-1).tool_call_id).toBe('read-a');
            expect(messages.at(-2).tool_calls[0].function.name).toBe('workplan_read_data');
            expect(messages.at(-1).content).toContain('ONLY_SELECTED_BODY');
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
    await expect(runOnDemandAssistant({ ...base, callModel: async () => ({ toolCalls: [{ name: 'workplan_read_data', arguments: '{"source":"tasks"}' }] }) })).rejects.toThrow('轮次');
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
