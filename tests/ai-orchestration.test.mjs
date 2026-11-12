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
        let response = { content: 'context answer', toolCalls: [] };
        let initialMessages;
        let nativeSupported = true;
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
            canProviderUseNativeTools: () => nativeSupported,
            callAIWithMessagesAndTools: async (_config, messages) => {
                requests++; capturedMessages = JSON.parse(JSON.stringify(messages));
                if (!messages.some(message=>message.role==='tool')) initialMessages = capturedMessages;
                if (messages.at(-1)?.role === 'tool') return {content:'context answer',toolCalls:[]};
                return typeof response === 'function' ? await response() : response;
            },
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
    assert.equal(requests,2);
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
    assert.match(get(ai.chatHistory).at(-1).content,/simulated persistence failure/);
    assert.equal(requests,3);
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
    assert.ok(capturedMessages.some(message=>message.role==='tool' && /工具参数无效/.test(message.content)));
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
    assert.match(get(ai.chatHistory).at(-1).content,/无效.*工具参数/);
    assert.equal(confirms,0);
    response.toolCalls=Array(9).fill({name:'workplan_notes_action',arguments:'{"action":"list"}'});
    await ai.sendAiMessage('查看笔记内容', {scope:'notes',source:'tasks',items:[]});
    assert.match(get(ai.chatHistory).at(-1).content,/预算/);
    assert.equal(confirms,0);
`));

test('ordinary chat remains usable with tools disabled and never impersonates another model', () => scenario(`
    settingsStore.update(state=>({...state,enableAiChatTools:false}));
    await ai.sendAiMessage('你好', {scope:'dashboard',source:'tasks',items:[]});
    assert.equal(get(ai.chatHistory).at(-1).content,'context answer');
    await ai.sendChatMessage('你好','fun');
    assert.equal(get(ai.aiChatHistory).at(-1).content,'context answer');
    assert.equal(get(ai.isAiLoading),false);
    assert.equal(requests,0);
    assert.ok(!capturedMessages[0].content.includes('你是 Grok'));
`));

test('note rewriting obtains content through a native query before generating a draft', () => scenario(`
    response.toolCalls=[{name:'workplan_read_data',arguments:'{"source":"current_note"}'}];
    await ai.sendAiMessage('请润色这篇笔记', {scope:'notes',mode:'note',source:'notes',activeNoteId:'note-1',noteTitle:'Original note',noteContent:'Original content',items:[]});
    assert.equal(get(ai.chatHistory).at(-1).content,'context answer');
    assert.equal(requests,2);
    assert.equal(confirms,0);
    assert.ok(capturedMessages[0].content.includes('工作文档模式'));
    assert.ok(!capturedMessages[0].content.includes('Original content'));
    assert.ok(capturedMessages.some(message=>message.role==='tool' && message.content.includes('Original content')));
    assert.ok(!JSON.stringify(initialMessages).includes('Original content'));
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

test('ordinary chat never classifies against application stores or includes earlier app data', () => scenario(`
    taskStore.update(state=>({...state,tasks:[{id:'secret-task',title:'PRIVATE_TASK_SENTINEL',note:'PRIVATE_TASK_BODY'}]}));
    ai.aiChatContext.set({scope:'notes',mode:'note',activeNoteId:'note-1',noteContent:'PRIVATE_CONTEXT_SENTINEL'});
    ai.aiChatHistory.set([{role:'assistant',type:'text',content:'PRIVATE_PRIOR_ANSWER'}]);
    await ai.sendChatMessage('解释一下彩虹是怎么形成的');
    assert.equal(requests,1);assert.equal(confirms,0);
    const payload=JSON.stringify(capturedMessages);
    for(const secret of ['PRIVATE_TASK_SENTINEL','PRIVATE_TASK_BODY','PRIVATE_CONTEXT_SENTINEL','PRIVATE_PRIOR_ANSWER','Original note','Original content','PROJECT_SUMMARY']) assert.ok(!payload.includes(secret),secret);
    assert.equal(capturedMessages.filter(message=>message.role==='user').length,1);
    assert.ok(payload.includes('彩虹'));
`));

test('the side assistant also excludes supplied application context for an ordinary question', () => scenario(`
    await ai.sendAiMessage('讲一个简短的笑话',{scope:'notes',mode:'note',activeNoteId:'note-1',noteContent:'PRIVATE_CONTEXT_SENTINEL',items:[{title:'PRIVATE_TASK_SENTINEL'}]});
    assert.equal(requests,1);assert.ok(!JSON.stringify(capturedMessages).includes('PRIVATE_'));
    assert.ok(!JSON.stringify(capturedMessages).includes('Original content'));
`));

test('unsupported attachments fail before history, model calls or composer clearing', () => scenario(`
    const file={name:'recording.wav',mediaType:'audio',mimeType:'audio/wav',base64Data:'YWJjZA==',size:4};
    ai.aiChatComposerAttachments.set([file]);
    await assert.rejects(ai.sendChatMessage('分析这个附件'),/未确认支持音频/);
    assert.equal(get(ai.aiChatHistory).length,0);assert.equal(get(ai.aiChatComposerAttachments).length,1);assert.equal(requests,0);
`));

