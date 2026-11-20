import { expect, test } from 'bun:test';
import { callProviderWebSearch } from '../src/lib/utils/ai-providers.js';
import { isPublicWebQuery, parseProviderSearch } from '../src/lib/utils/ai-web-search.js';

const url = 'https://svelte.dev/blog/svelte-5-is-alive';
const searchLabel = 'Svelte 5';
const suggestionUrl = 'https://www.google.com/search?q=Svelte+5';
const openai = { output: [
    { type: 'web_search_call', status: 'completed' },
    { type: 'message', content: [{ type: 'output_text', text: 'Svelte 5 is available.', annotations: [
        { type: 'url_citation', url, title: 'Release', start_index: 0, end_index: 22 }
    ] }] }
] };
const claude = { stop_reason: 'end_turn', content: [
    { type: 'server_tool_use', name: 'web_search', input: { query: searchLabel } },
    { type: 'text', text: 'Svelte 5 is available.', citations: [
        { type: 'web_search_result_location', url, title: 'Release', cited_text: 'Svelte 5 is alive' }
    ] }
] };
const gemini = { candidates: [{ content: { parts: [
    { thought: true, text: 'internal reasoning' }, { text: 'Svelte 5 is available.' }
] }, groundingMetadata: {
    searchEntryPoint: { sdkBlob: Buffer.from(JSON.stringify([[searchLabel, suggestionUrl], ['Other site', 'https://example.org/'], [searchLabel, suggestionUrl]])).toString('base64') },
    groundingChunks: [{ web: { uri: url, title: 'Release' } }, { web: { uri: 'javascript:alert(1)' } }],
    groundingSupports: [{ segment: { text: 'Svelte 5 is available.' }, groundingChunkIndices: [0, 0, 1, 99] }]
} }] };

