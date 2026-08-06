// Android biometric unlock.
//
// The security property under test: biometric is a *gate*, not a secret. It unwraps a
// device-bound copy of the PIN and then goes through the normal PIN path, so copying
// the vault to another machine must not make biometric usable there.
import { describe, test, expect, beforeEach, mock } from 'bun:test';

// --- Environment stubs -------------------------------------------------------

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
globalThis.window = globalThis;

let currentDeviceKey = 'android-machine-id.install-secret';
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

// This suite is the Android case, so the runtime reports Android.
mock.module('../src/lib/utils/runtime.js', () => ({
    isTauriRuntime: true,
    isAndroidRuntime: () => androidRuntime
}));

let androidRuntime = true;

// Stand-in for @tauri-apps/plugin-biometric.
let biometricAvailable = true;
let authOutcome = 'ok'; // 'ok' | 'cancel' | 'fail'
let authCalls = 0;
let lastAuthReason = '';

mock.module('@tauri-apps/plugin-biometric', () => ({
    checkStatus: async () => ({
        isAvailable: biometricAvailable,
        biometryType: biometricAvailable ? 3 : 0
    }),
    authenticate: async (reason) => {
        authCalls++;
        lastAuthReason = reason;
        if (authOutcome === 'cancel') throw new Error('userCancel: authentication cancelled');
        if (authOutcome === 'fail') throw new Error('authenticationFailed');
    }
}));

const {
    enableDeviceBinding,
    enablePin,
    clearPin,
    unlockWithPin,
    isBiometricSupported,
    getBiometricStatus,
    isBiometricEnabled,
    enableBiometric,
    disableBiometric,
    authenticateBiometric,
    clearDeviceKeyCache,
    MAX_PIN_ATTEMPTS
} = await import('../src/lib/utils/device-auth.js');

const MASTER = 'correct horse battery staple';
const PIN = '246810';

async function freshVaultWithPin() {
    localStorage.clear();
    clearDeviceKeyCache();
    androidRuntime = true;
    biometricAvailable = true;
    authOutcome = 'ok';
    authCalls = 0;
    deviceKeyAvailable = true;
    currentDeviceKey = 'android-machine-id.install-secret';
    await enableDeviceBinding();
    await enablePin(PIN, MASTER);
}

// --- Platform gating ---------------------------------------------------------

describe('platform support', () => {
    beforeEach(async () => {
        await freshVaultWithPin();
    });

    test('is supported on Android when hardware is enrolled', async () => {
        expect(await isBiometricSupported()).toBe(true);
    });

    test('is unsupported on desktop even though Tauri is present', async () => {
        androidRuntime = false;
        expect(await isBiometricSupported()).toBe(false);
    });

    test('reports the reason when the platform is unsupported', async () => {
        androidRuntime = false;
        const status = await getBiometricStatus();
        expect(status.isAvailable).toBe(false);
        expect(status.error).toBe('unsupported_platform');
    });

    test('is unsupported when no biometric is enrolled', async () => {
        biometricAvailable = false;
        expect(await isBiometricSupported()).toBe(false);
    });
});

// --- Enabling ----------------------------------------------------------------

describe('enabling biometric', () => {
    beforeEach(async () => {
        await freshVaultWithPin();
    });

    test('requires a PIN to already exist', async () => {
        clearPin();
        const result = await enableBiometric(PIN);
        expect(result.success).toBe(false);
        expect(result.error).toBe('pin_required');
    });

    test('rejects a PIN that does not open the wrapper', async () => {
        const result = await enableBiometric('999999');
        expect(result.success).toBe(false);
        expect(isBiometricEnabled()).toBe(false);
    });

    test('enables with the correct PIN', async () => {
        const result = await enableBiometric(PIN);
        expect(result.success).toBe(true);
        expect(isBiometricEnabled()).toBe(true);
    });

    test('refuses when the platform cannot do biometric', async () => {
        androidRuntime = false;
        const result = await enableBiometric(PIN);
        expect(result.success).toBe(false);
        expect(result.error).toBe('not_supported');
    });

    test('does not store the PIN in cleartext', async () => {
        await enableBiometric(PIN);
        const dump = JSON.stringify([
            localStorage.getItem('planpro_biometric_pin'),
            localStorage.getItem('planpro_biometric_enabled')
        ]);
        expect(dump.includes(PIN)).toBe(false);
    });
});

