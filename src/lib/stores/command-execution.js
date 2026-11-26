import { writable, get } from 'svelte/store';
import { isTauriRuntime } from '../utils/runtime.js';

const INITIAL_STATUS = Object.freeze({ enabled: false, supported: false, platform: '', shell: '', loaded: false, loading: false, error: '' });

// This permission belongs to the native installation. It is never restored
// from a chat, account backup or localStorage snapshot.
export function createCommandExecutionStore(invokeCommand) {
    const state = writable({ ...INITIAL_STATUS });
    let revision = 0;
    let changing = false;
    const normalize = value => {
        if (!value || typeof value.enabled !== 'boolean' || typeof value.supported !== 'boolean') {
            throw new Error('Invalid command execution status');
        }
        return { enabled: value.supported && value.enabled, supported: value.supported,
            platform: String(value.platform || ''), shell: String(value.shell || ''), loaded: true, loading: false, error: '' };
    };
    async function refresh() {
        const currentRevision = revision;
        try {
            const status = normalize(await invokeCommand('get_command_execution_status'));
            if (revision === currentRevision && !changing) state.set(status);
            return status;
        } catch (error) {
            if (revision === currentRevision && !changing) state.update(s => ({ ...s, enabled: false, loaded: true, loading: false, error: String(error?.message || error) }));
            throw error;
        }
    }
    async function setEnabled(enabled) {
        if (changing) throw new Error('Command execution setting is being updated');
        changing = true;
        revision++;
        state.update(s => ({ ...s, loading: true, error: '' }));
        try {
            const status = normalize(await invokeCommand('set_command_execution_enabled', { enabled: enabled === true }));
            state.set(status);
            return status;
        } catch (error) {
            // A failed write cannot grant permission in the UI. Native code
            // also revokes the session permission if persistence fails.
            state.update(s => ({ ...s, enabled: false, loading: false, error: String(error?.message || error) }));
            throw error;
        } finally {
            changing = false;
            revision++;
        }
    }
    return { subscribe: state.subscribe, refresh, setEnabled, snapshot: () => get(state) };
}

export const commandExecutionStore = createCommandExecutionStore(async (command, args) => {
    if (!isTauriRuntime) {
        if (command === 'get_command_execution_status') return { enabled: false, supported: false, platform: 'web', shell: '' };
        throw new Error('Command execution requires the native app');
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
});
