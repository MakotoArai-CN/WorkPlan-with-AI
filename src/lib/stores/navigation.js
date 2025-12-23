import { writable, get } from 'svelte/store';

export const navigationStack = writable([]);
export const lastBackPress = writable(0);
export const showExitToast = writable(false);

const DOUBLE_BACK_THRESHOLD = 2000;

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

    try {
        const { listen } = await import('@tauri-apps/api/event');
        
        const unlisten = await listen('tauri://back-button', () => {
            handleBackPress(closeToQuit, callbacks);
        });

        return unlisten;
    } catch (e) {
        console.log('Back button handler not available:', e);
        return () => {};
    }
}

export function initializeNavigation(initialView = 'dashboard') {
    clearNavigation();
    pushNavigation(initialView);
}