import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export const updateDialog = writable({ show: false, loading: false, data: null, error: '', currentOnly: false });
let inFlight;
let generation = 0;

export function checkForUpdates() {
    if (inFlight) {
        updateDialog.update(value => ({ ...value, show: true }));
        return inFlight;
    }
    const request = ++generation;
    updateDialog.set({ show: true, loading: true, data: null, error: '', currentOnly: false });
    const pending = (async () => {
        try {
            const data = await invoke('check_update');
            if (request === generation) updateDialog.update(value => ({ ...value, loading: false, data }));
        } catch (error) {
            if (request === generation) updateDialog.update(value => ({ ...value, loading: false, error: String(error?.message || error) }));
        }
    })().finally(() => { if (inFlight === pending) inFlight = null; });
    inFlight = pending;
    return pending;
}

export function showCurrentReleaseNotes() {
    generation++;
    inFlight = null;
    updateDialog.set({ show: true, loading: false, data: null, error: '', currentOnly: true });
}

export function closeUpdateDialog() {
    updateDialog.update(value => ({ ...value, show: false }));
}
