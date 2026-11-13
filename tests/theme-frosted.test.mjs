import { describe, test, expect } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');
const locales = ['zh', 'en', 'ja'];

describe('frosted glass theme', () => {
    test('replaces the retired graphite theme', () => {
        const css = read('src/app.css');
        expect(css).toContain(':root[data-theme="frosted"]');
        expect(css).not.toContain(':root[data-theme="graphite"]');

        const settings = read('src/lib/stores/settings.js');
        expect(settings).toContain("new Set(['dark'])");
        expect(settings).not.toContain('graphite: \'#');

        const picker = read('src/lib/components/Settings.svelte');
        expect(picker).toContain("id: 'frosted'");
        expect(picker).not.toContain("id: 'graphite'");
    });

    test('is a light theme: no .dark class, light color-scheme', () => {
        const settings = read('src/lib/stores/settings.js');
        const darkSet = settings.match(/const DARK_THEMES = new Set\(\[([^\]]*)\]\)/);
        expect(darkSet).toBeTruthy();
        expect(darkSet[1]).not.toContain('frosted');

        const bootstrap = read('static/theme-init.js');
        expect(bootstrap).not.toContain("isDark = mode === 'dark' || mode === 'frosted'");
    });

    test('migrates every previously persisted theme id', () => {
        const settings = read('src/lib/stores/settings.js');
        expect(settings).toContain("['graphite', 'liquidglass'].includes(parsed.theme)");
        expect(settings).toContain("? 'frosted'");

        const bootstrap = read('static/theme-init.js');
        expect(bootstrap).toContain("mode === 'graphite' || mode === 'liquidglass'");
        expect(bootstrap).toContain("mode = 'frosted'");
    });

    test('ships its wallpaper layer', () => {
        expect(existsSync(join(root, 'static/frosted-wallpaper.svg'))).toBe(true);
        const page = read('src/routes/+page.svelte');
        expect(page).toContain('/frosted-wallpaper.svg');
        expect(page).toContain('frosted-wallpaper');
        expect(read('src/app.css')).toContain('.frosted-wallpaper');
    });

    test('uses a static backdrop and limits live blur to outer panels', () => {
        const css = read('src/app.css');
        expect(css).not.toContain('@keyframes frosted-drift');
        expect(css).not.toContain('animation: frosted-drift');
        expect(css).not.toContain('blur(34px)');
        expect(css).toContain('backdrop-filter: none !important');
        expect(css).toContain('[data-glass-role="workspace"], #detail-panel');
        expect(css).toContain('--glass-blur: blur(16px) saturate(1.35)');
        expect(css).toContain('(pointer: coarse)');
        expect(css).toContain('--glass-blur: none');
        expect(css).toContain('prefers-reduced-motion: reduce');
        expect(read('src/routes/+layout.svelte')).not.toContain('installGlassPointer');
    });

    test('is labelled as frosted glass, not liquid glass', () => {
        for (const lang of locales) {
            const dictionary = JSON.parse(read(`src/lib/i18n/${lang}.json`));
            expect(typeof dictionary.settings.theme_frosted).toBe('string');
            expect(dictionary.settings.theme_frosted.length).toBeGreaterThan(0);
            expect(dictionary.settings.theme_liquidglass).toBeUndefined();
            expect(dictionary.settings.theme_graphite).toBeUndefined();
        }
        const zh = JSON.parse(read('src/lib/i18n/zh.json'));
        expect(zh.settings.theme_frosted).toBe('磨砂玻璃');
    });
});

describe('Linux font rendering', () => {
    test('uses a font stack that exists on Linux instead of Windows-only names', () => {
        const css = read('src/app.css');
        const stackMatch = css.match(/--app-font-sans:([\s\S]*?);/);
        expect(stackMatch).toBeTruthy();
        expect(stackMatch[1]).toContain('Noto Sans');
        expect(stackMatch[1]).toContain('Noto Sans CJK SC');
        expect(css).toContain('font-family: var(--app-font-sans)');
    });

    test('does not force grayscale antialiasing on Linux', () => {
        const css = read('src/app.css');
        expect(css).toContain('-webkit-font-smoothing: subpixel-antialiased');
        expect(css).not.toContain('-webkit-font-smoothing: antialiased;');
    });

    test('marks the platform before first paint', () => {
        const bootstrap = read('static/theme-init.js');
        expect(bootstrap).toContain("dataset.platform = 'linux'");
        expect(read('src/app.css')).toContain(':root[data-platform="linux"]');
    });
});
