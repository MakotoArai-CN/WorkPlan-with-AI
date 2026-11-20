//! Installation-specific update policy. No URLs, commands or destination paths
//! supplied by the webview are accepted by the installer entry point.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Nsis,
    Msi,
    Deb,
    Rpm,
    Arch,
    Appimage,
    Dmg,
    Apk,
    #[default]
    Unknown,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Installation {
    pub kind: Kind,
    pub machine_wide: bool,
    #[serde(skip_serializing)]
    pub directory: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
pub struct Plan {
    pub kind: Kind,
    pub automatic: bool,
    pub requires_exit: bool,
    pub manual_command: String,
    pub saved_path: String,
}

pub fn detect() -> Installation {
    #[cfg(target_os = "windows")]
    {
        return windows::detect();
    }
    #[cfg(target_os = "linux")]
    {
        use crate::linux_update::{installed_package, Package};
        let kind = match installed_package() {
            Some(Package::Deb) => Kind::Deb,
            Some(Package::Rpm) => Kind::Rpm,
            Some(Package::Arch) => Kind::Arch,
            None if appimage_path().is_some() => Kind::Appimage,
            _ => Kind::Unknown,
        };
        return Installation {
            kind,
            ..Default::default()
        };
    }
    #[cfg(target_os = "macos")]
    {
        return Installation {
            kind: Kind::Dmg,
            ..Default::default()
        };
    }
    #[cfg(target_os = "android")]
    {
        return Installation {
            kind: Kind::Apk,
            ..Default::default()
        };
    }
    #[allow(unreachable_code)]
    Installation::default()
}

pub fn matches_package(kind: &Kind, name: &str) -> bool {
    match kind {
        Kind::Nsis => name.ends_with("-setup.exe"),
        Kind::Msi => name.ends_with(".msi"),
        Kind::Deb => name.ends_with(".deb"),
        Kind::Rpm => name.ends_with(".rpm"),
        Kind::Arch => name.ends_with(".pkg.tar.zst"),
        Kind::Appimage => name.ends_with(".AppImage"),
        Kind::Dmg => name.ends_with(".dmg"),
        Kind::Apk => name.ends_with(".apk"),
        Kind::Unknown => false,
    }
}

fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub fn windows_quote(value: &str) -> String {
    format!(
        "\"{}{}\"",
        value,
        "\\".repeat(value.chars().rev().take_while(|c| *c == '\\').count())
    )
}

pub fn plan(installation: &Installation, name: &str, path: &Path) -> Plan {
    let value = path.to_string_lossy();
    let matched = matches_package(&installation.kind, name);
    let command = match installation.kind {
        Kind::Nsis | Kind::Msi | Kind::Unknown if cfg!(target_os = "windows") => {
            // A manual installer retains its wizard; never silently convert an
            // unidentified/portable copy into an MSI or NSIS installation.
            if name.ends_with(".msi") {
                let directory = if matched { format!(" INSTALLDIR={}",windows_quote(&installation.directory.to_string_lossy())) } else { String::new() };
                let arguments = format!("/i {} /norestart{directory}",windows_quote(&value));
                format!("Start-Process -FilePath msiexec.exe -ArgumentList {} -Wait",ps_quote(&arguments))
            } else if matched && installation.kind == Kind::Nsis {
                format!(
                    "Start-Process -FilePath {} -ArgumentList {} -Wait",
                    ps_quote(&value),
                    ps_quote(&format!(
                        "/UPDATE /D={}",
                        installation.directory.to_string_lossy()
                    ))
                )
            } else {
                format!("Start-Process -FilePath {} -Wait", ps_quote(&value))
            }
        }
        Kind::Deb => format!(
            "sudo {} {}",
            if Path::new("/usr/bin/apt-get").is_file() {
                "apt-get install --"
            } else {
                "dpkg -i --"
            },
            sh_quote(&value)
        ),
        Kind::Rpm => format!(
            "sudo {} {}",
            if Path::new("/usr/bin/dnf").is_file() {
                "dnf install --"
            } else {
                "rpm -U --"
            },
            sh_quote(&value)
        ),
        Kind::Arch => format!("sudo pacman -U -- {}", sh_quote(&value)),
        Kind::Appimage => appimage_path()
            .map(|target| {
                // GNU install reads the whole source before the atomic rename;
                // mv is on the destination filesystem, including Downloads on a
                // different mount. Do not truncate the running AppImage in place.
                let target = target.to_string_lossy();
                let temporary = Path::new(target.as_ref()).parent().unwrap_or_else(||Path::new(".")).join(".workplan-update.XXXXXXXXXX");
                let prefix = if appimage_writable(Path::new(target.as_ref())) {
                    ""
                } else {
                    "sudo "
                };
                format!(
                    "( workplan_update=$({prefix}mktemp {}) && {prefix}install -m 755 -- {} \"$workplan_update\" && {prefix}mv -f -- \"$workplan_update\" {} )",
                    sh_quote(&temporary.to_string_lossy()),
                    sh_quote(&value),
                    sh_quote(&target)
                )
            })
            .unwrap_or_else(|| format!("chmod +x -- {} && {}", sh_quote(&value), sh_quote(&value))),
        Kind::Dmg => format!("open {}", sh_quote(&value)),
        _ => String::new(),
    };
    let automatic = matched
        && match installation.kind {
            Kind::Nsis => cfg!(target_os = "windows") && !installation.machine_wide,
            Kind::Msi => cfg!(target_os = "windows") && installation.machine_wide,
            Kind::Deb | Kind::Rpm | Kind::Arch => {
                linux_command(&installation.kind, path).is_some() && linux_helper_available()
            }
            Kind::Appimage => appimage_path().is_some_and(|p| appimage_writable(&p)),
            Kind::Dmg | Kind::Apk => true, // open/OS-confirmed handoff, not installed
            _ => false,
        };
    Plan {
        kind: installation.kind.clone(),
        automatic,
        requires_exit: matched && matches!(installation.kind, Kind::Nsis | Kind::Msi),
        manual_command: command,
        saved_path: value.into_owned(),
    }
}

fn linux_helper_available() -> bool {
    [
        "/usr/bin/pkexec",
        "/bin/sh",
        "/usr/bin/dd",
        "/usr/bin/sha256sum",
        "/usr/bin/mktemp",
        "/usr/bin/wc",
        "/usr/bin/chmod",
        "/usr/bin/rm",
        "/usr/bin/rmdir",
    ]
    .iter()
    .all(|p| Path::new(p).is_file())
}

fn appimage_writable(path: &Path) -> bool {
    #[cfg(target_os = "linux")]
    {
        path.parent().is_some_and(|parent| {
            std::process::Command::new("/usr/bin/test")
                .arg("-w")
                .arg(parent)
                .status()
                .is_ok_and(|s| s.success())
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        false
    }
}

pub fn linux_command(kind: &Kind, package: &Path) -> Option<(PathBuf, Vec<String>)> {
    let candidates: &[(&str, &[&str])] = match kind {
        Kind::Deb => &[
            ("/usr/bin/apt-get", &["--assume-yes", "install", "--"]),
            ("/usr/bin/dpkg", &["-i", "--"]),
        ],
        Kind::Rpm => &[
            ("/usr/bin/dnf", &["--assumeyes", "install", "--"]),
            ("/usr/bin/rpm", &["-U", "--"]),
        ],
        Kind::Arch => &[("/usr/bin/pacman", &["--noconfirm", "-U", "--"])],
        _ => return None,
    };
    let (program, args) = candidates.iter().find(|(p, _)| Path::new(p).is_file())?;
    let mut args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    args.push(package.to_string_lossy().into_owned());
    Some((PathBuf::from(program), args))
}

pub fn appimage_path() -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        let original = PathBuf::from(std::env::var_os("APPIMAGE")?);
        let mount = PathBuf::from(std::env::var_os("APPDIR")?)
            .canonicalize()
            .ok()?;
        if !std::env::current_exe()
            .ok()?
            .canonicalize()
            .ok()?
            .starts_with(mount)
            || !original.is_absolute()
        {
            return None;
        }
        let metadata = std::fs::symlink_metadata(&original).ok()?;
        if metadata.is_file() && !metadata.file_type().is_symlink() {
            return Some(original);
        }
    }
    None
}

#[cfg(target_os = "windows")]
pub mod windows {
    use super::*;
    use winreg::{enums::*, RegKey};
    fn same_directory(value: &str, current: &Path) -> bool {
        let path = PathBuf::from(value.trim().trim_matches('"'));
        path.is_absolute()
            && path
                .canonicalize()
                .ok()
                .zip(current.canonicalize().ok())
                .is_some_and(|(a, b)| {
                    a.to_string_lossy()
                        .eq_ignore_ascii_case(&b.to_string_lossy())
                })
    }
    pub fn detect() -> Installation {
        let Ok(exe) = std::env::current_exe() else {
            return Installation::default();
        };
        let Some(directory) = exe.parent() else {
            return Installation::default();
        };
        let mut found = Vec::new();
        for (hive, machine_wide) in [(HKEY_CURRENT_USER, false), (HKEY_LOCAL_MACHINE, true)] {
            for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
                let root = RegKey::predef(hive);
                let Ok(uninstall) = root.open_subkey_with_flags(
                    r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
                    KEY_READ | view,
                ) else {
                    continue;
                };
                for key in uninstall.enum_keys().flatten() {
                    let Ok(entry) = uninstall.open_subkey_with_flags(&key, KEY_READ | view) else {
                        continue;
                    };
                    if entry.get_value::<String, _>("DisplayName").ok().as_deref()
                        != Some("WorkPlan")
                    {
                        continue;
                    }
                    let location = entry
                        .get_value::<String, _>("InstallLocation")
                        .unwrap_or_default();
                    if !same_directory(&location, directory) {
                        continue;
                    }
                    let kind = if entry.get_value::<u32, _>("WindowsInstaller").ok() == Some(1)
                        && key.starts_with('{')
                        && key.ends_with('}')
                    {
                        Kind::Msi
                    } else if key == "WorkPlan"
                        && entry
                            .get_value::<String, _>("MainBinaryName")
                            .ok()
                            .is_some_and(|name| {
                                exe.file_name().is_some_and(|file| {
                                    file.to_string_lossy().eq_ignore_ascii_case(&name)
                                })
                            })
                        && directory.join("uninstall.exe").is_file()
                    {
                        Kind::Nsis
                    } else {
                        continue;
                    };
                    if !found
                        .iter()
                        .any(|i: &Installation| i.kind == kind && i.machine_wide == machine_wide)
                    {
                        found.push(Installation {
                            kind,
                            directory: directory.to_path_buf(),
                            machine_wide,
                        });
                    }
                }
            }
        }
        if found.len() == 1 {
            found.remove(0)
        } else {
            Installation::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installation_and_asset_must_agree() {
        for (kind, name) in [
            (Kind::Nsis, "WorkPlan_0.6.0_x64-setup.exe"),
            (Kind::Msi, "WorkPlan_0.6.0_x64_en-US.msi"),
            (Kind::Deb, "WorkPlan_0.6.0_amd64.deb"),
            (Kind::Rpm, "WorkPlan-0.6.0-1.x86_64.rpm"),
            (Kind::Arch, "workplan-bin-0.6.0-1-x86_64.pkg.tar.zst"),
            (Kind::Appimage, "WorkPlan_0.6.0_amd64.AppImage"),
        ] {
            assert!(matches_package(&kind, name));
            assert!(!matches_package(&Kind::Unknown, name));
        }
        assert!(!matches_package(&Kind::Msi, "WorkPlan_0.6.0_x64-setup.exe"));
        assert!(!matches_package(
            &Kind::Nsis,
            "WorkPlan_0.6.0_x64_en-US.msi"
        ));
    }
    #[test]
    fn manual_commands_quote_paths_as_data() {
        assert_eq!(sh_quote("/a'b/$()/file.deb"), "'/a'\\''b/$()/file.deb'");
        assert_eq!(ps_quote("C:\\a'b\\x.exe"), "'C:\\a''b\\x.exe'");
        let plan = plan(
            &Installation {
                kind: Kind::Arch,
                ..Default::default()
            },
            "a.pkg.tar.zst",
            Path::new("/tmp/a'b;$(echo no).pkg.tar.zst"),
        );
        assert_eq!(
            plan.manual_command,
            "sudo pacman -U -- '/tmp/a'\\''b;$(echo no).pkg.tar.zst'"
        );
        assert!(!plan.requires_exit);
    }
}
