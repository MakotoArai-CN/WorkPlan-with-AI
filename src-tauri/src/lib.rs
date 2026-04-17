#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent, WindowEvent,
};
use scraper::{Html, Selector};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri_plugin_opener::OpenerExt;
use url::Url;
use walkdir::WalkDir;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod autostart;

static CLOSE_TO_QUIT: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalFileEntry {
    path: String,
    name: String,
    kind: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalFileReadResult {
    path: String,
    content: String,
    size: usize,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalFileMutationResult {
    path: String,
    action: String,
    size: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WebSearchEntry {
    title: String,
    url: String,
    snippet: String,
    source: String,
}

fn current_workspace_root() -> Result<PathBuf, String> {
    std::env::current_dir().map_err(|e| e.to_string())
}

fn normalize_pathbuf(path: PathBuf) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path
    } else {
        current_workspace_root()?.join(path)
    };

    let mut cursor = absolute.clone();
    let mut missing_segments = Vec::new();

    while !cursor.exists() {
        let Some(file_name) = cursor.file_name() else {
            return Err("无法解析目标路径".to_string());
        };
        missing_segments.push(file_name.to_os_string());
        let Some(parent) = cursor.parent() else {
            return Err("无法解析目标路径".to_string());
        };
        cursor = parent.to_path_buf();
    }

    let mut normalized = fs::canonicalize(&cursor).map_err(|e| e.to_string())?;
    for segment in missing_segments.iter().rev() {
        normalized.push(segment);
    }

    Ok(normalized)
}

fn normalize_path(path: &str) -> Result<PathBuf, String> {
    normalize_pathbuf(PathBuf::from(path))
}

fn allowed_write_roots(trusted_dirs: &[String]) -> Result<Vec<PathBuf>, String> {
    let mut roots = vec![normalize_pathbuf(current_workspace_root()?)?];
    for dir in trusted_dirs {
        if dir.trim().is_empty() {
            continue;
        }
        roots.push(normalize_path(dir)?);
    }
    Ok(roots)
}

fn ensure_mutation_allowed(path: &str, trusted_dirs: &[String]) -> Result<PathBuf, String> {
    let normalized = normalize_path(path)?;
    let roots = allowed_write_roots(trusted_dirs)?;
    if roots.iter().any(|root| normalized.starts_with(root)) {
        return Ok(normalized);
    }

    Err(format!(
        "拒绝操作未授权路径：{}。仅允许工作目录和用户授权目录。",
        normalized.to_string_lossy()
    ))
}

fn extract_duckduckgo_url(raw_url: &str) -> String {
    let prefixed = if raw_url.starts_with("http://") || raw_url.starts_with("https://") {
        raw_url.to_string()
    } else if raw_url.starts_with('/') {
        format!("https://html.duckduckgo.com{}", raw_url)
    } else {
        raw_url.to_string()
    };

    if let Ok(parsed) = Url::parse(&prefixed) {
        if let Some(decoded) = parsed
            .query_pairs()
            .find_map(|(key, value)| (key == "uddg").then(|| value.to_string()))
        {
            if let Ok(decoded_url) = Url::parse(&decoded) {
                if matches!(decoded_url.scheme(), "http" | "https") {
                    return decoded;
                }
            }
            return String::new();
        }

        if matches!(parsed.scheme(), "http" | "https") {
            return prefixed;
        }
    }

    String::new()
}

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
fn get_workspace_root() -> Result<String, String> {
    Ok(normalize_pathbuf(current_workspace_root()?)?
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
fn search_local_files(
    root: Option<String>,
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<LocalFileEntry>, String> {
    let root_path = match root {
        Some(value) if !value.trim().is_empty() => normalize_path(&value)?,
        _ => normalize_pathbuf(current_workspace_root()?)?,
    };
    if !root_path.exists() {
        return Err(format!("搜索根目录不存在：{}", root_path.to_string_lossy()));
    }

    let limit = max_results.unwrap_or(40).clamp(1, 200);
    let needle = query.trim().to_lowercase();
    let mut entries = Vec::new();

    for entry in WalkDir::new(&root_path)
        .follow_links(false)
        .into_iter()
        .filter_map(|item| item.ok())
    {
        if entries.len() >= limit {
            break;
        }
        let path = entry.path();
        if path == root_path {
            continue;
        }

        let path_text = path.to_string_lossy().to_lowercase();
        let name_text = entry.file_name().to_string_lossy().to_lowercase();
        if !needle.is_empty() && !path_text.contains(&needle) && !name_text.contains(&needle) {
            continue;
        }

        let metadata = entry.metadata().ok();
        entries.push(LocalFileEntry {
            path: path.to_string_lossy().to_string(),
            name: entry.file_name().to_string_lossy().to_string(),
            kind: if entry.file_type().is_dir() {
                "directory".to_string()
            } else {
                "file".to_string()
            },
            size: metadata.map(|item| item.len()).unwrap_or(0),
        });
    }

    Ok(entries)
}

#[tauri::command]
fn read_local_file(path: String, max_bytes: Option<usize>) -> Result<LocalFileReadResult, String> {
    let normalized = normalize_path(&path)?;
    let bytes = fs::read(&normalized)
        .map_err(|e| format!("读取文件失败 {}: {}", normalized.to_string_lossy(), e))?;
    let limit = max_bytes.unwrap_or(16_000).clamp(512, 256_000);
    let truncated = bytes.len() > limit;
    let slice = if truncated { &bytes[..limit] } else { bytes.as_slice() };
    let content = String::from_utf8_lossy(slice).to_string();

    Ok(LocalFileReadResult {
        path: normalized.to_string_lossy().to_string(),
        content,
        size: bytes.len(),
        truncated,
    })
}

#[tauri::command]
fn write_local_file(
    path: String,
    content: String,
    trusted_dirs: Vec<String>,
) -> Result<LocalFileMutationResult, String> {
    let normalized = ensure_mutation_allowed(&path, &trusted_dirs)?;
    let Some(parent) = normalized.parent() else {
        return Err("目标文件缺少父目录".to_string());
    };
    fs::create_dir_all(parent)
        .map_err(|e| format!("创建目录失败 {}: {}", parent.to_string_lossy(), e))?;
    fs::write(&normalized, content.as_bytes())
        .map_err(|e| format!("写入文件失败 {}: {}", normalized.to_string_lossy(), e))?;

    Ok(LocalFileMutationResult {
        path: normalized.to_string_lossy().to_string(),
        action: "write".to_string(),
        size: content.len(),
    })
}

#[tauri::command]
fn delete_local_file(
    path: String,
    trusted_dirs: Vec<String>,
) -> Result<LocalFileMutationResult, String> {
    let normalized = ensure_mutation_allowed(&path, &trusted_dirs)?;
    let metadata = fs::metadata(&normalized)
        .map_err(|e| format!("读取文件元数据失败 {}: {}", normalized.to_string_lossy(), e))?;
    if metadata.is_dir() {
        return Err(format!(
            "当前仅支持删除单个文件，不支持删除目录：{}",
            normalized.to_string_lossy()
        ));
    }
    fs::remove_file(&normalized)
        .map_err(|e| format!("删除文件失败 {}: {}", normalized.to_string_lossy(), e))?;

    Ok(LocalFileMutationResult {
        path: normalized.to_string_lossy().to_string(),
        action: "delete".to_string(),
        size: metadata.len() as usize,
    })
}

#[tauri::command]
async fn search_web(
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<WebSearchEntry>, String> {
    let needle = query.trim();
    if needle.is_empty() {
        return Ok(Vec::new());
    }

    let limit = max_results.unwrap_or(6).clamp(1, 10);
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; WorkPlan/0.3.1; +https://github.com/MakotoArai-CN/WorkPlan-with-AI)")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get("https://html.duckduckgo.com/html/")
        .query(&[("q", needle)])
        .send()
        .await
        .map_err(|e| format!("网页搜索请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("网页搜索失败: HTTP {}", response.status()));
    }

    let html = response
        .text()
        .await
        .map_err(|e| format!("读取搜索结果失败: {}", e))?;

    let document = Html::parse_document(&html);
    let result_selector = Selector::parse(".result").map_err(|e| e.to_string())?;
    let title_selector = Selector::parse("a.result__a").map_err(|e| e.to_string())?;
    let snippet_selector = Selector::parse(".result__snippet").map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for result in document.select(&result_selector) {
        if entries.len() >= limit {
            break;
        }

        let Some(title_link) = result.select(&title_selector).next() else {
            continue;
        };

        let title = title_link
            .text()
            .collect::<Vec<_>>()
            .join("")
            .trim()
            .to_string();
        let raw_url = title_link.value().attr("href").unwrap_or("").trim();
        let url = extract_duckduckgo_url(raw_url);
        let snippet = result
            .select(&snippet_selector)
            .next()
            .map(|item| item.text().collect::<Vec<_>>().join("").trim().to_string())
            .unwrap_or_default();

        if title.is_empty() || url.is_empty() {
            continue;
        }

        entries.push(WebSearchEntry {
            title,
            url,
            snippet,
            source: "DuckDuckGo".to_string(),
        });
    }

    Ok(entries)
}

#[tauri::command]
async fn fetch_web_content(
    url: String,
    max_chars: Option<usize>,
) -> Result<String, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("URL 不能为空".to_string());
    }

    let limit = max_chars.unwrap_or(4000).clamp(200, 12000);
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; WorkPlan/0.3.1; +https://github.com/MakotoArai-CN/WorkPlan-with-AI)")
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    if !content_type.contains("text/html") && !content_type.contains("text/plain") {
        return Err(format!("不支持的内容类型: {}", content_type));
    }

    let html = response
        .text()
        .await
        .map_err(|e| format!("读取内容失败: {}", e))?;

    // Parse HTML and extract text content
    let document = Html::parse_document(&html);

    // Remove script, style, nav, footer, header tags
    let skip_tags: std::collections::HashSet<&str> =
        ["script", "style", "nav", "footer", "header", "aside", "noscript", "svg", "form"]
            .iter()
            .copied()
            .collect();

    let mut text_parts: Vec<String> = Vec::new();

    fn extract_text(
        node: ego_tree::NodeRef<scraper::Node>,
        skip_tags: &std::collections::HashSet<&str>,
        parts: &mut Vec<String>,
    ) {
        match node.value() {
            scraper::Node::Text(t) => {
                let trimmed = t.text.trim();
                if !trimmed.is_empty() {
                    parts.push(trimmed.to_string());
                }
            }
            scraper::Node::Element(el) => {
                if skip_tags.contains(el.name()) {
                    return;
                }
                for child in node.children() {
                    extract_text(child, skip_tags, parts);
                }
                // Add line break after block elements
                let block_tags = ["p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "blockquote", "pre", "article", "section"];
                if block_tags.contains(&el.name()) {
                    parts.push("\n".to_string());
                }
            }
            _ => {
                for child in node.children() {
                    extract_text(child, skip_tags, parts);
                }
            }
        }
    }

    let root = document.tree.root();
    for child in root.children() {
        extract_text(child, &skip_tags, &mut text_parts);
    }

    let mut result = text_parts.join(" ");
    // Clean up whitespace
    result = result
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    // Truncate
    if result.len() > limit {
        let truncated: String = result.chars().take(limit).collect();
        result = format!("{}...[已截断]", truncated);
    }

    Ok(result)
}

#[tauri::command]
async fn open_github(app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(
            "https://github.com/MakotoArai-CN/WorkPlan-with-AI",
            None::<&str>,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_releases(app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(
            "https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases",
            None::<&str>,
        )
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            check_update,
            set_autostart,
            get_autostart_status,
            get_app_version,
            get_workspace_root,
            search_local_files,
            read_local_file,
            write_local_file,
            delete_local_file,
            search_web,
            fetch_web_content,
            open_github,
            open_releases,
            set_close_to_quit,
            get_close_to_quit,
            exit_app
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
    let builder = builder.setup(|app| {
        app.handle()
            .plugin(tauri_plugin_mobile_onbackpressed_listener::init())?;
        Ok(())
    });

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        builder
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}
