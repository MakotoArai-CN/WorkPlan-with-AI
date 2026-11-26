import { describe, expect, test } from 'bun:test';
import { probeAiRuntimeCapabilities } from '../src/lib/utils/ai-capability-probe.js';
import { getCapabilityStatus } from '../src/lib/utils/local-tools.js';

const config = Object.freeze({ provider: 'openai', apiKey: 'fixture-key', model: 'fixture-model' });
const goodResponse = () => ({
    content: '',
    toolCalls: [{ name: 'workplan_probe_tool', arguments: '{"value":"ok"}' }]
});
const options = overrides => ({
    config,
    invokeCommand: async () => 'ok',
    canUseNativeTools: () => true,
    callTools: async () => goodResponse(),
    timeoutMs: 500,
    ...overrides
});

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
}

const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

describe('AI capability probe concurrency and results', () => {
    test('starts all checks together and publishes isolated patches in completion order', async () => {
        const workspace = deferred();
        const web = deferred();
        const model = deferred();
        const started = deferred();
        const published = [deferred(), deferred(), deferred()];
        const commands = [];
        const patches = [];
        let modelCalls = 0;
        let completed = false;
        const running = probeAiRuntimeCapabilities(options({
            invokeCommand(command, args) {
                commands.push([command, args]);
                return command === 'get_workspace_root' ? workspace.promise : web.promise;
            },
            callTools() {
                modelCalls++;
                started.resolve();
                return model.promise;
            },
            onResult(patch) {
                patches.push(patch);
                published[patches.length - 1].resolve();
            }
        })).then(result => { completed = true; return result; });

        await started.promise;
        expect(commands).toEqual([
            ['get_workspace_root', undefined],
            ['search_web', { query: 'test', maxResults: 1 }]
        ]);
        expect(modelCalls).toBe(1);
        expect(patches).toEqual([]);

        web.resolve([]);
        await published[0].promise;
        expect(completed).toBe(false);
        expect(patches[0]).toEqual({
            webSearchRuntimeAvailable: true,
            details: { webSearch: { ok: true, kind: 'ok', message: '' } }
        });

        model.resolve(goodResponse());
        await published[1].promise;
        expect(completed).toBe(false);
        expect(patches[1]).toEqual({
            toolCallRuntimeAvailable: true,
            nativeToolCallRuntimeAvailable: true,
            details: {
                toolCall: { ok: true, kind: 'ok', message: '' },
                nativeToolCall: { ok: true, kind: 'ok', message: '' }
            }
        });

        const before = Date.now();
        workspace.resolve('/workspace');
        const result = await running;
        expect(patches).toHaveLength(3);
        expect(patches[2]).toEqual({
            localFilesRuntimeAvailable: true,
            details: { localFiles: { ok: true, kind: 'ok', message: '' } }
        });
        expect(result).toEqual({
            localFilesRuntimeAvailable: true,
            webSearchRuntimeAvailable: true,
            toolCallRuntimeAvailable: true,
            nativeToolCallRuntimeAvailable: true,
            details: {
                ...patches[0].details,
                ...patches[1].details,
                ...patches[2].details
            },
            probed: true,
            probing: false,
            probedAt: expect.any(Number)
        });
        expect(result.probedAt).toBeGreaterThanOrEqual(before);
        expect(result.probedAt).toBeLessThanOrEqual(Date.now());
    });

    test('uses one forced dummy tool request without a text completion or executing the returned tool', async () => {
        const commands = [];
        const requests = [];
        const result = await probeAiRuntimeCapabilities(options({
            invokeCommand(command) { commands.push(command); },
            canUseNativeTools(providerId, effectiveConfig) {
                expect(providerId).toBe('openai');
                expect(effectiveConfig).toEqual(config);
                return true;
            },
            callTools(effectiveConfig, messages, tools, requestOptions) {
                requests.push({ effectiveConfig, messages, tools, requestOptions });
                return goodResponse();
            }
        }));

        expect(result.nativeToolCallRuntimeAvailable).toBe(true);
        expect(commands).toEqual(['get_workspace_root', 'search_web']);
        expect(requests).toHaveLength(1);
        const request = requests[0];
        expect(request.effectiveConfig).toEqual(config);
        expect(request.messages.map(message => message.role)).toEqual(['system', 'user']);
        expect(request.messages[1].content).toContain('value 设置为 ok');
        expect(request.tools).toHaveLength(1);
        expect(request.tools[0].function.name).toBe('workplan_probe_tool');
        expect(request.tools[0].function.parameters.properties.value.enum).toEqual(['ok']);
        expect(request.requestOptions.toolChoice).toEqual({
            type: 'function', function: { name: 'workplan_probe_tool' }
        });
        expect(request.requestOptions.maxTokens).toBe(256);
        expect(request.requestOptions.signal).toBeInstanceOf(AbortSignal);
        expect(request.requestOptions.signal.aborted).toBe(false);
    });

    test('snapshots configuration before async support detection', async () => {
        const support = deferred();
        const started = deferred();
        const mutableConfig = { ...config };
        let requestedConfig;
        const running = probeAiRuntimeCapabilities(options({
            config: mutableConfig,
            canUseNativeTools() { started.resolve(); return support.promise; },
            callTools(effectiveConfig) { requestedConfig = effectiveConfig; return goodResponse(); }
        }));
        await started.promise;
        mutableConfig.model = 'different-model';
        mutableConfig.apiKey = 'different-key';
        support.resolve(true);
        await running;
        expect(requestedConfig).toEqual(config);
    });

    test('observer mutations cannot corrupt returned diagnostics or the other model flag', async () => {
        const result = await probeAiRuntimeCapabilities(options({
            onResult(patch) {
                patch.localFilesRuntimeAvailable = false;
                for (const detail of Object.values(patch.details)) {
                    detail.ok = false;
                    detail.kind = 'error';
                }
            }
        }));
        expect(result.localFilesRuntimeAvailable).toBe(true);
        for (const detail of Object.values(result.details)) {
            expect(detail).toEqual({ ok: true, kind: 'ok', message: '' });
        }
    });

    test.each(['throw', 'reject', 'pending'])('a %s observer cannot stall or fail checks', async behavior => {
        let callbacks = 0;
        const result = await probeAiRuntimeCapabilities(options({
            onResult() {
                callbacks++;
                if (behavior === 'throw') throw new Error('observer error');
                if (behavior === 'reject') return Promise.reject(new Error('async observer error'));
                return new Promise(() => {});
            }
        }));
        expect(callbacks).toBe(3);
        expect(result.probing).toBe(false);
        expect(result.nativeToolCallRuntimeAvailable).toBe(true);
        await nextTurn();
    });
});

