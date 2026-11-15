use std::{
    fs, io,
    path::{Path, PathBuf},
};

pub fn publish_without_overwrite(
    partial: &Path,
    directory: &Path,
    name: &str,
    check: impl Fn() -> io::Result<()>,
) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err("Invalid package filename".into());
    }
    for index in 0..1000 {
        check().map_err(|error| error.to_string())?;
        let filename = if index == 0 {
            name.to_string()
        } else {
            let path = Path::new(name);
            let stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .ok_or("Invalid package name")?;
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            format!("{stem} ({index}).{extension}")
        };
        let destination = directory.join(filename);
        // Both paths are on the Downloads filesystem. An existing file or
        // symlink is never replaced; only the verified staged inode is linked.
        match fs::hard_link(partial, &destination) {
            Ok(()) => {
                let _ = fs::remove_file(partial);
                return Ok(destination);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => match copy_without_overwrite(partial, &destination, &check) {
                Ok(()) => {
                    let _ = fs::remove_file(partial);
                    return Ok(destination);
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(format!(
                        "Cannot save verified package in Downloads: {error}"
                    ))
                }
            },
        }
    }
    Err("Too many packages with the same name in Downloads".into())
}

// Some Downloads locations (e.g. removable FAT/exFAT storage) cannot hard-link.
// create_new still protects existing files and symlinks; a copy error removes
// only the newly created destination, never an existing user's package.
fn copy_without_overwrite(
    source: &Path,
    destination: &Path,
    check: &impl Fn() -> io::Result<()>,
) -> io::Result<()> {
    use io::{Read, Write};
    check()?;
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options.open(destination)?;
    let result = (|| {
        let mut input = fs::File::open(source)?;
        let mut buffer = [0u8; 65536];
        loop {
            check()?;
            let size = input.read(&mut buffer)?;
            if size == 0 {
                break;
            }
            output.write_all(&buffer[..size])?;
        }
        output.sync_all()?;
        check()
    })();
    drop(output);
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn directory() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "workplan-update-files-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        root
    }
    #[test]
    fn preserve_existing_packages_for_all_supported_formats() {
        let root = directory();
        for name in [
            "WorkPlan_0.6.0_amd64.deb",
            "WorkPlan-0.6.0-1.x86_64.rpm",
            "workplan-bin-0.6.0-1-x86_64.pkg.tar.zst",
        ] {
            let existing = root.join(name);
            let partial = root.join("fixture.part");
            fs::write(&existing, b"keep-user-file").unwrap();
            fs::write(&partial, b"verified-fixture").unwrap();
            let saved = publish_without_overwrite(&partial, &root, name, || Ok(())).unwrap();
            assert_ne!(saved, existing);
            assert_eq!(fs::read(&existing).unwrap(), b"keep-user-file");
            assert_eq!(fs::read(&saved).unwrap(), b"verified-fixture");
            assert!(!partial.exists());
            fs::remove_file(saved).unwrap();
            fs::remove_file(existing).unwrap();
        }
        fs::remove_dir(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn publication_does_not_follow_or_replace_an_existing_symlink() {
        use std::os::unix::fs::symlink;
        let root = directory();
        let target = root.join("user-data");
        let link = root.join("fixture.deb");
        let partial = root.join("fixture.part");
        fs::write(&target, b"untouched").unwrap();
        fs::write(&partial, b"package").unwrap();
        symlink(&target, &link).unwrap();
        let saved = publish_without_overwrite(&partial, &root, "fixture.deb", || Ok(())).unwrap();
        assert_ne!(saved, link);
        assert_eq!(fs::read(&target).unwrap(), b"untouched");
        assert!(fs::symlink_metadata(&link).unwrap().is_symlink());
        fs::remove_file(saved).unwrap();
        fs::remove_file(link).unwrap();
        fs::remove_file(target).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn invalid_destination_does_not_destroy_the_verified_staging_file() {
        let root = directory();
        let partial = root.join("fixture.part");
        fs::write(&partial, b"package").unwrap();
        assert!(publish_without_overwrite(&partial, &root.join("missing"), "fixture.rpm", || Ok(())).is_err());
        for name in ["../fixture.deb", "..\\fixture.deb", "", ".."] {
            assert!(publish_without_overwrite(&partial, &root, name, || Ok(())).is_err());
        }
        assert_eq!(fs::read(&partial).unwrap(), b"package");
        fs::remove_file(partial).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn copy_fallback_preserves_existing_targets_and_removes_only_its_failed_copy() {
        let root = directory();
        let source = root.join("verified.part");
        let target = root.join("package.rpm");
        fs::write(&source, b"verified-bytes").unwrap();
        fs::write(&target, b"existing-package").unwrap();
        assert_eq!(
            copy_without_overwrite(&source, &target, &|| Ok(())).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
        assert_eq!(fs::read(&target).unwrap(), b"existing-package");
        let output = root.join("new-package.rpm");
        copy_without_overwrite(&source, &output, &|| Ok(())).unwrap();
        assert_eq!(fs::read(&output).unwrap(), b"verified-bytes");
        let failed = root.join("failed-package.rpm");
        assert!(copy_without_overwrite(&root.join("absent.part"), &failed, &|| Ok(())).is_err());
        assert!(!failed.exists());
        for path in [source, target, output] {
            fs::remove_file(path).unwrap();
        }
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn cancel_during_copy_removes_only_its_new_destination() {
        use std::cell::Cell;
        let root = directory();
        let partial = root.join("verified.part");
        let destination = root.join("new-package.rpm");
        let existing = root.join("existing-package.rpm");
        fs::write(&partial, vec![7; 256 * 1024]).unwrap();
        fs::write(&existing, b"keep-existing-package").unwrap();
        let checks = Cell::new(0);
        let check = || {
            checks.set(checks.get() + 1);
            if checks.get() >= 3 {
                Err(io::Error::new(io::ErrorKind::Interrupted, "Download canceled"))
            } else {
                Ok(())
            }
        };
        assert_eq!(
            copy_without_overwrite(&partial, &destination, &check).unwrap_err().kind(),
            io::ErrorKind::Interrupted
        );
        assert!(!destination.exists());
        assert_eq!(fs::metadata(&partial).unwrap().len(), 256 * 1024);
        assert_eq!(fs::read(&existing).unwrap(), b"keep-existing-package");
        assert!(publish_without_overwrite(&partial, &root, "existing-package.rpm", || {
            Err(io::Error::new(io::ErrorKind::Interrupted, "Download canceled"))
        }).is_err());
        assert_eq!(fs::read(&existing).unwrap(), b"keep-existing-package");
        fs::remove_file(partial).unwrap();
        fs::remove_file(existing).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
