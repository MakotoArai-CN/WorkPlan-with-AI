import { writable, get } from 'svelte/store';
import {
    getDefaultConnectorConfig,
    checkConnector,
    resolveConnectorTransport,
    getConnectorHttpChatEndpoint
} from '../utils/connector-client.js';
import { isWebDemo } from '../utils/runtime.js';

const STORAGE_KEY = 'planpro_connector_config';
const LEGACY_STORAGE_KEY = 'planpro_openclaw_config';

function loadConfig() {
    if (typeof window === 'undefined') return getDefaultConnectorConfig();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            return { ...getDefaultConnectorConfig(), ...JSON.parse(raw) };
        }
        // 兼容旧存档：把早期版本写入 planpro_openclaw_config 的连接配置
        // 迁移为通用连接器配置（OpenClaw 网关协议已移除，改用 nanobot 预设）。
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) {
            const parsed = JSON.parse(legacy);
            return {
                ...getDefaultConnectorConfig(),
                ...parsed,
                preset: 'nanobot',
                transport: 'auto'
            };
        }
        return getDefaultConnectorConfig();
    } catch {
        return getDefaultConnectorConfig();
    }
}

function persistConfig(cfg) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export const connectorConfig = writable(loadConfig());
export const connectorStatus = writable({
    connected: false,
    lastError: '',
    gatewayHello: null
});

connectorConfig.subscribe((cfg) => persistConfig(cfg));

export function updateConnectorConfig(updates) {
    connectorConfig.update((c) => ({ ...c, ...updates }));
}

export async function testConnection() {
    const cfg = get(connectorConfig);
    const transport = resolveConnectorTransport(cfg);

    if (transport === 'http') {
        const { fetchProviderModels, pingHttpConnector } = await import('../utils/ai-providers.js');
        const endpoint = getConnectorHttpChatEndpoint(cfg);
        if (!endpoint) throw new Error('未配置 HTTP 服务地址');
        // 先探测可达性（不可达会抛错），再尝试拉取模型列表（容错，失败仅返回空）。
        await pingHttpConnector(endpoint, cfg.apiKey);
        const models = await fetchProviderModels('webhook', cfg.apiKey, endpoint);
        connectorStatus.update((s) => ({
            ...s,
            connected: true,
            lastError: '',
            gatewayHello: { transport: 'http', models }
        }));
        return { ok: true, transport: 'http', models };
    }

    const result = await checkConnector(cfg);
    connectorStatus.update((s) => ({
        ...s,
        connected: true,
        lastError: '',
        gatewayHello: result?.hello || result || null
    }));
    return result;
}

export function initConnector() {
    if (isWebDemo) return;
    const cfg = get(connectorConfig);
    if (cfg.enabled) {
        testConnection().catch((e) => {
            connectorStatus.update((s) => ({
                ...s,
                connected: false,
                lastError: e?.message || String(e)
            }));
        });
    }
}
