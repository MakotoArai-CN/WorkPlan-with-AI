#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod autostart;

static CLOSE_TO_QUIT: AtomicBool = AtomicBool::new(false);

fn is_newer_version(current: &str, latest: &str) -> bool {
    let parse_version = |v: &str| -> Vec<u32> {
        v.trim_start_matches('v')
            .split('.')
            .filter_map(|s| s.parse::<u32>().ok())
            .collect()
    };
    let current_parts = parse_version(current);
    let latest_parts = parse_version(latest);
    for i in 0..std::cmp::max(current_parts.len(), latest_parts.len()) {
        let c = current_parts.get(i).unwrap_or(&0);
        let l = latest_parts.get(i).unwrap_or(&0);
        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }
    false
}

#[tauri::command]
async fn check_update() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.github.com/repos/MakotoArai-CN/WorkPlan-with-AI/releases/latest")
        .header("User-Agent", "WorkPlan")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status().is_success() {
        let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        let current_version = env!("CARGO_PKG_VERSION");
        let latest_version = data["tag_name"].as_str().unwrap_or("");
        let has_update = is_newer_version(current_version, latest_version);
        Ok(serde_json::json!({
            "has_update": has_update,
            "current_version": current_version,
            "latest_version": latest_version.trim_start_matches('v')
        }))
    } else {
        Err(format!("HTTP Error: {}", response.status()))
    }
}

#[tauri::command]
async fn set_autostart(enable: bool) -> Result<bool, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        autostart::set_autostart_registry(enable)
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = enable;
        Ok(true)
    }
}

#[tauri::command]
async fn get_autostart_status() -> Result<bool, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        autostart::get_autostart_status()
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        Ok(false)
    }
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
async fn open_github(app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url("https://github.com/MakotoArai-CN/WorkPlan-with-AI", None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_releases(app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url("https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases", None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_close_to_quit(value: bool) {
    CLOSE_TO_QUIT.store(value, Ordering::SeqCst);
}

#[tauri::command]
fn get_close_to_quit() -> bool {
    CLOSE_TO_QUIT.load(Ordering::SeqCst)
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
async fn close_splashscreen(app: tauri::AppHandle) {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if let Some(splashscreen) = app.get_webview_window("splashscreen") {
            let _ = splashscreen.close();
        }
        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.show();
            let _ = main_window.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            check_update,
            set_autostart,
            get_autostart_status,
            get_app_version,
            open_github,
            open_releases,
            set_close_to_quit,
            get_close_to_quit,
            exit_app,
            close_splashscreen
        ]);

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            let quit = MenuItem::with_id(app, "quit", "退出程序", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let notification =
                MenuItem::with_id(app, "notification", "系统通知", true, None::<&str>)?;
            let autostart_item =
                MenuItem::with_id(app, "autostart", "开机自启", true, None::<&str>)?;
            let about = MenuItem::with_id(app, "about", "关于程序", true, None::<&str>)?;
            let update = MenuItem::with_id(app, "update", "检查更新", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &show,
                    &notification,
                    &autostart_item,
                    &about,
                    &update,
                    &quit,
                ],
            )?;
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("WorkPlan - 任务管理")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "notification" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("tray-notification-toggle", ());
                        }
                    }
                    "autostart" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("tray-autostart-toggle", ());
                        }
                    }
                    "about" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("tray-open-about", ());
                        }
                    }
                    "update" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("tray-check-update", ());
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        });

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder
            .build(tauri::generate_context!())
            .expect("error while building tauri application")
            .run(|app_handle, event| {
                if let RunEvent::WindowEvent {
                    label,
                    event: WindowEvent::CloseRequested { api, .. },
                    ..
                } = event
                {
                    if label == "main" {
                        if CLOSE_TO_QUIT.load(Ordering::SeqCst) {
                            app_handle.exit(0);
                        } else {
                            api.prevent_close();
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                    }
                }
            });
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        builder
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}