// Device binding, PIN quick-unlock, and recovery-code behaviour.
//
// These run outside a browser, so localStorage and the Tauri IPC are stubbed before
// the module under test is imported.
import { describe, test, expect, beforeEach, mock } from 'bun:test';

// --- Environment stubs -------------------------------------------------------

function createStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        clear: () => map.clear(),
        get size() {
            return map.size;
        }
    };
}

globalThis.localStorage = createStorage();
globalThis.window = globalThis;

// Pretend to be the Tauri runtime with a fixed device key.
let currentDeviceKey = 'machine-guid-abc.install-secret-xyz';
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

const {
    getDeviceKey,
    clearDeviceKeyCache,
    composeVaultSecret,
    generateRecoveryCode,
    normalizeRecoveryCode,
    bindingKeyFromRecoveryCode,
    storeBindingEnvelope,
    readBindingKey,
    enableDeviceBinding,
    disableDeviceBinding,
    isDeviceBindingEnabled,
    enablePin,
    unlockWithPin,
    clearPin,
    isPinEnabled,
    getPinAttemptsRemaining,
    validatePinFormat,
    MAX_PIN_ATTEMPTS
} = await import('../src/lib/utils/device-auth.js');

const { encrypt, decrypt } = await import('../src/lib/utils/crypto.js');

beforeEach(() => {
    localStorage.clear();
    clearDeviceKeyCache();
    currentDeviceKey = 'machine-guid-abc.install-secret-xyz';
    deviceKeyAvailable = true;
});

