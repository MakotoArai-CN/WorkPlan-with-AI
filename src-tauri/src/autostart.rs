// use std::path::PathBuf;

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

fn get_exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| format!("无法获取程序路径: {}", e))
        .map(|p| p.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
pub fn set_autostart_registry(enable: bool) -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = r"Software\Microsoft\Windows\CurrentVersion\Run";
    let key = hkcu
        .open_subkey_with_flags(path, KEY_ALL_ACCESS)
        .map_err(|e| format!("无法打开注册表: {}", e))?;

    if enable {
        let exe_path = get_exe_path()?;
        key.set_value("WorkPlanwithAI", &exe_path)
            .map_err(|e| format!("无法设置启动项: {}", e))?;
        Ok(true)
    } else {
        match key.delete_value("WorkPlanwithAI") {
            Ok(_) => Ok(true),
            Err(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    Ok(true)
                } else {
                    Err(format!("无法删除启动项: {}", e))
                }
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub fn get_autostart_status() -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = r"Software\Microsoft\Windows\CurrentVersion\Run";
    let key = hkcu
        .open_subkey(path)
        .map_err(|e| format!("无法打开注册表: {}", e))?;

    match key.get_value::<String, _>("WorkPlanwithAI") {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[cfg(target_os = "linux")]
fn get_autostart_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "无法获取 HOME 目录".to_string())?;
    let autostart_dir = PathBuf::from(home).join(".config").join("autostart");
    if !autostart_dir.exists() {
        std::fs::create_dir_all(&autostart_dir)
            .map_err(|e| format!("无法创建 autostart 目录: {}", e))?;
    }
    Ok(autostart_dir)
}

#[cfg(target_os = "linux")]
fn get_desktop_file_path() -> Result<PathBuf, String> {
    let autostart_dir = get_autostart_dir()?;
    Ok(autostart_dir.join("workplan.desktop"))
}

#[cfg(target_os = "linux")]
pub fn set_autostart_registry(enable: bool) -> Result<bool, String> {
    let desktop_file = get_desktop_file_path()?;

    if enable {
        let exe_path = get_exe_path()?;
        let content = format!(
            "[Desktop Entry]\n\
             Type=Application\n\
             Name=WorkPlan\n\
             Exec={}\n\
             Terminal=false\n\
             StartupNotify=false\n\
             X-GNOME-Autostart-enabled=true\n",
            exe_path
        );
        std::fs::write(&desktop_file, content)
            .map_err(|e| format!("无法写入 desktop 文件: {}", e))?;
        Ok(true)
    } else {
        if desktop_file.exists() {
            std::fs::remove_file(&desktop_file)
                .map_err(|e| format!("无法删除 desktop 文件: {}", e))?;
        }
        Ok(true)
    }
}

#[cfg(target_os = "linux")]
pub fn get_autostart_status() -> Result<bool, String> {
    let desktop_file = get_desktop_file_path()?;
    Ok(desktop_file.exists())
}

#[cfg(target_os = "macos")]
fn get_launch_agents_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "无法获取 HOME 目录".to_string())?;
    let launch_agents = PathBuf::from(home).join("Library").join("LaunchAgents");
    if !launch_agents.exists() {
        std::fs::create_dir_all(&launch_agents)
            .map_err(|e| format!("无法创建 LaunchAgents 目录: {}", e))?;
    }
    Ok(launch_agents)
}

#[cfg(target_os = "macos")]
fn get_plist_path() -> Result<PathBuf, String> {
    let launch_agents = get_launch_agents_dir()?;
    Ok(launch_agents.join("com.makotoarai.workplan.plist"))
}

#[cfg(target_os = "macos")]
pub fn set_autostart_registry(enable: bool) -> Result<bool, String> {
    let plist_path = get_plist_path()?;

    if enable {
        let exe_path = get_exe_path()?;
        let content = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.makotoarai.workplan</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>"#,
            exe_path
        );
        std::fs::write(&plist_path, content)
            .map_err(|e| format!("无法写入 plist 文件: {}", e))?;
        Ok(true)
    } else {
        if plist_path.exists() {
            std::fs::remove_file(&plist_path)
                .map_err(|e| format!("无法删除 plist 文件: {}", e))?;
        }
        Ok(true)
    }
}

#[cfg(target_os = "macos")]
pub fn get_autostart_status() -> Result<bool, String> {
    let plist_path = get_plist_path()?;
    Ok(plist_path.exists())
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
pub fn set_autostart_registry(_enable: bool) -> Result<bool, String> {
    Err("当前平台不支持自启动功能".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
pub fn get_autostart_status() -> Result<bool, String> {
    Ok(false)
}