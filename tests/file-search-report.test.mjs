import { expect, test } from 'bun:test';
import { fitFileSearchReport } from '../src/lib/utils/file-search-report.js';

test('transport pagination preserves completed counts and a usable next offset', () => {
    const report = { entries: Array.from({ length: 100 }, (_, index) => ({ path: '/scope/' + index + 'x'.repeat(1000) })),
        offset: 20, totalMatched: 300, countComplete: true, counts: { files: 300 }, truncated: false, hasMore: true, nextOffset: 120 };
    const page = fitFileSearchReport(report, 5000);
    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.entries.length).toBeLessThan(100);
    expect(page.totalMatched).toBe(300);
    expect(page.countComplete).toBe(true);
    expect(page.truncated).toBe(false);
    expect(page.counts.files).toBe(300);
    expect(page.nextOffset).toBe(20 + page.entries.length);
    expect(page.pageLimited).toBe(true);
});

test('summary-only search returns exact aggregate metadata without a pointless list continuation', () => {
    const report = { entries: [], totalMatched: 5200, counts: { files: 5200 }, countComplete: true, hasMore: false };
    expect(fitFileSearchReport(report)).toBe(report);
});
