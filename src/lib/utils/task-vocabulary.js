// Canonical task status / priority vocabulary.
//
// The AI layers (tool calling in stores/ai.js, the plan executor in
// ai-execution-engine.js, the confirmation cards in AiChat.svelte) each used to
// carry their own copy of these tables, and they drifted: the plan executor told
// the model to send "high|normal|low" while the rest of the app only understands
// "normal|urgent|critical", so every plan-created task landed at normal priority.
// Import from here instead of re-declaring.

export const TASK_STATUSES = ['todo', 'doing', 'done'];
export const TASK_PRIORITIES = ['normal', 'urgent', 'critical'];

// Plain object literals inherit from Object.prototype, so `table['toString']`
// used to return a *function* instead of null — and `resolvePriority('toString')`
// then handed a function into the update payload, where it serialized away and the
// field silently vanished. Null-prototype tables plus a canonical-value guard in
// `lookup` close both halves of that.
function aliasTable(entries) {
    return Object.assign(Object.create(null), entries);
}

const STATUS_ALIASES = aliasTable({
    '未开始': 'todo',
    '待办': 'todo',
    '待处理': 'todo',
    '进行中': 'doing',
    '处理中': 'doing',
    '已完成': 'done',
    '完成': 'done',
    '已处理': 'done',
    '已修改': 'done',
    '已激活': 'done',
    '已部署': 'done',
    '已解决': 'done',
    '已验收': 'done',
    '已关闭': 'done',
    todo: 'todo',
    doing: 'doing',
    done: 'done',
    // Vocabulary models reach for when they ignore the schema.
    pending: 'todo',
    in_progress: 'doing',
    inprogress: 'doing',
    completed: 'done',
    finished: 'done'
});

const PRIORITY_ALIASES = aliasTable({
    '普通': 'normal',
    '一般': 'normal',
    '紧急': 'urgent',
    '重要': 'urgent',
    '特急': 'critical',
    '非常紧急': 'critical',
    '最优先': 'critical',
    normal: 'normal',
    urgent: 'urgent',
    critical: 'critical',
    // Models frequently emit the generic high/medium/low scale regardless of
    // what the schema says. Map it rather than silently dropping the signal.
    high: 'urgent',
    highest: 'critical',
    medium: 'normal',
    normal_priority: 'normal',
    low: 'normal',
    p0: 'critical',
    p1: 'urgent',
    p2: 'normal'
});

function lookup(table, canonical, value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const hit = table[raw] ?? table[raw.toLowerCase()] ?? null;
    // Defence in depth: never return anything the stores cannot persist, whatever
    // ends up in the alias tables.
    return canonical.includes(hit) ? hit : null;
}

/** Returns null for absent/unrecognized input so callers can pick their own fallback. */
export function resolveStatus(value) {
    return lookup(STATUS_ALIASES, TASK_STATUSES, value);
}

/** Returns null for absent/unrecognized input so callers can pick their own fallback. */
export function resolvePriority(value) {
    return lookup(PRIORITY_ALIASES, TASK_PRIORITIES, value);
}

export function normalizeStatus(value = 'todo') {
    return resolveStatus(value) || 'todo';
}

export function normalizePriority(value = 'normal') {
    return resolvePriority(value) || 'normal';
}
