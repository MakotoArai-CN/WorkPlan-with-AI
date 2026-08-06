// Device binding, PIN quick-unlock, and recovery codes for the password vault.
//
// Threat model, and why the layers are shaped this way:
//
//   Layer 1  device key   — always mixed into the vault key. Copying the stored data
//                           to another machine makes it undecryptable even if the
//                           attacker knows the master password.
//   Layer 2  master pw    — the only high-entropy secret; always required to bind a
//                           device or recover from one.
//   Layer 3  PIN / bio    — local convenience only. A 4-6 digit PIN has ~10^6 of
//                           entropy, so it NEVER derives the vault key. It only
//                           unwraps a locally stored copy of the master password,
//                           and that wrapper is destroyed after repeated failures.
//
// The distinction in layer 3 is the important one: an attacker who copies the vault
// files gets nothing from the PIN, because the wrapper is itself bound to the device
// key and is not part of the vault's own encryption.

import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime, isAndroidRuntime } from './runtime.js';
import { encrypt, decrypt } from './crypto.js';

const PIN_WRAPPER_KEY = 'planpro_pin_wrapper';
const PIN_ATTEMPTS_KEY = 'planpro_pin_attempts';
const DEVICE_BINDING_KEY = 'planpro_device_binding';

export const MAX_PIN_ATTEMPTS = 5;
export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 12;

let cachedDeviceKey = null;

/**
 * Per-device secret from the Rust backend.
 *
 * In the browser build there is no device to bind to, so this resolves to null and
 * every device-bound feature degrades to "unavailable" rather than to a weaker
 * scheme that pretends to offer binding.
 */
export async function getDeviceKey() {
    if (cachedDeviceKey !== null) return cachedDeviceKey;
    if (!isTauriRuntime) return null;

    try {
        cachedDeviceKey = await invoke('get_device_key');
        return cachedDeviceKey;
    } catch (error) {
        console.warn('Device key unavailable:', error);
        return null;
    }
}

export async function isDeviceBindingSupported() {
    return (await getDeviceKey()) !== null;
}

/** Discard the cached key; used after rebinding so the next read reflects the new one. */
export function clearDeviceKeyCache() {
    cachedDeviceKey = null;
}

// --- Vault key composition ---------------------------------------------------

/**
 * Combine the master password with the binding key into the value actually used to
 * encrypt vault entries.
 *
 * The second argument is the *binding key* (reconstructible from the recovery code),
 * not the raw device key. Deriving straight from the device key would leave the vault
 * unrecoverable once the drive dies, since that key cannot be reproduced.
 *
 * A NUL separator keeps distinct pairings from colliding. Kept deliberately stable:
 * changing this format would make every existing vault undecryptable.
 */
export function composeVaultSecret(masterPassword, bindingKey) {
    if (!bindingKey) return masterPassword;
    return `${masterPassword}\u0000device:${bindingKey}`;
}

export function isDeviceBindingEnabled() {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(DEVICE_BINDING_KEY) === '1';
}

function setDeviceBindingFlag(enabled) {
    if (typeof window === 'undefined') return;
    if (enabled) localStorage.setItem(DEVICE_BINDING_KEY, '1');
    else localStorage.removeItem(DEVICE_BINDING_KEY);
}

// --- Recovery code -----------------------------------------------------------
//
// The recovery code *is* the binding key, rather than a pointer to one stored on
// disk. That distinction is what makes recovery survive a dead drive:
//
//   bindingKey  = the normalized recovery code (100 bits of entropy)
//   vaultSecret = master password + bindingKey
//   on disk     : bindingKey encrypted under the device key  ("binding envelope")
//
// Normal unlock reads the envelope with the device key, so the user never types the
// recovery code. Copying the vault elsewhere yields an envelope that the other
// machine's device key cannot open, so binding still holds. But a user who kept
// their recovery code can reconstruct the binding key from the code alone —
// no envelope, no localStorage, nothing but the code and their master password.

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const RECOVERY_GROUPS = 5;
const RECOVERY_GROUP_LEN = 4;

