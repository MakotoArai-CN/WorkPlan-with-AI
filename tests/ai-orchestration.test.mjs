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
        settingsStore.addTrustedDirectory = directory => settingsStore.update(state=>({...state,localFileConfig:{...state.localFileConfig,trustedDirectories:[...state.localFileConfig.trustedDirectories,directory]}}));
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
        let fileSearches = [];
        let fileReads = [];
        let modelDriver;
        let pathResolutions = [];
        let acceptedDirectories = [];
        let acceptDirectory = true;
        let beforeDirectorySync = async () => {};
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
            resolveLocalPath: async path => {
                pathResolutions.push(path);
                if (path === '~/Desktop' || path === 'Desktop') return {path:'/isolated/OneDrive/Desktop',exists:true,isDirectory:true,authorized:acceptedDirectories.includes('/isolated/OneDrive/Desktop')};
                return {path,exists:!path.includes('missing'),isDirectory:!path.endsWith('.md'),authorized:path.startsWith('/workspace') || acceptedDirectories.includes(path)};
            },
            syncTrustedDirectories: async directories => {await beforeDirectorySync();acceptedDirectories=acceptDirectory?directories:[];return acceptedDirectories;},
            searchLocalFiles: async args => {fileSearches.push(args);return [{path:args.root+'/GPT/README.md',type:'file'}];}, readLocalFile: async args => {fileReads.push(args);return {path:args.path,content:args.path.endsWith('package.json')?'{"scripts":{"start":"node index.js"},"engines":{"node":">=20"}}':'Project fixture requires Node and npm install.',size:100,truncated:false};},
            searchLocalFilesDetailed: async args => {fileSearches.push(args);return {root:args.root,query:args.query,entries:[{path:args.root+'/GPT/README.md',name:'README.md',kind:'file'}],recursive:true,truncated:false,stopReason:'complete'};},
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
                if (modelDriver) return await modelDriver(messages);
                if (messages.some(message=>message.role === 'tool')) return {content:'context answer',toolCalls:[]};
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
    assert.ok(capturedMessages.some(message=>message.role==='tool' && message.content.includes('unknown_verify_before_retry')));
    assert.ok(capturedMessages.some(message=>message.role==='tool' && message.content.includes('simulated persistence failure')));
    assert.equal(writes,2);
    assert.equal(requests,3);
`));

for (const [source, name, args] of [
    ['notes', 'workplan_notes_action', { action: 'create', title: 'Created note' }],
    ['leave', 'workplan_worklog_action', { action: 'create_leave', start_date: '2026-11-12', end_date: '2026-11-12' }],
    ['overtime', 'workplan_worklog_action', { action: 'create_overtime', date: '2026-11-12', start: '18:00', end: '19:00' }]
]) test('confirmed ' + source + ' creation invalidates earlier list results', () => scenario(`
    notesStore.addNote = record => notesStore.update(state=>({...state,notes:[...state.notes,{...record,id:'new-note'}]}));
    taskStore.addOvertimeRecord = record => taskStore.update(state=>({...state,overtimeRecords:[...state.overtimeRecords,record]}));
    let round=0;
    const source=${JSON.stringify(source)};
    const before=source==='overtime'?0:1;
    modelDriver=async messages=>{
        if (!round++) return {toolCalls:[{id:'before',name:'workplan_read_data',arguments:JSON.stringify({source})}]};
        if (round===2) return {toolCalls:[{id:'create',name:${JSON.stringify(name)},arguments:${JSON.stringify(JSON.stringify(args))}}]};
        if (round===3) return {toolCalls:[{id:'after',name:'workplan_read_data',arguments:JSON.stringify({source})}]};
        const results=messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content));
        assert.equal(results[0].untrusted_data.total,before);
        assert.equal(results[1].untrusted_data.applied,true);
        assert.equal(results[2].cached,false);
        assert.equal(results[2].untrusted_data.total,before+1);
        return {content:'Verified current list.',toolCalls:[]};
    };
    await ai.sendChatMessage('新增记录后核对列表');
    assert.equal(get(ai.aiChatHistory).at(-1).content,'Verified current list.');
    assert.equal(confirms,1);
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
    assert.equal(get(ai.chatHistory).at(-1).type,'text');
    assert.equal(get(ai.chatHistory).at(-1).toolLimited,true);
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

