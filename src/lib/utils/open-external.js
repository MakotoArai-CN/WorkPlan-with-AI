const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function getValidatedExternalUrl(url) {
    if (!url) return null;

    try {
        const base =
            typeof window !== 'undefined' ? window.location.origin : 'https://localhost';
        const parsed = new URL(String(url), base);
        if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

export async function openExternalUrl(url) {
    const safeUrl = getValidatedExternalUrl(url);
    if (!safeUrl) {
        console.warn('Blocked external url:', url);
        return false;
    }

    try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(safeUrl);
        return true;
    } catch (error) {
        console.warn('Failed to open url via Tauri opener, falling back to window.open:', error);
    }

    if (typeof window !== 'undefined') {
        const opened = window.open(safeUrl, '_blank', 'noopener,noreferrer');
        if (opened) {
            opened.opener = null;
        }
        return Boolean(opened);
    }

    return false;
}
