// A confirm/alert dialog that is closed or replaced must still settle its
// promise; otherwise every caller awaiting it hangs forever.
import { describe, test, expect } from 'bun:test';
import { modalStore, showAlert, showConfirm } from '../src/lib/stores/modal.js';

describe('modal promise lifecycle', () => {
    test('closing a confirm resolves it as cancelled', async () => {
        const pending = showConfirm({ title: '删除？' });
        modalStore.close();
        expect(await pending).toBe(false);
    });

    test('closing an alert resolves it', async () => {
        const pending = showAlert({ title: '提示' });
        modalStore.close();
        expect(await pending).toBe(true);
    });

    test('opening a second dialog settles the first one', async () => {
        const first = showConfirm({ title: '第一个' });
        const second = showConfirm({ title: '第二个' });
        expect(await first).toBe(false);

        let state;
        const unsubscribe = modalStore.subscribe(value => { state = value; });
        unsubscribe();
        expect(state.show).toBe(true);
        expect(state.title).toBe('第二个');
        modalStore.close();
        expect(await second).toBe(false);
    });
});
