//! Device-bound secret used to harden the password vault.
//!
//! The vault key is derived from the master password *and* a per-device secret, so a
//! copied `localStorage` is useless on another machine even if the master password is
//! known. Two ingredients are combined:
//!
//! 1. A stable OS-level machine identifier (registry GUID, `/etc/machine-id`, …).
//! 2. A random per-install secret stored in the app data directory.
//!
//! The random half matters: OS identifiers are not secrets — they can be read by any
//! process and are sometimes cloned across VM images — so alone they would bind the
//! vault to a *known* value rather than an unknown one. The random half makes the
//! result unpredictable; the OS half makes it fail closed when data is copied to a
//! different machine whose install secret happens to travel with it.

use base64::Engine;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

const INSTALL_SECRET_FILE: &str = ".device-key";

/// Stable machine identifier, or `None` when the platform cannot provide one.
fn os_machine_id() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        // KEY_WOW64_64KEY: the value lives in the 64-bit view, and a 32-bit build
        // would otherwise be redirected to a different (missing) key.
        hklm.open_subkey_with_flags(
            r"SOFTWARE\Microsoft\Cryptography",
            KEY_READ | KEY_WOW64_64KEY,
        )
        .ok()
        .and_then(|key| key.get_value::<String, _>("MachineGuid").ok())
        .map(|guid| guid.trim().to_string())
        .filter(|guid| !guid.is_empty())
    }

    #[cfg(target_os = "linux")]
    {
        for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
            if let Ok(value) = fs::read_to_string(path) {
                let trimmed = value.trim().to_string();
                if !trimmed.is_empty() {
                    return Some(trimmed);
                }
            }
        }
        None
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        let output = Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        text.lines()
            .find(|line| line.contains("IOPlatformUUID"))
            .and_then(|line| line.split('"').nth(3))
            .map(|uuid| uuid.trim().to_string())
            .filter(|uuid| !uuid.is_empty())
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        // Mobile sandboxes already isolate app data per install, and the random
        // install secret below carries the binding there.
        None
    }
}

fn install_secret_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {}", e))?;
    Ok(dir.join(INSTALL_SECRET_FILE))
}

/// Read the per-install random secret, creating it on first use.
fn install_secret(app: &tauri::AppHandle) -> Result<String, String> {
    let path = install_secret_path(app)?;

    if let Ok(existing) = fs::read_to_string(&path) {
        let trimmed = existing.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(trimmed);
        }
    }

    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("生成设备密钥失败: {}", e))?;
    let secret = base64::engine::general_purpose::STANDARD_NO_PAD.encode(bytes);

    fs::write(&path, &secret).map_err(|e| format!("写入设备密钥失败: {}", e))?;
    restrict_permissions(&path);

    Ok(secret)
}

/// Best-effort tightening of file permissions on the install secret.
fn restrict_permissions(path: &PathBuf) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

/// Opaque per-device secret handed to the frontend for key derivation.
///
/// This value never leaves the machine: it is mixed into PBKDF2 alongside the master
/// password and is not persisted anywhere the vault data is stored.
#[tauri::command]
pub fn get_device_key(app: tauri::AppHandle) -> Result<String, String> {
    let install = install_secret(&app)?;
    match os_machine_id() {
        Some(machine) => Ok(format!("{}.{}", machine, install)),
        None => Ok(install),
    }
}

/// Replace the install secret, used when rebinding a vault via its recovery code.
#[tauri::command]
pub fn reset_device_key(app: tauri::AppHandle) -> Result<String, String> {
    let path = install_secret_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("重置设备密钥失败: {}", e))?;
    }
    get_device_key(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_machine_id_is_stable_across_calls() {
        // Either the platform provides an identifier or it does not, but it must not
        // change between calls — an unstable value would lock users out at random.
        assert_eq!(os_machine_id(), os_machine_id());
    }

    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    #[test]
    fn desktop_platforms_expose_a_machine_id() {
        let id = os_machine_id();
        assert!(id.is_some(), "desktop platforms should provide a machine id");
        assert!(!id.unwrap().trim().is_empty());
    }
}
