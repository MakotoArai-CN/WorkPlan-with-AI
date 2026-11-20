import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './runtime.js';
import {
    isExplicitWebSearchRequest,
    looksLikeWebSearchIntent
} from './intent-heuristics.js';

export { isExplicitWebSearchRequest, looksLikeWebSearchIntent };

export async function searchWeb({
    query,
    maxResults = 6
} = {}) {
    if (!isTauriRuntime) throw new Error('当前环境无法使用内置网页搜索');
    try {
        return await invoke('search_web', { query, maxResults });
    } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
    }
}

export async function fetchWebContent(url, maxChars = 4000) {
    try {
        return await invoke('fetch_web_content', { url, maxChars });
    } catch (error) {
        console.warn('fetchWebContent failed:', url, error);
        return null;
    }
}
