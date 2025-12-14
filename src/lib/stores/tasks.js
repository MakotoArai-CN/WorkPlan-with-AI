import { writable, derived } from 'svelte/store';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || '';
const TABLE_NAME = import.meta.env.VITE_SUPABASE_TABLE || 'planpro_data';

let supabase = null;

async function getSupabase() {
    if (supabase) return supabase;
    if (typeof window === 'undefined') return null;
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.warn('Supabase configuration missing. Cloud sync disabled.');
        return null;
    }
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    return supabase;
}

function createTaskStore() {
    const { subscribe, set, update } = writable({
        tasks: [],
        templates: [],
        scheduledTasks: [],
        accessKey: null,
        syncStatus: 'idle',
        lastCloudStr: ''
    });

    let saveTimer = null;

    function getPureDataString(data) {
        const copy = JSON.parse(JSON.stringify(data));
        ['tasks', 'templates', 'scheduledTasks'].forEach(key => {
            if (copy[key]) {
                copy[key].forEach(item => {
                    delete item.expanded;
                    delete item.isFromSchedule;
                });
            }
        });
        return JSON.stringify(copy);
    }

    async function loadData(accessKey) {
        const client = await getSupabase();
        if (!client) {
            update(s => ({ ...s, syncStatus: 'idle' }));
            return;
        }
        update(s => ({ ...s, syncStatus: 'syncing' }));
        try {
            const { data, error } = await client
                .from(TABLE_NAME)
                .select('content, updated_at')
                .eq('user_key', accessKey)
                .maybeSingle();

            if (error) {
                if (error.code === 'PGRST116' || error.message.includes('not find')) {
                    update(s => ({ ...s, syncStatus: 'idle' }));
                    return;
                }
                console.error('Load data error:', error.message);
                update(s => ({ ...s, syncStatus: 'error' }));
                return;
            }

            if (data && data.content) {
                const json = data.content;
                const cloudStr = getPureDataString({
                    tasks: json.tasks || [],
                    templates: json.templates || [],
                    scheduledTasks: json.scheduledTasks || []
                });
                update(s => ({
                    ...s,
                    tasks: json.tasks || [],
                    templates: json.templates || [],
                    scheduledTasks: json.scheduledTasks || [],
                    syncStatus: 'done',
                    lastCloudStr: cloudStr
                }));
            } else {
                update(s => ({ ...s, syncStatus: 'idle' }));
            }
        } catch (e) {
            console.error('Load error:', e);
            update(s => ({ ...s, syncStatus: 'error' }));
        }
    }

    async function saveData(state) {
        const client = await getSupabase();
        if (!client || !state.accessKey) return;

        const currentPureStr = getPureDataString({
            tasks: state.tasks,
            templates: state.templates,
            scheduledTasks: state.scheduledTasks
        });

        if (currentPureStr === state.lastCloudStr) return;

        update(s => ({ ...s, syncStatus: 'syncing' }));

        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            try {
                const nowTimestamp = Date.now();
                const rawData = JSON.parse(currentPureStr);
                const { error } = await client
                    .from(TABLE_NAME)
                    .upsert({ user_key: state.accessKey, content: rawData, updated_at: nowTimestamp }, { onConflict: 'user_key' });

                if (error) {
                    console.error('Save error:', error);
                    update(s => ({ ...s, syncStatus: 'error' }));
                } else {
                    update(s => ({ ...s, syncStatus: 'done', lastCloudStr: currentPureStr }));
                    setTimeout(() => update(s => s.syncStatus === 'done' ? { ...s, syncStatus: 'idle' } : s), 3000);
                }
            } catch (e) {
                console.error('Save error:', e);
                update(s => ({ ...s, syncStatus: 'error' }));
            }
        }, 2000);
    }

    function checkScheduledTasks(state) {
        const today = new Date().toISOString().split('T')[0];
        const todayDate = new Date(today);
        let addedCount = 0;
        const newTasks = [...state.tasks];

        state.scheduledTasks.forEach(sch => {
            if (!sch.enabled) return;
            let checkDate = sch.lastGeneratedDate
                ? new Date(new Date(sch.lastGeneratedDate).setDate(new Date(sch.lastGeneratedDate).getDate() + 1))
                : new Date(todayDate);

            while (checkDate <= todayDate) {
                const dayOfWeek = checkDate.getDay();
                if (sch.repeatDays.includes(dayOfWeek)) {
                    newTasks.push({
                        id: Date.now() + Math.random().toString(36).substr(2, 5),
                        title: sch.title,
                        status: 'todo',
                        priority: sch.priority || 'normal',
                        date: checkDate.toISOString().split('T')[0] + 'T09:00',
                        deadline: '',
                        note: sch.note || '',
                        subtasks: JSON.parse(JSON.stringify(sch.subtasks || [])),
                        expanded: false,
                        isFromSchedule: true
                    });
                    addedCount++;
                }
                checkDate.setDate(checkDate.getDate() + 1);
            }
            sch.lastGeneratedDate = today;
        });

        if (addedCount > 0) {
            update(s => ({ ...s, tasks: newTasks }));
        }
    }

    return {
        subscribe,
        set,
        update,
        login: (key) => {
            if (typeof window === 'undefined') return;
            localStorage.setItem('planpro_access_key', key);
            update(s => ({ ...s, accessKey: key }));
            loadData(key);
        },
        logout: () => {
            if (typeof window === 'undefined') return;
            localStorage.removeItem('planpro_access_key');
            set({ tasks: [], templates: [], scheduledTasks: [], accessKey: null, syncStatus: 'idle', lastCloudStr: '' });
        },
        loadFromLocal: () => {
            if (typeof window === 'undefined') return;
            const savedKey = localStorage.getItem('planpro_access_key');
            if (savedKey) {
                update(s => ({ ...s, accessKey: savedKey }));
                loadData(savedKey);
            }
        },
        addTask: (task) => update(s => {
            const newState = { ...s, tasks: [...s.tasks, task] };
            saveData(newState);
            return newState;
        }),
        updateTask: (id, updates) => update(s => {
            const tasks = s.tasks.map(t => t.id === id ? { ...t, ...updates } : t);
            const newState = { ...s, tasks };
            saveData(newState);
            return newState;
        }),
        deleteTask: (id) => update(s => {
            const newState = { ...s, tasks: s.tasks.filter(t => t.id !== id) };
            saveData(newState);
            return newState;
        }),
        addTemplate: (template) => update(s => {
            const newState = { ...s, templates: [...s.templates, template] };
            saveData(newState);
            return newState;
        }),
        updateTemplate: (id, updates) => update(s => {
            const templates = s.templates.map(t => t.id === id ? { ...t, ...updates } : t);
            const newState = { ...s, templates };
            saveData(newState);
            return newState;
        }),
        deleteTemplate: (id) => update(s => {
            const newState = { ...s, templates: s.templates.filter(t => t.id !== id) };
            saveData(newState);
            return newState;
        }),
        addScheduledTask: (task) => update(s => {
            const newState = { ...s, scheduledTasks: [...s.scheduledTasks, task] };
            saveData(newState);
            return newState;
        }),
        updateScheduledTask: (id, updates) => update(s => {
            const scheduledTasks = s.scheduledTasks.map(t => t.id === id ? { ...t, ...updates } : t);
            const newState = { ...s, scheduledTasks };
            saveData(newState);
            return newState;
        }),
        deleteScheduledTask: (id) => update(s => {
            const newState = { ...s, scheduledTasks: s.scheduledTasks.filter(t => t.id !== id) };
            saveData(newState);
            return newState;
        }),
        checkScheduled: () => update(s => {
            checkScheduledTasks(s);
            return s;
        }),
        clearAllData: async (accessKey) => {
            const client = await getSupabase();
            if (client) {
                try {
                    await client.from(TABLE_NAME).delete().eq('user_key', accessKey);
                } catch (e) {
                    console.error('Delete error:', e);
                }
            }
            if (typeof window !== 'undefined') {
                localStorage.removeItem('planpro_access_key');
            }
            set({ tasks: [], templates: [], scheduledTasks: [], accessKey: null, syncStatus: 'idle', lastCloudStr: '' });
        },
        exportData: (state) => {
            return JSON.stringify({
                tasks: state.tasks,
                templates: state.templates,
                scheduledTasks: state.scheduledTasks
            }, null, 2);
        },
        importData: (jsonStr) => {
            try {
                const json = JSON.parse(jsonStr);
                update(s => {
                    const newState = {
                        ...s,
                        tasks: json.tasks || s.tasks,
                        templates: json.templates || s.templates,
                        scheduledTasks: json.scheduledTasks || s.scheduledTasks
                    };
                    saveData(newState);
                    return newState;
                });
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }
    };
}

