const env = import.meta.env || {};

export const isWebDemo = env.VITE_BUILD_TARGET === 'web';

export const isTauriRuntime = !isWebDemo && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function isAndroidRuntime() {
    if (typeof navigator === 'undefined') return false;
    return /Android/i.test(navigator.userAgent || '');
}

export function noopAsync() {
    return Promise.resolve();
}

export function noopAsyncReturn(value) {
    return () => Promise.resolve(value);
}
