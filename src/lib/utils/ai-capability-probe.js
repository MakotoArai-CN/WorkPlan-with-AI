import { validateNativeToolCall } from './ai-tool-policy.js';
import { describeToolFailure } from './local-tools.js';

const OPTIONAL_API_KEY_PROVIDERS = new Set(['ollama', 'lmstudio', 'custom']);

function checkTimeout(timeoutMs, check, fallback) {
    const value = typeof timeoutMs === 'number' ? timeoutMs : timeoutMs?.[check];
    return Number.isFinite(value) && value >= 0 && value <= 2_147_483_647 ? value : fallback;
}

function cancellationError(signal) {
    const error = new Error(signal?.reason?.message || String(signal?.reason || '能力检测已取消'));
    error.name = 'AbortError';
    return error;
}

async function boundedCheck(check, { signal, controller, timeoutMs, label }) {
    if (signal?.aborted) throw cancellationError(signal);

    let timer;
    let abort;
    const interruption = new Promise((_, reject) => {
        abort = () => {
            const error = cancellationError(signal);
            reject(error);
            controller?.abort(error);
        };
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => {
            const error = new Error(`${label} timed out after ${timeoutMs} ms`);
            // Settle the deadline before abort-aware transports reject, keeping
            // timeouts in describeToolFailure's network category.
            reject(error);
            controller?.abort(error);
        }, timeoutMs);
    });

    try {
        // Promise.race observes both outcomes even after a timeout/cancellation.
        // Native invocations cannot abort, but their late rejects stay handled.
        return await Promise.race([
            Promise.resolve().then(() => {
                if (signal?.aborted) throw cancellationError(signal);
                return check();
            }),
            interruption
        ]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}

function createProbeTools() {
    return [{
        type: 'function',
        function: {
            name: 'workplan_probe_tool',
            description: '用于检测当前模型是否支持原生 function/tool calling，不执行实际操作。',
            parameters: {
                type: 'object',
                properties: { value: { type: 'string', enum: ['ok'] } },
                required: ['value'],
                additionalProperties: false
            }
        }
    }];
}

/**
 * Independently probe workspace access, web search and native model tool calls.
 * No stores, runtime imports, text-completion fallback or tool execution are used.
 *
 * @param {object} options
 * @param {object} options.config Effective provider configuration (snapshotted).
 * @param {(command: string, args?: object) => any} options.invokeCommand Tauri-compatible invoker.
 * @param {(providerId: string, config: object) => any} options.canUseNativeTools Provider support check; may be async.
 * @param {(config: object, messages: object[], tools: object[], options: object) => any} options.callTools Compatible with callAIWithMessagesAndTools.
 * @param {(patch: object) => any} [options.onResult] Called once per completed check, in completion order.
 *   Merge the patch's capability fields and merge its details into existing details.
 *   Observer results are not awaited; observer errors cannot fail or stall probing.
 * @param {AbortSignal} [options.signal] Cancels all checks and aborts the model request.
 * @param {number | {localFiles?: number, webSearch?: number, model?: number}} [options.timeoutMs]
 *   Default deadlines: 15,000 ms each for workspace/web, 30,000 ms for the model.
 *   A number overrides all three; an object overrides individual checks.
 * @returns {Promise<object>} Final runtime shape, with probed=true, probing=false and probedAt.
 *   Cancellation rejects with AbortError and stops further onResult calls.
 */
export async function probeAiRuntimeCapabilities({
    config = {},
    invokeCommand,
    canUseNativeTools,
    callTools,
    onResult,
    signal = config.signal,
    timeoutMs
}) {
    if (signal?.aborted) throw cancellationError(signal);

    const probeConfig = { ...config };
    const runtime = {
        localFilesRuntimeAvailable: null,
        webSearchRuntimeAvailable: null,
        toolCallRuntimeAvailable: null,
        nativeToolCallRuntimeAvailable: null,
        details: {}
    };
    const modelController = new AbortController();

    async function runCheck(fields, check, deadline, label, controller) {
        let detail;
        try {
            await boundedCheck(check, { signal, controller, timeoutMs: deadline, label });
            detail = { ok: true, kind: 'ok', message: '' };
        } catch (error) {
            if (signal?.aborted) throw cancellationError(signal);
            detail = { ok: false, ...describeToolFailure(error) };
        }

        if (signal?.aborted) throw cancellationError(signal);
        const patch = { details: {} };
        for (const [field, detailKey] of fields) {
            runtime[field] = detail.ok;
            runtime.details[detailKey] = { ...detail };
            patch[field] = detail.ok;
            patch.details[detailKey] = { ...detail };
        }
        if (typeof onResult === 'function') {
            try {
                Promise.resolve(onResult(patch)).catch(() => {});
            } catch {
                // A UI observer must not prevent the remaining checks settling.
            }
        }
    }

    await Promise.allSettled([
        runCheck(
            [['localFilesRuntimeAvailable', 'localFiles']],
            () => {
                if (typeof invokeCommand !== 'function') throw new Error('未配置本地命令调用器');
                return invokeCommand('get_workspace_root');
            },
            checkTimeout(timeoutMs, 'localFiles', 15_000),
            'Workspace probe'
        ),
        runCheck(
            [['webSearchRuntimeAvailable', 'webSearch']],
            () => {
                if (typeof invokeCommand !== 'function') throw new Error('未配置本地命令调用器');
                return invokeCommand('search_web', { query: 'test', maxResults: 1 });
            },
            checkTimeout(timeoutMs, 'webSearch', 15_000),
            'Web search probe'
        ),
        runCheck(
            [
                ['toolCallRuntimeAvailable', 'toolCall'],
                ['nativeToolCallRuntimeAvailable', 'nativeToolCall']
            ],
            async () => {
                const providerId = probeConfig.provider || 'openai';
                if (!OPTIONAL_API_KEY_PROVIDERS.has(providerId) && !String(probeConfig.apiKey || '').trim()) {
                    throw new Error('未配置 API Key');
                }
                if (typeof canUseNativeTools !== 'function') throw new Error('未配置模型工具能力检查器');
                if (!await canUseNativeTools(providerId, probeConfig)) {
                    throw new Error('当前服务商不支持原生工具调用');
                }
                // An async support check may finish after its deadline. Never
                // start a model request once that check has been abandoned.
                if (modelController.signal.aborted) throw cancellationError(modelController.signal);
                if (typeof callTools !== 'function') throw new Error('未配置模型工具调用器');

                const tools = createProbeTools();
                const response = await callTools(
                    probeConfig,
                    [
                        { role: 'system', content: '你是能力检测助手。必须调用指定工具，不要直接回答文本。' },
                        { role: 'user', content: '请调用 workplan_probe_tool，参数 value 设置为 ok。' }
                    ],
                    tools,
                    {
                        maxTokens: 256,
                        toolChoice: { type: 'function', function: { name: 'workplan_probe_tool' } },
                        signal: modelController.signal
                    }
                );
                const calls = response?.toolCalls;
                if (!Array.isArray(calls) || calls.length === 0) {
                    throw new Error('模型没有按 tool_choice 返回工具调用');
                }
                if (calls.length !== 1 || (calls[0]?.type !== undefined && calls[0].type !== 'function')
                    || !validateNativeToolCall(calls[0], tools).valid) {
                    throw new Error('模型返回的能力检测工具调用无效：需要 workplan_probe_tool({"value":"ok"})');
                }
            },
            checkTimeout(timeoutMs, 'model', 30_000),
            'Model tool probe',
            modelController
        )
    ]);

    if (signal?.aborted) throw cancellationError(signal);
    return { ...runtime, probed: true, probing: false, probedAt: Date.now() };
}
