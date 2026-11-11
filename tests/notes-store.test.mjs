// Notes are stored in localStorage with inline attachments. A quota failure
// used to throw from inside the store updater (losing the note entirely), and
// imports could duplicate ids. Pin both behaviours.
import { describe, test, expect, beforeEach } from 'bun:test';

function createStorage() {
    const data = new Map();
    return {
        data,
        getItem(key) { return data.has(key) ? data.get(key) : null; },
        setItem(key, value) { data.set(key, String(value)); },
        removeItem(key) { data.delete(key); },
        clear() { data.clear(); }
    };
}

globalThis.localStorage = createStorage();
globalThis.window = globalThis.window || { localStorage: globalThis.localStorage };

const { notesStore } = await import('../src/lib/stores/notes.js');

function snapshotNotes() {
    let state;
    const unsubscribe = notesStore.subscribe(value => { state = value; });
    unsubscribe();
    return state;
}

beforeEach(() => {
    globalThis.localStorage.clear();
    notesStore.load();
});

describe('notes store persistence', () => {
    test('empty account storage clears previously loaded notes and retains saved custom prompts', () => {
        localStorage.setItem('workplan_notes', JSON.stringify({ notes: [{ id: 'old-account', content: 'private' }], aiPrompts: [{ id: 'custom', label: 'Mine', prompt: 'My custom prompt' }] }));
        notesStore.load();
        expect(snapshotNotes().notes).toHaveLength(1);
        expect(snapshotNotes().aiPrompts[0].prompt).toBe('My custom prompt');
        localStorage.removeItem('workplan_notes');
        notesStore.load();
        expect(snapshotNotes().notes).toHaveLength(0);
        expect(snapshotNotes().aiPrompts).toHaveLength(5);
    });
    test('unchanged edits keep the note identity and timestamp and do not write storage', () => {
        notesStore.addNote({ title: 'Unchanged', content: 'Body' });
        const note = snapshotNotes().notes[0];
        const originalSetItem = localStorage.setItem;
        let writes = 0;
        let notifications = 0;
        const unsubscribe = notesStore.subscribe(() => notifications += 1);
        localStorage.setItem = (...args) => { writes += 1; return originalSetItem.apply(localStorage, args); };
        try {
            notesStore.updateNote(note.id, { title: note.title, content: note.content });
            notesStore.updateNote('missing-id', { title: 'No-op' });
            expect(writes).toBe(0);
            expect(notifications).toBe(1);
            expect(snapshotNotes().notes[0]).toBe(note);
            expect(snapshotNotes().notes[0].updatedAt).toBe(note.updatedAt);
        } finally { localStorage.setItem = originalSetItem; unsubscribe(); }
    });
    test('adds a note and uses a collision-resistant id', () => {
        notesStore.addNote({ title: 'A', content: 'one' });
        notesStore.addNote({ title: 'B', content: 'two' });
        const notes = snapshotNotes().notes;
        expect(notes).toHaveLength(2);
        expect(new Set(notes.map(note => note.id)).size).toBe(2);
    });

    test('a storage quota failure does not throw or drop the in-memory note', () => {
        const originalSetItem = globalThis.localStorage.setItem;
        globalThis.localStorage.setItem = () => {
            const error = new Error('QuotaExceededError');
            error.name = 'QuotaExceededError';
            throw error;
        };
        try {
            expect(() => notesStore.addNote({ title: '大附件', content: 'x'.repeat(1000) })).not.toThrow();
            expect(snapshotNotes().notes.some(note => note.title === '大附件')).toBe(true);
        } finally {
            globalThis.localStorage.setItem = originalSetItem;
        }
    });

    test('import rejects non-arrays and de-duplicates ids', () => {
        notesStore.addNote({ title: 'existing', content: '' });
        const existingId = snapshotNotes().notes[0].id;

        const bad = notesStore.importNotes(JSON.stringify({ notes: [] }));
        expect(bad.success).toBe(false);

        const result = notesStore.importNotes(JSON.stringify([
            { id: existingId, title: '冲突 id', content: 'a' },
            { id: 'fresh', title: '正常', content: 'b' },
            { title: '没 id', content: 'c' }
        ]));
        expect(result.success).toBe(true);
        const notes = snapshotNotes().notes;
        expect(new Set(notes.map(note => note.id)).size).toBe(notes.length);
        expect(notes.some(note => note.title === '冲突 id')).toBe(true);
        expect(notes.some(note => note.title === '正常')).toBe(true);
    });
});
