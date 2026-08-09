// Two things this pins, both from the Android "导出后根本找不着" report:
//
// 1. `pdf.output('datauristring')` returns a *complete* data URL. downloadFile's
//    browser fallback wrapped it in a second `data:...;base64,` prefix, which
//    `fetch` rejects outright, so web PDF export always failed.
// 2. Android's save dialog returns a SAF `content://` URI. Showing that raw in a
//    toast is useless to a human, so it gets rendered as a readable volume/path.
import { describe, test, expect } from 'bun:test';
// Imported from export-payload.js, not export.js: the latter pulls in html2canvas,
// which dereferences `window.document` at import time. Earlier test files leak a
// bare `globalThis.window` without a document, so importing export.js here crashed
// the whole suite while passing in isolation.
import { stripDataUrlPrefix, describeSavedLocation } from '../src/lib/utils/export-payload.js';

describe('stripDataUrlPrefix', () => {
    test('strips the prefix jsPDF emits', () => {
        expect(stripDataUrlPrefix('data:application/pdf;filename=generated.pdf;base64,JVBERi0xLjM='))
            .toBe('JVBERi0xLjM=');
    });

    test('strips a plain octet-stream prefix', () => {
        expect(stripDataUrlPrefix('data:application/octet-stream;base64,QUJD')).toBe('QUJD');
    });

    test('is case-insensitive about the scheme and the base64 marker', () => {
        expect(stripDataUrlPrefix('DATA:image/png;BASE64,QQ==')).toBe('QQ==');
    });

    test('leaves bare base64 untouched', () => {
        expect(stripDataUrlPrefix('JVBERi0xLjM=')).toBe('JVBERi0xLjM=');
    });

    test('leaves a non-base64 data URL alone rather than corrupting it', () => {
        expect(stripDataUrlPrefix('data:text/plain,hello')).toBe('data:text/plain,hello');
    });

    test('handles absent input', () => {
        expect(stripDataUrlPrefix('')).toBe('');
        expect(stripDataUrlPrefix(null)).toBe('');
        expect(stripDataUrlPrefix(undefined)).toBe('');
    });

    test('re-wrapping the result produces exactly one prefix', () => {
        const jsPdfOutput = 'data:application/pdf;filename=generated.pdf;base64,JVBERi0xLjM=';
        const wrapped = `data:application/octet-stream;base64,${stripDataUrlPrefix(jsPdfOutput)}`;
        expect(wrapped).toBe('data:application/octet-stream;base64,JVBERi0xLjM=');
        expect(wrapped.match(/data:/gi)).toHaveLength(1);
    });
});

describe('describeSavedLocation', () => {
    test('a plain filesystem path is shown as-is', () => {
        expect(describeSavedLocation('C:\\Users\\me\\Downloads\\a.pdf')).toBe('C:\\Users\\me\\Downloads\\a.pdf');
        expect(describeSavedLocation('/storage/emulated/0/Download/a.pdf')).toBe('/storage/emulated/0/Download/a.pdf');
    });

    test('a SAF URI with an embedded primary volume becomes a readable path', () => {
        expect(describeSavedLocation('content://com.android.externalstorage.documents/document/primary%3ADownload%2Fa.pdf'))
            .toBe('内部存储/Download/a.pdf');
    });

    test('a non-primary volume keeps its volume name', () => {
        expect(describeSavedLocation('content://com.android.externalstorage.documents/document/1A2B-3C4D%3ADocs%2Fa.pdf'))
            .toBe('1A2B-3C4D/Docs/a.pdf');
    });

    test('an opaque SAF URI degrades to a human-readable hint, not the raw URI', () => {
        const described = describeSavedLocation('content://com.example.provider/document/12345');
        expect(described).not.toContain('content://');
        expect(described).toBe('你在系统保存对话框中选择的位置');
    });

    test('absent input yields an empty string so the toast omits the location', () => {
        expect(describeSavedLocation('')).toBe('');
        expect(describeSavedLocation(undefined)).toBe('');
        expect(describeSavedLocation(null)).toBe('');
    });
});
