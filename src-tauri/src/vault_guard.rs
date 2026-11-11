use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use subtle::ConstantTimeEq;

static VERIFY_BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Default, Deserialize, Serialize)]
pub(crate) struct AttemptState {
    failures: u32,
    next_allowed: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    valid: bool,
    attempted: bool,
    retry_after_ms: u64,
}

struct BusyGuard;
impl Drop for BusyGuard {
    fn drop(&mut self) { VERIFY_BUSY.store(false, Ordering::Release); }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_millis() as u64).unwrap_or(0)
}

pub(crate) fn trusted_origin(url: &url::Url) -> bool {
    let host = url.host_str().unwrap_or("");
    if !url.username().is_empty() || url.password().is_some() { return false; }
    if (url.scheme() == "tauri" && host == "localhost")
        || (matches!(url.scheme(), "http" | "https") && host == "tauri.localhost" && url.port().is_none()) {
        return true;
    }
    cfg!(debug_assertions) && matches!(url.scheme(), "http" | "https")
        && matches!(host, "localhost" | "127.0.0.1" | "[::1]") && url.port() == Some(1420)
}

fn from_hex(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) { return None; }
    value.as_bytes().chunks_exact(2).map(|pair| {
        std::str::from_utf8(pair).ok().and_then(|hex| u8::from_str_radix(hex, 16).ok())
    }).collect()
}

fn verify(password: &str, verifier: &str) -> bool {
    let parts: Vec<_> = verifier.split(':').collect();
    let mut actual = [0u8; 32];
    let expected = match parts.as_slice() {
        ["v2", salt, iterations, hash] => {
            let (Some(salt), Ok(iterations), Some(hash)) = (from_hex(salt), iterations.parse::<u32>(), from_hex(hash)) else { return false; };
            if salt.len() != 16 || !(10_000..=2_000_000).contains(&iterations) || hash.len() != 32 { return false; }
            pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, iterations, &mut actual);
            hash
        }
        [salt, hash] if salt.len() <= 128 => {
            let Some(hash) = from_hex(hash) else { return false; };
            if hash.len() != 32 { return false; }
            // Legacy CryptoJS uses the salt's UTF-8 text, not its hex bytes.
            pbkdf2_hmac::<Sha256>(password.as_bytes(), salt.as_bytes(), 10_000, &mut actual);
            hash
        }
        [hash] => {
            let Some(hash) = from_hex(hash) else { return false; };
            if hash.len() != 32 { return false; }
            actual.copy_from_slice(&Sha256::digest(password.as_bytes()));
            hash
        }
        _ => return false,
    };
    actual.as_slice().ct_eq(&expected).into()
}

fn after_attempt(state: &mut AttemptState, valid: bool, now: u64) {
    if valid {
        state.failures = 0;
        state.next_allowed = 0;
    } else {
        state.failures = state.failures.saturating_add(1);
        let backoff = if state.failures < 5 { 1000 } else {
            30_000u64.saturating_mul(1u64 << ((state.failures - 5) / 5).min(4)).min(300_000)
        };
        state.next_allowed = now.saturating_add(backoff);
    }
}

#[tauri::command]
pub async fn vault_verify_master(webview: tauri::WebviewWindow, password: String) -> Result<Verification, String> {
    if webview.label() != "main" || !trusted_origin(&webview.url().map_err(|e| e.to_string())?) {
        return Err("Untrusted verification origin".into());
    }
    if password.is_empty() || password.len() > 4096 { return Err("Invalid password request".into()); }
    if VERIFY_BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err("Verification already in progress".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = BusyGuard;
        crate::local_db::with_vault_guard(|verifier, state| {
            let now = now_ms();
            if state.next_allowed > now {
                return Ok(Verification { valid: false, attempted: false, retry_after_ms: state.next_allowed - now });
            }
            let valid = verify(&password, verifier);
            after_attempt(state, valid, now_ms());
            Ok(Verification { valid, attempted: true, retry_after_ms: state.next_allowed.saturating_sub(now_ms()) })
        })
    }).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origins_reject_remote_and_spoofed_local_domains() {
        for origin in ["https://attacker.invalid", "https://tauri.localhost.attacker.invalid", "https://user@tauri.localhost", "file:///tmp/x"] {
            assert!(!trusted_origin(&url::Url::parse(origin).unwrap()));
        }
        assert!(trusted_origin(&url::Url::parse("http://tauri.localhost/index.html").unwrap()));
    }

    #[test]
    fn native_verifier_reads_all_existing_formats_and_rejects_invalid_kdf_work() {
        let password = "native-vault-test-master";
        let salt = [3u8; 16];
        let mut hash = [0u8; 32];
        pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, 10_000, &mut hash);
        let hex = |bytes: &[u8]| bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let v2 = format!("v2:{}:10000:{}", hex(&salt), hex(&hash));
        assert!(verify(password, &v2));
        assert!(!verify("incorrect", &v2));
        pbkdf2_hmac::<Sha256>(password.as_bytes(), b"legacy-salt", 10_000, &mut hash);
        assert!(verify(password, &format!("legacy-salt:{}", hex(&hash))));
        assert!(verify(password, &hex(&Sha256::digest(password.as_bytes()))));
        assert!(!verify(password, "v2:bad:4294967295:bad"));
    }

    #[test]
    fn limiter_is_always_on_and_success_resets_only_after_verification() {
        let mut state = AttemptState::default();
        for failure in 1..=50 {
            after_attempt(&mut state, false, 1000);
            assert_eq!(state.failures, failure);
            assert!(state.next_allowed > 1000);
            assert!(state.next_allowed <= 301_000);
            if failure == 5 { assert_eq!(state.next_allowed, 31_000); }
        }
        after_attempt(&mut state, true, 301_000);
        assert_eq!(state.failures, 0);
        assert_eq!(state.next_allowed, 0);
    }
}
