/**
 * Vditor only creates a table through the toolbar button. These helpers let the
 * Notes editor turn a typed row (`| 名称 | 数量 |`) into a real table on Enter,
 * without touching Vditor's own Enter/backspace behaviour.
 */

function splitCells(line) {
    const text = String(line || '').trim();
    if (!text.startsWith('|') || !text.endsWith('|')) return null;
    const inner = text.slice(1, -1);
    const cells = inner.split('|').map((cell) => cell.trim());
    // `| a | b |` -> ["a", "b"]; a single cell is not a table row.
    return cells.length >= 2 ? cells : null;
}

/** A separator row such as `| --- | :---: |` belongs to an existing table. */
export function isSeparatorRow(line = '') {
    const cells = splitCells(line);
    if (!cells) return false;
    const filled = cells.filter((cell) => cell.length > 0);
    if (filled.length === 0) return false;
    return filled.every((cell) => /^:?-{2,}:?$/.test(cell));
}

export function isTableRowLine(line = '') {
    if (!String(line || '').trim()) return false;
    if (!splitCells(line)) return false;
    return !isSeparatorRow(line);
}

export function tableFromRow(line = '') {
    const cells = splitCells(line);
    if (!cells) return '';
    const header = `| ${cells.join(' | ')} |`;
    const divider = `| ${cells.map(() => '---').join(' | ')} |`;
    const body = `| ${cells.map(() => '  ').join(' | ')} |`;
    return `${header}\n${divider}\n${body}`;
}
