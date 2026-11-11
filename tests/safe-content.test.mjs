import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { escapeHtml, safeImageUrl, safeInlineStyle, safeLinkUrl, safeMediaDataUrl } from '../src/lib/utils/safe-content.js';

describe('untrusted content URLs', () => {
    test('rejects executable/local/control-character URLs for links', () => {
        for (const value of ['javascript:alert(1)', 'vbscript:x', 'data:text/html,x', 'file:///C:/secret', 'asset://localhost/secret', 'tauri://localhost/x', 'java\nscript:alert(1)', 'https://user:password@example.com', '\\evil.test']) {
            expect(safeLinkUrl(value)).toBe('');
        }
        for (const value of ['https://example.com/a?x=1', 'mailto:test@example.com', 'tel:+861234', '#heading-x', './relative']) {
            expect(safeLinkUrl(value)).toBe(value);
        }
    });

    test('allows raster media and known bundled avatars, not arbitrary active documents', () => {
        expect(safeImageUrl('data:image/png;base64,YWJjZA==')).toBe('data:image/png;base64,YWJjZA==');
        expect(safeImageUrl('/avatars/assistant-orbit-1.svg')).toBe('/avatars/assistant-orbit-1.svg');
        expect(safeImageUrl('https://example.com/photo.png')).toBe('https://example.com/photo.png');
        for (const value of ['javascript:alert(1)', 'data:image/svg+xml;base64,YWJjZA==', 'data:text/html;base64,YWJjZA==', 'file:///secret.png', '/api/private-data', 'blob:tauri://localhost/secret']) {
            expect(safeImageUrl(value)).toBe('');
        }
    });

    test('checks MIME and base64 before constructing inline image/audio sources', () => {
        expect(safeMediaDataUrl('audio/mpeg', 'YWJjZA==', 'audio')).toBe('data:audio/mpeg;base64,YWJjZA==');
        expect(safeMediaDataUrl('image/svg+xml', 'YWJjZA==')).toBe('');
        expect(safeMediaDataUrl('text/html', 'YWJjZA==', 'audio')).toBe('');
        expect(safeMediaDataUrl('image/png', 'data:text/html,payload')).toBe('');
    });
});

describe('safe formatting', () => {
    test('escapes untrusted export titles and HTML text', () => {
        expect(escapeHtml('</title><script>alert("x")</script>')).toBe('&lt;/title&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    });

    test('preserves KaTeX layout and table alignment but drops overlay/network CSS', () => {
        const style = safeInlineStyle('height:3em;top:-2.5em;margin-right:0.2em;position:fixed;inset:0;z-index:999999;background:url(https://evil.test);color:red;text-align:center;opacity:0');
        expect(style).toBe('height:3em;top:-2.5em;margin-right:0.2em;color:red;text-align:center');
        expect(safeInlineStyle('width:expression(alert(1));height:var(--secret);color:url(x)')).toBe('');
    });

    test('markdown and exported documents use a final sanitizer, not raw interpolated HTML', () => {
        const markdown = readFileSync(new URL('../src/lib/utils/markdown.js', import.meta.url), 'utf8');
        const exported = readFileSync(new URL('../src/lib/utils/export.js', import.meta.url), 'utf8');
        expect(markdown).toContain('return sanitizeHtml(html)');
        expect(markdown).toContain('return escapeHtml(token.text || token.raw');
        expect(markdown).toContain('encodeURIComponent(sanitizeDiagramSvg(result.svg))');
        expect(markdown).not.toContain('element.innerHTML = sanitizeHtml(result.svg');
        expect(exported).toContain('<title>${escapeHtml(title)}</title>');
        expect(exported).toContain('<body>${sanitizeHtml(content)}</body>');
        expect(exported).toContain('Content-Security-Policy');
    });

    test('Vditor never runs loose diagram plugins or live raw-HTML previews for stored notes', () => {
        const notes = readFileSync(new URL('../src/lib/components/Notes.svelte', import.meta.url), 'utf8');
        const sanitizer = readFileSync(new URL('../src/lib/utils/safe-html.js', import.meta.url), 'utf8');
        expect(notes).toContain('codeBlockPreview: false');
        expect(notes).toContain('mathBlockPreview: true');
        expect(notes).toContain('transform: sanitizeEditorPreview');
        expect(notes).toContain('hardenVditorLute(instance.vditor.lute)');
        expect(notes.indexOf('hardenVditorLute(instance.vditor.lute)')).toBeLessThan(notes.indexOf('instance.setValue(editContent)'));
        expect(notes).toContain("value: ''");
        for (const language of ['mermaid', 'echarts', 'wavedrom', 'markmap', 'graphviz']) expect(sanitizer).toContain(`'${language}'`);
        expect(sanitizer).toContain("element.classList.replace(name, 'language-plaintext')");
    });
});
