import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const surfaceScript = readFileSync(new URL('../static/theme-surface.js', import.meta.url), 'utf8');
const bootScript = readFileSync(new URL('../static/theme-init.js', import.meta.url), 'utf8');

test('web metadata and the Android bridge receive the same surface for every supported theme', () => {
    const calls = [], metadata = [];
    const window = { WorkPlanAndroid: { setSystemBars: theme => calls.push(theme) }, document: { querySelector: () => ({ setAttribute: (_, value) => metadata.push(value) }) } };
    runInNewContext(surfaceScript, { window });
    for (const [theme, color] of Object.entries({ light: '#ffffff', dark: '#0f172a', ocean: '#e0f2fe', forest: '#ecfdf5', sunset: '#fff7ed', rose: '#fff1f2', frosted: '#eef4ff' })) {
        window.WorkPlanTheme.applySystemBars(theme);
        expect(metadata.at(-1)).toBe(color);
        expect(calls.at(-1)).toBe(theme);
    }
    window.WorkPlanTheme.applySystemBars('invalid');
    expect(calls.at(-1)).toBe('light');
});

test('first paint updates system bars for light, colored, legacy and automatic themes', () => {
    for (const [saved, systemDark, expected] of [['light', true, 'light'], ['forest', false, 'forest'], ['auto', true, 'dark'], ['auto', false, 'light'], ['liquidglass', false, 'frosted']]) {
        const calls = [];
        const document = { documentElement: { dataset: {}, classList: { add() {} }, style: {} } };
        const window = { matchMedia: () => ({ matches: systemDark }), WorkPlanTheme: { applySystemBars: theme => calls.push(theme) } };
        runInNewContext(bootScript, { window, document, navigator: { userAgent: 'Android' }, localStorage: { length: 0, getItem: () => JSON.stringify({ theme: saved }) } });
        expect(calls).toEqual([expected]);
    }
});

test('older bridges or non-native browsers remain usable and no arbitrary color reaches native UI', () => {
    for (const bridge of [undefined, {}, { setSystemBars() { throw Error('Unavailable bridge'); } }]) {
        const window = { WorkPlanAndroid: bridge };
        runInNewContext(surfaceScript, { window });
        expect(() => window.WorkPlanTheme.applySystemBars('dark')).not.toThrow();
    }
    const source = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
    expect(source).toContain('fun setSystemBars(theme: String)');
    expect(source).toContain('if (theme !in setOf(');
    expect(source).toContain('WindowInsetsControllerCompat(window, decor)');
    expect(source).toContain('WindowInsetsCompat.Type.statusBars()');
    expect(source).toContain('scrim.isClickable = false');
    expect(source).toContain('scrim.isFocusable = false');
    expect(source).toContain('<item name="android:statusBarColor">#ffffff</item>');
    expect(source).toContain('<item name="android:statusBarColor">#0f172a</item>');
});

test('blocked preference storage does not prevent following system dark mode at first paint', () => {
    const calls = [];
    const document = { documentElement: { dataset: {}, classList: { add() {} }, style: {} } };
    runInNewContext(bootScript, { document, navigator: { userAgent: 'Android' },
        window: { matchMedia: () => ({ matches: true }), WorkPlanTheme: { applySystemBars: theme => calls.push(theme) } },
        localStorage: { get length() { throw Error('Blocked'); }, getItem() { throw Error('Blocked'); } } });
    expect(calls).toEqual(['dark']);
});
