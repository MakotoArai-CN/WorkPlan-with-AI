import { expect, test } from 'bun:test';
import { assertChatAttachments, assertProviderMessages, attachmentCapabilities } from '../src/lib/utils/ai-attachment-policy.js';

const image = { name: 'image.png', mediaType: 'image', mimeType: 'image/png', base64Data: 'YWJjZA==', size: 4 };
test('text conversion is bounded and binary documents are not silently pretended to be text', () => {
    expect(()=>assertChatAttachments({provider:'deepseek',model:'deepseek-chat'},[{name:'notes.md',mediaType:'text',content:'hello'}])).not.toThrow();
    for (const item of [{name:'document.pdf',mediaType:'file',content:'unreadable'}, {name:'data.zip',content:'binary'}, {name:'x.txt',content:'a\u0000b'}, {name:'x.txt',content:'a'.repeat(200001)}]) {
        expect(()=>assertChatAttachments({},[item])).toThrow();
    }
    expect(()=>assertChatAttachments({},Array(9).fill({name:'x.txt',content:'a'}))).toThrow();
});
test('known image models accept only supported raster types and bounded data', () => {
    const config={provider:'openai',model:'gpt-4o-mini'};
    expect(()=>assertChatAttachments(config,[image])).not.toThrow();
    for (const item of [{...image,mimeType:'image/svg+xml'}, {...image,truncated:true}, {...image,base64Data:'bad...'}, {...image,size:5000001}]) {
        expect(()=>assertChatAttachments(config,[item])).toThrow();
    }
    for (const config of [{provider:'deepseek',model:'deepseek-chat'},{provider:'custom',model:'unknown'},{provider:'openai',model:'auto'}]) {
        expect(()=>assertChatAttachments(config,[image])).toThrow();
    }
});
test('audio and video are gated to a supported protocol/model rather than being dropped', () => {
    const audio={name:'x.wav',mediaType:'audio',mimeType:'audio/wav',base64Data:'YWJjZA=='};
    expect(attachmentCapabilities({provider:'google',model:'gemini-2.5-flash'})).toEqual({image:true,audio:true,video:true});
    expect(()=>assertChatAttachments({provider:'google',model:'gemini-2.5-flash'},[audio])).not.toThrow();
    expect(()=>assertChatAttachments({provider:'anthropic',model:'claude-sonnet-4-6'},[audio])).toThrow();
    expect(()=>assertChatAttachments({provider:'openai',model:'gpt-4o'},[audio])).toThrow();
});
test('request boundary rejects multipart payloads in an incompatible API shape', () => {
    const openai=[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,YWJjZA=='}}]}];
    expect(()=>assertProviderMessages({provider:'openai',model:'gpt-4o'},openai)).not.toThrow();
    expect(()=>assertProviderMessages({provider:'google',model:'gemini-2.5-flash'},openai)).toThrow();
    expect(()=>assertProviderMessages({provider:'deepseek',model:'deepseek-chat'},openai)).toThrow();
    expect(()=>assertProviderMessages({provider:'openai',model:'gpt-4o'},[{role:'user',content:[{type:'input_file',file_id:'x'}]}])).toThrow();
});
