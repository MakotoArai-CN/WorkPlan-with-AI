import { writable, derived, get } from 'svelte/store';

const STORAGE_KEY = 'planpro_notes';

const DEFAULT_CATEGORIES = ['全部', '工作', '学习', '个人', '想法'];

function createNotesStore() {
    const { subscribe, set, update } = writable({
        notes: [],
        categories: DEFAULT_CATEGORIES,
        activeNoteId: null,
        aiPrompts: [
            { id: '1', label: '总结', prompt: '请总结这篇笔记的主要内容和关键点' },
            { id: '2', label: '扩写', prompt: '请根据笔记内容进行扩写，补充更多细节' },
            { id: '3', label: '润色', prompt: '请润色并改善这篇笔记的文字表达' },
            { id: '4', label: '提取要点', prompt: '请从笔记中提取关键要点，以列表形式呈现' },
            { id: '5', label: '生成大纲', prompt: '请根据笔记内容生成一个结构化的大纲' }
        ]
    });

    function load() {
        if (typeof window === 'undefined') return;
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                set({
                    notes: parsed.notes || [],
                    categories: parsed.categories || DEFAULT_CATEGORIES,
                    activeNoteId: null,
                    aiPrompts: parsed.aiPrompts || [
                        { id: '1', label: '总结', prompt: '请总结这篇笔记的主要内容和关键点' },
                        { id: '2', label: '扩写', prompt: '请根据笔记内容进行扩写，补充更多细节' },
                        { id: '3', label: '润色', prompt: '请润色并改善这篇笔记的文字表达' },
                        { id: '4', label: '提取要点', prompt: '请从笔记中提取关键要点，以列表形式呈现' },
                        { id: '5', label: '生成大纲', prompt: '请根据笔记内容生成一个结构化的大纲' }
                    ]
                });
            } catch (e) {
                console.error('Failed to load notes:', e);
            }
        }
    }

    function save(state) {
        if (typeof window === 'undefined') return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            notes: state.notes,
            categories: state.categories,
            aiPrompts: state.aiPrompts
        }));
    }

    return {
        subscribe,
        load,
        addNote: (note) => update(s => {
            const newNote = {
                id: Date.now().toString(),
                title: note.title || '无标题笔记',
                content: note.content || '',
                category: note.category || '全部',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                tags: note.tags || [],
                attachments: note.attachments || [],
                aiLocked: false
            };
            const newState = { ...s, notes: [newNote, ...s.notes], activeNoteId: newNote.id };
            save(newState);
            return newState;
        }),
        updateNote: (id, updates) => update(s => {
            const notes = s.notes.map(n =>
                n.id === id ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n
            );
            const newState = { ...s, notes };
            save(newState);
            return newState;
        }),
        deleteNote: (id) => update(s => {
            const notes = s.notes.filter(n => n.id !== id);
            const activeNoteId = s.activeNoteId === id ? null : s.activeNoteId;
            const newState = { ...s, notes, activeNoteId };
            save(newState);
            return newState;
        }),
        setActiveNote: (id) => update(s => ({ ...s, activeNoteId: id })),
        clearActiveNote: () => update(s => ({ ...s, activeNoteId: null })),
        toggleAiLock: (id) => update(s => {
            const notes = s.notes.map(n =>
                n.id === id ? { ...n, aiLocked: !n.aiLocked, updatedAt: new Date().toISOString() } : n
            );
            const newState = { ...s, notes };
            save(newState);
            return newState;
        }),
        addCategory: (name) => update(s => {
            if (s.categories.includes(name)) return s;
            const newState = { ...s, categories: [...s.categories, name] };
            save(newState);
            return newState;
        }),
        deleteCategory: (name) => update(s => {
            if (name === '全部') return s;
            const categories = s.categories.filter(c => c !== name);
            const notes = s.notes.map(n => n.category === name ? { ...n, category: '全部' } : n);
            const newState = { ...s, categories, notes };
            save(newState);
            return newState;
        }),
        updateAiPrompt: (id, updates) => update(s => {
            const aiPrompts = s.aiPrompts.map(p => p.id === id ? { ...p, ...updates } : p);
            const newState = { ...s, aiPrompts };
            save(newState);
            return newState;
        }),
        addAiPrompt: (prompt) => update(s => {
            const newPrompt = { id: Date.now().toString(), ...prompt };
            const newState = { ...s, aiPrompts: [...s.aiPrompts, newPrompt] };
            save(newState);
            return newState;
        }),
        deleteAiPrompt: (id) => update(s => {
            const aiPrompts = s.aiPrompts.filter(p => p.id !== id);
            const newState = { ...s, aiPrompts };
            save(newState);
            return newState;
        }),
        exportNotes: () => {
            const state = get({ subscribe });
            return JSON.stringify(state.notes, null, 2);
        },
        importNotes: (jsonStr) => {
            try {
                const notes = JSON.parse(jsonStr);
                if (!Array.isArray(notes)) throw new Error('Invalid format');
                update(s => {
                    const newState = { ...s, notes: [...notes, ...s.notes] };
                    save(newState);
                    return newState;
                });
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }
    };
}

export const notesStore = createNotesStore();

export const activeNote = derived(notesStore, $store =>
    $store.notes.find(n => n.id === $store.activeNoteId) || null
);

export const notesList = derived(notesStore, $store => $store.notes);
export const noteCategories = derived(notesStore, $store => $store.categories);
export const noteAiPrompts = derived(notesStore, $store => $store.aiPrompts);
