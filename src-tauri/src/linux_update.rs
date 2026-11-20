#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Package {
    Deb,
    Rpm,
    Arch,
}

pub fn package_owner(manager: &str, result: &str) -> Option<Package> {
    if result.trim().lines().count() != 1 {
        return None;
    }
    let owner = match manager {
        "dpkg-query" => result.split_once(": ")?.0.split(':').next()?,
        "rpm" | "pacman" => result.trim(),
        _ => return None,
    }
    .trim()
    .to_ascii_lowercase();
    if !["workplan", "work-plan", "workplan-bin", "workplan-with-ai"].contains(&owner.as_str()) {
        return None;
    }
    match manager {
        "dpkg-query" => Some(Package::Deb),
        "rpm" => Some(Package::Rpm),
        "pacman" => Some(Package::Arch),
        _ => None,
    }
}

#[cfg(target_os = "linux")]
pub fn installed_package() -> Option<Package> {
    use std::{
        io::Read,
        path::Path,
        process::{Command, Stdio},
        sync::OnceLock,
        time::{Duration, Instant},
    };
    static DETECTED: OnceLock<Option<Package>> = OnceLock::new();
    *DETECTED.get_or_init(|| {
        // Do not infer an installation format from distro names or installed
        // tools: only the manager that owns the running executable qualifies.
        // Portable/AppImage installs cannot be converted into distro packages.
        if std::env::var_os("APPIMAGE").is_some() {
            return None;
        }
        let executable = std::env::current_exe().ok()?.canonicalize().ok()?;
        let mut found = Vec::new();
        for (manager, arguments) in [
            ("pacman", vec!["-Qoq"]),
            ("dpkg-query", vec!["-S"]),
            ("rpm", vec!["-qf", "--qf", "%{NAME}"]),
        ] {
            let program = Path::new("/usr/bin").join(manager);
            if !program.is_file() {
                continue;
            }
            let Ok(mut child) = Command::new(program)
                .args(arguments)
                .arg(&executable)
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
            else {
                continue;
            };
            let started = Instant::now();
            let success = loop {
                match child.try_wait() {
                    Ok(Some(status)) => break status.success(),
                    Ok(None) if started.elapsed() < Duration::from_secs(2) => {
                        std::thread::sleep(Duration::from_millis(20))
                    }
                    _ => {
                        let _ = child.kill();
                        let _ = child.wait();
                        break false;
                    }
                }
            };
            if !success {
                continue;
            }
            let mut output = Vec::new();
            if child
                .stdout
                .take()
                .map(|stream| stream.take(8192).read_to_end(&mut output).is_ok())
                != Some(true)
            {
                continue;
            }
            if let Some(package) = package_owner(manager, &String::from_utf8_lossy(&output)) {
                found.push(package);
            }
        }
        if found.len() == 1 {
            found.first().copied()
        } else {
            None
        }
    })
}

pub fn asset_name(version: &str, package: Package) -> String {
    match package {
        Package::Deb => format!("WorkPlan_{version}_amd64.deb"),
        Package::Rpm => format!("WorkPlan-{version}-1.x86_64.rpm"),
        Package::Arch => format!("workplan-bin-{version}-1-x86_64.pkg.tar.zst"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn format_depends_on_the_owner_of_workplan_not_the_distro_name() {
        assert_eq!(
            package_owner("pacman", "workplan-bin\n"),
            Some(Package::Arch)
        );
        assert_eq!(
            package_owner("dpkg-query", "workplan: /usr/bin/workplan\n"),
            Some(Package::Deb)
        );
        assert_eq!(
            package_owner("dpkg-query", "workplan:amd64: /usr/bin/workplan\n"),
            Some(Package::Deb)
        );
        // Tauri publishes the Debian package as `work-plan`, despite the
        // executable being named `workplan` and the asset `WorkPlan_*.deb`.
        assert_eq!(
            package_owner("dpkg-query", "work-plan: /usr/bin/workplan\n"),
            Some(Package::Deb)
        );
        assert_eq!(
            package_owner("dpkg-query", "work-plan:amd64: /usr/bin/workplan\n"),
            Some(Package::Deb)
        );
        assert_eq!(package_owner("rpm", "WorkPlan"), Some(Package::Rpm));
        for (manager, value) in [
            ("pacman", "firefox"),
            ("dpkg-query", "other: /usr/bin/workplan"),
            (
                "dpkg-query",
                "workplan: /usr/bin/workplan\nother: /usr/bin/workplan",
            ),
            ("rpm", "workplan\nother"),
            ("unknown", "workplan"),
        ] {
            assert_eq!(package_owner(manager, value), None);
        }
    }
    #[test]
    fn only_the_three_published_distribution_package_formats_are_selected() {
        assert_eq!(
            asset_name("0.5.27", Package::Arch),
            "workplan-bin-0.5.27-1-x86_64.pkg.tar.zst"
        );
        assert!(asset_name("0.5.27", Package::Deb).ends_with("_amd64.deb"));
        assert!(asset_name("0.5.27", Package::Rpm).ends_with(".x86_64.rpm"));
        for package in [Package::Deb, Package::Rpm, Package::Arch] {
            assert!(!asset_name("0.5.27", package).contains("AppImage"));
        }
    }
}
