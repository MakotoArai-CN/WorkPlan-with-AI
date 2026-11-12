import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { getReleaseNotes, officialReleaseUrl, publicReleaseNotes } from '../src/lib/utils/release-history.js';
import { renderReleaseNotes } from '../packaging/release-notes.mjs';
import releases from '../src/lib/release-history.json';

test('public release history covers the shipping version with localized concise changes', () => {
    const version = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
    expect(getReleaseNotes(version, 'zh')).not.toBe('');
    const versions = releases.map(item => item.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const entry of releases) {
        expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        for (const language of ['zh', 'en', 'ja']) {
            expect(entry.changes[language].length).toBeGreaterThan(0);
            for (const change of entry.changes[language]) expect(change.length).toBeLessThan(500);
        }
    }
    expect(getReleaseNotes('v0.5.17', 'zh-Hant')).toBe(getReleaseNotes('0.5.17', 'zh'));
    expect(getReleaseNotes('0.5.17', 'fr')).toBe(getReleaseNotes('0.5.17', 'en'));
    expect(getReleaseNotes('0.0.1')).toBe('');
});

test('update links are official version-specific URLs only', () => {
    expect(officialReleaseUrl('v0.5.17')).toBe('https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/tag/v0.5.17');
    for (const invalid of ['', 'https://attacker.invalid', '../escape', '0.5.17/../other', '0.5.17-beta']) expect(officialReleaseUrl(invalid)).toBe('');
});

test('changelog extraction excludes installer tables while leaving arbitrary text inert for the renderer', () => {
    expect(publicReleaseNotes('# Header\n\n## 本次更新\n\n- Correct names\n- Notes\n\n## 下载\ninstaller')).toBe('- Correct names\n- Notes');
    expect(publicReleaseNotes('')).toBe('');
    expect(publicReleaseNotes('x'.repeat(50000)).length).toBe(40000);
});

test('release page prioritizes curated user-facing changes over internal commit subjects', () => {
    const body = renderReleaseNotes({ version: '0.5.17', repository: 'test/workplan', assets: [],
        commits: ['INTERNAL_TEST_RUN_DESCRIPTION'], changes: ['Keep names unchanged', 'Show release notes'] });
    expect(body).toContain('- Keep names unchanged');
    expect(body).not.toContain('INTERNAL_TEST_RUN_DESCRIPTION');
});

test('public entity names and settings do not expose migration-status writers or debug click instructions', () => {
    const config = readFileSync(new URL('../src/lib/utils/ai-config.js', import.meta.url), 'utf8');
    const settings = readFileSync(new URL('../src/lib/components/Settings.svelte', import.meta.url), 'utf8');
    expect(config).not.toContain("name: `${profile.name");
    expect(settings).not.toContain('连续点击');
    expect(settings).not.toContain('repairClicks');
    expect(settings).toContain('settings.local_data_backups');
    expect(settings).toContain('showCurrentReleaseNotes');
});
