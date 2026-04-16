export function resizeTextarea(textarea, maxRatio = 0.5) {
    if (!textarea) {
        return;
    }

    const shell = textarea.closest('[data-ai-shell]');
    const shellHeight = shell?.clientHeight || window.innerHeight || 0;
    const maxHeight = Math.max(120, Math.floor(shellHeight * maxRatio));

    textarea.style.height = '0px';

    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${Math.max(44, nextHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
}