export const taskStore = createTaskStore();

const getToday = () => typeof window !== 'undefined' ? new Date().toISOString().split('T')[0] : '2024-01-01';

export const today = writable(getToday());
export const viewDate = writable(getToday());
export const currentView = writable('dashboard');
export const activeTask = writable(null);

export const activeTasks = derived(
    [taskStore, viewDate, today],
    ([$store, $viewDate, $today]) => {
        const now = new Date();
        const list = $store.tasks.filter(t => {
            const taskDate = t.date.split('T')[0];
            if (t.status === 'done') return false;
            if ($viewDate === $today) return taskDate <= $today;
            return taskDate === $viewDate;
        });

        const pMap = { critical: 3, urgent: 2, normal: 1 };
        const sMap = { doing: 2, todo: 1 };

        return list.sort((a, b) => {
            const pDiff = pMap[b.priority] - pMap[a.priority];
            if (pDiff !== 0) return pDiff;
            const aOver = a.deadline && a.deadline < now.toISOString() ? 1 : 0;
            const bOver = b.deadline && b.deadline < now.toISOString() ? 1 : 0;
            if (aOver !== bOver) return bOver - aOver;
            const sDiff = sMap[b.status] - sMap[a.status];
            if (sDiff !== 0) return sDiff;
            return a.date > b.date ? 1 : -1;
        });
    }
);

export const completedTasks = derived(
    [taskStore, viewDate, today],
    ([$store, $viewDate, $today]) => {
        return $store.tasks.filter(t => {
            if (t.status !== 'done') return false;
            if ($viewDate === $today) {
                return t.date.split('T')[0] === $today ||
                    (t.completedDate && t.completedDate.split('T')[0] === $today);
            }
            return t.date.split('T')[0] === $viewDate;
        });
    }
);

export const futurePreviews = derived(
    [taskStore, viewDate, today],
    ([$store, $viewDate, $today]) => {
        if ($viewDate <= $today) return [];
        const targetDay = new Date($viewDate).getDay();
        return $store.scheduledTasks
            .filter(s => s.enabled && s.repeatDays.includes(targetDay === 0 ? 7 : targetDay))
            .map(s => ({ ...s, id: 'preview_' + s.id, status: 'todo', isPreview: true }));
    }
);

export const enabledScheduledCount = derived(
    taskStore,
    $store => $store.scheduledTasks.filter(t => t.enabled).length
);