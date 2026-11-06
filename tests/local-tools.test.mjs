import { describe, test, expect } from 'bun:test';
import {
    LOCAL_TOOL_SPECS,
    createToolProbeResult,
    describeToolFailure,
    probeLocalTools,
    summarizeProbe
} from '../src/lib/utils/local-tools.js';

describe('local toolchain registry', () => {
    test('declares a command and label for every tool', () => {
        expect(LOCAL_TOOL_SPECS.length).toBeGreaterThan(3);
        for (const spec of LOCAL_TOOL_SPECS) {
            expect(typeof spec.id).toBe('string');
            expect(typeof spec.command).toBe('string');
            expect(spec.command.length).toBeGreaterThan(0);
            expect(typeof spec.label).toBe('string');
        }
    });

    test('keeps ids unique', () => {
        const ids = LOCAL_TOOL_SPECS.map(spec => spec.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('tool failure classification', () => {
    // The Linux builds only ever showed "失败", which is what made the Arch
    // report impossible to triage. Every rejection now keeps its category.
    test('separates unsupported commands from permission and network errors', () => {
        expect(describeToolFailure('command get_workspace_root not found').kind).toBe('unsupported');
        expect(describeToolFailure('cmd not implemented').kind).toBe('unsupported');
        expect(describeToolFailure('permission denied: /home/u').kind).toBe('permission');
        expect(describeToolFailure('TLS certificate verify failed').kind).toBe('network');
        expect(describeToolFailure('something odd').kind).toBe('error');
    });

    test('never returns an empty message', () => {
        expect(describeToolFailure(undefined).message.length).toBeGreaterThan(0);
        expect(describeToolFailure('').message.length).toBeGreaterThan(0);
        const result = createToolProbeResult('workspace', Date.now(), new Error('boom'));
        expect(result.ok).toBe(false);
        expect(result.message).toContain('boom');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
});

describe('probeLocalTools', () => {
    test('reports each tool without throwing when a command is missing', async () => {
        const invoked = [];
        const results = await probeLocalTools(async (command) => {
            invoked.push(command);
            if (command === 'write_text_file') throw new Error('command not found');
            return 'ok';
        });
        expect(results.length).toBeGreaterThan(0);
        expect(invoked).not.toContain('search_web');
        const write = results.find(result => result.id === 'write-file');
        expect(write.ok).toBe(false);
        expect(write.kind).toBe('unsupported');
        expect(results.filter(result => result.ok).length).toBe(results.length - 1);
    });

    test('summarizes failures for the diagnostics UI', () => {
        const summary = summarizeProbe([
            { id: 'workspace', ok: true, message: '' },
            { id: 'read-file', ok: false, message: 'permission denied' }
        ]);
        expect(summary.total).toBe(2);
        expect(summary.ok).toBe(1);
        expect(summary.failed[0]).toContain('read-file');
        expect(summarizeProbe(undefined).total).toBe(0);
    });
});
