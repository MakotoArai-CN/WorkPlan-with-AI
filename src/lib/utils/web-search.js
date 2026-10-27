import { invoke } from '@tauri-apps/api/core';
import {
    isExplicitWebSearchRequest,
    looksLikeWebSearchIntent
} from './intent-heuristics.js';

export { isExplicitWebSearchRequest, looksLikeWebSearchIntent };

export async function searchWeb({
    query,
    maxResults = 6
} = {}) {
    return await invoke('search_web', {
        query,
        maxResults
    });
}

export async function fetchWebContent(url, maxChars = 4000) {
    try {
        return await invoke('fetch_web_content', { url, maxChars });
    } catch (error) {
        console.warn('fetchWebContent failed:', url, error);
        return null;
    }
}
