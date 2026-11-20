import { writable, get } from 'svelte/store';
import { invoke, Channel } from '@tauri-apps/api/core';
import { officialReleaseUrl } from '../utils/release-history.js';
import { openExternalUrl } from '../utils/open-external.js';

export const updateDialog = writable({ show: false, loading: false, data: null, error: '', currentOnly: false });
let inFlight;
let generation = 0;
export const updateDownload = writable({ stage: 'idle', id: '', version: '', name: '', received: 0, total: 0, attempt: 0, error: '', installation: null });
let downloading;
let opening = false;
const preparations = new Set();

// Editors can flush their existing save buffers before a native installer
// closes the webview. Registration is scoped to the mounted editor.
export function registerUpdatePreparation(handler) {
    preparations.add(handler);
    return () => preparations.delete(handler);
}

async function openOfficialRelease(version) {
    const url = officialReleaseUrl(version) || 'https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/latest';
    try { await openExternalUrl(url); } catch {}
}

export function downloadUpdate() {
    if (downloading) return downloading;
    if (opening) return Promise.resolve();
    const data = get(updateDialog).data;
    if (!data?.has_update || !data.download) return Promise.resolve();
    const id = crypto.randomUUID();
    updateDownload.set({ stage: 'downloading', id, version: data.latest_version, name: data.download.name, received: 0, total: data.download.size, attempt: 0, error: '', installation: null });
    const channel = new Channel();
    channel.onmessage = event => {
        if (event.id === id && get(updateDownload).id === id && get(updateDownload).stage === 'canceling') {
            void invoke('cancel_update_download', { id }).catch(() => {});
            return;
        }
        updateDownload.update(state => {
            const attempt = Number.isInteger(event.attempt) && event.attempt >= 0 ? event.attempt : state.attempt;
            if (state.id !== id || state.stage === 'canceling' || !['downloading', 'verifying'].includes(state.stage) || event.id !== id || attempt < state.attempt) return state;
            return { ...state, attempt, received: Math.max(attempt > state.attempt ? 0 : state.received, Math.min(state.total, Number(event.received) || 0)),
                stage: event.stage === 'verifying' ? 'verifying' : 'downloading' };
        });
    };
    const pending = (async () => {
        try {
            const result = await invoke('download_update', { version: data.latest_version, id, progress: channel });
            updateDownload.update(state => state.id !== id ? state : state.stage === 'canceling'
                ? { ...state, stage: 'idle' } : result?.verified === true && result.id === id
                    ? { ...state, stage: 'ready', received: result.size, total: result.size, name: result.name, downloadOnly: result.download_only === true, savedPath: result.saved_path || '', installation: result.installation || null }
                    : { ...state, stage: 'error', error: 'Update verification failed' });
            const ready = get(updateDownload);
            if (ready.id === id && ready.stage === 'ready' && (ready.installation?.automatic === true
                || (!ready.downloadOnly && typeof window !== 'undefined' && window.WorkPlanAndroid?.installUpdate))) await openDownloadedUpdate();
        } catch (error) {
            const canceled = get(updateDownload).id !== id || get(updateDownload).stage === 'canceling';
            updateDownload.update(state => state.id !== id ? state : { ...state, stage: state.stage === 'canceling' ? 'idle' : 'error', error: state.stage === 'canceling' ? '' : String(error?.message || error) });
            if (!canceled) {
                await openOfficialRelease(data.latest_version);
            }
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
    catch (error) {
        updateDownload.update(value => value.id === state.id && value.stage === 'canceling'
            ? { ...value, stage: state.stage, error: String(error?.message || error) } : value);
    }
}

export async function openDownloadedUpdate(manual = false) {
    // Svelte click handlers pass a MouseEvent. Only an explicit boolean opts
    // into opening the package instead of the native installation workflow.
    manual = manual === true;
    const state = get(updateDownload);
    if (opening || state.stage !== 'ready' || state.recovered || (state.downloadOnly && !state.installation)) return;
    opening = true;
    updateDownload.update(value => ({ ...value, stage: 'opening', error: '', canceled: false }));
    try {
        let prepare;
        if (state.installation) {
            const { prepareLocalDatabaseForUpdate } = await import('../utils/local-db.js');
            prepare = async () => {
                for (const handler of preparations) await handler();
                await prepareLocalDatabaseForUpdate();
            };
            await prepare();
        }
        if (state.pendingHandoff) {
            await invoke('complete_update_handoff', { id: state.id });
            updateDownload.update(value => value.id === state.id ? { ...value, stage: 'handoff' } : value);
            return;
        }
        const result = await invoke('open_downloaded_update', { id: state.id, manual });
        if (result?.canceled) {
            updateDownload.update(value => value.id === state.id ? { ...value, canceled: true } : value);
        } else if (result?.android_path) {
            const bridge = typeof window !== 'undefined' && window.WorkPlanAndroid;
            if (!bridge?.installUpdate) throw new Error('Android update installer is unavailable');
            const status = JSON.parse(bridge.installUpdate(result.android_path));
            if (!status.ok) throw new Error(status.error || 'Unable to open Android installer');
            updateDownload.update(value => ({ ...value, permissionRequired: status.permission_required === true }));
        } else if (!result?.opened) throw new Error('Unable to open update package');
        else if (result.exit_required || result.restart_required) {
            // A download or an opened DMG is not an installed update. Exit only
            // after native confirmation of the installer handoff/transaction.
            updateDownload.update(value => value.id === state.id ? { ...value, pendingHandoff: true } : value);
            if (prepare) await prepare();
            updateDownload.update(value => value.id === state.id ? { ...value, stage: 'handoff' } : value);
            await invoke('complete_update_handoff', { id: state.id });
        }
    } catch (error) {
        updateDownload.update(value => value.id === state.id ? { ...value, stage: 'ready', error: String(error?.message || error) } : value);
    } finally {
        updateDownload.update(value => value.id === state.id && value.stage === 'opening' ? { ...value, stage: 'ready' } : value);
        opening = false;
    }
}

export async function resumeUpdateInstallation() {
    try {
        const result = await invoke('get_update_install_status');
        if (!result || !['failed', 'canceled'].includes(result.state) || get(updateDialog).show) return;
        const recovery = result.recovery;
        if (recovery) updateDownload.set({ stage: 'ready', id: '', version: result.version, name: recovery.name,
            savedPath: recovery.saved_path, installation: recovery.installation, recovered: true,
            received: 0, total: 0, attempt: 0, error: '' });
        updateDialog.set({ show: true, loading: false, data: recovery ? { latest_version: result.version, has_update: true } : null, currentOnly: false, installationError: true,
            error: result.state === 'canceled' ? 'Installation canceled' : String(result.message || 'Installation failed') });
    } catch { /* Older builds and browser previews do not expose this command. */ }
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
            if (request === generation) {
                const visible = get(updateDialog).show;
                updateDialog.update(value => ({ ...value, loading: false, error: String(error?.message || error) }));
                if (visible) await openOfficialRelease();
            }
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
