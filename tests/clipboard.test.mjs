// The report copy button relied on navigator.clipboard alone: in webviews
// where that API is missing or rejected, clicking copy silently did nothing.
// Cover both the modern path and the legacy fallback.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { copyText } from '../src/lib/utils/clipboard.js';

const originalNavigator = globalThis.navigator;
const originalDocument = globalThis.document;

function installLegacyDocument({ execCommandResult = true } = {}) {
    const appended = [];
    const removed = [];
    const textarea = {
        value: '',
        style: {},
        setAttribute() {},
        select() { this.selected = true; },
        setSelectionRange() {}
    };
    globalThis.document = {
        createElement() { return textarea; },
        body: {
            appendChild(node) { appended.push(node); },
            removeChild(node) { removed.push(node); }
        },
        execCommand(command) {
            this.lastCommand = command;
            return execCommandResult;
        }
    };
    return { textarea, appended, removed, document: globalThis.document };
}

beforeEach(() => {
    globalThis.navigator = {};
});

afterEach(() => {
    globalThis.navigator = originalNavigator;
    globalThis.document = originalDocument;
});

describe('copyText', () => {
    test('uses navigator.clipboard when available', async () => {
        let written = null;
        globalThis.navigator = {
            clipboard: {
                async writeText(value) { written = value; }
            }
        };
        expect(await copyText('日报内容')).toBe(true);
        expect(written).toBe('日报内容');
    });

    test('falls back to execCommand when the clipboard API rejects', async () => {
        globalThis.navigator = {
            clipboard: {
                async writeText() { throw new Error('NotAllowedError'); }
            }
        };
        const fake = installLegacyDocument();
        expect(await copyText('fallback text')).toBe(true);
        expect(fake.appended).toHaveLength(1);
        expect(fake.removed).toHaveLength(1);
        expect(fake.textarea.value).toBe('fallback text');
        expect(fake.document.lastCommand).toBe('copy');
    });

    test('reports failure when both paths fail', async () => {
        globalThis.navigator = {};
        installLegacyDocument({ execCommandResult: false });
        expect(await copyText('text')).toBe(false);
    });

    test('empty input is a no-op', async () => {
        expect(await copyText('')).toBe(false);
        expect(await copyText(null)).toBe(false);
    });
});
