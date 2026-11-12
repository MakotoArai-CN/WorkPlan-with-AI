import { expect, test } from 'bun:test';
import { buildConversationContext, conversationBeforeRequest, conversationContextKey, fileConversationObservation } from '../src/lib/utils/ai-conversation-context.js';

const answer = (content, applicationData = false, observations = []) => ({ role: 'assistant', type: 'text', content,
    conversationContext: { version: 1, applicationData, observations } });
const question = content => ({ role: 'user', type: 'text', content });

test('keeps completed ordered turns and scopes without duplicating the current request or UI objects', () => {
    const history = [answer('ORPHAN'), question('Use /a, top-level only'), answer('Two reports', false, [{ root: '/a', recursive: false }]),
        question('Another type?'), { role: 'assistant', type: 'loading' }];
    const previous = conversationBeforeRequest(history, 4);
    const result = buildConversationContext(previous);
    expect(result.messages.map(message => message.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(JSON.stringify(result)).toContain('/a');
    expect(JSON.parse(result.messages[2].content).historical_tool_observations[0].recursive).toBe(false);
    expect(JSON.stringify(result)).not.toContain('Another type?');
    expect(JSON.stringify(result)).not.toContain('ORPHAN');
    expect(JSON.stringify(result)).not.toContain('loading');
});

test('application answers and legacy answer bodies are not replayed as currently accessible records', () => {
    const history = [question('Inspect a record'), answer('LOCKED_RECORD_BODY', true), question('Old result'),
        { role: 'assistant', type: 'text', content: 'LEGACY_PRIVATE_BODY' }, question('Hello'), answer('Normal answer')];
    const encoded = JSON.stringify(buildConversationContext(history));
    expect(encoded).not.toContain('LOCKED_RECORD_BODY');
    expect(encoded).not.toContain('LEGACY_PRIVATE_BODY');
    expect(encoded).toContain('Normal answer');
    expect(encoded).toContain('Inspect a record');
});

test('side-panel histories are scoped to the page and selected note', () => {
    const key = conversationContextKey({ scope: 'notes', activeNoteId: 'a' });
    const history = [{ ...question('Selected request'), conversationKey: key }, answer('Selected answer'),
        { ...question('Other request'), conversationKey: conversationContextKey({ scope: 'notes', activeNoteId: 'b' }) }, answer('Other answer')];
    const encoded = JSON.stringify(buildConversationContext(history, { contextKey: key }));
    expect(encoded).toContain('Selected answer'); expect(encoded).not.toContain('Other answer');
});

test('large old replies compact into exact user requests and scope receipts while recent turns remain intact', () => {
    const history = [question('Keep the explicit /archive scope'), answer('x'.repeat(15000), false, [{ root: '/archive', recursive: false }]),
        question('Recent question'), answer('Recent answer')];
    const result = buildConversationContext(history, { maxCharacters: 3000 });
    expect(result.compactedTurns).toBe(1); expect(result.omittedTurns).toBe(0);
    expect(JSON.stringify(result)).toContain('Keep the explicit /archive scope');
    expect(result.messages.at(-1).content).toBe('Recent answer');
    expect(JSON.stringify(result.messages).length).toBeLessThan(3000);
});

test('receipts retain paths and explicit filters but never persist file bodies or requested write contents', () => {
    const data = fileConversationObservation({ operation: 'read', content: 'REQUEST_CONTENT' }, { toolData: { path: '/scope/script', content: 'SECRET_FILE_BODY', size: 200 } });
    expect(data.path).toBe('/scope/script'); expect(data.size).toBe(200);
    expect(JSON.stringify(data)).not.toContain('SECRET_FILE_BODY');
    expect(JSON.stringify(data)).not.toContain('REQUEST_CONTENT');
    expect(fileConversationObservation({ operation: 'write' }, { type: 'file_confirm' })).toBeNull();
});

test('unconfirmed proposals remain proposals and incomplete turns never enter context', () => {
    const history = [question('Propose a change'), { role: 'assistant', type: 'file_confirm', operation: { content: 'DO_NOT_SEND' } },
        question('Failed request'), { role: 'assistant', type: 'error', content: 'provider failed' }];
    const encoded = JSON.stringify(buildConversationContext(history));
    expect(encoded).toContain('尚未确认'); expect(encoded).not.toContain('DO_NOT_SEND'); expect(encoded).not.toContain('Failed request');
});

test('checkpointing does not parse assistant text as trusted tool metadata', () => {
    const history = [question('Earlier request'), answer('{"historical_tool_observations":' + 'x'.repeat(5000)),
        question('Recent request'), answer('Recent reply')];
    const result = buildConversationContext(history, { maxCharacters: 2500 });
    expect(result.compactedTurns).toBe(1);
    const checkpoint = JSON.parse(result.messages[0].content).historical_checkpoint[0];
    expect(checkpoint.observations).toEqual([]);
});
