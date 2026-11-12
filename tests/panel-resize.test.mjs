import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_DETAIL_WIDTH, DEFAULT_NOTES_WIDTH, notesPanelLayout, sidebarPanelLayout, detailPanelLayout, detailWidthFromKey } from '../src/lib/utils/panel-resize.js';

describe('resizable workspace detail panel', () => {
    test('keeps a usable workspace and clamps a persisted width', () => {
        expect(detailPanelLayout(992)).toEqual({ min: 280, max: 632, width: DEFAULT_DETAIL_WIDTH, overlay: false });
        expect(detailPanelLayout(992, 9999).width).toBe(632);
        expect(detailPanelLayout(1600, 9999).width).toBe(720);
        expect(detailPanelLayout(992, -5).width).toBe(280);
        expect(detailPanelLayout(992, 'bad').width).toBe(DEFAULT_DETAIL_WIDTH);
    });

    test('overlays at narrow desktop sizes instead of squeezing the board', () => {
        expect(detailPanelLayout(480, 9999)).toEqual({ min: 280, max: 456, width: 456, overlay: true });
        expect(detailPanelLayout(640).overlay).toBe(false);
        expect(detailPanelLayout(639).overlay).toBe(true);
        expect(detailPanelLayout(200, 350)).toEqual({ min: 200, max: 200, width: 200, overlay: true });
        expect(detailPanelLayout(0).width).toBe(0);
    });

    test('temporary viewport clamps do not destroy the preferred width', () => {
        const preferred = 600;
        expect(detailPanelLayout(700, preferred).width).toBe(340);
        expect(detailPanelLayout(1200, preferred).width).toBe(600);
    });

    test('supports left-edge keyboard resizing and exact bounds', () => {
        expect(detailWidthFromKey('ArrowLeft', 350, 280, 600)).toBe(366);
        expect(detailWidthFromKey('ArrowRight', 350, 280, 600)).toBe(334);
        expect(detailWidthFromKey('ArrowRight', 280, 280, 600)).toBe(280);
        expect(detailWidthFromKey('Home', 350, 280, 600)).toBe(280);
        expect(detailWidthFromKey('End', 350, 280, 600)).toBe(600);
        expect(detailWidthFromKey('Enter', 350, 280, 600)).toBeNull();
    });

    test('retains OS-native window borders and a practical compact minimum', () => {
        const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
        const main = config.app.windows.find(window => window.label === 'main');
        expect(main.resizable).toBe(true);
        expect(main.decorations).toBe(true);
        expect(main.minWidth).toBe(480);
        expect(main.minHeight).toBe(480);
    });
});

describe('shared sidebar sizing', () => {
    test('uses each sidebar bounds without overwriting temporary viewport clamps', () => {
        for (const options of [
            { defaultWidth: 288, minWidth: 200, maxWidth: 400, reserveWidth: 560 },
            { defaultWidth: 280, minWidth: 200, maxWidth: 480, reserveWidth: 360 },
            { defaultWidth: 224, minWidth: 180, maxWidth: 400, reserveWidth: 360 }
        ]) {
            expect(sidebarPanelLayout(1400, 'invalid', options).width).toBe(options.defaultWidth);
            expect(sidebarPanelLayout(1400, 9999, options).width).toBe(options.maxWidth);
            expect(sidebarPanelLayout(1400, -50, options).width).toBe(options.minWidth);
            expect(sidebarPanelLayout(1400, 350, options).width).toBe(350);
            expect(sidebarPanelLayout(500, 350, options).width).toBeLessThanOrEqual(250);
            expect(sidebarPanelLayout(0, 350, options).width).toBe(0);
        }
    });

    test('every actual left sidebar uses the shared resize controller and its own saved width', () => {
        const sources = [
            ['Sidebar.svelte', 'navigation-sidebar', 'workplan_navigation_panel_width'],
            ['AiChat.svelte', 'chat-session-sidebar', 'workplan_chat_sessions_panel_width'],
            ['Notes.svelte', 'notes-sidebar', 'NOTES_WIDTH_KEY'],
            ['Passwords.svelte', 'vault-category-sidebar', 'workplan_vault_categories_panel_width']
        ];
        for (const [file, id, key] of sources) {
            const source = readFileSync(new URL(`../src/lib/components/${file}`, import.meta.url), 'utf8');
            expect(source).toContain("import SidebarResizeHandle from './SidebarResizeHandle.svelte'");
            expect(source).toContain(`<SidebarResizeHandle controls="${id}"`);
            expect(source).toContain(key);
        }
        const notes = readFileSync(new URL('../src/lib/components/Notes.svelte', import.meta.url), 'utf8');
        expect(notes).not.toContain('startNotesResize');
        const shared = readFileSync(new URL('../src/lib/components/SidebarResizeHandle.svelte', import.meta.url), 'utf8');
        expect(shared).toContain('on:pointercancel={finish}');
        expect(shared).toContain('on:lostpointercapture={finish}');
        expect(shared).toContain('observer.disconnect()');
        expect(shared).toContain('panel.style.width = originalWidth');
    });
});

describe('resizable notes list', () => {
    test('preserves editor room and clamps restored widths without changing the preference', () => {
        expect(notesPanelLayout(1000).width).toBe(DEFAULT_NOTES_WIDTH);
        expect(notesPanelLayout(1000, 9999).width).toBe(480);
        expect(notesPanelLayout(650, 480)).toEqual({ min: 200, max: 290, width: 290 });
        expect(notesPanelLayout(1000, 480).width).toBe(480);
        expect(notesPanelLayout(1000, -1).width).toBe(200);
        expect(notesPanelLayout(1000, 'invalid').width).toBe(DEFAULT_NOTES_WIDTH);
        expect(notesPanelLayout(300, 480).width).toBe(150);
        expect(notesPanelLayout(0).width).toBe(0);
    });

    test('right-edge keys follow the physical drag direction and support bounds', () => {
        expect(detailWidthFromKey('ArrowRight', 288, 200, 480, 'right')).toBe(304);
        expect(detailWidthFromKey('ArrowLeft', 288, 200, 480, 'right')).toBe(272);
        expect(detailWidthFromKey('ArrowLeft', 200, 200, 480, 'right')).toBe(200);
        expect(detailWidthFromKey('End', 288, 200, 480, 'right')).toBe(480);
        expect(detailWidthFromKey('Home', 288, 200, 480, 'right')).toBe(200);
        expect(detailWidthFromKey('Escape', 288, 200, 480, 'right')).toBeNull();
    });
});
