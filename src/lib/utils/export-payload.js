// Pure payload / path helpers for the export pipeline.
//
// These live apart from export.js because that module pulls in jsPDF and
// html2canvas, both of which touch `window.document` at import time. Keeping the
// string handling here means it can be imported (and tested) without dragging a
// DOM along.

/**
 * Callers hand base64 over in two shapes: bare base64, or a complete data URL
 * (`pdf.output('datauristring')`). The browser download fallback used to wrap
 * whatever it got in a second `data:` prefix, producing
 * `data:...;base64,data:application/pdf;...` which `fetch` rejects outright — so
 * web PDF export always failed. Strip the prefix once, mirroring
 * `decode_save_payload` on the Rust side, so every consumer sees bare base64.
 */
export function stripDataUrlPrefix(content) {
    const raw = String(content ?? '');
    const match = /^data:[^,]*;base64,/i.exec(raw);
    return match ? raw.slice(match[0].length) : raw;
}

/**
 * Android's save dialog hands back a SAF `content://` URI instead of a filesystem
 * path. Raw URIs are useless to a human, so pull the readable volume/path pair out
 * of it when the provider embeds one.
 */
export function describeSavedLocation(path) {
    if (!path) return '';
    const raw = String(path);
    if (!raw.startsWith('content://')) return raw;

    let decoded = raw;
    try {
        decoded = decodeURIComponent(raw);
    } catch {
        // Keep the raw URI if it is not valid percent-encoding.
    }

    const match = decoded.match(/([^/:]+):([^/][^:]*)$/);
    if (match && match[2].includes('/')) {
        const [, volume, relative] = match;
        return volume === 'primary' ? `内部存储/${relative}` : `${volume}/${relative}`;
    }
    return '你在系统保存对话框中选择的位置';
}
