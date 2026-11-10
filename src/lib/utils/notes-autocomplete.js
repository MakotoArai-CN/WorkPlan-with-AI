/**
 * Helpers for the notes autocomplete.
 *
 * The first version kept only `result.split('\n')[0]`, so a model that returned
 * three useful lines produced a one-line suggestion. It also sent the last three
 * lines only, with no title, which is why completions felt generic.
 */

export const AUTOCOMPLETE_TAIL_LIMIT = 1200;
export const AUTOCOMPLETE_MAX_LINES = 3;
export const AUTOCOMPLETE_MAX_CHARS = 300;

export function buildAutocompleteContext({ title = '', text = '' } = {}) {
    const body = String(text || '');
    const tail = body.length > AUTOCOMPLETE_TAIL_LIMIT
        ? body.slice(-AUTOCOMPLETE_TAIL_LIMIT)
        : body;
    const cleanTitle = String(title || '').trim();
    return [
        cleanTitle ? `笔记标题：${cleanTitle}` : '',
        '以下是笔记结尾的内容，请直接接着写：',
        tail.trim()
    ].filter(Boolean).join('\n\n');
}

/**
 * Keep the useful lines, drop code fences and echoed context, and clamp the
 * result so the inline hint cannot cover the editor.
 */
export function normalizeSuggestion(raw = '', tail = '') {
    let text = String(raw || '').replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/,'').trim();
    if (!text) return '';
    // Models often repeat the last line before continuing it.
    const lastLine = String(tail || '').trim().split('\n').pop()?.trim() || '';
    if (lastLine && text.startsWith(lastLine)) {
        text = text.slice(lastLine.length).replace(/^\s+/, '');
    }
    const lines = text.split('\n').map((line) => line.replace(/\s+$/, ''));
    const kept = lines.slice(0, AUTOCOMPLETE_MAX_LINES).join('\n').trim();
    if (!kept) return '';
    return kept.length > AUTOCOMPLETE_MAX_CHARS
        ? kept.slice(0, AUTOCOMPLETE_MAX_CHARS)
        : kept;
}
