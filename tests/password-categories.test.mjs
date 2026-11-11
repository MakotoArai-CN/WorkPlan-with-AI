import { describe, expect, test } from 'bun:test';
import {
    DEFAULT_PASSWORD_CATEGORIES,
    MAX_PASSWORD_CATEGORIES,
    collectPasswordCategories,
    validatePasswordCategory
} from '../src/lib/utils/password-categories.js';

describe('custom password categories', () => {
    test('trims names and rejects empty, reserved, control and overlong names', () => {
        expect(validatePasswordCategory('  Home devices  ')).toEqual({ success: true, category: 'Home devices' });
        expect(validatePasswordCategory('   ').error).toBe('category_empty');
        expect(validatePasswordCategory('__ALL__').error).toBe('category_invalid');
        expect(validatePasswordCategory('line\nbreak').error).toBe('category_invalid');
        expect(validatePasswordCategory('a'.repeat(33)).error).toBe('category_too_long');
        expect(validatePasswordCategory(String.fromCodePoint(0x1f511).repeat(32)).success).toBe(true);
        expect(validatePasswordCategory(String.fromCodePoint(0x1f511).repeat(33)).error).toBe('category_too_long');
    });

    test('detects case/width-equivalent duplicates and bounds new types', () => {
        expect(validatePasswordCategory('  cookie ', DEFAULT_PASSWORD_CATEGORIES).error).toBe('category_exists');
        expect(validatePasswordCategory('HOME', ['Home']).error).toBe('category_exists');
        expect(validatePasswordCategory('Home', Array.from({ length: MAX_PASSWORD_CATEGORIES }, (_, index) => `Type ${index}`)).error).toBe('category_limit');
        expect(validatePasswordCategory(String.fromCharCode(0xff21, 0xff22), ['AB']).error).toBe('category_exists');
    });

    test('retains built-ins and discovers imported types without losing legacy names', () => {
        const longLegacy = 'x'.repeat(50);
        const names = collectPasswordCategories(['Home', 'Home', null, '', '__ALL__'], [{ category: 'Travel' }, { category: longLegacy }]);
        expect(names.slice(0, DEFAULT_PASSWORD_CATEGORIES.length)).toEqual([...DEFAULT_PASSWORD_CATEGORIES]);
        expect(names.filter(name => name === 'Home')).toHaveLength(1);
        expect(names).toContain('Travel');
        expect(names).toContain(longLegacy);
        expect(names).not.toContain('__ALL__');
        expect(collectPasswordCategories(null, null)).toEqual([...DEFAULT_PASSWORD_CATEGORIES]);
    });
});