describe('AI capability probe failures and fast exits', () => {
    test.each([
        ['permission denied: workspace', 'permission', 'restricted'],
        ['HTTP 401: invalid credentials', 'permission', 'restricted'],
        ['HTTP 429: rate limit', 'permission', 'restricted'],
        ['未配置 API Key', 'configuration', 'restricted'],
        ['TLS certificate verify failed', 'network', 'restricted'],
        ['command not found', 'unsupported', 'unavailable'],
        ['unexpected provider response', 'error', 'unavailable']
    ])('preserves %s failures across all capability fields', async (message, kind, status) => {
        const fail = () => { throw new Error(message); };
        const result = await probeAiRuntimeCapabilities(options({ invokeCommand: fail, callTools: fail }));
        expect(result.localFilesRuntimeAvailable).toBe(false);
        expect(result.webSearchRuntimeAvailable).toBe(false);
        expect(result.toolCallRuntimeAvailable).toBe(false);
        expect(result.nativeToolCallRuntimeAvailable).toBe(false);
        expect(result.probed).toBe(true);
        expect(result.probing).toBe(false);
        for (const detail of Object.values(result.details)) {
            expect(detail).toEqual({ ok: false, kind, message });
            expect(getCapabilityStatus({ probed: true, failureKind: detail.kind })).toBe(status);
        }
    });

    test.each(['missing key', 'unsupported provider'])('%s publishes before pending native checks without contacting the model', async reason => {
        const local = deferred();
        const modelPublished = deferred();
        const patches = [];
        let modelCalls = 0;
        let supportChecks = 0;
        const running = probeAiRuntimeCapabilities(options({
            config: reason === 'missing key' ? { provider: 'openai', apiKey: '  ' } : config,
            invokeCommand: () => local.promise,
            canUseNativeTools() { supportChecks++; return false; },
            callTools() { modelCalls++; return goodResponse(); },
            onResult(patch) {
                patches.push(patch);
                if ('nativeToolCallRuntimeAvailable' in patch) modelPublished.resolve();
            }
        }));
        await modelPublished.promise;
        expect(patches).toHaveLength(1);
        expect(patches[0].toolCallRuntimeAvailable).toBe(false);
        expect(patches[0].nativeToolCallRuntimeAvailable).toBe(false);
        const kind = reason === 'missing key' ? 'configuration' : 'unsupported';
        expect(patches[0].details.toolCall.kind).toBe(kind);
        expect(patches[0].details.nativeToolCall.kind).toBe(kind);
        expect(modelCalls).toBe(0);
        expect(supportChecks).toBe(reason === 'missing key' ? 0 : 1);
        local.resolve('ok');
        expect((await running).localFilesRuntimeAvailable).toBe(true);
    });

    test.each(['custom', 'ollama', 'lmstudio'])('%s does not require an API key', async provider => {
        let calls = 0;
        const result = await probeAiRuntimeCapabilities(options({
            config: { provider },
            callTools() { calls++; return goodResponse(); }
        }));
        expect(calls).toBe(1);
        expect(result.nativeToolCallRuntimeAvailable).toBe(true);
    });

    test('missing injected dependencies fail with configuration diagnostics', async () => {
        const result = await probeAiRuntimeCapabilities({ config });
        for (const detail of Object.values(result.details)) expect(detail.kind).toBe('configuration');
        expect(result.probing).toBe(false);
        const missingTransport = await probeAiRuntimeCapabilities(options({ callTools: undefined }));
        expect(missingTransport.details.nativeToolCall.kind).toBe('configuration');
    });
});

