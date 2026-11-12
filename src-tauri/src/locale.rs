#[cfg(any(target_os = "linux", test))]
pub fn effective_posix_locale(values: &[Option<String>]) -> Option<String> {
    values.iter().flatten().find(|value| !value.trim().is_empty()).map(|value| value.trim().to_string())
}

pub fn system_locale() -> Option<String> {
    #[cfg(target_os = "linux")]
    { effective_posix_locale(&["LC_ALL", "LC_MESSAGES", "LANG"].map(|name| std::env::var(name).ok())) }
    #[cfg(target_os = "windows")]
    {
        #[link(name = "kernel32")]
        extern "system" { fn GetUserDefaultLocaleName(name: *mut u16, length: i32) -> i32; }
        let mut name = [0u16; 85];
        // The OS writes at most the provided UTF-16 buffer length, including NUL.
        let length = unsafe { GetUserDefaultLocaleName(name.as_mut_ptr(), name.len() as i32) };
        if length > 1 { Some(String::from_utf16_lossy(&name[..length as usize - 1])) } else { None }
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    { None }
}

pub fn initialization_script() -> String {
    match system_locale() {
        Some(language) => format!("Object.defineProperty(window, '__WORKPLAN_SYSTEM_LOCALE__', {{value: {}, writable: false}});", serde_json::to_string(&language).unwrap()),
        None => String::new(),
    }
}

pub fn tray_labels(language: Option<&str>) -> [&'static str; 6] {
    let language = language.unwrap_or("en").to_lowercase();
    if language == "zh" || language.starts_with("zh_") || language.starts_with("zh-") {
        ["退出程序", "显示窗口", "系统通知", "开机自启", "关于程序", "检查更新"]
    } else {
        ["Quit", "Show Window", "Notifications", "Launch at Login", "About", "Check for Updates"]
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub struct TrayMenuLabels(pub [tauri::menu::MenuItem<tauri::Wry>; 6]);

#[tauri::command]
pub fn set_app_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    if !["zh", "zh-Hant", "en", "ja", "ko", "ru"].contains(&language.as_str()) {
        return Err("Unsupported language".into());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri::Manager;
        if let Some(menu) = app.try_state::<TrayMenuLabels>() {
            for (item, label) in menu.0.iter().zip(tray_labels(Some(&language))) {
                item.set_text(label).map_err(|error| error.to_string())?;
            }
        }
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = app;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn posix_precedence_keeps_explicit_c_and_ignores_empty_values() {
        assert_eq!(effective_posix_locale(&[Some("C".into()), Some("zh_CN.UTF-8".into()), Some("ja_JP.UTF-8".into())]), Some("C".into()));
        assert_eq!(effective_posix_locale(&[Some(" ".into()), Some("en_US.UTF-8".into()), Some("zh_CN.UTF-8".into())]), Some("en_US.UTF-8".into()));
        assert_eq!(effective_posix_locale(&[None, None, Some("zh_TW.UTF-8".into())]), Some("zh_TW.UTF-8".into()));
        assert_eq!(effective_posix_locale(&[None, None, None]), None);
    }

    #[test]
    fn native_menu_uses_english_fallback_and_chinese_only_for_chinese_locales() {
        for language in [None, Some("C"), Some("POSIX"), Some("en_US.UTF-8"), Some("de_DE.UTF-8")] {
            assert_eq!(tray_labels(language)[0], "Quit");
        }
        assert_eq!(tray_labels(Some("zh_CN.UTF-8"))[0], "退出程序");
    }
}
