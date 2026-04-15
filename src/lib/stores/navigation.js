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
    const { onSecondaryBack, onPrimaryBack, onExit, onMinimize } = callbacks;
    const depth = getNavigationDepth();

    if (depth > 1) {
        const popped = popNavigation();
        if (onSecondaryBack) onSecondaryBack(popped);
        return 'secondary';
    }

    if (closeToQuit) {
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

export async function setupAndroidBackHandler(closeToQuit, callbacks) {
    if (typeof window === 'undefined') return () => {};

    const isAndroid = /Android/i.test(navigator.userAgent);
    if (!isAndroid) return () => {};

    if (backListenerCleanup) {
        backListenerCleanup();
        backListenerCleanup = null;
    }

    const handler = () => {
        handleBackPress(closeToQuit, callbacks);
    };

    window.addEventListener('androidbackbutton', handler);

    backListenerCleanup = () => {
        window.removeEventListener('androidbackbutton', handler);
    };

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