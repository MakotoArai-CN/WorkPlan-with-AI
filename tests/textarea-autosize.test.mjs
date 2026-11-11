import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resizeTextarea, observeTextareaResize } from '../src/lib/utils/textarea-autosize.js';

function textarea(contentHeight = 44, value = 'draft') {
    const shell = { clientWidth: 360, clientHeight: 600 };
    return {
        value,
        style: { height: '44px', overflowY: 'hidden' },
        scrollTop: 0,
        contentHeight,
        shell,
        closest: () => shell,
        get scrollHeight() {
            return Math.max(this.contentHeight, parseFloat(this.style.height) || 0);
        }
    };
}

describe('AI textarea autosize', () => {
    test('grows for content then shrinks when content is removed', () => {
        const node = textarea(220);
        resizeTextarea(node);
        expect(node.style.height).toBe('220px');
        node.contentHeight = 64;
        resizeTextarea(node);
        expect(node.style.height).toBe('64px');
    });

    test('empty drafts reset to their original height and clear internal scrolling', () => {
        const node = textarea(900);
        node.scrollTop = 400;
        resizeTextarea(node);
        expect(node.style.overflowY).toBe('auto');
        node.value = '';
        resizeTextarea(node);
        expect(node.style.height).toBe('44px');
        expect(node.style.overflowY).toBe('hidden');
        expect(node.scrollTop).toBe(0);
    });

    test('recalculates the cap when a panel or window gets shorter', () => {
        const node = textarea(900);
        resizeTextarea(node);
        expect(node.style.height).toBe('300px');
        node.shell.clientHeight = 240;
        resizeTextarea(node);
        expect(node.style.height).toBe('120px');
        expect(node.style.overflowY).toBe('auto');
    });

    test('keeps the one-row minimum and tolerates an unmounted textarea', () => {
        const node = textarea(10);
        resizeTextarea(node);
        expect(node.style.height).toBe('44px');
        expect(() => resizeTextarea(null)).not.toThrow();
    });
});

describe('AI textarea resize subscription', () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    afterEach(() => {
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
        else delete globalThis.window;
        if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver);
        else delete globalThis.ResizeObserver;
    });

    test('observes container, window and keyboard viewport changes with cleanup', () => {
        const events = new Map();
        const viewportEvents = new Map();
        globalThis.window = {
            addEventListener: (event, listener) => events.set(event, listener),
            removeEventListener: event => events.delete(event),
            visualViewport: {
                addEventListener: (event, listener) => viewportEvents.set(event, listener),
                removeEventListener: event => viewportEvents.delete(event)
            }
        };
        let callback;
        let observed;
        let disconnected = false;
        globalThis.ResizeObserver = class {
            constructor(listener) { callback = listener; }
            observe(node) { observed = node; }
            disconnect() { disconnected = true; }
        };
        const node = textarea();
        let calls = 0;
        const cleanup = observeTextareaResize(node, () => calls++);
        expect(observed).toBe(node.shell);
        callback();
        expect(calls).toBe(0);
        node.shell.clientWidth = 280;
        callback();
        expect(calls).toBe(1);
        events.get('resize')();
        viewportEvents.get('resize')();
        expect(calls).toBe(3);
        cleanup();
        expect(disconnected).toBe(true);
        expect(events.size).toBe(0);
        expect(viewportEvents.size).toBe(0);
    });
});

describe('AI composer integration', () => {
    test('both composers share shrinkable autosize and responsive observation', () => {
        for (const component of ['AiPanel', 'AiChat']) {
            const source = readFileSync(new URL(`../src/lib/components/${component}.svelte`, import.meta.url), 'utf8');
            expect(source).toContain('resizeTextarea(composerTextarea, 0.5)');
            expect(source).toContain('observeTextareaResize(composerTextarea, syncComposerHeight)');
            expect(source).not.toContain('Math.max(minHeight, currentHeight, contentHeight)');
        }
    });

    test('chat clears the composer before waiting for the full response', () => {
        const source = readFileSync(new URL('../src/lib/components/AiChat.svelte', import.meta.url), 'utf8');
        const send = source.slice(source.indexOf('async function handleSend()'), source.indexOf('async function handleRetry('));
        expect(send.indexOf('inputText = ""')).toBeLessThan(send.indexOf('await sending'));
        expect(send).toContain('inputText = draft');
    });
});