describe('AI capability probe tool validation', () => {
    test.each([
        undefined,
        null,
        { content: 'ok' },
        { toolCalls: [] },
        { toolCalls: 'workplan_probe_tool' },
        { toolCalls: [null] },
        { toolCalls: [{ name: 'some_real_tool', arguments: '{"value":"ok"}' }] },
        { toolCalls: [{ name: 'workplan_probe_tool' }] },
        { toolCalls: [{ name: 'workplan_probe_tool', arguments: '{' }] },
        { toolCalls: [{ name: 'workplan_probe_tool', arguments: 'null' }] },
        { toolCalls: [{ name: 'workplan_probe_tool', arguments: '[]' }] },
        { toolCalls: [{ name: 'workplan_probe_tool', arguments: '{}' }] },
        { toolCalls: [{ name: 'workplan_probe_tool', arguments: '{"value":"wrong"}' }] },
        { toolCalls: [{ name: 'workplan_probe_tool', arguments: { value: true } }] },
        { toolCalls: [{ name: 'workplan_probe_tool', arguments: { value: 'ok', extra: true } }] },
        { toolCalls: [{ name: 'workplan_probe_tool', type: 'custom', arguments: { value: 'ok' } }] },
        { toolCalls: [...goodResponse().toolCalls, ...goodResponse().toolCalls] },
        { toolCalls: [...goodResponse().toolCalls, { name: 'write_text_file', arguments: '{}' }] }
    ])('does not claim support for a missing or malformed call: %j', async response => {
        const commands = [];
        const result = await probeAiRuntimeCapabilities(options({
            invokeCommand(command) { commands.push(command); },
            callTools: () => response
        }));
        expect(result.localFilesRuntimeAvailable).toBe(true);
        expect(result.webSearchRuntimeAvailable).toBe(true);
        expect(result.toolCallRuntimeAvailable).toBe(false);
        expect(result.nativeToolCallRuntimeAvailable).toBe(false);
        expect(result.details.nativeToolCall.ok).toBe(false);
        expect(result.details.nativeToolCall.kind).toBe('error');
        expect(result.details.nativeToolCall.message.length).toBeGreaterThan(0);
        expect(commands).toEqual(['get_workspace_root', 'search_web']);
    });

    test.each(['{"value":"ok"}', { value: 'ok' }])('accepts valid JSON or parsed arguments: %j', async args => {
        const result = await probeAiRuntimeCapabilities(options({
            callTools: () => ({ toolCalls: [{ name: 'workplan_probe_tool', arguments: args }] })
        }));
        expect(result.toolCallRuntimeAvailable).toBe(true);
        expect(result.nativeToolCallRuntimeAvailable).toBe(true);
    });
});

