import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../static/startup.js', import.meta.url), 'utf8');

function boot({ userAgent = 'Windows', language = 'en', settings = '{}', reducedMotion = false, blockedStorage = false } = {}) {
    const listeners = new Map();
    const pending = new Map();
    const frames = [];
    const classes = new Set();
    const attributes = new Map();
    const dataset = {};
    let removed = false;
    let reloads = 0;
    let buttonClick;
    const status = { textContent: '' };
    const button = { hidden: true, textContent: '', addEventListener: (_, callback) => { buttonClick = callback; } };
    const screen = {
        classList: { add: value => classes.add(value), toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value) },
        setAttribute: (key, value) => attributes.set(key, value), remove: () => { removed = true; }
    };
    const context = {
        document: {
            documentElement: { dataset },
            getElementById: id => id === 'workplan-startup-status' ? status : id === 'workplan-startup-retry' ? button : removed ? null : screen,
            addEventListener: (event, callback) => listeners.set(event, callback)
        },
        window: { addEventListener: (event, callback) => listeners.set(event, callback), matchMedia: () => ({ matches: reducedMotion }) },
        navigator: { userAgent, language },
        localStorage: { getItem: key => { if (blockedStorage) throw new Error('denied'); return key === 'workplan_system_settings' ? settings : null; } },
        location: { reload: () => reloads++ },
        setTimeout: (callback, milliseconds) => { const id = pending.size + 1; pending.set(id, { callback, milliseconds }); return id; },
        clearTimeout: id => pending.delete(id),
        requestAnimationFrame: callback => frames.push(callback)
    };
    runInNewContext(script, context);
    return {
        dataset, classes, attributes, status, button, pending,
        get removed() { return removed; }, get reloads() { return reloads; },
        fire: event => listeners.get(event)?.(),
        paint: () => frames.splice(0).forEach(callback => callback()),
        advance: milliseconds => {
            const due = [...pending].filter(([, timer]) => timer.milliseconds === milliseconds);
            due.forEach(([id, timer]) => { pending.delete(id); timer.callback(); });
        },
        retry: () => buttonClick?.()
    };
}

describe('first-paint startup animation', () => {
    test('selects distinct desktop and Android presentations independently of viewport width', () => {
        expect(boot().dataset.startupPlatform).toBe('desktop');
        expect(boot({ userAgent: 'Mozilla/5.0 (Linux; Android 14)' }).dataset.startupPlatform).toBe('android');
    });

    test('leaves only after app readiness and a paint, without an artificial minimum delay', () => {
        const app = boot();
        app.fire('DOMContentLoaded');
        expect(app.removed).toBe(false);
        app.fire('workplan:ready');
        expect(app.classes.has('startup-leaving')).toBe(false);
        app.paint();
        expect(app.classes.has('startup-leaving')).toBe(true);
        expect(app.attributes.get('aria-hidden')).toBe('true');
        app.advance(220);
        expect(app.removed).toBe(true);
        expect(app.pending.size).toBe(0);
    });

    test('does not lose readiness signaled before DOMContentLoaded', () => {
        const app = boot();
        app.fire('workplan:ready');
        app.fire('DOMContentLoaded');
        app.paint();
        app.advance(220);
        expect(app.removed).toBe(true);
    });

    test('exposes retry for a slow startup without revealing uninitialized data', () => {
        const app = boot();
        app.fire('DOMContentLoaded');
        app.advance(12000);
        expect(app.removed).toBe(false);
        expect(app.button.hidden).toBe(false);
        expect(app.status.textContent).toContain('longer');
        app.retry();
        expect(app.reloads).toBe(1);
    });

    test('shows a localized startup error without exposing a blocked application', () => {
        const app = boot({ language: 'zh-CN' });
        app.fire('workplan:startup-error');
        app.fire('DOMContentLoaded');
        expect(app.status.textContent).toContain('\u542f\u52a8\u5931\u8d25');
        expect(app.classes.has('startup-failed')).toBe(true);
        expect(app.button.hidden).toBe(false);
        expect(app.pending.size).toBe(0);
        expect(app.removed).toBe(false);
    });

    test('honors both the saved reduced-animation preference and the operating system', () => {
        for (const options of [{ settings: '{"reduceAnimations":true}' }, { reducedMotion: true }]) {
            const app = boot(options);
            app.fire('DOMContentLoaded');
            app.fire('workplan:ready');
            app.paint();
            app.advance(0);
            expect(app.removed).toBe(true);
        }
    });

    test('still starts when browser storage is unavailable', () => {
        const app = boot({ blockedStorage: true });
        app.fire('DOMContentLoaded');
        expect(app.status.textContent).toBe('Preparing your workspace');
    });
});
