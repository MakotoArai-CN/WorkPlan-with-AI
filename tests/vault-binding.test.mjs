// End-to-end behaviour of the passwords store across device binding, PIN unlock,
// recovery, and master-password changes. This exercises the real store rather than
// the crypto primitives, so it catches wiring mistakes the unit tests cannot.
import { describe, test, expect, beforeEach, mock } from 'bun:test';

function createStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        clear: () => map.clear()
    };
}

globalThis.localStorage = createStorage();
globalThis.sessionStorage = createStorage();
globalThis.window = globalThis;

let currentDeviceKey = 'machine-a.install-a';
let deviceKeyAvailable = true;

mock.module('@tauri-apps/api/core', () => ({
    invoke: async (cmd) => {
        if (cmd === 'get_device_key') {
            if (!deviceKeyAvailable) throw new Error('unavailable');
            return currentDeviceKey;
        }
        throw new Error(`unexpected command ${cmd}`);
    }
}));

mock.module('../src/lib/utils/runtime.js', () => ({
    isTauriRuntime: true,
    isAndroidRuntime: () => false
}));

const { passwordsStore } = await import('../src/lib/stores/passwords.js');
const { clearDeviceKeyCache } = await import('../src/lib/utils/device-auth.js');

const MASTER = 'my-master-password-2026';

/** Fresh vault with one entry, unlocked and ready. */
async function freshVault() {
    localStorage.clear();
    sessionStorage.clear();
    currentDeviceKey = 'machine-a.install-a';
    deviceKeyAvailable = true;
    clearDeviceKeyCache();

    passwordsStore.clearAll();
    await passwordsStore.setMasterPassword(MASTER);
    passwordsStore.addPassword({ title: 'GitHub', username: 'me', password: 'gh-secret' });
}

function storedEntry() {
    let entry;
    passwordsStore.subscribe((s) => (entry = s.passwords[0]))();
    return entry;
}

function readBack() {
    const entry = storedEntry();
    return passwordsStore.decryptPassword(entry.password);
}

beforeEach(async () => {
    await freshVault();
});

describe('vault without device binding', () => {
    test('stores and reads an entry', () => {
        expect(readBack()).toBe('gh-secret');
    });
});

describe('enabling device binding', () => {
    test('re-encrypts existing entries and keeps them readable', async () => {
        const before = storedEntry().password;
        const result = await passwordsStore.enableDeviceBinding();

        expect(result.success).toBe(true);
        expect(result.recoveryCode).toBeTruthy();
        expect(passwordsStore.isDeviceBindingEnabled()).toBe(true);

        // Ciphertext changed, plaintext did not.
        expect(storedEntry().password).not.toBe(before);
        expect(readBack()).toBe('gh-secret');
    });

    test('bound data cannot be opened on a different device', async () => {
        await passwordsStore.enableDeviceBinding();

        // Simulate the stored vault being copied to another machine.
        currentDeviceKey = 'machine-b.install-b';
        clearDeviceKeyCache();
        passwordsStore.lock();

        // Fails closed at unlock: the binding envelope cannot be opened here, so the
        // vault refuses rather than unlocking into undecryptable data.
        await expect(passwordsStore.unlock(MASTER)).rejects.toThrow();
    });

    test('new entries added after binding are also bound', async () => {
        const { recoveryCode } = await passwordsStore.enableDeviceBinding();
        passwordsStore.addPassword({ title: 'Bank', username: 'me', password: 'bank-secret' });

        let bankEntry;
        passwordsStore.subscribe((s) => (bankEntry = s.passwords.find((p) => p.title === 'Bank')))();

        expect(passwordsStore.decryptPassword(bankEntry.password)).toBe('bank-secret');

        // On another machine the entry is only reachable via the recovery code.
        currentDeviceKey = 'machine-b.install-b';
        clearDeviceKeyCache();
        passwordsStore.lock();
        await expect(passwordsStore.unlock(MASTER)).rejects.toThrow();

        expect((await passwordsStore.recoverWithCode(recoveryCode, MASTER)).success).toBe(true);
        expect(passwordsStore.decryptPassword(bankEntry.password)).toBe('bank-secret');
    });
});

describe('disabling device binding', () => {
    test('restores portability of the vault', async () => {
        await passwordsStore.enableDeviceBinding();
        const result = await passwordsStore.disableDeviceBinding();

        expect(result.success).toBe(true);
        expect(passwordsStore.isDeviceBindingEnabled()).toBe(false);
        expect(readBack()).toBe('gh-secret');

        // Now the vault should open on another device again.
        const unbound = storedEntry().password;
        currentDeviceKey = 'machine-b.install-b';
        clearDeviceKeyCache();
        passwordsStore.lock();
        await passwordsStore.unlock(MASTER);
        expect(passwordsStore.decryptPassword(unbound)).toBe('gh-secret');
    });
});

