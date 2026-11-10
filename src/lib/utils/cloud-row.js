/**
 * PostgREST answers `.single()` with "JSON object requested, multiple (or no)
 * rows returned" whenever the query matches 0 or >1 rows. Cloud sync must treat
 * those as normal states (no remote record yet / duplicated rows from a table
 * without RLS), so queries ask for an array and we pick the first row here.
 */
export function firstRow(data) {
    if (!data) return null;
    if (Array.isArray(data)) return data.length > 0 ? data[0] : null;
    return data;
}

export function rowCount(data) {
    if (!data) return 0;
    return Array.isArray(data) ? data.length : 1;
}
