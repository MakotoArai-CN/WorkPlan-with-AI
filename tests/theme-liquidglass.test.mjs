import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');
const locales = ['zh', 'en', 'ja'];

describe('liquid glass theme', () => {
    test('replaces the retired graphite theme everywhere', () => {
        const css = read('src/app.css');
        expect(css).toContain(':root[data-theme="liquidglass"]');
        expect(css).not.toContain(':root[data-theme="graphite"]');

        const settings = read('src/lib/stores/settings.js');
        expect(settings).toContain("new Set(['dark'])");
        expect(settings).not.toContain('graphite: ');

        const picker = read('src/lib/components/Settings.svelte');
        expect(picker).toContain("id: 'liquidglass'");
        expect(picker).not.toContain("id: 'graphite'");
    });

    test('migrates a stored graphite preference instead of dropping the theme', () => {
        const settings = read('src/lib/stores/settings.js');
        expect(settings).toContain("parsed.theme === 'graphite'");
        expect(settings).toContain("? 'liquidglass'");

        const bootstrap = read('static/theme-init.js');
        expect(bootstrap).toContain("if (mode === 'graphite') mode = 'liquidglass';");
        expect(bootstrap).not.toContain("isDark = mode === 'dark' || mode === 'liquidglass'");
    });

    test('keeps the animated aurora respectful of reduced motion', () => {
        const css = read('src/app.css');
        expect(css).toContain('@keyframes liquidglass-drift');
        expect(css).toContain('prefers-reduced-motion: reduce');
    });

    test('is offered with a translated label in every locale', () => {
        for (const lang of locales) {
            const dictionary = JSON.parse(read(`src/lib/i18n/${lang}.json`));
            expect(typeof dictionary.settings.theme_liquidglass).toBe('string');
            expect(dictionary.settings.theme_liquidglass.length).toBeGreaterThan(0);
            expect(dictionary.settings.theme_graphite).toBeUndefined();
        }
    });
});

describe('Linux font rendering', () => {
    test('uses a font stack that exists on Linux instead of Windows-only names', () => {
        const css = read('src/app.css');
        const stackMatch = css.match(/--app-font-sans:([\s\S]*?);/);
        expect(stackMatch).toBeTruthy();
        const stack = stackMatch[1];
        expect(stack).toContain('Noto Sans');
        expect(stack).toContain('Noto Sans CJK SC');
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
