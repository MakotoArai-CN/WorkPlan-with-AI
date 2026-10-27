// Merge rules for the single-blob cloud sync.
//
// The cloud stores one JSON document per access key, but the app can create or
// edit tasks while the backend is unreachable. Pushing that local state blindly
// overwrites changes made on another device; pulling blindly drops the offline
// work. Both directions are wrong, so the sync merges per item:
//
//   * local-only items are kept (offline creations),
//   * cloud-only items are kept (changes from another device),
//   * for the same id, the side that changed since the last known cloud
//     snapshot wins,
//   * a local deletion is detected as "id in the baseline, absent locally",
//   * a remote deletion is honoured only when the local copy is unchanged.
//
// Item identity is the task/template/schedule id. UI-only fields (`expanded`,
// `isFromSchedule`) are ignored so they never make an item look "changed".

const UI_ONLY_FIELDS = ['expanded', 'isFromSchedule'];

export const TASK_COLLECTIONS = ['tasks', 'templates', 'scheduledTasks', 'overtimeRecords', 'leaveRecords'];

function stripUiFields(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(stripUiFields);
    const copy = {};
    for (const [key, item] of Object.entries(value)) {
        if (UI_ONLY_FIELDS.includes(key)) continue;
        copy[key] = item && typeof item === 'object' ? stripUiFields(item) : item;
    }
    return copy;
}

export function stableItemString(item) {
    return JSON.stringify(stripUiFields(item));
}

function toItemMap(list) {
    const map = new Map();
    if (!Array.isArray(list)) return map;
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const id = typeof item.id === 'string' && item.id ? item.id : '';
        if (!id) continue;
        map.set(id, item);
    }
    return map;
}

function collectionOrder(localList, remoteList) {
    const ids = [];
    const seen = new Set();
    for (const list of [remoteList, localList]) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            const id = item && typeof item.id === 'string' ? item.id : '';
            if (!id || seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
        }
    }
    return ids;
}

/**
 * Merge one collection (tasks/templates/scheduledTasks).
 *
 * @param {Array} localList current local items
 * @param {Array} remoteList items currently in the cloud
 * @param {Array|null} baselineList last known cloud items (null when never synced)
 */
export function mergeCollection(localList = [], remoteList = [], baselineList = null) {
    const local = toItemMap(localList);
    const remote = toItemMap(remoteList);
    const baseline = Array.isArray(baselineList) ? toItemMap(baselineList) : null;
    const merged = [];

    for (const id of collectionOrder(localList, remoteList)) {
        const localItem = local.get(id);
        const remoteItem = remote.get(id);
        const baselineItem = baseline?.get(id);
        const existedInBaseline = baseline ? baseline.has(id) : false;

        if (!localItem) {
            // Not present locally. If it existed in the last cloud snapshot the
            // user deleted it while offline; otherwise it is simply a cloud-only
            // item from another device and must be kept.
            if (existedInBaseline) continue;
            if (remoteItem) merged.push(remoteItem);
            continue;
        }

        const localChanged = !existedInBaseline
            || stableItemString(localItem) !== stableItemString(baselineItem);

        if (!remoteItem) {
            // Deleted in the cloud. Keep the local copy only if it was edited
            // after the last snapshot; otherwise the deletion wins.
            if (localChanged) merged.push(localItem);
            continue;
        }

        merged.push(localChanged ? localItem : remoteItem);
    }

    // Items without an id cannot be matched; keep them rather than lose data.
    for (const list of [remoteList, localList]) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            if (typeof item.id === 'string' && item.id) continue;
            merged.push(item);
        }
    }

    return merged;
}

/** Merge a full sync document ({tasks, templates, scheduledTasks}). */
export function mergeSyncState(local = {}, remote = {}, baseline = null) {
    const merged = {};
    for (const key of TASK_COLLECTIONS) {
        merged[key] = mergeCollection(local?.[key], remote?.[key], baseline?.[key] ?? null);
    }
    return merged;
}

/** Normalize a cloud payload to the three collections. */
export function normalizeSyncPayload(content = {}) {
    return {
        tasks: Array.isArray(content.tasks) ? content.tasks : [],
        templates: Array.isArray(content.templates) ? content.templates : [],
        scheduledTasks: Array.isArray(content.scheduledTasks) ? content.scheduledTasks : [],
        overtimeRecords: Array.isArray(content.overtimeRecords) ? content.overtimeRecords : [],
        leaveRecords: Array.isArray(content.leaveRecords) ? content.leaveRecords : []
    };
}
