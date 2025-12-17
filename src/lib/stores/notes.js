import { writable, derived, get } from 'svelte/store';

const STORAGE_KEY = 'planpro_notes';

function createNotesStore() {
    const { subscribe, set, update } = writable({
        notes: [],
        activeNoteId: null
    });

    function load() {
        if (typeof window === 'undefined') return;
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                set({
                    notes: parsed.notes || [],
                    activeNoteId: null
                });
            } catch (e) {
                console.error('Failed to load notes:', e);
            }
        }
    }

    function save(state) {
        if (typeof window === 'undefined') return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            notes: state.notes
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
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                tags: note.tags || [],
                attachments: note.attachments || []
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