test('desktop aliases resolve to the real native folder before authorization and execute after its allowlist is synchronized', () => scenario(`
    response.toolCalls=[{name:'workplan_local_file',arguments:JSON.stringify({operation:'search',root:'~/Desktop',query:'GPT'})}];
    await ai.sendChatMessage('桌面的GPT项目还能用吗？');
    const card=get(ai.aiChatHistory).at(-1);
    assert.equal(card.type,'file_confirm');
    assert.equal(card.operation.root,'/isolated/OneDrive/Desktop');
    assert.equal(card.operation.authorizationDirectory,'/isolated/OneDrive/Desktop');
    assert.equal(fileSearches.length,0);
    const result=await ai.confirmAiChatLocalFileOperation(get(ai.aiChatHistory).length-1,card.operation);
    assert.equal(result.success,true);
    assert.equal(fileSearches.length,1);
    assert.equal(fileSearches[0].root,'/isolated/OneDrive/Desktop');
    assert.ok(acceptedDirectories.includes('/isolated/OneDrive/Desktop'));
    assert.ok(pathResolutions.includes('~/Desktop'));
    assert.ok(!JSON.stringify(fileSearches).includes('/workspace/~'));
`));

test('a missing local directory reports its resolved location without authorizing or searching it', () => scenario(`
    response.toolCalls=[{name:'workplan_local_file',arguments:JSON.stringify({operation:'search',root:'/missing/Desktop',query:'GPT'})}];
    await ai.sendChatMessage('查看这个目录');
    assert.equal(fileSearches.length,0);
    assert.equal(acceptedDirectories.length,0);
    assert.ok(capturedMessages.some(message=>message.role==='tool' && message.content.includes('目标路径不存在')));
`));

test('validated native file arguments are never rewritten by language, filename extensions or quoted user text', () => scenario(`
    const path='/workspace/记录，.custom-format';
    response.toolCalls=[{name:'workplan_local_file',arguments:JSON.stringify({operation:'write',path,content:'  '})}];
    await ai.sendChatMessage('写入文件 "/workspace/other.txt"，内容：不要从这段话重建工具参数');
    const card=get(ai.aiChatHistory).at(-1);
    assert.equal(card.type,'file_confirm');
    assert.equal(card.operation.path,path);
    assert.equal(card.operation.content,'  ');
    assert.equal(fileWrites,0);
    assert.ok(pathResolutions.includes(path));
    assert.ok(!pathResolutions.includes('/workspace/other.txt'));
`));

test('confirmation does not execute until native authorization is accepted, and a rejected grant stays blocked', () => scenario(`
    const operation={operation:'search',root:'/isolated/OneDrive/Desktop',query:'GPT',authorizationDirectory:'/isolated/OneDrive/Desktop',originalUserText:'桌面的GPT项目还能用吗？'};
    ai.aiChatHistory.set([{role:'assistant',type:'file_confirm',operation}]);
    acceptDirectory=false;
    assert.equal((await ai.confirmAiChatLocalFileOperation(0,operation)).success,false);
    assert.equal(fileSearches.length,0);
    assert.deepEqual(get(settingsStore).localFileConfig.trustedDirectories,[]);
    acceptDirectory=true;
    let release;
    beforeDirectorySync=()=>new Promise(resolve=>{release=resolve;});
    ai.aiChatHistory.set([{role:'assistant',type:'file_confirm',operation}]);
    const pending=ai.confirmAiChatLocalFileOperation(0,operation);
    while(!release) await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(fileSearches.length,0);
    release();
    assert.equal((await pending).success,true);
    assert.equal(fileSearches.length,1);
`));

test('the desktop GPT project question continues after authorization with one scan and two key-file reads, not another search loop', () => scenario(`
    modelDriver=async messages=>{
        const results=messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content).untrusted_data);
        if(!results.length)return {toolCalls:[{id:'find-project',name:'workplan_local_file',arguments:'{"operation":"search","root":"Desktop","query":"GPT"}'}]};
        const reads=results.filter(result=>result.operation==='read');
        if(!reads.length){
            assert.equal(results[0].root,'/isolated/OneDrive/Desktop');assert.equal(results[0].recursive,true);
            return {toolCalls:['README.md','package.json'].map((name,index)=>({id:'key-file-'+index,name:'workplan_local_file',arguments:JSON.stringify({operation:'read',path:'/isolated/OneDrive/Desktop/GPT/'+name})}))};
        }
        assert.equal(reads.length,2);
        assert.ok(reads.some(result=>result.content.includes('engines')));
        return {content:'已检查 GPT 的 README 和 package.json，需要 Node>=20 和依赖；未实际运行，不能保证当前可用。',toolCalls:[]};
    };
    await ai.sendChatMessage('桌面的GPT项目还能用吗？');
    const index=get(ai.aiChatHistory).length-1, card=get(ai.aiChatHistory)[index];
    assert.equal(card.type,'file_confirm');assert.equal(fileSearches.length,0);
    assert.equal((await ai.confirmAiChatLocalFileOperation(index,card.operation)).success,true);
    assert.equal(fileSearches.length,1);assert.equal(fileReads.length,2);assert.equal(requests,3);
    assert.equal(get(ai.aiChatHistory)[index].type,'text');
    assert.ok(get(ai.aiChatHistory)[index].content.includes('README'));
    assert.ok(!get(ai.aiChatHistory)[index].content.includes('预算'));
    assert.equal(get(ai.isAiLoading),false);
`));
