/**
 * Safe text helpers for list search. Imported notes/passwords can miss fields
 * (older exports, or vault entries whose readable fields still live in the
 * encrypted `meta` blob), so calling `value.toLowerCase()` directly crashed the
 * whole view and left the previous view painted.
 */
export function toSearchText(value) {
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value : String(value);
}

export function matchesSearchQuery(values, query) {
    const needle = toSearchText(query).trim().toLowerCase();
    if (!needle) return true;
    const list = Array.isArray(values) ? values : [values];
    return list.some((value) => toSearchText(value).toLowerCase().includes(needle));
}
