import { writable } from 'svelte/store';

export const settingsFocusTarget = writable(null);

export async function openCommandExecutionSettings() {
    const { currentView } = await import('./tasks.js');
    settingsFocusTarget.set('command-execution');
    currentView.set('settings');
}
