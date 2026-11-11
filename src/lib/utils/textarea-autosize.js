export function resizeTextarea(textarea, maxRatio = 0.5) {
    if (!textarea) {
        return;
    }

    const minHeight = 44;
    const shell = textarea.closest('[data-ai-shell]');
    const shellHeight = shell?.clientHeight || globalThis.visualViewport?.height || globalThis.innerHeight || 480;
    const maxHeight = Math.max(minHeight, Math.floor(shellHeight * maxRatio));

    if (!textarea.value) {
        textarea.style.height = `${minHeight}px`;
        textarea.style.overflowY = 'hidden';
        textarea.scrollTop = 0;
        return;
    }

    // Measure from zero: scrollHeight otherwise includes the previous tall box.
    textarea.style.height = '0px';

    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${Math.max(minHeight, nextHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

export function observeTextareaResize(textarea, resize) {
    if (!textarea || typeof window === 'undefined') return () => {};
    const shell = textarea.closest('[data-ai-shell]');
    let width = shell?.clientWidth;
    let height = shell?.clientHeight;
    const observer = shell && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
        if (width === shell.clientWidth && height === shell.clientHeight) return;
        width = shell.clientWidth;
        height = shell.clientHeight;
        resize();
    }) : null;
    observer?.observe(shell);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
        observer?.disconnect();
        window.removeEventListener('resize', resize);
        window.visualViewport?.removeEventListener('resize', resize);
    };
}
