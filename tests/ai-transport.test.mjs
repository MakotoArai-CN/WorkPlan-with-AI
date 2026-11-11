import { describe, expect, test } from 'bun:test';
import { abortable, addEndpointQuery, boundedNumber, createAiStreamParser, MAX_AI_STREAM_FRAME_CHARS, providerHttpError, readAiResponseJson, safeProviderError } from '../src/lib/utils/ai-transport.js';

describe('AI stream framing', () => {
    test('handles chunk splits, CRLF, multiline SSE and data without a space', () => {
        const received = [];
        const parser = createAiStreamParser(payload => received.push(JSON.parse(payload)));
        parser.feed(': heartbeat\r\ndata:{"text":\r\n');
        parser.feed('data: "first"}\r\n\r\ndata: {"text":"second"}\n\n');
        parser.feed('data: [DONE]\n\ndata: {"text":"ignored"}\n\n');
        parser.finish();
        expect(received).toEqual([{ text: 'first' }, { text: 'second' }]);
        expect(parser.ended).toBe(true);
    });

    test('handles Ollama JSONL and an unterminated final frame', () => {
        const received = [];
        const parser = createAiStreamParser(payload => received.push(JSON.parse(payload)), { jsonLines: true });
        parser.feed('{"text":"one"}\n{"text":');
        parser.feed('"two"}');
        parser.finish();
        expect(received).toEqual([{ text: 'one' }, { text: 'two' }]);
    });

    test('caps malformed or oversized frames instead of accumulating indefinitely', () => {
        const parser = createAiStreamParser(() => {});
        expect(() => parser.feed('x'.repeat(MAX_AI_STREAM_FRAME_CHARS + 1))).toThrow('size');
        const manyLines = createAiStreamParser(() => {});
        expect(() => manyLines.feed('data:\n'.repeat(4097))).toThrow('size');
        const jsonLine = createAiStreamParser(() => {}, { jsonLines: true });
        expect(() => jsonLine.feed(`{"text":"${'x'.repeat(MAX_AI_STREAM_FRAME_CHARS)}"}\n`)).toThrow('size');
    });
});

describe('AI transport boundaries', () => {
    test('preserves a deterministic zero temperature and clamps other numeric options', () => {
        expect(boundedNumber(0, 0.7, 0, 2)).toBe(0);
        expect(boundedNumber(undefined, 0.7, 0, 2)).toBe(0.7);
        expect(boundedNumber(Infinity, 2048, 1, 8192)).toBe(2048);
        expect(boundedNumber(-5, 2048, 1, 8192)).toBe(1);
    });

    test('adds provider query authentication without corrupting an existing query', () => {
        const url = new URL(addEndpointQuery('https://api.invalid/chat?proxy=local', 'key', 'private-test-key'));
        expect(url.searchParams.get('proxy')).toBe('local');
        expect(url.searchParams.get('key')).toBe('private-test-key');
    });

    test('never exposes configured secrets or unstructured proxy response HTML', () => {
        const key = 'private-test-key-for-redaction';
        expect(safeProviderError(`https://api.invalid?key=${key} Bearer ${key}`, [key])).not.toContain(key);
        expect(providerHttpError(401, `<html>${key}</html>`, [key]).message).toBe('HTTP 401: AI request failed');
        expect(providerHttpError(429, JSON.stringify({ error: { message: `limit ${key}` } }), [key]).message).not.toContain(key);
    });

    test('aborts third-party awaits promptly and consumes a late rejection', async () => {
        const controller = new AbortController();
        let reject;
        const promise = abortable(new Promise((_, fail) => { reject = fail; }), controller.signal);
        controller.abort();
        await expect(promise).rejects.toHaveProperty('name', 'AbortError');
        reject(new Error('late error'));
        await Promise.resolve();
    });

    test('invalid JSON remains an error, never a raw assistant response', async () => {
        await expect(readAiResponseJson(new Response('<html>private proxy body</html>'))).rejects.toThrow('invalid JSON');
    });
});
