import { describe, expect, test } from 'bun:test';
import { captureMessageApproval } from '../src/lib/utils/ai-message-approval.js';

function fixture(overrides = {}) {
    const state = { message: { type: 'update_confirm', task: { id: '1', title: 'Original' } },
        items: [{ id: '1', title: 'Original' }], context: {}, current: true, ...overrides };
    const check = captureMessageApproval({ message: state.message, getMessage: () => state.message,
        getItems: () => state.items, getContext: () => state.context, isOperationCurrent: () => state.current });
    return { state, check };
}

describe('AI confirmation identity', () => {
    test('permits an unchanged proposal against its original data', () => expect(fixture().check()).toBe(true));
    test('rejects cross-account/session cancellation, replaced message, changed panel and edited targets', () => {
        for (const change of [state => { state.current = false; }, state => { state.message = { ...state.message }; },
            state => { state.context = {}; }, state => { state.items = [...state.items]; },
            state => { state.message.confirmed = true; }]) {
            const { state, check } = fixture();
            change(state);
            expect(check()).toBe(false);
        }
    });
    test('rejects a proposal whose target was changed or deleted before opening confirmation', () => {
        expect(fixture({ items: [{ id: '1', title: 'Edited' }] }).check()).toBe(false);
        expect(fixture({ items: [] }).check()).toBe(false);
    });
    test('allows new task cards without an existing target but never an already confirmed card', () => {
        expect(fixture({ message: { type: 'task_card', data: { title: 'New' } }, items: [] }).check()).toBe(true);
        expect(fixture({ message: { type: 'task_card', confirmed: true } }).check()).toBe(false);
        expect(fixture({ message: { type: 'text' } }).check()).toBe(false);
    });

    test('rejects malformed targets and proposals altered in place while awaiting approval', () => {
        for (const message of [ { type: 'update_confirm' }, { type: 'delete_confirm', tasks: [] },
            { type: 'multi_update_confirm', operations: [null] }, { type: 'task_card', data: null },
            { type: 'mixed_confirm', updateOps: {} } ]) {
            expect(fixture({ message }).check()).toBe(false);
        }
        const { state, check } = fixture();
        state.message.updates = { title: 'Changed during the dialog' };
        expect(check()).toBe(false);
    });
});