test('search uses each official protocol, scopes credentials and sends only the query', async () => {
    const realFetch = globalThis.fetch;
    const fixtureCredential = ['unit', 'fixture', 'only'].join('-');
    const query = 'Svelte 5';
    const cases = [
        ['openai', 'gpt-5', 'https://api.openai.com/v1/responses', 'authorization', `Bearer ${fixtureCredential}`, 'web_search', openai],
        ['anthropic', 'claude-sonnet-4-5', 'https://api.anthropic.com/v1/messages', 'x-api-key', fixtureCredential, 'web_search_20250305', claude],
        ['google', 'gemini-2.5-flash', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', 'x-goog-api-key', fixtureCredential, 'google_search', gemini]
    ];
    try {
        for (const [provider, model, endpoint, keyHeader, keyValue, tool, fixture] of cases) {
            let sent;
            globalThis.fetch = async (target, options) => { sent = { target, options }; return Response.json(fixture); };
            const result = await callProviderWebSearch({ provider, model, apiKey: fixtureCredential,
                messages: ['DO NOT FORWARD HISTORY'], customHeaders: { 'X-Fixture': 'IGNORE ME', 'OpenAI-Project': 'proj_unit' }
            }, query);
            expect(sent.target).toBe(endpoint);
            expect(sent.options.method).toBe('POST');
            expect(sent.options.redirect).toBe('error');
            expect(sent.options.body).not.toContain(fixtureCredential);
            expect(sent.options.body).not.toContain('DO NOT FORWARD HISTORY');
            const headers = new Headers(sent.options.headers);
            expect(headers.get(keyHeader)).toBe(keyValue);
            expect(headers.get('OpenAI-Project')).toBe(provider === 'openai' ? 'proj_unit' : null);
            expect(headers.get('X-Fixture')).toBeNull();
            const body = JSON.parse(sent.options.body);
            if (provider === 'openai') {
                expect(body.input).toBe(query);
                expect(body.store).toBe(false);
                expect(body.tools[0].type).toBe(tool);
            } else if (provider === 'anthropic') {
                expect(body.messages).toEqual([{ role: 'user', content: query }]);
                expect(body.tools[0].type).toBe(tool);
                expect(headers.get('anthropic-version')).toBe('2023-06-01');
            } else {
                expect(body.contents).toEqual([{ role: 'user', parts: [{ text: query }] }]);
                expect(body.tools).toEqual([{ [tool]: {} }]);
            }
            expect(result.entries[0].url).toBe(url);
        }
        globalThis.fetch = () => { throw new Error('Custom endpoint must not request official search'); };
        expect(await callProviderWebSearch({ provider: 'openai', apiKey: fixtureCredential, customEndpoint: 'https://gateway.invalid/v1' }, query)).toBeNull();
        expect(await callProviderWebSearch({ provider: 'custom', apiKey: fixtureCredential }, query)).toBeNull();
    } finally { globalThis.fetch = realFetch; }
});

test('OpenAI citations keep inline positions, accept safe URLs and do not duplicate sources', () => {
    const response = structuredClone(openai);
    const part = response.output[1].content[0];
    part.text = '旅行🌍计划。后续说明';
    part.annotations = [
        { type: 'url_citation', url, title: 'Release', end_index: 6 },
        { type: 'url_citation', url, title: 'Duplicate', end_index: 6 },
        { type: 'url_citation', url: 'javascript:alert(1)', end_index: 6 },
        { type: 'url_citation', url: 'https://user@svelte.dev/', end_index: 6 },
        { type: 'url_citation', url: 'https://svelte.dev/\nunsafe', end_index: 6 }
    ];
    const result = parseProviderSearch('openai', response);
    expect(result.summary).toBe(`旅行🌍计划。 [1](<${url}>)后续说明`);
    expect(result.entries.map(entry => entry.title)).toEqual(['Release']);
    response.output.shift();
    expect(parseProviderSearch('openai', response)).toBeNull();
});

test('Claude links citation blocks and Gemini keeps its suggested searches with the unmodified answer', () => {
    expect(parseProviderSearch('anthropic', claude)).toMatchObject({
        summary: `Svelte 5 is available. [1](<${url}>)`, entries: [{ url, title: 'Release', snippet: 'Svelte 5 is alive', source: 'Claude' }]
    });
    expect(parseProviderSearch('google', gemini)).toEqual({
        summary: 'Svelte 5 is available.', entries: [{ url, title: 'Release', snippet: 'Svelte 5 is available.', source: 'Google Search' }],
        suggestions: [{ title: searchLabel, url: suggestionUrl }], transient: true
    });
    const noSuggestions = structuredClone(gemini);
    delete noSuggestions.candidates[0].groundingMetadata.searchEntryPoint;
    expect(parseProviderSearch('google', noSuggestions)).toBeNull();
});

test('refusals and server tool failures are errors, not uncited successes', () => {
    expect(() => parseProviderSearch('openai', { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Refused' }] }] })).toThrow('refused');
    expect(() => parseProviderSearch('anthropic', { stop_reason: 'refusal', content: [] })).toThrow('refused');
    expect(() => parseProviderSearch('anthropic', { content: [{ type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' } }] })).toThrow('failed');
    expect(() => parseProviderSearch('google', { promptFeedback: { blockReason: 'SAFETY' } })).toThrow('blocked');
    expect(parseProviderSearch('openai', { output: [{ type: 'web_search_call', status: 'completed' }] })).toBeNull();
});

test('unsupported search can fall back, but permission, quota and unrelated model errors propagate', async () => {
    const realFetch = globalThis.fetch;
    const fixtureCredential = ['unit', 'fixture', 'only'].join('-');
    const config = { provider: 'openai', apiKey: fixtureCredential };
    try {
        globalThis.fetch = async () => Response.json({ error: { message: 'This model does not support web_search.' } }, { status: 400 });
        expect(await callProviderWebSearch(config, searchLabel)).toBeNull();
        for (const [status, message] of [
            [401, `Invalid API key: ${fixtureCredential}`], [403, 'Permission denied: tools not available'],
            [429, 'Web search quota exceeded'], [404, 'Requested model does not exist']
        ]) {
            globalThis.fetch = async () => Response.json({ error: { message } }, { status });
            await expect(callProviderWebSearch(config, searchLabel)).rejects.toHaveProperty('status', status);
        }
    } finally { globalThis.fetch = realFetch; }
});

test('cancellation reaches the search transport and ignores a late reply', async () => {
    const realFetch = globalThis.fetch;
    const controller = new AbortController();
    let resolve, sentSignal;
    try {
        globalThis.fetch = (_, options) => new Promise(done => { resolve = done; sentSignal = options.signal; });
        const pending = callProviderWebSearch({ provider: 'openai', apiKey: ['unit', 'fixture', 'only'].join('-'), signal: controller.signal }, searchLabel);
        controller.abort();
        await expect(pending).rejects.toHaveProperty('name', 'AbortError');
        expect(sentSignal.aborted).toBe(true);
        resolve(Response.json(openai));
    } finally { globalThis.fetch = realFetch; }
});

test('direct routing accepts clear public searches, not questions about the search feature or private lookups', () => {
    for (const prompt of ['请联网搜索一下 Svelte 5', 'Search the web for Svelte', '今日の天気', '今天的汇率']) {
        expect(isPublicWebQuery(prompt)).toBe(true);
    }
    for (const prompt of ['联网搜索功能怎么用？', 'Web search is disabled?', '帮我查今天的工作记录', '不要联网搜索 Svelte',
        'Search the web for Svelte, no need to use web search', '"Search the web for Svelte"', 'https://svelte.dev/', '联网搜索\n隐私内容']) {
        expect(isPublicWebQuery(prompt)).toBe(false);
    }
});
