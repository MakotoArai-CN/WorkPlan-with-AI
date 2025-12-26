import { writable, get } from 'svelte/store';
import { registerBackEvent } from "@kingsword/tauri-plugin-mobile-onbackpressed-listener";

export const navigationStack = writable([]);
export const lastBackPress = writable(0);
export const showExitToast = writable(false);

const DOUBLE_BACK_THRESHOLD = 2000;

// 用于防止重复注册监听器
let isBackListenerRegistered = false;
let backListener = null;

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

    const isMobile = /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) return () => {};

    // 防止重复注册
    if (isBackListenerRegistered) {
        return async () => {
            if (backListener) {
                await backListener.unregister();
                backListener = null;
                isBackListenerRegistered = false;
            }
        };
    }

    try {
        isBackListenerRegistered = true;
        
        backListener = await registerBackEvent(() => {
            handleBackPress(closeToQuit, callbacks);
        });

        return async () => {
            if (backListener) {
                await backListener.unregister();
                backListener = null;
                isBackListenerRegistered = false;
            }
        };
    } catch (e) {
        console.log('Back button handler not available:', e);
        isBackListenerRegistered = false;
        return () => {};
    }
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