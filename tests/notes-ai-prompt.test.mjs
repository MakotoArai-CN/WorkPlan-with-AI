import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, '..', 'src/lib/stores/ai.js'), 'utf8');

describe('notes AI system prompt', () => {
    // The generic prompt only said "answer about the current page", so the model
    // did not know whether to rewrite, summarise, or ask for the note body.
    test('adds a notes-specific behaviour block', () => {
        expect(source).toContain('工作文档模式');
        expect(source).toContain("assistantContext.scope === 'notes'");
        expect(source).toContain('${notesGuidance}');
    });

    test('tells the model to keep Markdown structure and not claim saves', () => {
        expect(source).toContain('保持原有结构');
        expect(source).toContain('不要声称已经保存或修改了笔记');
        expect(source).toContain('引用块');
    });
});