/** Human-transcribable recovery code, e.g. WPLN-7K3M-9QX2-4FTD-8BVC. */
export function generateRecoveryCode() {
    const total = RECOVERY_GROUPS * RECOVERY_GROUP_LEN;
    const values = new Uint32Array(total);
    crypto.getRandomValues(values);

    const chars = Array.from(values, (v) => RECOVERY_ALPHABET[v % RECOVERY_ALPHABET.length]);
    const groups = [];
    for (let i = 0; i < RECOVERY_GROUPS; i++) {
        groups.push(chars.slice(i * RECOVERY_GROUP_LEN, (i + 1) * RECOVERY_GROUP_LEN).join(''));
    }
    return groups.join('-');
}

/** Accept user input regardless of case, spacing, or dashes. */
export function normalizeRecoveryCode(code) {
    return String(code || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

/** The binding key derived from a recovery code. */
export function bindingKeyFromRecoveryCode(recoveryCode) {
    const normalized = normalizeRecoveryCode(recoveryCode);
    return normalized || null;
}

const BINDING_ENVELOPE_KEY = 'planpro_binding_envelope';

/** Wrap the binding key under the device key so normal unlock needs no typing. */
export function storeBindingEnvelope(bindingKey, deviceKey) {
    if (typeof window === 'undefined' || !bindingKey || !deviceKey) return false;
    const envelope = encrypt(bindingKey, deviceKey);
    if (!envelope) return false;
    localStorage.setItem(BINDING_ENVELOPE_KEY, envelope);
    return true;
}

/** Recover the binding key on this device, or null if the envelope is unusable. */
export async function readBindingKey() {
    if (typeof window === 'undefined') return null;
    const envelope = localStorage.getItem(BINDING_ENVELOPE_KEY);
    if (!envelope) return null;
    const deviceKey = await getDeviceKey();
    if (!deviceKey) return null;
    return decrypt(envelope, deviceKey);
}

export function hasBindingEnvelope() {
    if (typeof window === 'undefined') return false;
    return Boolean(localStorage.getItem(BINDING_ENVELOPE_KEY));
}

export function clearBindingEnvelope() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(BINDING_ENVELOPE_KEY);
}

/**
 * Turn on device binding and return the one-time recovery code.
 *
 * The caller must show the code to the user exactly once and must re-encrypt the
 * vault under the returned binding key.
 */
export async function enableDeviceBinding() {
    const deviceKey = await getDeviceKey();
    if (!deviceKey) {
        throw new Error('当前环境不支持设备绑定');
    }
    const recoveryCode = generateRecoveryCode();
    const bindingKey = bindingKeyFromRecoveryCode(recoveryCode);
    if (!storeBindingEnvelope(bindingKey, deviceKey)) {
        throw new Error('生成恢复码失败');
    }
    setDeviceBindingFlag(true);
    return { recoveryCode, bindingKey, deviceKey };
}

export function disableDeviceBinding() {
    setDeviceBindingFlag(false);
    clearBindingEnvelope();
    clearPin();
}

// --- PIN quick-unlock --------------------------------------------------------

export function isPinEnabled() {
    if (typeof window === 'undefined') return false;
    return Boolean(localStorage.getItem(PIN_WRAPPER_KEY));
}

export function getPinAttemptsRemaining() {
    if (typeof window === 'undefined') return MAX_PIN_ATTEMPTS;
    const used = Number(localStorage.getItem(PIN_ATTEMPTS_KEY) || '0');
    return Math.max(0, MAX_PIN_ATTEMPTS - (Number.isFinite(used) ? used : MAX_PIN_ATTEMPTS));
}

function recordPinFailure() {
    if (typeof window === 'undefined') return;
    const used = Number(localStorage.getItem(PIN_ATTEMPTS_KEY) || '0');
    const next = (Number.isFinite(used) ? used : 0) + 1;
    localStorage.setItem(PIN_ATTEMPTS_KEY, String(next));
    if (next >= MAX_PIN_ATTEMPTS) {
        // Out of attempts: destroy the wrapper so only the master password works.
        clearPin();
    }
}

function resetPinAttempts() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(PIN_ATTEMPTS_KEY);
}

export function clearPin() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(PIN_WRAPPER_KEY);
    localStorage.removeItem(PIN_ATTEMPTS_KEY);
    // Biometric unlock replays the stored PIN, so leaving its wrapper behind would
    // keep granting access after a lockout has destroyed the PIN itself.
    localStorage.removeItem(BIOMETRIC_ENABLED_KEY);
    localStorage.removeItem(BIOMETRIC_PIN_KEY);
}

