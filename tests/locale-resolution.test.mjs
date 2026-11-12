import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../static/locale-init.js', import.meta.url), 'utf8');

function resolve({ saved, system, browser = 'en-US', blocked = false } = {}) {
    const document = { documentElement: {} };
    const window = { document, navigator: { language: browser }, __WORKPLAN_SYSTEM_LOCALE__: system,
        localStorage: { getItem() { if (blocked) throw Error('Storage denied'); return saved; } } };
    runInNewContext(script, { window });
    return { locale: window.WorkPlanLocale.current(), html: document.documentElement.lang, normalize: window.WorkPlanLocale.normalize };
}

test('saved explicit language wins over system locale and WebView preference', () => {
    expect(resolve({ saved: 'en', system: 'zh_CN.UTF-8', browser: 'zh-CN' }).locale).toBe('en');
    expect(resolve({ saved: 'zh-Hant', system: 'en_US.UTF-8' }).locale).toBe('zh-Hant');
});

test('POSIX system locale takes priority, including explicit English fallback for C and unsupported locales', () => {
    for (const system of ['en_US.UTF-8', 'C', 'C.UTF-8', 'POSIX', 'de_DE.UTF-8']) {
        expect(resolve({ system, browser: 'zh-CN' }).locale).toBe('en');
    }
    for (const system of ['zh_CN.UTF-8', 'zh_SG.utf8']) expect(resolve({ system }).locale).toBe('zh');
    for (const system of ['zh_TW.UTF-8', 'zh_HK.UTF-8', 'zh-Hant-TW']) expect(resolve({ system }).locale).toBe('zh-Hant');
    expect(resolve({ system: 'ja_JP.UTF-8' }).locale).toBe('ja');
});

test('web/mobile fall back to WebView language and tolerate unavailable storage or invalid saved values', () => {
    expect(resolve({ browser: 'zh-CN' }).html).toBe('zh');
    expect(resolve({ browser: 'fr-FR' }).html).toBe('en');
    expect(resolve({ saved: 'invalid', system: 'en_US.UTF-8', browser: 'zh-CN' }).locale).toBe('en');
    expect(resolve({ blocked: true, system: 'zh_CN.UTF-8' }).locale).toBe('zh');
    expect(resolve({ browser: 'ja-JP' }).locale).toBe('ja');
});

test('first paint and application share the same resolver and the English HTML fallback', () => {
    const html = readFileSync(new URL('../src/app.html', import.meta.url), 'utf8');
    const startup = readFileSync(new URL('../static/startup.js', import.meta.url), 'utf8');
    const application = readFileSync(new URL('../src/lib/i18n/index.js', import.meta.url), 'utf8');
    expect(html).toContain('<html lang="en">');
    expect(html.indexOf('/locale-init.js')).toBeLessThan(html.indexOf('/startup.js'));
    expect(startup).toContain('window.WorkPlanLocale.current()');
    expect(application).toContain("import '../../../static/locale-init.js'");
    const native = readFileSync(new URL('../src-tauri/src/locale.rs', import.meta.url), 'utf8');
    expect(native).toContain('["LC_ALL", "LC_MESSAGES", "LANG"]');
});
