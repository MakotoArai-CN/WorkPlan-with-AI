import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const modal = readFileSync(new URL('../src/lib/components/AnimatedModal.svelte', import.meta.url), 'utf8');
const vault = readFileSync(new URL('../src/lib/components/Passwords.svelte', import.meta.url), 'utf8');

test('shared modal snapshots the trigger before autofocus and reuses it on close', () => {
    const open = modal.slice(modal.indexOf('async function open()'), modal.indexOf('async function close('));
    expect(open.indexOf('const openingOrigin = origin || triggerRect()')).toBeLessThan(open.indexOf('await tick()'));
    expect(open).toContain('originRect = openingOrigin');
    expect(modal).toContain('const origin = originRect || triggerRect()');
    expect(modal).toContain('prefers-reduced-motion: reduce');
});

test('all custom category entry points capture their own clicked button for linear motion', () => {
    for (const source of ['filter', 'new', 'edit']) {
        expect(vault).toContain(`openCustomCategory("${source}", event)`);
    }
    expect(vault).toContain('customCategoryOrigin = trigger?.getBoundingClientRect()');
    expect(vault).toContain('origin={customCategoryOrigin} animationEasing="linear"');
    expect(modal).toContain("animationEasing || 'cubic-bezier(0.22, 0.8, 0.24, 1)'");
});
