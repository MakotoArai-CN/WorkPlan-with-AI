use crate::update_install::windows_quote as quote;
use crate::update_install::{Installation, Kind};
use base64::Engine;
use serde_json::{json, Value};
use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
    time::Duration,
};

// ProcessStartInfo receives a Windows command-line string, never script source.
fn arguments(installation: &Installation, package: &Path) -> String {
    if installation.kind == Kind::Msi {
        format!(
            "/i {} /passive /norestart REBOOT=ReallySuppress INSTALLDIR={}",
            quote(&package.to_string_lossy()),
            quote(&installation.directory.to_string_lossy())
        )
    } else {
        // NSIS /D must be last, and must not be quoted (even with spaces).
        // /S also skips the language selector; /P alone can still show it.
        format!("/S /UPDATE /D={}", installation.directory.to_string_lossy())
    }
}

pub fn start(
    installation: &Installation,
    package: &Path,
    size: u64,
    digest: &str,
    id: &str,
    version: &str,
    directory: &Path,
) -> Result<(Value, std::path::PathBuf), String> {
    use std::os::windows::process::CommandExt;
    if !matches!(installation.kind, Kind::Nsis | Kind::Msi)
        || (installation.kind == Kind::Nsis && installation.machine_wide)
        || (installation.kind == Kind::Msi && !installation.machine_wide)
    {
        return Err("Unsupported installer scope; use the manual installer".into());
    }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let status = directory.join("last-install.json");
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).map_err(|e| e.to_string())?;
    let nonce: String = nonce.iter().map(|b| format!("{b:02x}")).collect();
    let acknowledgement = directory.join(format!("handoff-{nonce}.ok"));
    let system = std::env::var_os("SystemRoot")
        .map(std::path::PathBuf::from)
        .ok_or("Cannot locate Windows")?;
    let program = if installation.kind == Kind::Msi {
        system.join("System32/msiexec.exe")
    } else {
        package.to_path_buf()
    };
    let configuration = json!({"id":id,"version":version,"parent":std::process::id(),"executable":executable,
        "package":package,"size":size,"digest":digest,"kind":installation.kind,"status":status,
        "program":program,"arguments":arguments(installation,package),"elevate":installation.machine_wide,"ack":acknowledgement});
    // Reusing a verified download after cancel/failure must not read the old
    // receipt as the outcome of the new helper.
    fs::write(&status, json!({"id":id,"state":"preparing"}).to_string())
        .map_err(|e| e.to_string())?;
    let encoded =
        base64::engine::general_purpose::STANDARD.encode(configuration.to_string().as_bytes());
    let script = format!("$config = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded}')))\n{}", include_str!("update_helper.ps1"));
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let encoded_script = base64::engine::general_purpose::STANDARD.encode(bytes);
    let powershell = system.join("System32/WindowsPowerShell/v1.0/powershell.exe");
    // No global execution-policy changes, temporary script, or inherited pipes.
    let mut helper = Command::new(powershell)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &encoded_script,
        ])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    loop {
        if let Some(value) = read_status(&status).filter(|value| value["id"] == id) {
            match value["state"].as_str() {
                Some("started" | "installed") => {
                    return Ok((json!({"opened":true,"exit_required":true}), acknowledgement))
                }
                Some("canceled") => {
                    return Ok((json!({"opened":false,"canceled":true}), acknowledgement))
                }
                Some("failed") => {
                    return Err(value["message"]
                        .as_str()
                        .unwrap_or("Installer failed")
                        .to_string())
                }
                _ => {}
            }
        }
        if helper.try_wait().map_err(|e| e.to_string())?.is_some() {
            return Err("Update helper stopped before installer handoff".into());
        }
        // Keep the app running while the user handles UAC. Do not kill an
        // installer or an authorization prompt on an arbitrary timeout.
        std::thread::sleep(Duration::from_millis(50));
    }
}

pub fn read_status(path: &Path) -> Option<Value> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > 8192 {
        return None;
    }
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

