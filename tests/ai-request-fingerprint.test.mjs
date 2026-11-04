import { describe, test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
    REQUEST_FINGERPRINT_PRESETS,
    normalizeRequestHeaders,
    parseRequestHeadersText,
    resolveRequestHeaders,
    serializeRequestHeaders
} from '../src/lib/utils/ai-request-fingerprint.js';

const root = path.resolve(import.meta.dir, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('AI request fingerprint headers', () => {
    test('built-in presets cover Claude Code, Codex and OpenCode', () => {
        expect(REQUEST_FINGERPRINT_PRESETS.claude_code['User-Agent']).toContain('claude-cli');
        expect(REQUEST_FINGERPRINT_PRESETS.codex['originator']).toBe('codex_cli_rs');
        expect(REQUEST_FINGERPRINT_PRESETS.opencode['User-Agent']).toContain('opencode');
        for (const preset of Object.values(REQUEST_FINGERPRINT_PRESETS)) {
            expect(Object.keys(preset).some(key => key.toLowerCase() === 'authorization')).toBe(false);
        }
    });

    test('custom headers override presets case-insensitively', () => {
        const headers = resolveRequestHeaders({
            requestFingerprint: 'codex',
            customHeaders: { 'user-agent': 'my-client/1.0', 'X-Test': 'ok' }
        });
        expect(headers['user-agent'] || headers['User-Agent']).toBe('my-client/1.0');
        expect(headers['X-Test']).toBe('ok');
        expect(Object.keys(headers).filter(key => key.toLowerCase() === 'user-agent')).toHaveLength(1);
    });

    test('line editor format round-trips and rejects unsafe headers', () => {
        const parsed = parseRequestHeadersText('User-Agent: test/1.0\nX-Client: workplan\n# comment');
        expect(parsed['User-Agent']).toBe('test/1.0');
        expect(parsed['X-Client']).toBe('workplan');
        expect(serializeRequestHeaders(parsed)).toContain('User-Agent: test/1.0');
        expect(() => normalizeRequestHeaders({ Host: 'evil.example' })).toThrow();
        expect(() => normalizeRequestHeaders({ 'X-Test': 'ok\r\nInjected: yes' })).not.toThrow();
        expect(normalizeRequestHeaders({ 'X-Test': 'ok\r\nInjected: yes' })['X-Test']).not.toContain('\n');
    });

    test('all AI request paths use the resolver and the config persists the choice', () => {
        const providers = read('src/lib/utils/ai-providers.js');
        expect(providers.match(/resolveRequestHeaders\(config\)/g)).toHaveLength(4);
        const store = read('src/lib/stores/ai.js');
        expect(store).toContain("requestFingerprint: 'default'");
        expect(store).toContain('requestFingerprint: nextState.requestFingerprint');
    });
});
