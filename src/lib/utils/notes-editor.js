let vditorIconsLoading;
let vditorIconsScript;

export function ensureVditorIcons() {
    if (vditorIconsLoading) return vditorIconsLoading;
    const existing = document.getElementById('vditorIconScript');
    if (existing) {
        vditorIconsScript = existing;
        return Promise.resolve();
    }
    if (vditorIconsScript) {
        // Vditor removes its script marker on destroy. Restore the already
        // executed node instead of fetching or injecting the icon sprite again.
        document.head.appendChild(vditorIconsScript);
        return Promise.resolve();
    }
    vditorIconsLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/vendor/vditor/dist/js/icons/material.js';
        script.async = true;
        script.onload = () => {
            script.id = 'vditorIconScript';
            vditorIconsScript = script;
            vditorIconsLoading = null;
            resolve();
        };
        script.onerror = () => {
            script.remove();
            vditorIconsLoading = null;
            reject(new Error('Unable to load editor icons'));
        };
        document.head.appendChild(script);
    });
    return vditorIconsLoading;
}

export function createLatestEditorRequest() {
    let revision = 0;
    let controller;
    return {
        invalidate() {
            revision += 1;
            controller?.abort();
            controller = null;
        },
        begin() {
            this.invalidate();
            controller = new AbortController();
            return { revision, signal: controller.signal };
        },
        isCurrent(request) {
            return !!request && request.revision === revision && !request.signal.aborted;
        }
    };
}

export function rangeAtBlockStart(range, block) {
    if (!range?.collapsed || !block?.contains(range.startContainer)) return false;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(block);
    prefix.setEnd(range.startContainer, range.startOffset);
    return prefix.toString().replace(/\u200b/g, '').length === 0;
}

export function rangeAtEditorEnd(range, editor) {
    if (!range?.collapsed || !editor?.contains(range.endContainer)) return false;
    const suffix = range.cloneRange();
    suffix.selectNodeContents(editor);
    suffix.setStart(range.endContainer, range.endOffset);
    return suffix.toString().replace(/\u200b/g, '').trim().length === 0;
}

export function noteDraftChanged(note, title, content) {
    return !!note && (note.title !== title || note.content !== content);
}
