import { writable } from 'svelte/store';

export const backupModal = writable({ show: false, mode: 'export' });

export function openBackupModal(mode = 'export') {
    backupModal.set({ show: true, mode });
}

export function closeBackupModal() {
    backupModal.update(state => ({ ...state, show: false }));
}
