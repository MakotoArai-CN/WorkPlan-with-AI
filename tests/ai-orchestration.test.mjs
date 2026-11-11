import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

// Each scenario has isolated module mocks; no network, native DB or file I/O.
function scenario(body) {
    const script = `
        import { mock } from 'bun:test';
        import assert from 'node:assert/strict';
        import { writable, get } from 'svelte/store';
        const storage = new Map([['workplan_access_key', 'account-a']]);
        globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
        globalThis.fetch = async () => { throw new Error('Unexpected real network request'); };
        const settingsStore = writable({ enableAiChatTools: true, enableOvertime: true, workspaceRoot: '/workspace', localFileConfig: { enabled: true, requireConfirmation: true, trustedDirectories: [] } });
        const taskStore = Object.assign(writable({ accessKey: 'account-a', tasks: [], templates: [], scheduledTasks: [], overtimeRecords: [], leaveRecords: [{ id: 'leave-1', startDate: '2026-11-11', endDate: '2026-11-11', unit: 'day', duration: 1, type: 'annual', paid: true, note: 'original' }] }), {
            updateLeaveRecord(id, updates) { taskStore.update(state => ({ ...state, leaveRecords: state.leaveRecords.map(record => record.id === id ? { ...record, ...updates } : record) })); },
            addLeaveRecord(record) { taskStore.update(state => ({ ...state, leaveRecords: [...state.leaveRecords, record] })); }
        });
        const notesStore = Object.assign(writable({ notes: [{id:'note-1',title:'Original note',content:'Original content',category:'Work'}], categories: [] }), {
            updateNote(id, updates) { notesStore.update(state => ({...state, notes:state.notes.map(note => note.id === id ? {...note,...updates}:note)})); }
        });
        let response = { content: '', toolCalls: [] };
        let noteWriteFailure = false;
        let noteWrites = 0;
        let fileWrites = 0;
        let lastPrompt;
        let requests = 0;
        let confirms = 0;
        let confirm = async () => true;
        let capturedMessages;
        mock.module('./src/lib/stores/settings.js', () => ({ settingsStore }));
        mock.module('./src/lib/stores/tasks.js', () => ({ taskStore }));
        mock.module('./src/lib/stores/notes.js', () => ({ notesStore }));
        mock.module('./src/lib/stores/modal.js', () => ({ showConfirm: async () => { confirms++; return await confirm(); } }));
        mock.module('./src/lib/utils/local-file-tools.js', () => ({
            looksLikeFileIntent: text => /文件|file|workspace/.test(text),
            searchLocalFiles: async () => [], readLocalFile: async () => ({path:'/workspace/doc.md',content:'safe'}),
            writeLocalFile: async args => {fileWrites++; return {path:args.path};}, deleteLocalFile: async () => ({path:'/workspace/doc.md'}),
            pickLocalTextFiles: async()=>[],readSelectedTextFiles:async()=>[],readPastedFilesAsAttachments:async()=>[],
            isContentUri: path => /^content:/.test(path || ''),pickMediaFiles:async()=>[],readSelectedMediaFiles:async()=>[],
            getMediaType:()=> 'text',getFileExtension:()=> 'md',SUPPORTED_MEDIA_EXTENSIONS:[],isPathCoveredByContentTree:()=>false
        }));
        mock.module('./src/lib/utils/ai-providers.js', () => ({
            canProviderUseNativeTools: () => true,
            callAIWithMessagesAndTools: async (_config, messages) => { requests++; capturedMessages = messages; return typeof response === 'function' ? await response() : response; },
            callAI: async (_config,text,prompt) => { if(lastPrompt === null) {lastPrompt={text,prompt};return 'report';} throw new Error('Unexpected fallback request'); },
            callAIWithMessages: async (_config, messages) => { capturedMessages = messages; return 'context answer'; },
            getProviderBodyFormat: () => 'openai',
            PROVIDER_CONFIGS: {},
            callAIWithMessagesStream: async (_config, messages) => { capturedMessages = messages; return 'chat answer'; }
        }));
        const ai = await import('./src/lib/stores/ai.js');
        ai.aiConfig.set({ provider: 'custom', model: 'test', maxTokens: 1024 });
        ${body}
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000 });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
}

test('leave updates preserve unspecified fields and use typed values after confirmation', () => scenario(`
    response.toolCalls = [{name:'workplan_worklog_action',arguments:JSON.stringify({action:'update',kind:'leave',id:'leave-1',note:'changed'})}];
    await ai.sendAiMessage('修改请假记录的备注', {scope:'worklog', source:'tasks', items:[]});
    const record = get(taskStore).leaveRecords[0];
    assert.equal(record.note, 'changed');
    assert.equal(record.unit, 'day');
    assert.equal(record.paid, true);
    assert.equal(record.type, 'annual');
    assert.equal(confirms,1);
    assert.equal(requests,1);
`));

test('native project proposals retain their actual source when requested from another page', () => scenario(`
    response.toolCalls = [{name:'workplan_project_action',arguments:JSON.stringify({source:'templates',operation:'create',tasks:[{title:'Template test'}]})}];
    await ai.sendAiMessage('查询任务', {scope:'dashboard',source:'tasks',items:[]});
    const message = get(ai.chatHistory).at(-1);
    assert.equal(message.type,'task_card');
    assert.equal(message.assistantSource,'templates');
    assert.equal(message.data.title,'Template test');
`));

test('native duplicate calls execute once and partial execution errors never fall back into another router', () => scenario(`
    let writes=0;
    notesStore.updateNote = () => {writes++; if(writes===2) throw new Error('simulated persistence failure');};
    const call = {name:'workplan_notes_action',arguments:JSON.stringify({action:'update',id:'note-1',content:'changed'})};
    response.toolCalls=[call,call];
    await ai.sendAiMessage('修改笔记', {scope:'notes',source:'tasks',items:[]});
    assert.equal(writes,1);
    assert.equal(confirms,1);
    response.toolCalls=[call,{name:'workplan_notes_action',arguments:JSON.stringify({action:'update',id:'note-1',title:'Other title'})}];
    await ai.sendAiMessage('修改笔记', {scope:'notes',source:'tasks',items:[]});
    assert.match(get(ai.chatHistory).at(-1).content,/工具执行中断/);
    assert.equal(requests,2);
`));

test('file confirmations are identity-bound and cannot be replayed or forged', () => scenario(`
    const operation = {operation:'write',path:'/workspace/doc.md',content:'safe'};
    ai.aiChatHistory.set([{role:'assistant',type:'file_confirm',operation}]);
    assert.equal((await ai.confirmAiChatLocalFileOperation(0,{...operation})).success,false);
    assert.equal(fileWrites,0);
    const pending=ai.confirmAiChatLocalFileOperation(0,operation);
    assert.equal((await ai.confirmAiChatLocalFileOperation(0,operation)).success,false);
    assert.equal((await pending).success,true);
    assert.equal(fileWrites,1);
`));

test('native tool output cannot enable a tool disabled after the request started', () => scenario(`
    response=async()=>{ settingsStore.update(state=>({...state,localFileConfig:{...state.localFileConfig,enabled:false}})); return {toolCalls:[{name:'workplan_local_file',arguments:'{"operation":"read","path":"/workspace/doc.md"}'}]}; };
    await ai.sendChatMessage('读取文件 /workspace/doc.md');
    assert.equal(fileWrites,0);
    assert.match(get(ai.aiChatHistory).at(-1).content,/工具参数无效/);
`));

test('report custom placeholders all expand without promoting task contents to system instructions', () => scenario(`
    lastPrompt=null;
    ai.aiConfig.update(config=>({...config,dailyReportPrompt:'{{time}} {{time}} {{type}} {{tasks}} {{tasks}}'}));
    await ai.generateReport([{title:'untrusted sentinel instruction',status:'todo'}],'daily');
    assert.ok(!lastPrompt.prompt.includes('untrusted sentinel instruction'));
    assert.ok(!lastPrompt.prompt.includes('{{tasks}}'));
    assert.ok(!lastPrompt.prompt.includes('{{time}}'));
    assert.ok(lastPrompt.text.includes('untrusted sentinel instruction'));
    assert.ok(lastPrompt.text.includes('UNTRUSTED_CONTEXT'));
`));

test('declined confirmations and locking during a dialog never apply note updates', () => scenario(`
    response.toolCalls = [{name:'workplan_notes_action',arguments:JSON.stringify({action:'update',id:'note-1',content:'changed'})}];
    confirm = async () => false;
    await ai.sendAiMessage('修改笔记内容', {scope:'notes',source:'tasks',items:[]});
    assert.equal(get(notesStore).notes[0].content,'Original content');
    confirm = async () => { notesStore.update(state => ({...state,notes:state.notes.map(note=>({...note,aiLocked:true}))})); return true; };
    await ai.sendAiMessage('修改笔记内容', {scope:'notes',source:'tasks',items:[]});
    assert.equal(get(notesStore).notes[0].content,'Original content');
`));

test('account switch or cancellation while awaiting a dialog cannot mutate records', () => scenario(`
    response.toolCalls = [{name:'workplan_worklog_action',arguments:JSON.stringify({action:'update',kind:'leave',id:'leave-1',paid:false})}];
    confirm = async () => { storage.set('workplan_access_key','account-b'); return true; };
    await ai.sendAiMessage('修改请假记录为不带薪', {scope:'worklog',source:'tasks',items:[]});
    assert.equal(get(taskStore).leaveRecords[0].paid,true);
    storage.set('workplan_access_key','account-a');
    confirm = async () => { ai.stopStreaming(); return true; };
    await ai.sendAiMessage('修改请假记录为不带薪', {scope:'worklog',source:'tasks',items:[]});
    assert.equal(get(taskStore).leaveRecords[0].paid,true);
    assert.equal(get(ai.isAiLoading),false);
`));

test('malformed or oversized tool batches fail before confirmations without fallback', () => scenario(`
    response.toolCalls = [{name:'workplan_notes_action',arguments:'null'}];
    await ai.sendAiMessage('修改笔记内容', {scope:'notes',source:'tasks',items:[]});
    assert.match(get(ai.chatHistory).at(-1).content,/参数无效/);
    assert.equal(confirms,0);
    response.toolCalls=Array(9).fill({name:'workplan_notes_action',arguments:'{"action":"list"}'});
    await ai.sendAiMessage('查看笔记内容', {scope:'notes',source:'tasks',items:[]});
    assert.match(get(ai.chatHistory).at(-1).content,/上限/);
    assert.equal(confirms,0);
`));

test('ordinary chat remains usable with tools disabled and never impersonates another model', () => scenario(`
    settingsStore.update(state=>({...state,enableAiChatTools:false}));
    await ai.sendAiMessage('你好', {scope:'dashboard',source:'tasks',items:[]});
    assert.equal(get(ai.chatHistory).at(-1).content,'context answer');
    await ai.sendChatMessage('你好','fun');
    assert.equal(get(ai.aiChatHistory).at(-1).content,'chat answer');
    assert.equal(get(ai.isAiLoading),false);
    assert.equal(requests,0);
    assert.ok(!capturedMessages[0].content.includes('你是 Grok'));
`));

test('note rewriting uses the note-aware prompt without tool classification or mutations', () => scenario(`
    await ai.sendAiMessage('请润色这篇笔记', {scope:'notes',mode:'note',source:'notes',activeNoteId:'note-1',noteTitle:'Original note',noteContent:'Original content',items:[]});
    assert.equal(get(ai.chatHistory).at(-1).content,'context answer');
    assert.equal(requests,0);
    assert.equal(confirms,0);
    assert.ok(capturedMessages[0].content.includes('工作文档模式'));
    assert.ok(!capturedMessages[0].content.includes('Original content'));
    assert.ok(capturedMessages[1].content.includes('Original content'));
    assert.equal(get(notesStore).notes[0].content,'Original content');
`));

test('late replies after history clear cannot replace a newer response', () => scenario(`
    let release;
    response = () => new Promise(resolve => { release = resolve; });
    const pending = ai.sendAiMessage('查看笔记', {scope:'notes',source:'tasks',items:[]});
    while (!release) await new Promise(resolve=>setTimeout(resolve,0));
    ai.clearChatHistory();
    response = {content:'new reply',toolCalls:[]};
    await ai.sendAiMessage('查看笔记', {scope:'notes',source:'tasks',items:[]});
    release({content:'stale reply',toolCalls:[]});
    await pending;
    assert.equal(get(ai.chatHistory).at(-1).content,'new reply');
    assert.equal(get(ai.isAiLoading),false);
`));
