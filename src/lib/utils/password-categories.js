export const DEFAULT_PASSWORD_CATEGORIES = Object.freeze([
    '\u9ed8\u8ba4', '\u793e\u4ea4', '\u5de5\u4f5c', '\u91d1\u878d', '\u8d2d\u7269', 'Cookie',
    'API' + '\u5bc6\u94a5', '\u670d\u52a1\u5668', '\u90ae\u7bb1', '\u6570\u636e\u5e93', '\u5176\u4ed6'
]);
export const MAX_PASSWORD_CATEGORY_LENGTH = 32;
export const MAX_PASSWORD_CATEGORIES = 64;

function categoryKey(name) {
    return name.normalize('NFKC').toLowerCase();
}

export function validatePasswordCategory(value, categories = []) {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name) return { success: false, error: 'category_empty' };
    if (/[\u0000-\u001f\u007f]/u.test(name) || name === '__ALL__') {
        return { success: false, error: 'category_invalid' };
    }
    if ([...name].length > MAX_PASSWORD_CATEGORY_LENGTH) {
        return { success: false, error: 'category_too_long' };
    }
    if (categories.some(category => categoryKey(category) === categoryKey(name))) {
        return { success: false, error: 'category_exists' };
    }
    if (categories.length >= MAX_PASSWORD_CATEGORIES) return { success: false, error: 'category_limit' };
    return { success: true, category: name };
}

// Retain imported/legacy names even above the creation limit: existing entries
// must remain reachable in the category filter after loading or cloud sync.
export function collectPasswordCategories(categories = [], entries = []) {
    const result = [...DEFAULT_PASSWORD_CATEGORIES];
    const seen = new Set(result);
    const names = [
        ...(Array.isArray(categories) ? categories : []),
        ...(Array.isArray(entries) ? entries.map(entry => entry?.category) : [])
    ];
    for (const name of names) {
        if (typeof name !== 'string' || !name.trim() || name === '__ALL__' || seen.has(name)) continue;
        seen.add(name);
        result.push(name);
    }
    return result;
}
