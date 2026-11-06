/**
 * Local toolchain registry.
 *
 * Mirrors the shape DSH uses for its own tool surface: every tool declares a
 * stable id, the runtime command it depends on, and a human label. Probing is
 * separate from execution so the UI can explain *why* a tool is unavailable
 * instead of silently showing a red badge — the Linux builds used to report
 * "失败" with no reason attached.
 */

export const LOCAL_TOOL_SPECS = [
    {
        id: 'workspace',
        command: 'get_workspace_root',
        label: '工作区',
        description: '读取工作区根目录，本地文件类工具的前提'
    },
    {
        id: 'read-file',
        command: 'read_text_file',
        label: '读文件',
        description: '按路径读取文本文件'
    },
    {
        id: 'write-file',
        command: 'write_text_file',
        label: '写文件',
        description: '写入文本文件（需要确认）'
    },
    {
        id: 'list-files',
        command: 'search_files',
        label: '搜索文件',
        description: '按名称在工作区内搜索文件'
    },
    {
        id: 'web-search',
        command: 'search_web',
        label: '网页搜索',
        description: '通过 DuckDuckGo HTML 端点搜索'
    }
];

const UNSUPPORTED_PATTERN = /(not found|not implemented|unknown command|no such command|不支持|未实现|找不到命令|command .*not)/i;
const PERMISSION_PATTERN = /(permission denied|access denied|not allowed|forbidden|权限|拒绝)/i;
const NETWORK_PATTERN = /(timed? ?out|timeout|connection|dns|tls|ssl|certificate|network|网络|连接)/i;

/**
 * Turn a raw invoke rejection into a stable category plus the original text, so
 * the diagnostics panel can show something actionable on every platform.
 */
export function describeToolFailure(error) {
    const raw = typeof error === 'string'
        ? error
        : String(error?.message || error || '');
    const text = raw.trim() || '未知错误';
    let kind = 'error';
    if (UNSUPPORTED_PATTERN.test(text)) kind = 'unsupported';
    else if (PERMISSION_PATTERN.test(text)) kind = 'permission';
    else if (NETWORK_PATTERN.test(text)) kind = 'network';
    return { kind, message: text };
}

export function createToolProbeResult(id, startedAt, error) {
    if (!error) {
        return {
            id,
            ok: true,
            kind: 'ok',
            message: '',
            durationMs: Math.max(0, Date.now() - startedAt)
        };
    }
    const failure = describeToolFailure(error);
    return {
        id,
        ok: false,
        kind: failure.kind,
        message: failure.message,
        durationMs: Math.max(0, Date.now() - startedAt)
    };
}

/**
 * Probe the runtime tools through the injected invoker. `invokeCommand` is
 * passed in so this module stays testable outside Tauri.
 */
export async function probeLocalTools(invokeCommand) {
    const results = [];
    for (const spec of LOCAL_TOOL_SPECS) {
        if (spec.id === 'web-search') continue; // network probe is handled separately
        const startedAt = Date.now();
        try {
            await invokeCommand(spec.command);
            results.push(createToolProbeResult(spec.id, startedAt, null));
        } catch (error) {
            results.push(createToolProbeResult(spec.id, startedAt, error));
        }
    }
    return results;
}

export function summarizeProbe(results = []) {
    const list = Array.isArray(results) ? results : [];
    const failed = list.filter(result => !result.ok);
    return {
        total: list.length,
        ok: list.length - failed.length,
        failed: failed.map(result => `${result.id}: ${result.message}`)
    };
}
