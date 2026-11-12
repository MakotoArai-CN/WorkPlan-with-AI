// Bound the transported page, not the native scan or its aggregate counts.
export function fitFileSearchReport(report, maxCharacters = 100000) {
    const entries = [];
    let characters = JSON.stringify(JSON.stringify({ ...report, entries: [] })).length;
    for (const entry of report.entries || []) {
        const size = JSON.stringify(JSON.stringify(entry)).length + 1;
        if (characters + size > maxCharacters) break;
        entries.push(entry);
        characters += size;
    }
    if (entries.length === (report.entries || []).length) return report;
    return { ...report, entries, returned: entries.length, hasMore: true,
        nextOffset: (report.offset || 0) + entries.length, pageLimited: true };
}