// --- Unlocking ---------------------------------------------------------------

describe('unlocking with biometric', () => {
    beforeEach(async () => {
        await freshVaultWithPin();
        await enableBiometric(PIN);
    });

    test('returns the master password after a successful prompt', async () => {
        const result = await authenticateBiometric();
        expect(result.success).toBe(true);
        expect(result.masterPassword).toBe(MASTER);
    });

    test('actually prompts the OS', async () => {
        await authenticateBiometric('解锁密码库');
        expect(authCalls).toBe(1);
        expect(lastAuthReason).toBe('解锁密码库');
    });

    test('reports cancellation distinctly from failure', async () => {
        authOutcome = 'cancel';
        const result = await authenticateBiometric();
        expect(result.success).toBe(false);
        expect(result.error).toBe('cancelled');
    });

    test('reports a failed match', async () => {
        authOutcome = 'fail';
        const result = await authenticateBiometric();
        expect(result.success).toBe(false);
        expect(result.error).toBe('auth_failed');
    });

    test('does not reveal the master password when auth fails', async () => {
        authOutcome = 'fail';
        const result = await authenticateBiometric();
        expect(result.masterPassword).toBeUndefined();
    });

    test('is inert when not enabled', async () => {
        disableBiometric();
        const result = await authenticateBiometric();
        expect(result.success).toBe(false);
        expect(result.error).toBe('not_enabled');
        // Must not even prompt if there is nothing to unwrap.
        expect(authCalls).toBe(0);
    });
});

// --- Device binding of the biometric wrapper ---------------------------------

describe('the biometric wrapper is device-bound', () => {
    beforeEach(async () => {
        await freshVaultWithPin();
        await enableBiometric(PIN);
    });

    test('a copied wrapper is useless on another device', async () => {
        // Same stored bytes, different machine.
        currentDeviceKey = 'different-machine.other-install';
        clearDeviceKeyCache();

        const result = await authenticateBiometric();
        expect(result.success).toBe(false);
        expect(result.masterPassword).toBeUndefined();
    });

    test('a copied wrapper is disabled rather than left dangling', async () => {
        currentDeviceKey = 'different-machine.other-install';
        clearDeviceKeyCache();
        await authenticateBiometric();
        expect(isBiometricEnabled()).toBe(false);
    });

    test('fails closed when the device key cannot be read', async () => {
        deviceKeyAvailable = false;
        clearDeviceKeyCache();
        const result = await authenticateBiometric();
        expect(result.success).toBe(false);
        expect(result.error).toBe('device_key_unavailable');
    });
});

// --- Interaction with PIN lockout --------------------------------------------

describe('PIN lockout also revokes biometric', () => {
    beforeEach(async () => {
        await freshVaultWithPin();
        await enableBiometric(PIN);
    });

    test('exhausting PIN attempts disables biometric too', async () => {
        for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) {
            await unlockWithPin('000000');
        }
        // Otherwise biometric would still hand back a PIN that the lockout was
        // meant to invalidate.
        expect(isBiometricEnabled()).toBe(false);
    });

    test('biometric cannot unlock after PIN lockout', async () => {
        for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) {
            await unlockWithPin('000000');
        }
        const result = await authenticateBiometric();
        expect(result.success).toBe(false);
    });

    test('explicitly clearing the PIN also clears biometric', async () => {
        clearPin();
        expect(isBiometricEnabled()).toBe(false);
    });
});
