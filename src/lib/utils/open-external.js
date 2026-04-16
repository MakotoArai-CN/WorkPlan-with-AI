export async function openExternalUrl(url) {
    if (!url) return;

    try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
        return;
    } catch (error) {
        console.warn('Failed to open url via Tauri opener, falling back to window.open:', error);
    }

    if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}
