import { describe, expect, test } from 'bun:test';
import { packLocalJson, unpackLocalJson, isPackedLocalJson } from '../src/lib/utils/local-compress.js';

describe('AI chat history compression', () => {
    test('round-trips unicode history and saves space on repetitive data', () => {
        const history = {
            activeSessionId: 'session-1',
            sessions: Array.from({ length: 30 }, (_, index) => ({
                id: `session-${index}`,
                title: `关于任务整理与代码审查的对话 ${index}`,
                history: Array.from({ length: 20 }, (_, messageIndex) => ({
                    role: messageIndex % 2 ? 'assistant' : 'user',
                    type: 'text',
                    content: '请帮我整理今天的任务，并生成一份包含重点、风险和后续计划的周报。'.repeat(3)
                }))
            }))
        };
        const packed = packLocalJson(history);
        expect(isPackedLocalJson(packed)).toBe(true);
        expect(packed.length).toBeLessThan(JSON.stringify(history).length);
        expect(unpackLocalJson(packed)).toEqual(history);
    });

    test('keeps small or legacy plain JSON readable', () => {
        const value = { hello: '世界' };
        const packed = packLocalJson(value);
        expect(unpackLocalJson(packed)).toEqual(value);
        expect(unpackLocalJson(JSON.stringify(value))).toEqual(value);
    });
});
