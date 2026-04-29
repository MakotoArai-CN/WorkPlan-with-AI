import { writable, get } from 'svelte/store';
import {
    checkGateway,
    getDefaultOpenClawConfig
} from '../utils/openclaw-client.js';
import { isWebDemo } from '../utils/runtime.js';

const STORAGE_KEY = 'planpro_openclaw_config';

function loadConfig() {
    if (typeof window === 'undefined') return getDefaultOpenClawConfig();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return getDefaultOpenClawConfig();
        return { ...getDefaultOpenClawConfig(), ...JSON.parse(raw) };
    } catch {
        return getDefaultOpenClawConfig();
    }
}

function persistConfig(cfg) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export const openclawConfig = writable(loadConfig());
export const openclawStatus = writable({
    connected: false,
    lastError: '',
    gatewayHello: null
});

openclawConfig.subscribe((cfg) => persistConfig(cfg));

export function updateOpenClawConfig(updates) {
    openclawConfig.update((c) => ({ ...c, ...updates }));
}

export async function testConnection() {
    const cfg = get(openclawConfig);
    const result = await checkGateway({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
    openclawStatus.update((s) => ({
        ...s,
        connected: true,
        lastError: '',
        gatewayHello: result?.hello || result || null
    }));
    return result;
}

export function initOpenClaw() {
    if (isWebDemo) return;
    const cfg = get(openclawConfig);
    if (cfg.enabled) {
        testConnection().catch((e) => {
            openclawStatus.update((s) => ({
                ...s,
                connected: false,
                lastError: e?.message || String(e)
            }));
        });
    }
}
