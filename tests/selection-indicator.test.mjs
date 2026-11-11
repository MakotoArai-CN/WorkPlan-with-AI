import { expect, test } from 'bun:test';
import { selectionIndicatorBounds } from '../src/lib/utils/selection-indicator.js';

function element(rect, extra = {}) {
    return { getBoundingClientRect: () => rect, ...extra };
}

test('indicator uses fractional coordinates within its own grid', () => {
    const grid = element({ left: 400, top: 200, width: 900, height: 210 }, { offsetWidth: 900, offsetHeight: 210, clientWidth: 900, clientHeight: 210 });
    const button = element({ left: 702.25, top: 312.5, width: 295.75, height: 97.5 });
    expect(selectionIndicatorBounds(grid, button)).toEqual({ left: 302.25, top: 112.5, width: 295.75, height: 97.5, ready: true });
});

test('indicator responds to ancestor scaling and never extends beyond the grid', () => {
    const grid = element({ left: 100, top: 100, width: 300, height: 100 }, { offsetWidth: 600, offsetHeight: 200, clientWidth: 600, clientHeight: 200 });
    expect(selectionIndicatorBounds(grid, element({ left: 250, top: 150, width: 200, height: 70 })))
        .toEqual({ left: 300, top: 100, width: 300, height: 100, ready: true });
    expect(selectionIndicatorBounds(grid, null).ready).toBe(false);
    expect(selectionIndicatorBounds(element({ width: 0, height: 0 }), grid).ready).toBe(false);
});
