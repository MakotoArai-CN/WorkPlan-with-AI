import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../src/lib/components/AiPanel.svelte', import.meta.url), 'utf8');

test('side assistant renders replies using the same safe Markdown component as full chat', () => {
    const textBranch = panel.slice(panel.indexOf('{#if msg.type === "text"}'), panel.indexOf('{:else if msg.type === "error"}'));
    expect(textBranch).toContain('msg.role === "user"');
    expect(textBranch).toContain('<div class="whitespace-pre-wrap">{msg.content}</div>');
    expect(textBranch).toContain('<MarkdownRenderer content={msg.content || ""} />');
    expect(panel).not.toContain('{@html');
});

test('long note descriptions and message content cannot set the side panel minimum width', () => {
    const intro = panel.slice(panel.indexOf('bind:this={chatContainer}'), panel.indexOf('{#each $chatHistory'));
    expect(intro).toContain('overflow-x-hidden');
    expect(intro).toContain('min-w-0');
    expect(intro).toContain('[overflow-wrap:anywhere]');
    const detail = readFileSync(new URL('../src/lib/components/TaskDetail.svelte', import.meta.url), 'utf8');
    expect(detail).toContain('w-full min-w-0 min-h-0 overflow-hidden');
});

test('note shortcuts have compact translated labels while preserving the original submitted requests', () => {
    expect(panel).toContain('$: panelMeta = getPanelMeta($aiPanelContext, $_);');
    for (const language of ['zh', 'en', 'ja']) {
        const { notes } = JSON.parse(readFileSync(new URL(`../src/lib/i18n/${language}.json`, import.meta.url), 'utf8'));
        expect(notes.ai_panel_placeholder.length).toBeLessThan(24);
        for (const [label, request] of [['summary', 'summary'], ['polish', 'polish'], ['actions', 'actions']]) {
            expect(notes[`ai_panel_${label}_label`].length).toBeLessThanOrEqual(10);
            expect(notes[`ai_panel_${label}_label`].length).toBeLessThan(notes[`ai_panel_quick_${request}`].length);
            expect(panel).toContain(`label: translate('notes.ai_panel_${label}_label'), value: translate('notes.ai_panel_quick_${request}')`);
        }
    }
});
