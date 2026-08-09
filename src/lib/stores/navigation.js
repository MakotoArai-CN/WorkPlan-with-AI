import { writable, get } from 'svelte/store';

export const navigationStack = writable([]);
export const lastBackPress = writable(0);
export const showExitToast = writable(false);

const DOUBLE_BACK_THRESHOLD = 2000;

let backListenerCleanup = null;

export function pushNavigation(view) {
    navigationStack.update(stack => {
        if (stack.length === 0 || stack[stack.length - 1] !== view) {
            return [...stack, view];
        }
        return stack;
    });
}

export function popNavigation() {
    let popped = null;
    navigationStack.update(stack => {
        if (stack.length > 0) {
            popped = stack[stack.length - 1];
            return stack.slice(0, -1);
        }
        return stack;
    });
    return popped;
}

export function clearNavigation() {
    navigationStack.set([]);
}

export function getNavigationDepth() {
    return get(navigationStack).length;
}

export function replaceNavigation(view) {
    navigationStack.update(stack => {
        if (stack.length > 0) {
            return [...stack.slice(0, -1), view];
        }
        return [view];
    });
}

export function peekNavigation() {
    const stack = get(navigationStack);
    return stack.length > 0 ? stack[stack.length - 1] : null;
}

export function canGoBack() {
    return get(navigationStack).length > 1;
}

export function handleBackPress(closeToQuit, callbacks = {}) {
    const { onSecondaryBack, onPrimaryBack, onExit, onMinimize, forceDoubleBackExit = false } = callbacks;
    const depth = getNavigationDepth();

    if (onPrimaryBack && onPrimaryBack()) {
        return 'primary';
    }

    if (depth > 1) {
        const popped = popNavigation();
        if (onSecondaryBack) {
            onSecondaryBack({
                popped,
                next: peekNavigation()
            });
        }
        return 'secondary';
    }

    if (closeToQuit || forceDoubleBackExit) {
        const now = Date.now();
        const last = get(lastBackPress);

        if (now - last < DOUBLE_BACK_THRESHOLD) {
            showExitToast.set(false);
            if (onExit) onExit();
            return 'exit';
        } else {
            lastBackPress.set(now);
            showExitToast.set(true);
            setTimeout(() => showExitToast.set(false), DOUBLE_BACK_THRESHOLD);
            return 'toast';
        }
    } else {
        if (onMinimize) onMinimize();
        return 'minimize';
    }
}

function resolveCloseToQuit(value) {
    return typeof value === 'function' ? Boolean(value()) : Boolean(value);
}

export async function setupAndroidBackHandler(closeToQuit, callbacks) {
    if (typeof window === 'undefined') return () => {};

    const isAndroid = /Android/i.test(navigator.userAgent);
    if (!isAndroid) return () => {};

    if (backListenerCleanup) {
        backListenerCleanup();
        backListenerCleanup = null;
    }

    let lastHandled = 0;
    const handler = () => {
        const now = Date.now();
        if (now - lastHandled < 300) return;
        lastHandled = now;
        handleBackPress(resolveCloseToQuit(closeToQuit), callbacks);
    };

    const cleanups = [];
    window.__workplanAndroidBack = handler;
    cleanups.push(() => {
        if (window.__workplanAndroidBack === handler) {
            delete window.__workplanAndroidBack;
        }
    });

    const eventHandler = (event) => {
        event?.preventDefault?.();
        handler();
    };

    window.addEventListener('workplan-android-back', eventHandler);
    cleanups.push(() => window.removeEventListener('workplan-android-back', eventHandler));

    window.addEventListener('androidbackbutton', eventHandler);
    cleanups.push(() => window.removeEventListener('androidbackbutton', eventHandler));

    const pendingBacks = Number(window.__workplanPendingAndroidBack || 0);
    window.__workplanPendingAndroidBack = 0;
    for (let index = 0; index < Math.min(pendingBacks, 3); index += 1) {
        setTimeout(handler, index * 50);
    }

    // Inlined rather than depending on @kingsword/tauri-plugin-mobile-onbackpressed-listener:
    // that package is published only to JSR, which `bun audit` silently skips, so it was the
    // one dependency in the tree with no vulnerability coverage. Its whole JS half was these
    // two calls. The Rust crate stays — it carries the Android native glue, and crates.io is
    // covered by Dependabot.
    try {
        const { invoke, addPluginListener } = await import('@tauri-apps/api/core');
        await invoke('plugin:mobile-onbackpressed-listener|register_back_event');
        const pluginListener = await addPluginListener(
            'mobile-onbackpressed-listener',
            'mobile-onbackpressed-goback',
            () => handler()
        );
        cleanups.push(() => pluginListener.unregister());
    } catch (e) {
        console.warn('Tauri back-press plugin not available:', e);
    }

    let disposed = false;
    const cleanup = () => {
        if (disposed) return;
        disposed = true;
        for (const fn of cleanups) fn();
        if (backListenerCleanup === cleanup) {
            backListenerCleanup = null;
        }
    };

    backListenerCleanup = cleanup;
    return backListenerCleanup;
}

export function initializeNavigation(initialView = 'dashboard') {
    clearNavigation();
    pushNavigation(initialView);
}

export function handleViewBack(currentView, callbacks = {}) {
    const { onClosePanel, onNavigateBack } = callbacks;
    const depth = getNavigationDepth();

    if (onClosePanel) {
        onClosePanel();
        if (depth > 1) {
            popNavigation();
        }
        return 'panel_closed';
    }

    if (depth > 1) {
        const popped = popNavigation();
        if (onNavigateBack) onNavigateBack(popped);
        return 'navigated';
    }

    return 'at_root';
}