describe('device binding', () => {
    test('vault secret changes when the device key changes', () => {
        const onDeviceA = composeVaultSecret('master-pw', 'device-a');
        const onDeviceB = composeVaultSecret('master-pw', 'device-b');
        expect(onDeviceA).not.toBe(onDeviceB);
    });

    test('data encrypted on one device cannot be read on another', () => {
        const ciphertext = encrypt('my-secret', composeVaultSecret('master-pw', 'device-a'));
        // Same master password, different machine — this is the whole point.
        expect(decrypt(ciphertext, composeVaultSecret('master-pw', 'device-b'))).toBeNull();
        expect(decrypt(ciphertext, composeVaultSecret('master-pw', 'device-a'))).toBe('my-secret');
    });

    test('knowing only the master password is not enough once bound', () => {
        const ciphertext = encrypt('my-secret', composeVaultSecret('master-pw', 'device-a'));
        expect(decrypt(ciphertext, 'master-pw')).toBeNull();
    });

    test('enabling binding records the flag and returns a recovery code', async () => {
        expect(isDeviceBindingEnabled()).toBe(false);
        const { recoveryCode } = await enableDeviceBinding();
        expect(isDeviceBindingEnabled()).toBe(true);
        expect(recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
    });

    test('disabling binding clears the flag and any PIN', async () => {
        await enableDeviceBinding();
        await enablePin('4827', 'master-pw');
        expect(isPinEnabled()).toBe(true);

        disableDeviceBinding();
        expect(isDeviceBindingEnabled()).toBe(false);
        expect(isPinEnabled()).toBe(false);
    });

    test('reports unavailable rather than degrading when there is no device key', async () => {
        deviceKeyAvailable = false;
        clearDeviceKeyCache();
        expect(await getDeviceKey()).toBeNull();
    });
});

describe('recovery code', () => {
    test('is itself the binding key, so no stored blob is needed', () => {
        const code = generateRecoveryCode();
        // The whole point: derivable from the code alone, even with empty storage.
        localStorage.clear();
        expect(bindingKeyFromRecoveryCode(code)).toBeTruthy();
    });

    test('accepts user formatting variations', () => {
        const code = generateRecoveryCode();
        const canonical = bindingKeyFromRecoveryCode(code);
        expect(bindingKeyFromRecoveryCode(code.toLowerCase())).toBe(canonical);
        expect(bindingKeyFromRecoveryCode(code.replace(/-/g, ''))).toBe(canonical);
        expect(bindingKeyFromRecoveryCode(code.replace(/-/g, ' '))).toBe(canonical);
    });

    test('different codes yield different binding keys', () => {
        expect(bindingKeyFromRecoveryCode(generateRecoveryCode()))
            .not.toBe(bindingKeyFromRecoveryCode(generateRecoveryCode()));
    });

    test('rejects empty input', () => {
        expect(bindingKeyFromRecoveryCode('')).toBeNull();
        expect(bindingKeyFromRecoveryCode('---')).toBeNull();
    });

    test('recovers the vault after total loss of local storage', () => {
        // Simulate a dead drive: the user has nothing but their code and password.
        const code = generateRecoveryCode();
        const bindingKey = bindingKeyFromRecoveryCode(code);
        const ciphertext = encrypt('my-secret', composeVaultSecret('master-pw', bindingKey));

        localStorage.clear();

        const rebuilt = composeVaultSecret('master-pw', bindingKeyFromRecoveryCode(code));
        expect(decrypt(ciphertext, rebuilt)).toBe('my-secret');
    });

    test('the wrong code cannot open a bound vault', () => {
        const bindingKey = bindingKeyFromRecoveryCode(generateRecoveryCode());
        const ciphertext = encrypt('my-secret', composeVaultSecret('master-pw', bindingKey));

        const wrong = bindingKeyFromRecoveryCode(generateRecoveryCode());
        expect(decrypt(ciphertext, composeVaultSecret('master-pw', wrong))).toBeNull();
    });

    test('the binding envelope round trips under the device key', async () => {
        const bindingKey = bindingKeyFromRecoveryCode(generateRecoveryCode());
        expect(storeBindingEnvelope(bindingKey, currentDeviceKey)).toBe(true);
        expect(await readBindingKey()).toBe(bindingKey);
    });

    test('the envelope is unreadable on a different device', async () => {
        const bindingKey = bindingKeyFromRecoveryCode(generateRecoveryCode());
        storeBindingEnvelope(bindingKey, currentDeviceKey);

        // Envelope copied to another machine: normal unlock must fail there.
        currentDeviceKey = 'other-machine.other-secret';
        clearDeviceKeyCache();
        expect(await readBindingKey()).toBeNull();
    });

    test('omits visually ambiguous characters', () => {
        for (let i = 0; i < 20; i++) {
            expect(generateRecoveryCode()).not.toMatch(/[IO01]/);
        }
    });

    test('generates distinct codes', () => {
        const codes = new Set(Array.from({ length: 50 }, () => generateRecoveryCode()));
        expect(codes.size).toBe(50);
    });

    test('normalizes to comparable form', () => {
        expect(normalizeRecoveryCode('wpln-7k3m')).toBe('WPLN7K3M');
    });
});

describe('PIN format rules', () => {
    test('accepts a reasonable PIN', () => {
        expect(validatePinFormat('4827').valid).toBe(true);
        expect(validatePinFormat('918273').valid).toBe(true);
    });

    test('rejects non-numeric, too short, and too long', () => {
        expect(validatePinFormat('12a4').valid).toBe(false);
        expect(validatePinFormat('123').valid).toBe(false);
        expect(validatePinFormat('1234567890123').valid).toBe(false);
    });

    test('rejects trivially guessable PINs', () => {
        expect(validatePinFormat('1111').valid).toBe(false);
        expect(validatePinFormat('1234').valid).toBe(false);
        expect(validatePinFormat('4321').valid).toBe(false);
    });
});

describe('PIN quick-unlock', () => {
    test('recovers the master password with the right PIN', async () => {
        await enablePin('4827', 'my-master-password');
        const result = await unlockWithPin('4827');
        expect(result.success).toBe(true);
        expect(result.masterPassword).toBe('my-master-password');
    });

    test('rejects the wrong PIN and counts down attempts', async () => {
        await enablePin('4827', 'my-master-password');

        const first = await unlockWithPin('9999');
        expect(first.success).toBe(false);
        expect(first.attemptsRemaining).toBe(MAX_PIN_ATTEMPTS - 1);

        const second = await unlockWithPin('9999');
        expect(second.attemptsRemaining).toBe(MAX_PIN_ATTEMPTS - 2);
    });

    test('destroys the wrapper after too many failures', async () => {
        await enablePin('4827', 'my-master-password');

        for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) {
            await unlockWithPin('9999');
        }

        expect(isPinEnabled()).toBe(false);
        expect(getPinAttemptsRemaining()).toBe(MAX_PIN_ATTEMPTS);

        // Even the correct PIN no longer works — only the master password does.
        const afterLockout = await unlockWithPin('4827');
        expect(afterLockout.success).toBe(false);
        expect(afterLockout.error).toBe('not_enabled');
    });

    test('a successful unlock resets the failure count', async () => {
        await enablePin('4827', 'my-master-password');
        await unlockWithPin('9999');
        await unlockWithPin('9999');
        expect(getPinAttemptsRemaining()).toBe(MAX_PIN_ATTEMPTS - 2);

        await unlockWithPin('4827');
        expect(getPinAttemptsRemaining()).toBe(MAX_PIN_ATTEMPTS);
    });

    test('the PIN wrapper is useless on another device', async () => {
        await enablePin('4827', 'my-master-password');

        // Simulate the stored wrapper being copied to a different machine.
        currentDeviceKey = 'different-machine.other-secret';
        clearDeviceKeyCache();

        const result = await unlockWithPin('4827');
        expect(result.success).toBe(false);
    });

    test('cannot be enabled without a device key', async () => {
        deviceKeyAvailable = false;
        clearDeviceKeyCache();
        await expect(enablePin('4827', 'master-pw')).rejects.toThrow();
    });

    test('reports not_enabled when no PIN is configured', async () => {
        clearPin();
        const result = await unlockWithPin('4827');
        expect(result.success).toBe(false);
        expect(result.error).toBe('not_enabled');
    });

    test('the stored wrapper never contains the master password in clear', async () => {
        await enablePin('4827', 'super-secret-master');
        const stored = localStorage.getItem('planpro_pin_wrapper');
        expect(stored).not.toContain('super-secret-master');
    });
});
