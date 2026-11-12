import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, '..', 'src/lib/stores/ai.js'), 'utf8');

describe('notes AI system prompt', () => {
    // The generic prompt only said "answer about the current page", so the model
    // did not know whether to rewrite, summarise, or ask for the note body.
    test('adds a notes-specific behaviour block', () => {
        expect(source).toContain('工作文档模式');
        expect(source).toContain("context.scope === 'notes'");
        expect(source).toContain('通过工具取得正文后保持原有Markdown结构');
    });

    test('tells the model to keep Markdown structure and not claim saves', () => {
        expect(source).toContain('保持原有Markdown结构');
        expect(source).toContain('直接给出草稿，不声称已保存');
        expect(source).toContain('拿到真实内容后再回答');
    });

    test('live chat entry points use native on-demand queries instead of keyword or intent-classifier routing', () => {
        const side = source.slice(source.indexOf('export async function sendAiMessage('), source.indexOf('export async function retryLastMessage('));
        const chat = source.slice(source.indexOf('export async function sendChatMessage('), source.indexOf('export async function retryChatMessage('));
        for (const entry of [side, chat]) {
            expect(entry).toContain('requestOnDemandReply(');
            expect(entry).not.toContain('classifyUserIntent(');
            expect(entry).not.toContain('resolveAssistantMessage(');
        }
        expect(source).not.toContain('requestsApplicationData');
        const panel = readFileSync(join(import.meta.dir, '..', 'src/lib/components/AiPanel.svelte'), 'utf8');
        const payload = panel.slice(panel.indexOf('function getAssistantPayload()'), panel.indexOf('function addScopedItem('));
        expect(payload).not.toContain('getExistingItems');
        expect(payload).not.toContain('noteContent');
        expect(payload).toContain('items: []');
    });
});
