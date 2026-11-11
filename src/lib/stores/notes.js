import { writable, derived, get } from 'svelte/store';
import { defaultNotePrompts } from '../utils/notes-prompts.js';

const STORAGE_KEY = 'workplan_notes';

const DEFAULT_CATEGORIES = ['全部', '工作', '学习', '个人', '想法'];

function initialAiPrompts() {
    let language = 'zh';
    try { language = localStorage.getItem('workplan_locale') || globalThis.navigator?.language || language; } catch {}
    return defaultNotePrompts(language);
}

function emptyNotesState() {
    return { notes: [], categories: [...DEFAULT_CATEGORIES], activeNoteId: null, aiPrompts: initialAiPrompts() };
}

function createNotesStore() {
    const { subscribe, set, update } = writable(emptyNotesState());

    function load() {
        if (typeof window === 'undefined') return;
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                set({
                    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
                    categories: Array.isArray(parsed.categories) ? parsed.categories : [...DEFAULT_CATEGORIES],
                    activeNoteId: null,
                    aiPrompts: Array.isArray(parsed.aiPrompts) ? parsed.aiPrompts : initialAiPrompts()
                });
            } catch (e) {
                console.error('Failed to load notes:', e);
                set(emptyNotesState());
            }
        } else set(emptyNotesState());
    }

    function createNoteId() {
        return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function save(state) {
        if (typeof window === 'undefined') return false;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                notes: state.notes,
                categories: state.categories,
                aiPrompts: state.aiPrompts
            }));
            return true;
        } catch (error) {
            // QuotaExceededError used to throw from inside update(), so the note
            // was neither added nor persisted. Keep the in-memory copy at least.
            console.warn('Failed to save notes:', error?.message || error);
            return false;
        }
    }

    return {
        subscribe,
        load,
        addNote: (note) => update(s => {
            const newNote = {
                id: createNoteId(),
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
        updateNote: (id, updates) => {
            const previous = get({ subscribe }).notes.find(note => note.id === id);
            // Returning the same object from a Svelte writable updater still
            // notifies subscribers; skip the updater entirely for unchanged drafts.
            if (!previous || !updates || !Object.keys(updates).some(key => previous[key] !== updates[key])) return;
            update(s => {
                const notes = s.notes.map(n =>
                    n.id === id ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n
                );
                const newState = { ...s, notes };
                save(newState);
                return newState;
            });
        },
        deleteNote: (id) => update(s => {
            const notes = s.notes.filter(n => n.id !== id);
            const activeNoteId = s.activeNoteId === id ? null : s.activeNoteId;
            const newState = { ...s, notes, activeNoteId };
            save(newState);
            return newState;
        }),
        setActiveNote: (id) => update(s => ({ ...s, activeNoteId: id })),
        clearActiveNote: () => update(s => ({ ...s, activeNoteId: null })),
        replaceAll: (notes, categories) => update(s => {
            const nextNotes = Array.isArray(notes) ? notes.filter(note => note && note.id) : s.notes;
            const nextCategories = Array.isArray(categories) && categories.length > 0
                ? categories
                : s.categories;
            const next = {
                ...s,
                notes: nextNotes,
                categories: nextCategories,
                activeNoteId: nextNotes.some(note => note.id === s.activeNoteId) ? s.activeNoteId : null
            };
            save(next);
            return next;
        }),
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
                const parsed = JSON.parse(jsonStr);
                if (!Array.isArray(parsed)) throw new Error('Invalid format');
                const incoming = parsed.filter(item => item && typeof item === 'object');
                if (!incoming.length) {
                    return { success: false, error: '文件里没有可导入的笔记' };
                }
                update(s => {
                    const existingIds = new Set(s.notes.map(note => note.id));
                    const imported = incoming.map((note) => {
                        let id = typeof note.id === 'string' && note.id ? note.id : createNoteId();
                        if (existingIds.has(id)) {
                            id = createNoteId();
                        }
                        existingIds.add(id);
                        return {
                            ...note,
                            id,
                            title: typeof note.title === 'string' ? note.title : '无标题笔记',
                            content: typeof note.content === 'string' ? note.content : '',
                            tags: Array.isArray(note.tags) ? note.tags : [],
                            attachments: Array.isArray(note.attachments) ? note.attachments : []
                        };
                    });
                    const newState = { ...s, notes: [...imported, ...s.notes] };
                    save(newState);
                    return newState;
                });
                return { success: true, skipped: parsed.length - incoming.length };
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