describe('recovery on a new device', () => {
    test('recovery code rebinds the vault and restores access', async () => {
        const { recoveryCode } = await passwordsStore.enableDeviceBinding();

        // Move to a new machine: the vault will not open normally here.
        currentDeviceKey = 'machine-b.install-b';
        clearDeviceKeyCache();
        passwordsStore.lock();

        const result = await passwordsStore.recoverWithCode(recoveryCode, MASTER);
        expect(result.success).toBe(true);
        expect(readBack()).toBe('gh-secret');
    });

    test('recovery survives losing local storage entirely', async () => {
        const { recoveryCode } = await passwordsStore.enableDeviceBinding();
        const entries = localStorage.getItem('planpro_passwords');
        const verifier = localStorage.getItem('planpro_master_hash');

        // Dead drive: the user restores a backup of the vault data and nothing else.
        // No binding envelope, no device-key remnants — only the saved code.
        localStorage.clear();
        localStorage.setItem('planpro_passwords', entries);
        localStorage.setItem('planpro_master_hash', verifier);
        localStorage.setItem('planpro_device_binding', '1');
        currentDeviceKey = 'replacement-machine.install-new';
        clearDeviceKeyCache();
        passwordsStore.clearSessionForTest?.();
        passwordsStore.load();

        const result = await passwordsStore.recoverWithCode(recoveryCode, MASTER);
        expect(result.success).toBe(true);
        expect(readBack()).toBe('gh-secret');
    });

    test('the saved code stays valid after rebinding', async () => {
        const { recoveryCode } = await passwordsStore.enableDeviceBinding();

        currentDeviceKey = 'machine-b.install-b';
        clearDeviceKeyCache();
        passwordsStore.lock();
        expect((await passwordsStore.recoverWithCode(recoveryCode, MASTER)).success).toBe(true);

        // Recovery does not silently rotate the code the user wrote down, so it still
        // works on the next machine.
        currentDeviceKey = 'machine-c.install-c';
        clearDeviceKeyCache();
        passwordsStore.lock();
        expect((await passwordsStore.recoverWithCode(recoveryCode, MASTER)).success).toBe(true);
        expect(readBack()).toBe('gh-secret');
    });

    test('re-keying issues a new code and retires the old one', async () => {
        const { recoveryCode: original } = await passwordsStore.enableDeviceBinding();

        const reissue = await passwordsStore.regenerateRecoveryCode();
        expect(reissue.success).toBe(true);
        expect(reissue.recoveryCode).not.toBe(original);
        expect(readBack()).toBe('gh-secret');

        // The retired code must no longer open the re-keyed vault.
        currentDeviceKey = 'machine-b.install-b';
        clearDeviceKeyCache();
        passwordsStore.lock();
        expect((await passwordsStore.recoverWithCode(original, MASTER)).success).toBe(false);

        clearDeviceKeyCache();
        expect((await passwordsStore.recoverWithCode(reissue.recoveryCode, MASTER)).success).toBe(true);
        expect(readBack()).toBe('gh-secret');
    });

    test('rejects a wrong recovery code and a wrong master password', async () => {
        const { recoveryCode } = await passwordsStore.enableDeviceBinding();
        currentDeviceKey = 'machine-b.install-b';
        clearDeviceKeyCache();

        expect((await passwordsStore.recoverWithCode('WPLN-2345-6789-ABCD-EFGH', MASTER)).success)
            .toBe(false);
        expect((await passwordsStore.recoverWithCode(recoveryCode, 'wrong-password')).success)
            .toBe(false);
    });
});

describe('PIN unlock through the store', () => {
    test('unlocks the vault and yields readable entries', async () => {
        await passwordsStore.enableDeviceBinding();
        expect((await passwordsStore.enablePin('4827')).success).toBe(true);

        passwordsStore.lock();
        const result = await passwordsStore.unlockWithPin('4827');

        expect(result.success).toBe(true);
        expect(readBack()).toBe('gh-secret');
    });

    test('a wrong PIN does not unlock', async () => {
        await passwordsStore.enableDeviceBinding();
        await passwordsStore.enablePin('4827');
        passwordsStore.lock();

        const result = await passwordsStore.unlockWithPin('9999');
        expect(result.success).toBe(false);
    });

    test('changing the master password invalidates the PIN', async () => {
        await passwordsStore.enableDeviceBinding();
        await passwordsStore.enablePin('4827');

        const changed = await passwordsStore.changeMasterPassword(MASTER, 'a-brand-new-password');
        expect(changed.success).toBe(true);
        expect(passwordsStore.isPinEnabled()).toBe(false);
    });
});

describe('changing the master password while bound', () => {
    test('entries remain readable afterwards', async () => {
        await passwordsStore.enableDeviceBinding();

        const changed = await passwordsStore.changeMasterPassword(MASTER, 'a-brand-new-password');
        expect(changed.success).toBe(true);
        expect(readBack()).toBe('gh-secret');

        // And the new password is the one that works.
        passwordsStore.lock();
        expect(await passwordsStore.unlock('a-brand-new-password')).toBe(true);
        expect(readBack()).toBe('gh-secret');
    });

    test('rejects a wrong current password', async () => {
        await passwordsStore.enableDeviceBinding();
        const changed = await passwordsStore.changeMasterPassword('not-the-password', 'whatever-new');
        expect(changed.success).toBe(false);
    });
});