test('attached text uses only explicit text content, never local paths or stored app data', () => scenario(`
    const attachment={name:'example.txt',path:'C:/private/DO_NOT_SEND_PATH/example.txt',mediaType:'text',mimeType:'text/plain',content:'USER_FILE_CONTENT'};
    await ai.sendChatMessage('只解释这个文件','default',null,{attachments:[attachment]});
    const payload=JSON.stringify(capturedMessages);
    assert.ok(payload.includes('USER_FILE_CONTENT'));assert.ok(!payload.includes('DO_NOT_SEND_PATH'));assert.ok(!payload.includes('Original content'));assert.equal(requests,1);
`));

test('native tool selection does not disclose data when no query is requested', () => scenario(`
    await ai.sendChatMessage('联网搜索最新AI新闻');
    assert.equal(requests,1);assert.equal(confirms,0);
    assert.ok(!JSON.stringify(capturedMessages).includes('Original content'));
    assert.ok(!JSON.stringify(capturedMessages).includes('/workspace'));
`));

test('the exact current-note question includes only the unlocked selected note and its latest saved body', () => scenario(`
    response.toolCalls=[{name:'workplan_read_data',arguments:'{"source":"current_note"}'}];
    notesStore.update(state=>({...state,notes:[
        {...state.notes[0],content:'LATEST_SELECTED_NOTE_BODY'},
        {id:'other-note',title:'PRIVATE_OTHER_NOTE',content:'PRIVATE_OTHER_BODY'}
    ]}));
    await ai.sendAiMessage('请基于当前笔记协助我，先简要指出可以继续完善的方向。',{
        scope:'notes',mode:'note',source:'notes',activeNoteId:'note-1',
        noteTitle:'STALE_TITLE',noteContent:'STALE_BODY',items:[]
    });
    assert.equal(requests,2);assert.equal(confirms,0);
    const payload=JSON.stringify(capturedMessages);
    assert.ok(!JSON.stringify(initialMessages).includes('LATEST_SELECTED_NOTE_BODY'));
    assert.ok(payload.includes('LATEST_SELECTED_NOTE_BODY'));
    assert.ok(payload.includes('Original note'));
    assert.ok(!payload.includes('STALE_BODY'));assert.ok(!payload.includes('PRIVATE_OTHER'));
    assert.ok(capturedMessages[0].content.includes('工作文档模式'));
`));

test('current-note authorization cannot bypass a lock or resurrect a deleted note from cached context', () => scenario(`
    response.toolCalls=[{name:'workplan_read_data',arguments:'{"source":"current_note"}'}];
    const context={scope:'notes',mode:'note',source:'notes',activeNoteId:'note-1',noteContent:'CACHED_SENSITIVE_BODY',items:[]};
    notesStore.update(state=>({...state,notes:state.notes.map(note=>({...note,aiLocked:true}))}));
    await ai.sendAiMessage('请基于当前笔记协助我',context);
    let payload=JSON.stringify(capturedMessages);
    assert.ok(payload.includes('禁止AI访问'));assert.ok(!payload.includes('Original content'));assert.ok(!payload.includes('CACHED_SENSITIVE_BODY'));
    notesStore.update(state=>({...state,notes:[]}));
    await ai.sendAiMessage('这篇笔记有何改进方向',context);
    payload=JSON.stringify(capturedMessages);
    assert.ok(payload.includes('不存在'));assert.ok(!payload.includes('CACHED_SENSITIVE_BODY'));
    assert.equal(requests,4);assert.equal(confirms,0);
`));

test('unsupported native-tool connections never use a classifier or silently preload the note', () => scenario(`
    nativeSupported=false;
    await ai.sendAiMessage('请基于当前笔记协助我',{
        scope:'notes',mode:'note',source:'notes',activeNoteId:'note-1',noteContent:'CACHED_PRIVATE_BODY',items:[]
    });
    assert.equal(requests,0);
    assert.ok(capturedMessages[0].content.includes('当前连接未提供原生工具'));
    assert.ok(!JSON.stringify(capturedMessages).includes('CACHED_PRIVATE_BODY'));
    assert.ok(!JSON.stringify(capturedMessages).includes('Original content'));
`));

test('task queries happen only after the native model requests the application read function', () => scenario(`
    taskStore.update(state=>({...state,tasks:[{id:'task-1',title:'ON_DEMAND_TASK_MARKER'}]}));
    response.toolCalls=[{name:'workplan_read_data',arguments:'{"source":"tasks","limit":1}'}];
    await ai.sendChatMessage('我今天有哪些任务？');
    assert.equal(requests,2);
    assert.ok(!JSON.stringify(initialMessages).includes('ON_DEMAND_TASK_MARKER'));
    assert.ok(capturedMessages.some(message=>message.role==='tool' && message.content.includes('ON_DEMAND_TASK_MARKER')));
`));