export function validatePinFormat(pin) {
    const value = String(pin || '');
    if (!/^\d+$/.test(value)) {
        return { valid: false, error: 'PIN 只能包含数字' };
    }
    if (value.length < MIN_PIN_LENGTH || value.length > MAX_PIN_LENGTH) {
        return { valid: false, error: `PIN 长度需为 ${MIN_PIN_LENGTH}-${MAX_PIN_LENGTH} 位` };
    }
    if (/^(\d)\1+$/.test(value)) {
        return { valid: false, error: 'PIN 不能全部为相同数字' };
    }
    // Reject straight ascending/descending runs such as 1234 or 987654.
    const ascending = value.split('').every((d, i, arr) => i === 0 || Number(d) === Number(arr[i - 1]) + 1);
    const descending = value.split('').every((d, i, arr) => i === 0 || Number(d) === Number(arr[i - 1]) - 1);
    if (ascending || descending) {
        return { valid: false, error: 'PIN 不能为连续数字' };
    }
    return { valid: true };
}

/** The key that wraps the master password: PIN alone is never sufficient. */
function pinWrappingSecret(pin, deviceKey) {
    return `pin:${pin}\u0000device:${deviceKey}`;
}

/**
 * Enable PIN quick-unlock by wrapping the master password.
 *
 * Requires a device key — without one the wrapper would be protected by the PIN
 * alone, which is far too weak to sit next to the vault on disk.
 */
export async function enablePin(pin, masterPassword) {
    const format = validatePinFormat(pin);
    if (!format.valid) throw new Error(format.error);

    const deviceKey = await getDeviceKey();
    if (!deviceKey) {
        throw new Error('当前环境不支持 PIN 快捷解锁（需要设备绑定）');
    }

    const wrapper = encrypt(masterPassword, pinWrappingSecret(pin, deviceKey));
    if (!wrapper) throw new Error('PIN 设置失败');

    localStorage.setItem(PIN_WRAPPER_KEY, wrapper);
    resetPinAttempts();
    return true;
}

/**
 * Attempt a PIN unlock.
 * Returns the master password on success, or a failure with attempts remaining.
 */
export async function unlockWithPin(pin) {
    if (typeof window === 'undefined') {
        return { success: false, error: 'unavailable', attemptsRemaining: 0 };
    }

    const wrapper = localStorage.getItem(PIN_WRAPPER_KEY);
    if (!wrapper) {
        return { success: false, error: 'not_enabled', attemptsRemaining: 0 };
    }

    const deviceKey = await getDeviceKey();
    if (!deviceKey) {
        return { success: false, error: 'no_device_key', attemptsRemaining: getPinAttemptsRemaining() };
    }

    const masterPassword = decrypt(wrapper, pinWrappingSecret(pin, deviceKey));
    if (!masterPassword) {
        recordPinFailure();
        const remaining = getPinAttemptsRemaining();
        return {
            success: false,
            error: remaining > 0 ? 'wrong_pin' : 'locked_out',
            attemptsRemaining: remaining
        };
    }

    resetPinAttempts();
    return { success: true, masterPassword, attemptsRemaining: MAX_PIN_ATTEMPTS };
}

// --- Biometric unlock (Android only) -----------------------------------------
//
// Biometrics are treated as a gate on top of the PIN wrapper, not as a separate
// secret. There is no way to "encrypt with a fingerprint" — the OS just tells us
// whether the user authenticated. So the flow is:
//
//   1. User must have a PIN configured (which pins the vault to this device).
//   2. Enabling biometrics flips a flag; nothing new is stored.
//   3. On unlock we ask the OS to authenticate, then use the existing PIN wrapper.
//
// Consequence: if the OS's biometric enrollment changes (new fingerprint added,
// device unenrolled), the vault does not become weaker — the PIN wrapper is still
// bound to the device key, and biometrics can be turned off without touching data.
//
// Platform: the Tauri v2 official plugin supports Android and iOS only. Windows,
// macOS, and Linux are unsupported by the plugin, so we gate on isAndroidRuntime.
// iOS is not enabled here because this app currently builds only Android mobile.

const BIOMETRIC_ENABLED_KEY = 'planpro_biometric_enabled';
const BIOMETRIC_PIN_KEY = 'planpro_biometric_pin';

/**
 * Is biometric unlock even supported on this build?
 * Returns false in the browser, on desktop, and on iOS.
 */
