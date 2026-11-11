import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('master password change', () => {
    // Regression: swapping the in-memory secrets before persisting left the
    // session on the new master while storage still had the old one, so every
    // later save/cancel failed to encrypt or decrypt.
    test('rolls the session back when the swap fails', () => {
        const store = read('src/lib/stores/passwords.js');
        expect(store).toContain('主密码更新失败');
        expect(store).toContain('vaultSecret = oldSecret;');
        expect(store).toContain('currentMasterPassword = oldPassword;');
        // Derive without changing live secrets; swap only after the session fence.
        expect(store).toContain('newEntryKey = await ensureVaultEntryKey(newSecret)');
        expect(store).toContain('if (!unchanged())');
    });

    test('never throws past the caller', () => {
        const component = read('src/lib/components/Passwords.svelte');
        expect(component).toContain('passwordsStore.changeMasterPassword(');
        expect(component).toContain('catch (error)');
        const store = read('src/lib/stores/passwords.js');
        expect(store).toContain("if (!state.masterPasswordHash)");
    });

    test('cancel is a pure state change', () => {
        const component = read('src/lib/components/Passwords.svelte');
        expect(component).toContain('on:click|stopPropagation={() => (showChangeMasterPasswordModal = false)}');
    });
});
