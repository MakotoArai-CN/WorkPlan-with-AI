import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createLatestEditorRequest, noteDraftChanged, rangeAtBlockStart, rangeAtEditorEnd } from '../src/lib/utils/notes-editor.js';
import { defaultNotePrompts } from '../src/lib/utils/notes-prompts.js';

describe('default note prompts', () => {
    test('uses localized bounded drafting instructions without mutating a shared preset', () => {
        expect(defaultNotePrompts('zh-CN')[0].label).toBe('总结');
        expect(defaultNotePrompts('en-US')[0].label).toBe('Summarize');
        expect(defaultNotePrompts('ja-JP')[0].label).toBe('要約');
        expect(defaultNotePrompts('ru')[0].label).toBe('Summarize');
        for (const prompt of defaultNotePrompts('en')) {
            expect(prompt.prompt).toContain('untrusted source material');
            expect(prompt.prompt).toContain('draft only');
        }
        const modified = defaultNotePrompts('en');
        modified[0].prompt = 'custom';
        expect(defaultNotePrompts('en')[0].prompt).not.toBe('custom');
    });
});

describe('note editor request lifetime', () => {
    test('new edits immediately abort and invalidate an in-flight continuation', () => {
        const requests = createLatestEditorRequest();
        const first = requests.begin();
        expect(requests.isCurrent(first)).toBe(true);
        requests.invalidate();
        expect(first.signal.aborted).toBe(true);
        expect(requests.isCurrent(first)).toBe(false);
        const second = requests.begin();
        expect(second.signal.aborted).toBe(false);
        expect(requests.isCurrent(second)).toBe(true);
        expect(requests.isCurrent(first)).toBe(false);
    });

    test('starting another request invalidates the earlier one without waiting for its response', () => {
        const requests = createLatestEditorRequest();
        const first = requests.begin();
        const second = requests.begin();
        expect(first.signal.aborted).toBe(true);
        expect(requests.isCurrent(first)).toBe(false);
        expect(requests.isCurrent(second)).toBe(true);
    });
});

describe('editor persistence', () => {
    test('does not persist unchanged or missing notes', () => {
        expect(noteDraftChanged(null, 'A', 'B')).toBe(false);
        expect(noteDraftChanged({ title: 'A', content: 'B' }, 'A', 'B')).toBe(false);
        expect(noteDraftChanged({ title: 'A', content: 'B' }, 'A', 'C')).toBe(true);
        expect(noteDraftChanged({ title: 'A', content: 'B' }, 'D', 'B')).toBe(true);
    });
});

function rangeWithText(text, collapsed = true) {
    return {
        collapsed, startContainer: {}, endContainer: {}, startOffset: 0, endOffset: 0,
        cloneRange: () => ({ selectNodeContents() {}, setStart() {}, setEnd() {}, toString: () => text })
    };
}

describe('caret boundaries', () => {
    const block = { contains: () => true };
    test('nested inline startOffset zero is not the start of its paragraph', () => {
        expect(rangeAtBlockStart(rangeWithText('earlier text '), block)).toBe(false);
        expect(rangeAtBlockStart(rangeWithText(''), block)).toBe(true);
        expect(rangeAtBlockStart(rangeWithText('\u200b'), block)).toBe(true);
        expect(rangeAtBlockStart(rangeWithText('', false), block)).toBe(false);
    });

    test('only a collapsed caret at the document tail can accept a continuation', () => {
        expect(rangeAtEditorEnd(rangeWithText('more text'), block)).toBe(false);
        expect(rangeAtEditorEnd(rangeWithText('\n\u200b'), block)).toBe(true);
        expect(rangeAtEditorEnd(rangeWithText('', false), block)).toBe(false);
        expect(rangeAtEditorEnd(rangeWithText(''), { contains: () => false })).toBe(false);
    });
});

describe('editor integration guards', () => {
    const notes = readFileSync(new URL('../src/lib/components/Notes.svelte', import.meta.url), 'utf8');

    test('IME composition pauses background work and normal shortcuts', () => {
        expect(notes).toContain('on:compositionstart={handleCompositionStart}');
        expect(notes).toContain('on:compositionend={handleCompositionEnd}');
        expect(notes).toContain('e.keyCode === 229');
        expect(notes).toContain('!autoSaveEnabled || editorComposing');
    });

    test('AI continuation is explicit opt-in, respects note locks and inserts only text', () => {
        expect(notes).toContain("localStorage.getItem('workplan_notes_ai_autocomplete') === 'true'");
        expect(notes).toContain('!aiAutocompleteEnabled || editorComposing || !editMode || $activeNote?.aiLocked');
        expect(notes).toContain('signal: request.signal');
        expect(notes).toContain("document.execCommand('insertText', false, aiSuggestion)");
        expect(notes).not.toContain('insertValue(aiSuggestion)');
    });

    test('table conversion does not replace the entire document or search for the first duplicate', () => {
        const tableHandler = notes.slice(notes.indexOf("if (e.key === 'Enter'"), notes.indexOf("if (e.key === 'Tab'"));
        expect(tableHandler).toContain('range.selectNode(block)');
        expect(tableHandler).toContain('instance.updateValue(html)');
        expect(tableHandler).not.toContain('.findIndex(');
        expect(tableHandler).not.toContain('.setValue(');
    });

    test('the initial undo baseline is the loaded note rather than an empty constructor', () => {
        expect(notes.indexOf('instance.clearStack()')).toBeGreaterThan(notes.indexOf('instance.setValue(editContent)'));
        expect(notes.indexOf('instance.clearStack()')).toBeLessThan(notes.indexOf('normalizeVditorEditable(container, token, { focus: true })'));
    });
});
