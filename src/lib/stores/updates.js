import { writable, get } from 'svelte/store';
import { invoke, Channel } from '@tauri-apps/api/core';

export const updateDialog = writable({ show: false, loading: false, data: null, error: '', currentOnly: false });
let inFlight;
let generation = 0;
export const updateDownload = writable({ stage: 'idle', id: '', version: '', name: '', received: 0, total: 0, error: '' });
let downloading;
let opening = false;

export function downloadUpdate() {
    if (downloading) return downloading;
    const data = get(updateDialog).data;
    if (!data?.has_update || !data.download) return Promise.resolve();
    const id = crypto.randomUUID();
    updateDownload.set({ stage: 'downloading', id, version: data.latest_version, name: data.download.name, received: 0, total: data.download.size, error: '' });
    const channel = new Channel();
    channel.onmessage = event => {
        if (event.id === id && get(updateDownload).id === id && get(updateDownload).stage === 'canceling') {
            void invoke('cancel_update_download', { id }).catch(() => {});
            return;
        }
        updateDownload.update(state => state.id !== id || state.stage === 'canceling' || event.id !== id ? state : {
            ...state, received: Math.max(state.received, Math.min(state.total, Number(event.received) || 0)),
            stage: event.stage === 'verifying' ? 'verifying' : 'downloading'
        });
    };
    const pending = (async () => {
        try {
            const result = await invoke('download_update', { version: data.latest_version, id, progress: channel });
            updateDownload.update(state => state.id !== id ? state : state.stage === 'canceling'
                ? { ...state, stage: 'idle' } : result?.verified === true && result.id === id
                    ? { ...state, stage: 'ready', received: result.size, total: result.size, name: result.name }
                    : { ...state, stage: 'error', error: 'Update verification failed' });
        } catch (error) {
            updateDownload.update(state => state.id !== id ? state : { ...state, stage: state.stage === 'canceling' ? 'idle' : 'error', error: state.stage === 'canceling' ? '' : String(error?.message || error) });
        }
    })().finally(() => { if (downloading === pending) downloading = null; });
    downloading = pending;
    return pending;
}

export async function cancelUpdateDownload() {
    const state = get(updateDownload);
    if (!['downloading', 'verifying'].includes(state.stage)) return;
    updateDownload.update(value => ({ ...value, stage: 'canceling' }));
    try { await invoke('cancel_update_download', { id: state.id }); }
    catch (error) { updateDownload.update(value => ({ ...value, stage: state.stage, error: String(error?.message || error) })); }
}

export async function openDownloadedUpdate() {
    const state = get(updateDownload);
    if (opening || state.stage !== 'ready') return;
    opening = true;
    updateDownload.update(value => ({ ...value, stage: 'opening', error: '' }));
    try {
        const result = await invoke('open_downloaded_update', { id: state.id });
        if (result?.android_path) {
            const bridge = typeof window !== 'undefined' && window.WorkPlanAndroid;
            if (!bridge?.installUpdate) throw new Error('Android update installer is unavailable');
            const status = JSON.parse(bridge.installUpdate(result.android_path));
            if (!status.ok) throw new Error(status.error || 'Unable to open Android installer');
            updateDownload.update(value => ({ ...value, permissionRequired: status.permission_required === true }));
        } else if (!result?.opened) throw new Error('Unable to open update package');
    } catch (error) {
        updateDownload.update(value => ({ ...value, error: String(error?.message || error) }));
    } finally {
        updateDownload.update(value => value.id === state.id ? { ...value, stage: 'ready' } : value);
        opening = false;
    }
}

export function checkForUpdates() {
    if (downloading || opening) {
        updateDialog.update(value => ({ ...value, show: true }));
        return downloading || Promise.resolve();
    }
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
    if (downloading || opening) { updateDialog.update(value => ({ ...value, show: true })); return; }
    generation++;
    inFlight = null;
    updateDialog.set({ show: true, loading: false, data: null, error: '', currentOnly: true });
}

export function closeUpdateDialog() {
    updateDialog.update(value => ({ ...value, show: false }));
}
