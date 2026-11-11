import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_DETAIL_WIDTH, detailPanelLayout, detailWidthFromKey } from '../src/lib/utils/panel-resize.js';

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
