import { abortable, throwIfAborted } from './ai-transport.js';

export const COMMAND_EXECUTION_TOOL = {
    type: 'function',
    function: {
        name: 'workplan_command',
        description: '查询命令执行开关与系统shell；引导用户打开设置；仅在用户明确要求执行命令时运行命令。默认关闭。status和open_settings始终可用，不会修改开关；execute由原生端再次校验开关并向用户确认完整命令与目录，拒绝、取消、超时和非零退出码必须如实说明，不自动重试。',
        parameters: {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['status', 'open_settings', 'execute'] },
                command: { type: 'string', description: '仅execute必填；当前系统shell执行的完整命令。先查询status获取系统与shell，不猜测操作系统；禁止提权。' },
                cwd: { type: 'string', description: '工作目录，可省略使用应用工作目录。可使用系统识别的目录别名，如~/Desktop，不猜测用户目录。' },
                timeoutMs: { type: 'integer', minimum: 1000, maximum: 120000, description: '执行时限，默认60000毫秒；超时终止进程。' }
            },
            required: ['operation']
        }
    }
};

export async function runCommandTool(args, { getStatus, invokeCommand, signal, isCurrent = () => true }) {
    const assertCurrent = () => {
        throwIfAborted(signal);
        if (!isCurrent()) throw new DOMException('Operation cancelled', 'AbortError');
    };
    assertCurrent();
    const status = await abortable(getStatus(), signal);
    assertCurrent();
    const settings = { view: 'settings', section: 'command-execution' };
    if (args.operation === 'status') return { data: { ...status, settings } };
    if (args.operation === 'open_settings' || !status.enabled) {
        return { data: { ...status, status: !status.supported ? 'unsupported' : status.enabled ? 'enabled' : 'disabled', executed: false, settings }, guide: true };
    }
    if (!status.supported) return { data: { ...status, status: 'unsupported', executed: false, settings }, guide: true };
    if (args.operation !== 'execute' || typeof args.command !== 'string' || !args.command.trim()
        || args.command.length > 16000 || args.command.includes('\0')
        || args.cwd !== undefined && (typeof args.cwd !== 'string' || args.cwd.length > 4096 || args.cwd.includes('\0'))
        || args.timeoutMs !== undefined && (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1000 || args.timeoutMs > 120000)) {
        return { data: { status: 'invalid_arguments', executed: false } };
    }
    const requestId = crypto.randomUUID();
    const cancel = () => { Promise.resolve().then(() => invokeCommand('cancel_command_execution', { requestId })).catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
        assertCurrent();
        const result = await abortable(invokeCommand('execute_command', {
            requestId, command: args.command, cwd: args.cwd || null, timeoutMs: args.timeoutMs ?? 60000
        }), signal);
        assertCurrent();
        return { data: result, applied: result?.executed === true };
    } finally {
        signal?.removeEventListener('abort', cancel);
    }
}
