import { expect, test } from 'bun:test';
import { COMMAND_EXECUTION_TOOL, runCommandTool } from '../src/lib/utils/command-execution.js';
import { createCommandExecutionStore } from '../src/lib/stores/command-execution.js';
import { validateNativeToolCall } from '../src/lib/utils/ai-tool-policy.js';
import { describeOperation } from '../src/lib/utils/ai-operation-policy.js';

const status = { supported: true, enabled: false, platform: 'windows', shell: 'powershell' };

test('native permission defaults off and is never inferred from browser storage', () => {
    const store = createCommandExecutionStore(() => { throw new Error('Not called'); });
    expect(store.snapshot().enabled).toBe(false);
    expect(store.snapshot().loaded).toBe(false);
});

test('status and settings guidance stay available while execution is disabled', async () => {
    const invoked = [];
    const deps = { getStatus: async () => status, invokeCommand: (...args) => invoked.push(args) };
    const queried = await runCommandTool({ operation: 'status' }, deps);
    expect(queried.data.enabled).toBe(false);
    expect(queried.data.settings.section).toBe('command-execution');
    const guided = await runCommandTool({ operation: 'open_settings' }, deps);
    expect(guided.guide).toBe(true);
    const rejected = await runCommandTool({ operation: 'execute', command: 'echo SHOULD_NOT_RUN' }, deps);
    expect(rejected.data.executed).toBe(false);
    expect(rejected.guide).toBe(true);
    expect(invoked).toEqual([]);
});

test('invalid execution requests never reach the native executor', async () => {
    const invoked = [];
    const deps = { getStatus: async () => ({ ...status, enabled: true }), invokeCommand: (...args) => invoked.push(args) };
    for (const extra of [{}, { command: '' }, { command: '\0echo' }, { command: 'a'.repeat(16001) },
        { command: 'echo ok', timeoutMs: 0 }, { command: 'echo ok', cwd: 42 }]) {
        const result = await runCommandTool({ operation: 'execute', ...extra }, deps);
        expect(result.data.status).toBe('invalid_arguments');
    }
    expect(invoked).toEqual([]);
    expect(validateNativeToolCall({ name: 'workplan_command', arguments: '{"operation":"enable"}' }, [COMMAND_EXECUTION_TOOL]).valid).toBe(false);
});

test('execution preserves native failure, cancellation, timeout and truncation evidence', async () => {
    for (const result of [
        { executed: false, status: 'declined' },
        { executed: true, exitCode: 9, stdout: 'partial', stderr: 'failure' },
        { executed: true, timedOut: true, outputTruncated: true }
    ]) {
        let captured;
        const output = await runCommandTool({ operation: 'execute', command: 'echo fixture', cwd: 'C:/fixture', timeoutMs: 1000 }, {
            getStatus: async () => ({ ...status, enabled: true }),
            invokeCommand: async (name, args) => { captured = { name, args }; return result; }
        });
        expect(captured.name).toBe('execute_command');
        expect(captured.args.command).toBe('echo fixture');
        expect(captured.args.cwd).toBe('C:/fixture');
        expect(captured.args.timeoutMs).toBe(1000);
        expect(output.data).toEqual(result);
        expect(output.applied).toBe(result.executed);
    }
});

test('stopping a pending command calls native cancellation with its original identity', async () => {
    const controller = new AbortController();
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const invoked = [];
    const pending = runCommandTool({ operation: 'execute', command: 'echo fixture' }, {
        getStatus: async () => ({ ...status, enabled: true }), signal: controller.signal,
        invokeCommand: async (name, args) => {
            invoked.push({ name, args });
            if (name === 'execute_command') { started(); return new Promise(() => {}); }
        }
    });
    await ready;
    controller.abort();
    await expect(pending).rejects.toHaveProperty('name', 'AbortError');
    expect(invoked.map(call => call.name)).toEqual(['execute_command', 'cancel_command_execution']);
    expect(invoked[1].args.requestId).toBe(invoked[0].args.requestId);
});

test('context changes during the status check prevent a stale execution', async () => {
    let current = true;
    const invoked = [];
    await expect(runCommandTool({ operation: 'execute', command: 'echo fixture' }, {
        isCurrent: () => current,
        getStatus: async () => { current = false; return { ...status, enabled: true }; },
        invokeCommand: (...args) => invoked.push(args)
    })).rejects.toHaveProperty('name', 'AbortError');
    expect(invoked).toEqual([]);
});

test('a stale status response cannot overwrite a newly saved permission', async () => {
    let resolveRead;
    const store = createCommandExecutionStore(async (name, args) => name === 'get_command_execution_status'
        ? new Promise(resolve => { resolveRead = resolve; }) : { ...status, enabled: args.enabled });
    const stale = store.refresh();
    await store.setEnabled(true);
    resolveRead(status);
    await stale;
    expect(store.snapshot().enabled).toBe(true);
});

test('failed permission writes never enable the UI and double toggles are rejected', async () => {
    let rejectSave;
    const store = createCommandExecutionStore(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    const saving = store.setEnabled(true);
    await expect(store.setEnabled(true)).rejects.toThrow('being updated');
    rejectSave(new Error('storage unavailable'));
    await expect(saving).rejects.toThrow('storage unavailable');
    expect(store.snapshot().enabled).toBe(false);
    expect(store.snapshot().loading).toBe(false);
});

test('only command execution is treated as a mutation by the shared tool loop', () => {
    expect(describeOperation({ name: 'workplan_command' }, { operation: 'status' }).readOnly).toBe(true);
    expect(describeOperation({ name: 'workplan_command' }, { operation: 'open_settings' }).readOnly).toBe(true);
    expect(describeOperation({ name: 'workplan_command' }, { operation: 'execute', command: 'echo ok' }).readOnly).toBe(false);
});
