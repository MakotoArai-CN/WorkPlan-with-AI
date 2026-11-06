import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

describe('AI chat session drawer', () => {
    // The drawer used to keep `position: fixed` after the window was widened,
    // so its 280px panel covered the app sidebar and every nav item (including
    // 密码管理) became unclickable while the screen still showed the chat.
    test('never stays fixed at desktop breakpoints', () => {
        const source = read('src/lib/components/AiChat.svelte');
        const aside = source.slice(source.indexOf('<aside'), source.indexOf('</aside>'));
        expect(aside).toContain('md:static');
        expect(aside).toContain('md:translate-x-0');
    });

    test('closes itself when the viewport grows past the mobile breakpoint', () => {
        const source = read('src/lib/components/AiChat.svelte');
        expect(source).toContain('window.innerWidth >= 768');
        expect(source).toContain("window.addEventListener('resize', handleViewportResize)");
        expect(source).toContain("window.removeEventListener('resize', handleViewportResize)");
    });

    test('offers an explicit close button inside the drawer', () => {
        const source = read('src/lib/components/AiChat.svelte');
        expect(source).toMatch(/showSessionDrawer = false/);
        expect(source).toContain('ph-x');
    });
});

describe('main view rendering', () => {
    // A view that throws used to leave the previous view painted and swallow
    // every later navigation. The boundary keeps the app usable.
    test('wraps the view switch in a boundary keyed by view', () => {
        const source = read('src/routes/+page.svelte');
        expect(source).toContain('{#key $currentView}');
        expect(source).toContain('<svelte:boundary>');
        expect(source).toContain('{#snippet failed(error)}');
        expect(source).toContain("currentView.set('dashboard')");
    });
});
