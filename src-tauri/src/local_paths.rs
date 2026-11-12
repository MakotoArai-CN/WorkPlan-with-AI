use std::path::{Path, PathBuf};

// Resolve only recognized aliases, never shell expressions or another user's
// home. Desktop is the OS known folder (including OneDrive/redirection), not
// an English folder guessed beneath HOME or the application workspace.
pub(crate) fn expand_aliases(path: &str, home: Option<&Path>, desktop: Option<&Path>, windows: bool) -> Result<PathBuf, String> {
    let path = path.trim();
    if path.is_empty() || path.contains('\0') || path.len() > 32768 { return Err("本地路径为空、过长或包含无效字符".into()); }
    let normalized = if windows { path.replace('\\', "/") } else { path.to_string() };
    let mut parts = normalized.split('/');
    let first = parts.next().unwrap_or("");
    let home_alias = first == "~" || (windows && first.eq_ignore_ascii_case("%USERPROFILE%"))
        || first == "$HOME" || first == "${HOME}" || (windows && first == "$env:USERPROFILE");
    if first.starts_with('~') && first != "~" { return Err("不支持其他用户的~路径，请选择本机目录".into()); }
    let rest: Vec<_> = parts.collect();
    if home_alias {
        let is_desktop = rest.first().is_some_and(|part| *part == "桌面" || part.eq_ignore_ascii_case("desktop"));
        let base = if is_desktop { desktop.ok_or("系统桌面目录不可用，请通过目录选择器授权实际桌面")? }
            else { home.ok_or("系统用户目录不可用，请选择实际目录")? };
        let tail = if is_desktop { &rest[1..] } else { &rest[..] };
        let mut result = base.to_path_buf();
        for part in tail { if !part.is_empty() { result.push(part); } }
        return Ok(result);
    }
    if first.eq_ignore_ascii_case("desktop") || first == "桌面" {
        let mut result = desktop.ok_or("系统桌面目录不可用，请选择实际目录")?.to_path_buf();
        for part in rest { if !part.is_empty() { result.push(part); } }
        return Ok(result);
    }
    // Fail closed for unresolved environment expressions rather than creating a
    // bogus workspace/$HOME or workspace/%USERPROFILE% authorization entry.
    if first.starts_with('$') || first.starts_with('%') { return Err("无法识别路径变量，请使用实际路径或目录选择器".into()); }
    if windows && path.contains(':') && !path.starts_with(r"\\?\")
        && !(path.as_bytes().get(1) == Some(&b':') && path.as_bytes()[0].is_ascii_alphabetic()) {
        return Err("本地路径不能使用URL或设备协议".into());
    }
    if windows && path.as_bytes().get(1) == Some(&b':') && !matches!(path.as_bytes().get(2), Some(b'\\' | b'/')) {
        return Err("不支持盘符相对路径，请使用完整绝对路径".into());
    }
    Ok(PathBuf::from(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn home_and_redirected_desktop_use_os_directories_not_workspace() {
        let home = Path::new("/isolated/user");
        let desktop = Path::new("/isolated/OneDrive/Desktop");
        for path in ["~/Desktop", r"~\Desktop", "%USERPROFILE%/Desktop", "$HOME/Desktop", "桌面", "Desktop"] {
            assert_eq!(expand_aliases(path, Some(home), Some(desktop), true).unwrap(), desktop);
        }
        assert_eq!(expand_aliases(r"~\Desktop\GPT\README.md", Some(home), Some(desktop), true).unwrap(), desktop.join("GPT").join("README.md"));
        assert_eq!(expand_aliases("~/projects", Some(home), Some(desktop), false).unwrap(), home.join("projects"));
        assert_eq!(expand_aliases("relative/project", Some(home), Some(desktop), false).unwrap(), PathBuf::from("relative/project"));
        assert_eq!(expand_aliases(r"$env:USERPROFILE\Desktop", Some(home), Some(desktop), true).unwrap(), desktop);
        assert_eq!(expand_aliases(r"\\?\C:\Users\fixture\Desktop", Some(home), Some(desktop), true).unwrap(), PathBuf::from(r"\\?\C:\Users\fixture\Desktop"));
    }

    #[test]
    fn unsupported_or_unavailable_aliases_fail_instead_of_workspace_fallback() {
        for path in ["~other/Desktop", "$UNKNOWN/Desktop", "%UNKNOWN%/Desktop", "C:Desktop", "https://example.com", "file:///secret", ""] {
            assert!(expand_aliases(path, Some(Path::new("/user")), Some(Path::new("/desktop")), true).is_err(), "{path}");
        }
        assert!(expand_aliases("~/Desktop", Some(Path::new("/user")), None, true).is_err());
        assert!(expand_aliases("~", None, None, true).is_err());
    }
}