describe('AI capability probe deadlines and cancellation', () => {
    test('never-resolving native calls have independent bounded deadlines', async () => {
        const patches = [];
        const result = await probeAiRuntimeCapabilities(options({
            invokeCommand: () => new Promise(() => {}),
            timeoutMs: { localFiles: 10, webSearch: 30, model: 200 },
            onResult: patch => patches.push(patch)
        }));
        expect(patches.map(patch => Object.keys(patch.details)[0])).toEqual(['toolCall', 'localFiles', 'webSearch']);
        expect(result.localFilesRuntimeAvailable).toBe(false);
        expect(result.webSearchRuntimeAvailable).toBe(false);
        expect(result.nativeToolCallRuntimeAvailable).toBe(true);
        expect(result.details.localFiles.kind).toBe('network');
        expect(result.details.localFiles.message).toContain('10 ms');
        expect(result.details.webSearch.kind).toBe('network');
        expect(result.details.webSearch.message).toContain('30 ms');
        expect(result.probing).toBe(false);
    });

    test.each([false, true])('bounds a never-resolving model and aborts it (transport observes abort: %s)', async observesAbort => {
        let modelSignal;
        const result = await probeAiRuntimeCapabilities(options({
            timeoutMs: { model: 10 },
            callTools(_config, _messages, _tools, requestOptions) {
                modelSignal = requestOptions.signal;
                return new Promise((_, reject) => {
                    if (observesAbort) modelSignal.addEventListener('abort', () => {
                        const error = new Error('transport aborted');
                        error.name = 'AbortError';
                        reject(error);
                    }, { once: true });
                });
            }
        }));
        expect(modelSignal.aborted).toBe(true);
        expect(result.localFilesRuntimeAvailable).toBe(true);
        expect(result.webSearchRuntimeAvailable).toBe(true);
        expect(result.toolCallRuntimeAvailable).toBe(false);
        expect(result.nativeToolCallRuntimeAvailable).toBe(false);
        expect(result.details.nativeToolCall.kind).toBe('network');
        expect(result.details.nativeToolCall.message).toContain('10 ms');
        expect(result.probing).toBe(false);
    });

    test('one numeric deadline bounds every check and consumes all late rejections', async () => {
        const native = [deferred(), deferred()];
        const model = deferred();
        const patches = [];
        const unhandled = [];
        const onUnhandled = reason => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        try {
            let commandIndex = 0;
            const result = await probeAiRuntimeCapabilities(options({
                timeoutMs: 10,
                invokeCommand: () => native[commandIndex++].promise,
                callTools: () => model.promise,
                onResult: patch => patches.push(patch)
            }));
            const snapshot = JSON.stringify(result);
            expect(patches).toHaveLength(3);
            for (const detail of Object.values(result.details)) expect(detail.kind).toBe('network');
            for (const pending of [...native, model]) pending.reject(new Error('late timeout failure'));
            await nextTurn();
            expect(unhandled).toEqual([]);
            expect(patches).toHaveLength(3);
            expect(JSON.stringify(result)).toBe(snapshot);
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });

    test('a timed-out async provider check cannot start a late model request', async () => {
        const support = deferred();
        let calls = 0;
        const result = await probeAiRuntimeCapabilities(options({
            timeoutMs: { model: 10 },
            canUseNativeTools: () => support.promise,
            callTools() { calls++; return goodResponse(); }
        }));
        expect(result.details.nativeToolCall.kind).toBe('network');
        support.resolve(true);
        await nextTurn();
        expect(calls).toBe(0);
    });

    test('already-cancelled probes issue no calls or callbacks', async () => {
        const controller = new AbortController();
        controller.abort('cancelled before starting');
        let calls = 0;
        const unexpected = () => { calls++; };
        await expect(probeAiRuntimeCapabilities(options({
            signal: controller.signal,
            invokeCommand: unexpected,
            canUseNativeTools: unexpected,
            callTools: unexpected,
            onResult: unexpected
        }))).rejects.toMatchObject({ name: 'AbortError' });
        expect(calls).toBe(0);
    });

    test('cancellation aborts the model, promptly settles native waits and consumes late rejects', async () => {
        const controller = new AbortController();
        const native = [deferred(), deferred()];
        const model = deferred();
        const started = deferred();
        const patches = [];
        const unhandled = [];
        const onUnhandled = reason => unhandled.push(reason);
        let modelSignal;
        let commandIndex = 0;
        process.on('unhandledRejection', onUnhandled);
        try {
            const running = probeAiRuntimeCapabilities(options({
                signal: controller.signal,
                invokeCommand: () => native[commandIndex++].promise,
                callTools(_config, _messages, _tools, requestOptions) {
                    modelSignal = requestOptions.signal;
                    started.resolve();
                    return model.promise;
                },
                onResult: patch => patches.push(patch)
            }));
            await started.promise;
            controller.abort(new Error('settings changed'));
            await expect(running).rejects.toMatchObject({ name: 'AbortError', message: 'settings changed' });
            expect(commandIndex).toBe(2);
            expect(modelSignal.aborted).toBe(true);
            expect(patches).toEqual([]);
            for (const pending of [...native, model]) pending.reject(new Error('late cancellation failure'));
            await nextTurn();
            expect(unhandled).toEqual([]);
            expect(patches).toEqual([]);
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });

    test('cancelling from an incremental result suppresses later results', async () => {
        const controller = new AbortController();
        const workspace = deferred();
        const web = deferred();
        const model = deferred();
        const started = deferred();
        const patches = [];
        const running = probeAiRuntimeCapabilities(options({
            signal: controller.signal,
            invokeCommand: command => command === 'get_workspace_root' ? workspace.promise : web.promise,
            callTools() { started.resolve(); return model.promise; },
            onResult(patch) { patches.push(patch); controller.abort(); }
        }));
        await started.promise;
        workspace.resolve('/workspace');
        await expect(running).rejects.toMatchObject({ name: 'AbortError' });
        expect(patches).toHaveLength(1);
        expect(patches[0].localFilesRuntimeAvailable).toBe(true);
        web.resolve([]);
        model.resolve(goodResponse());
        await nextTurn();
        expect(patches).toHaveLength(1);
    });

    test('cancelling during async provider detection prevents a late model request', async () => {
        const controller = new AbortController();
        const support = deferred();
        const started = deferred();
        let calls = 0;
        const running = probeAiRuntimeCapabilities(options({
            signal: controller.signal,
            canUseNativeTools() { started.resolve(); return support.promise; },
            callTools() { calls++; return goodResponse(); }
        }));
        await started.promise;
        controller.abort();
        await expect(running).rejects.toMatchObject({ name: 'AbortError' });
        support.resolve(true);
        await nextTurn();
        expect(calls).toBe(0);
    });

    test('successful checks clear deadlines and cancellation listeners', async () => {
        const controller = new AbortController();
        let modelSignal;
        await probeAiRuntimeCapabilities(options({
            signal: controller.signal,
            timeoutMs: 10,
            callTools(_config, _messages, _tools, requestOptions) {
                modelSignal = requestOptions.signal;
                return goodResponse();
            }
        }));
        controller.abort();
        await new Promise(resolve => setTimeout(resolve, 25));
        expect(modelSignal.aborted).toBe(false);
    });
});
