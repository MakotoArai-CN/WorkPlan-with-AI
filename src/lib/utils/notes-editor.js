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