pub fn open_manual(installation: &Installation, package: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let system = std::env::var_os("SystemRoot")
        .map(std::path::PathBuf::from)
        .ok_or("Cannot locate Windows")?;
    let is_msi = package
        .extension()
        .is_some_and(|s| s.eq_ignore_ascii_case("msi"));
    let program = if is_msi {
        system.join("System32/msiexec.exe")
    } else {
        package.to_path_buf()
    };
    let arguments = if is_msi {
        let directory = if installation.kind == Kind::Msi {
            format!(
                " INSTALLDIR={}",
                quote(&installation.directory.to_string_lossy())
            )
        } else {
            String::new()
        };
        format!(
            "/i {} /norestart{directory}",
            quote(&package.to_string_lossy())
        )
    } else if installation.kind == Kind::Nsis {
        format!("/UPDATE /D={}", installation.directory.to_string_lossy())
    } else {
        String::new()
    };
    let config = base64::engine::general_purpose::STANDARD.encode(
        json!({"program":program,"arguments":arguments})
            .to_string()
            .as_bytes(),
    );
    let script = format!("$ErrorActionPreference='Stop'; $c=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{config}'))); $s=New-Object Diagnostics.ProcessStartInfo; $s.FileName=$c.program; $s.Arguments=$c.arguments; $s.UseShellExecute=$true; [Diagnostics.Process]::Start($s) | Out-Null");
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let output = Command::new(system.join("System32/WindowsPowerShell/v1.0/powershell.exe"))
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &base64::engine::general_purpose::STANDARD.encode(bytes),
        ])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err("Windows could not open the installer, or authorization was canceled. Use the saved package and command to retry".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_powershell_helper_rejects_bad_hash_size_and_parent_before_launch() {
        use std::os::windows::process::CommandExt;
        let root = std::env::temp_dir().join(format!(
            "workplan-helper-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let package = root.join("package.exe");
        fs::write(&package, b"test").unwrap();
        let status = root.join("status.json");
        let powershell = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        for case in ["hash", "size", "parent"] {
            let config = json!({"id":case,"version":"0.6.0","parent":std::process::id(),
                "executable":if case=="parent" {root.join("wrong-parent.exe")} else {std::env::current_exe().unwrap()},
                "package":package,"size":if case=="size" {5} else {4},"digest":"0".repeat(64),
                "kind":"nsis","status":status,"ack":root.join("ack"),"program":powershell,
                // Even a regression must not launch an installer or a visible
                // console. The fixture program is harmless and never elevated.
                "arguments":"-NoProfile -NonInteractive -WindowStyle Hidden -Command \"exit 23\"","elevate":false});
            let encoded =
                base64::engine::general_purpose::STANDARD.encode(config.to_string().as_bytes());
            let script = format!("$config=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded}')))\n{}",include_str!("update_helper.ps1"));
            let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
            let output = Command::new(&powershell)
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-EncodedCommand",
                    &base64::engine::general_purpose::STANDARD.encode(bytes),
                ])
                .creation_flags(0x08000000)
                .stdin(Stdio::null())
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            let receipt = read_status(&status).unwrap();
            assert_eq!(receipt["state"], "failed");
            let message = receipt["message"].as_str().unwrap();
            assert!(
                message.contains(match case {
                    "hash" => "SHA-256",
                    "size" => "changed",
                    _ => "parent executable",
                }),
                "{case}: {message}"
            );
            assert_eq!(fs::read(&package).unwrap(), b"test");
            fs::remove_file(&status).unwrap();
        }
        fs::remove_file(package).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn native_installer_arguments_preserve_the_existing_directory_and_do_not_mix_formats() {
        let mut installation = Installation {
            kind: Kind::Msi,
            machine_wide: true,
            directory: "C:\\Program Files\\WorkPlan".into(),
        };
        let args = arguments(&installation, Path::new("C:\\Users\\A B\\update.msi"));
        assert!(args.starts_with("/i \"C:\\Users\\A B\\update.msi\" /passive /norestart"));
        assert!(args.contains("INSTALLDIR=\"C:\\Program Files\\WorkPlan\""));
        assert!(!args.contains("AUTOLAUNCHAPP"));
        installation.kind = Kind::Nsis;
        assert_eq!(
            arguments(&installation, Path::new("C:\\update.exe")),
            "/S /UPDATE /D=C:\\Program Files\\WorkPlan"
        );
        assert_eq!(quote("C:\\Folder\\"), "\"C:\\Folder\\\\\"");
    }
}
