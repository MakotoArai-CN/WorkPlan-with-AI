// Clipboard helper that works in both the Tauri webview and plain browsers.
// `navigator.clipboard` is missing on insecure origins and may be blocked by
// permissions in some webviews, so keep a legacy `execCommand` fallback.
export async function copyText(text = '') {
    const value = String(text ?? '');
    if (!value) return false;

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch (error) {
            console.warn('navigator.clipboard.writeText failed, falling back:', error);
        }
    }

    if (typeof document === 'undefined') return false;

    try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, value.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    } catch (error) {
        console.warn('execCommand copy failed:', error);
        return false;
    }
}
