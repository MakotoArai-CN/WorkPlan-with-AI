import { describe, expect, test } from 'bun:test';
import { normalizeChatEndpoint } from '../src/lib/utils/ai-providers.js';

describe('AI custom chat endpoint normalization', () => {
    test('accepts a base URL ending in /v1', () => {
        expect(normalizeChatEndpoint('https://api.example.com/v1')).toBe('https://api.example.com/v1/chat/completions');
        expect(normalizeChatEndpoint('https://api.example.com/v1/')).toBe('https://api.example.com/v1/chat/completions');
    });

    test('keeps a complete chat completions URL unchanged', () => {
        expect(normalizeChatEndpoint('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1/chat/completions');
    });

    test('adds v1/chat/completions for a host-only endpoint', () => {
        expect(normalizeChatEndpoint('https://api.example.com')).toBe('https://api.example.com/v1/chat/completions');
    });

    test('adapts local model providers', () => {
        expect(normalizeChatEndpoint('http://localhost:11434', 'ollama')).toBe('http://localhost:11434/api/chat');
        expect(normalizeChatEndpoint('http://localhost:1234/v1', 'lmstudio')).toBe('http://localhost:1234/v1/chat/completions');
    });
});
