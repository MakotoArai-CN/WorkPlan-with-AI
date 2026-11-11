import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// New public prose must be explicitly reviewed instead of publishing local notes.
const PUBLIC_DOCUMENTS = new Set([
    'README.md',
    'docs/SUPABASE_SECURITY.md',
    'packaging/arch/README.md'
]);
const INTERNAL_DIRECTORIES = /^(?:docs\/(?:internal|development|testing)|test-results|playwright-report|output\/playwright|\.playwright-cli|\.playwright-mcp)(?:\/|$)/i;
const INTERNAL_NAMES = /(?:^|\/)(?:AGENTS\.md|(?:DEVELOPMENT|TESTING|TEST_REPORT)[^/]*\.md|(?:check|test)-output\.log)$/i;

export function findPrivateFiles(paths) {
    return paths.filter(path => INTERNAL_DIRECTORIES.test(path) || INTERNAL_NAMES.test(path)
        || (/\.(?:md|mdx|markdown|rst|adoc)$/i.test(path) && !PUBLIC_DOCUMENTS.has(path)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    // Check tracked files, not a directory walk: ignored private files stay local.
    const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    const blocked = findPrivateFiles(tracked);
    if (blocked.length) {
        console.error(`Internal or unreviewed documentation must not be published:\n${blocked.join('\n')}`);
        process.exitCode = 1;
    } else {
        console.log('Public repository file policy passed.');
    }
}
