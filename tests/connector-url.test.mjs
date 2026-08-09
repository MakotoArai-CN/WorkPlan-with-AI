// getConnectorBaseUrl's protocol whitelist used to `throw` inside the same `try`
// whose `catch` returned the raw input, so an explicitly disallowed scheme was
// handed straight back and `javascript:alert(1)` became a chat endpoint. These
// tests pin the distinction the fix draws: a disallowed *scheme* is rejected,
// while a genuinely schemeless `host:port` stays tolerated.
import { describe, test, expect } from 'bun:test';
import {
    getConnectorBaseUrl,
    getConnectorHttpChatEndpoint,
    getConnectorHttpModelsEndpoint,
    resolveConnectorTransport
} from '../src/lib/utils/connector-client.js';

const DISALLOWED = [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,x',
    'vbscript:msgbox(1)',
    'blob:http://x.test/abc'
];

describe('disallowed schemes are rejected, not echoed', () => {
    for (const raw of DISALLOWED) {
        test(`${raw} yields no base url or endpoint`, () => {
            expect(getConnectorBaseUrl({ baseUrl: raw })).toBe('');
            expect(getConnectorHttpChatEndpoint({ baseUrl: raw })).toBe('');
            expect(getConnectorHttpChatEndpoint({ customEndpoint: raw })).toBe('');
            expect(getConnectorHttpModelsEndpoint({ baseUrl: raw })).toBe('');
        });
    }
});

describe('allowed schemes pass through', () => {
    test('http/https/ws/wss are accepted and trailing slashes trimmed', () => {
        expect(getConnectorBaseUrl({ baseUrl: 'http://127.0.0.1:18789' })).toBe('http://127.0.0.1:18789');
        expect(getConnectorBaseUrl({ baseUrl: 'https://x.test/' })).toBe('https://x.test');
        expect(getConnectorBaseUrl({ baseUrl: 'ws://x.test' })).toBe('ws://x.test');
        expect(getConnectorBaseUrl({ baseUrl: 'wss://x.test/' })).toBe('wss://x.test');
    });

    test('a misfiled /v1/... endpoint collapses back to the root', () => {
        expect(getConnectorBaseUrl({ baseUrl: 'https://x.test/v1/chat/completions' })).toBe('https://x.test');
        expect(getConnectorBaseUrl({ baseUrl: 'https://x.test/v1/models?x=1' })).toBe('https://x.test');
    });

    test('a sub-path base url is preserved', () => {
        expect(getConnectorBaseUrl({ baseUrl: 'http://x.test:8080/base/' })).toBe('http://x.test:8080/base');
    });
});

describe('schemeless input stays tolerated', () => {
    // `new URL('localhost:18789/v1')` parses with protocol 'localhost:', which is
    // not in the whitelist — but it is a user typing a host, not a hostile scheme.
    test('host:port is returned as-is rather than dropped', () => {
        expect(getConnectorBaseUrl({ baseUrl: '127.0.0.1:18789' })).toBe('127.0.0.1:18789');
        expect(getConnectorBaseUrl({ baseUrl: 'localhost:18789/v1' })).toBe('localhost:18789/v1');
        expect(getConnectorBaseUrl({ baseUrl: 'localhost:18789//' })).toBe('localhost:18789');
    });

    test('empty input yields an empty string', () => {
        expect(getConnectorBaseUrl({})).toBe('');
        expect(getConnectorBaseUrl({ baseUrl: '   ' })).toBe('');
        expect(getConnectorBaseUrl()).toBe('');
    });
});

describe('chat endpoint derivation', () => {
    test('an explicit chat endpoint is kept verbatim', () => {
        expect(getConnectorHttpChatEndpoint({ baseUrl: 'https://x.test/v1/chat/completions' }))
            .toBe('https://x.test/v1/chat/completions');
        expect(getConnectorHttpChatEndpoint({ baseUrl: 'https://x.test/v1/messages' }))
            .toBe('https://x.test/v1/messages');
    });

    test('a versioned base gets /chat/completions appended', () => {
        expect(getConnectorHttpChatEndpoint({ baseUrl: 'https://x.test/v1' }))
            .toBe('https://x.test/v1/chat/completions');
    });

    test('a bare base gets /v1/chat/completions appended', () => {
        expect(getConnectorHttpChatEndpoint({ baseUrl: 'http://127.0.0.1:18789/' }))
            .toBe('http://127.0.0.1:18789/v1/chat/completions');
    });

    test('the models endpoint is derived from the chat endpoint', () => {
        expect(getConnectorHttpModelsEndpoint({ baseUrl: 'https://x.test/v1' }))
            .toBe('https://x.test/v1/models');
    });
});

describe('transport resolution', () => {
    test('an explicit transport wins over the address scheme', () => {
        expect(resolveConnectorTransport({ transport: 'http', baseUrl: 'ws://x.test' })).toBe('http');
        expect(resolveConnectorTransport({ transport: 'ws', baseUrl: 'https://x.test' })).toBe('ws');
    });

    test('auto infers ws only from a ws/wss address', () => {
        expect(resolveConnectorTransport({ transport: 'auto', baseUrl: 'wss://x.test' })).toBe('ws');
        expect(resolveConnectorTransport({ transport: 'auto', baseUrl: 'http://x.test' })).toBe('http');
        expect(resolveConnectorTransport({})).toBe('http');
    });
});
