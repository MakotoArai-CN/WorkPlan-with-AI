import { describe, test, expect } from 'bun:test';
import { convertOklchColorsInValue, oklchToRgb } from '../src/lib/utils/color.js';

describe('oklch export conversion', () => {
    test('converts black and white', () => {
        expect(oklchToRgb('oklch(0 0 0)')).toBe('rgb(0, 0, 0)');
        expect(oklchToRgb('oklch(1 0 0)')).toBe('rgb(255, 255, 255)');
    });

    test('converts a known red', () => {
        const rgb = oklchToRgb('oklch(0.627955 0.257683 29.2339)');
        expect(rgb).toMatch(/^rgb\(/);
        const [r, g, b] = rgb.match(/\d+/g).map(Number);
        expect(Math.abs(r - 255)).toBeLessThanOrEqual(2);
        expect(g).toBeLessThanOrEqual(2);
        expect(b).toBeLessThanOrEqual(2);
    });

    test('preserves alpha', () => {
        expect(oklchToRgb('oklch(1 0 0 / 50%)')).toBe('rgba(255, 255, 255, 0.5)');
    });

    test('handles chrome-style oklch colours with alpha', () => {
        const converted = oklchToRgb('oklch(0.7 0.1 200 / 0.25)');
        expect(converted).toMatch(/^rgba\(\d+, \d+, \d+, 0.25\)$/);
    });

    test('leaves non-oklch values alone', () => {
        expect(oklchToRgb('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
        expect(convertOklchColorsInValue('#fff')).toBe('#fff');
    });

    test('converts every colour inside a gradient', () => {
        const converted = convertOklchColorsInValue(
            'linear-gradient(90deg, oklch(1 0 0), oklch(0 0 0))'
        );
        expect(converted).toContain('rgb(255, 255, 255)');
        expect(converted).toContain('rgb(0, 0, 0)');
        expect(converted.toLowerCase()).not.toContain('oklch(');
    });
});
