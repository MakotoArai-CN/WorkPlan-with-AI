import { writable } from 'svelte/store';

function createModalStore() {
    const { subscribe, set, update } = writable({
        show: false,
        type: 'confirm',
        title: '',
        message: '',
        confirmText: '确认',
        cancelText: '取消',
        variant: 'default',
        onConfirm: null,
        onCancel: null
    });

    return {
        subscribe,
        confirm: (options) => {
            return new Promise((resolve) => {
                set({
                    show: true,
                    type: 'confirm',
                    title: options.title || '确认操作',
                    message: options.message || '',
                    confirmText: options.confirmText || '确认',
                    cancelText: options.cancelText || '取消',
                    variant: options.variant || 'default',
                    onConfirm: () => {
                        set({ show: false, type: 'confirm', title: '', message: '', confirmText: '确认', cancelText: '取消', variant: 'default', onConfirm: null, onCancel: null });
                        resolve(true);
                    },
                    onCancel: () => {
                        set({ show: false, type: 'confirm', title: '', message: '', confirmText: '确认', cancelText: '取消', variant: 'default', onConfirm: null, onCancel: null });
                        resolve(false);
                    }
                });
            });
        },
        alert: (options) => {
            return new Promise((resolve) => {
                set({
                    show: true,
                    type: 'alert',
                    title: options.title || '提示',
                    message: options.message || '',
                    confirmText: options.confirmText || '确定',
                    cancelText: '',
                    variant: options.variant || 'default',
                    onConfirm: () => {
                        set({ show: false, type: 'confirm', title: '', message: '', confirmText: '确认', cancelText: '取消', variant: 'default', onConfirm: null, onCancel: null });
                        resolve(true);
                    },
                    onCancel: null
                });
            });
        },
        close: () => {
            update(s => ({ ...s, show: false }));
        }
    };
}

function createToastStore() {
    const { subscribe, update } = writable([]);
    let toastId = 0;

    return {
        subscribe,
        show: (options) => {
            const id = ++toastId;
            const toast = {
                id,
                message: options.message || '',
                type: options.type || 'info',
                duration: options.duration || 3000
            };
            update(toasts => [...toasts, toast]);
            if (toast.duration > 0) {
                setTimeout(() => {
                    update(toasts => toasts.filter(t => t.id !== id));
                }, toast.duration);
            }
            return id;
        },
        success: (message, duration = 3000) => {
            return createToastStore().show({ message, type: 'success', duration });
        },
        error: (message, duration = 4000) => {
            return createToastStore().show({ message, type: 'error', duration });
        },
        info: (message, duration = 3000) => {
            return createToastStore().show({ message, type: 'info', duration });
        },
        warning: (message, duration = 3500) => {
            return createToastStore().show({ message, type: 'warning', duration });
        },
        remove: (id) => {
            update(toasts => toasts.filter(t => t.id !== id));
        },
        clear: () => {
            update(() => []);
        }
    };
}

export const modalStore = createModalStore();
export const toastStore = createToastStore();

export function showConfirm(options) {
    return modalStore.confirm(options);
}

export function showAlert(options) {
    return modalStore.alert(options);
}

export function showToast(options) {
    const id = Date.now();
    const toast = {
        id,
        message: typeof options === 'string' ? options : options.message || '',
        type: typeof options === 'string' ? 'info' : (options.type || 'info'),
        duration: typeof options === 'string' ? 3000 : (options.duration || 3000)
    };
    toastStore.subscribe(() => {})();
    toastStore.show(toast);
    return id;
}