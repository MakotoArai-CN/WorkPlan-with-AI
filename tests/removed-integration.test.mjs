import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('removed SDK is not a tracked dependency, runtime import or build checkout', () => {
    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/);
    expect(tracked).not.toContain('g4f.dev');
    expect(tracked).not.toContain('.gitmodules');
    for (const file of ['release.yml', 'quality.yml', 'linux-portable.yml']) {
        expect(readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8')).not.toMatch(/g4f/i);
    }
    function scan(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) scan(path);
            else if (/\.(js|svelte)$/.test(path)) {
                expect(readFileSync(path, 'utf8')).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*g4f/i);
            }
        }
    }
    scan(fileURLToPath(new URL('../src', import.meta.url)));
});

test('destructive entry point exists in Settings only and binds confirmation to its account', () => {
    const read = path => readFileSync(new URL(`../src/lib/components/${path}`, import.meta.url), 'utf8');
    for (const file of ['Sidebar.svelte', 'MoreMenu.svelte', 'MobileNav.svelte']) {
        expect(read(file)).not.toContain('clearAllData');
        expect(read(file)).not.toContain('settings.danger_zone');
    }
    expect(read('Settings.svelte')).toContain('taskStore.clearAllData(account)');
    expect(read('Settings.svelte')).toContain('$taskStore.accessKey === account');
});