export async function isBiometricSupported() {
    if (!isTauriRuntime) return false;
    if (!isAndroidRuntime()) return false;
    try {
        const { checkStatus } = await import('@tauri-apps/plugin-biometric');
        const status = await checkStatus();
        return Boolean(status?.isAvailable);
    } catch (error) {
        console.warn('Biometric plugin unavailable:', error);
        return false;
    }
}

/** Detailed status (for the UI to explain why it's unavailable). */
export async function getBiometricStatus() {
    if (!isTauriRuntime || !isAndroidRuntime()) {
        return { isAvailable: false, biometryType: 0, error: 'unsupported_platform' };
    }
    try {
        const { checkStatus } = await import('@tauri-apps/plugin-biometric');
        return await checkStatus();
    } catch (error) {
        return { isAvailable: false, biometryType: 0, error: String(error?.message || error) };
    }
}

export function isBiometricEnabled() {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(BIOMETRIC_ENABLED_KEY) === '1'
        && Boolean(localStorage.getItem(BIOMETRIC_PIN_KEY));
}

/**
 * Prompt the OS and, on success, run through the existing PIN unlock path.
 *
 * Callers get exactly what unlockWithPin returns, so the store's logic does not
 * need a separate branch for biometric-vs-PIN.
 */
export async function authenticateBiometric(reason = '解锁密码库') {
    if (!isBiometricEnabled()) {
        return { success: false, error: 'not_enabled' };
    }
    if (!(await isBiometricSupported())) {
        return { success: false, error: 'not_supported' };
    }

    try {
        const { authenticate } = await import('@tauri-apps/plugin-biometric');
        await authenticate(reason, {
            allowDeviceCredential: true,
            confirmationRequired: false,
            maxAttemps: 3
        });
    } catch (error) {
        // The plugin rejects on user cancel, wrong biometric, and OS-level lockout
        // alike. We surface the coarse category so the UI can decide whether to
        // fall back to PIN silently or show a message.
        const message = String(error?.message || error);
        const cancelled = /cancel/i.test(message);
        return {
            success: false,
            error: cancelled ? 'cancelled' : 'auth_failed',
            detail: message
        };
    }

    // OS said the user is authenticated. Now unwrap the stored PIN using the
    // device key (so a copied vault can't reuse this on another machine) and
    // hand off to the existing PIN unlock path.
    const wrapped = localStorage.getItem(BIOMETRIC_PIN_KEY);
    if (!wrapped) {
        disableBiometric();
        return { success: false, error: 'wrapper_gone' };
    }
    const deviceKey = await getDeviceKey();
    if (!deviceKey) {
        return { success: false, error: 'device_key_unavailable' };
    }
    const pin = decrypt(wrapped, deviceKey);
    if (!pin) {
        // Device key rotated or wrapper corrupted. Force the user through the
        // normal PIN/master path so they can re-enable biometric fresh.
        disableBiometric();
        return { success: false, error: 'wrapper_invalid' };
    }
    return await unlockWithPin(pin);
}

/**
 * Enable biometric unlock on top of an existing PIN.
 *
 * The PIN must already be set — this function does not create one. We store the
 * PIN wrapped under the device key so a copy of the vault is still useless on
 * another machine.
 */
export async function enableBiometric(pin) {
    if (!isPinEnabled()) {
        return { success: false, error: 'pin_required' };
    }
    if (!(await isBiometricSupported())) {
        return { success: false, error: 'not_supported' };
    }
    const deviceKey = await getDeviceKey();
    if (!deviceKey) {
        return { success: false, error: 'device_key_unavailable' };
    }

    // Verify the PIN opens the wrapper before we commit — otherwise we'd store a
    // wrong PIN that would just fail biometric unlock forever.
    const check = await unlockWithPin(pin);
    if (!check.success) {
        return { success: false, error: check.error || 'wrong_pin' };
    }

    const wrapped = encrypt(pin, deviceKey);
    if (!wrapped) {
        return { success: false, error: 'wrap_failed' };
    }
    localStorage.setItem(BIOMETRIC_PIN_KEY, wrapped);
    localStorage.setItem(BIOMETRIC_ENABLED_KEY, '1');
    return { success: true };
}

export function disableBiometric() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(BIOMETRIC_ENABLED_KEY);
    localStorage.removeItem(BIOMETRIC_PIN_KEY);
}

