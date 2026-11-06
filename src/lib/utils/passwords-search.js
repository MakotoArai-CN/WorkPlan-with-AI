import { matchesSearchQuery } from './search-text.js';

export const PASSWORD_CATEGORY_ALL = '__ALL__';

/**
 * Filter vault entries without assuming every entry has plaintext
 * `title`/`username`/`url` fields. Vault entries are stored with encrypted
 * `meta` first and only get those fields after hydration, so a strict
 * `.toLowerCase()` here used to throw during render.
 */
export function filterPasswordEntries(entries, { query = '', category = PASSWORD_CATEGORY_ALL } = {}) {
    const list = Array.isArray(entries) ? entries : [];
    const activeCategory = category || PASSWORD_CATEGORY_ALL;
    return list.filter((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const matchesCategory = activeCategory === PASSWORD_CATEGORY_ALL || entry.category === activeCategory;
        if (!matchesCategory) return false;
        return matchesSearchQuery([entry.title, entry.username, entry.url], query);
    });
}
