import { expect, test } from 'bun:test';
import { findPrivateFiles } from '../packaging/check-public-files.mjs';

test('public documentation is explicitly allowlisted without hiding executable tests', () => {
    expect(findPrivateFiles([
        'README.md', 'docs/SUPABASE_SECURITY.md', 'packaging/arch/README.md',
        'tests/crypto.test.mjs', 'docs/sql/verify_rls.sql', 'src/lib/utils/markdown.js'
    ])).toEqual([]);
});

test('internal documents and test artifacts cannot be published even when force-added', () => {
    const paths = [
        'docs/internal/SECURITY_NOTES.md', 'docs/development/plan.txt',
        'docs/testing/results.json', 'docs/SECURITY_NOTES.md', 'AGENTS.md',
        'TEST_REPORT_2026.md', 'test-results/result.json', 'playwright-report/index.html',
        'output/playwright/screenshot.png', '.playwright-cli/page.yml',
        'check-output.log', 'docs/new-unreviewed-guide.mdx'
    ];
    expect(findPrivateFiles(paths)).toEqual(paths);
});
