#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent, WindowEvent,
};
#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::Manager;
use scraper::{Html, Selector};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::collections::HashSet;
use std::net::{IpAddr, ToSocketAddrs};
use std::path::{Component, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};
use tauri_plugin_opener::OpenerExt;
use url::Url;
use walkdir::WalkDir;
use base64::Engine;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod autostart;
mod device;

static CLOSE_TO_QUIT: AtomicBool = AtomicBool::new(false);

/// Paths the user explicitly selected through a native file dialog in this session.
///
/// The dialog pick *is* the authorization grant, so the grant has to be recorded on
/// the side that owns the dialog. Previously the frontend picked the files and then
/// handed arbitrary paths back to `read_selected_text_files`, which meant anything
/// able to call that command — including a model-generated execution plan — could read
/// any file on disk. The backend now only reads back what it handed out.
static PICKED_FILE_GRANTS: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn grant_picked_paths<I: IntoIterator<Item = String>>(paths: I) {
    let Ok(mut guard) = PICKED_FILE_GRANTS.lock() else {
        return;
    };
    let grants = guard.get_or_insert_with(HashSet::new);
    for path in paths {
        grants.insert(path);
    }
}

fn is_path_granted(label: &str) -> bool {
    PICKED_FILE_GRANTS
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|grants| grants.contains(label)))
        .unwrap_or(false)
}

/// Authorize a path for reading: either the user picked it from a dialog this session,
/// or it lives under the workspace / a directory the user explicitly trusted.
fn ensure_readable_path(label: &str, path: &str, trusted_dirs: &[String]) -> Result<(), String> {
    if is_path_granted(label) {
        return Ok(());
    }
    ensure_local_path_allowed(path, trusted_dirs).map(|_| ())
}

/// Reduce an arbitrary caller-supplied filename to a single safe path segment.
///
/// `Path::join` replaces the whole base path when given an absolute path, and does not
/// collapse `..`, so an unsanitized filename here is a write-anywhere primitive.
fn sanitize_download_filename(filename: &str) -> Result<String, String> {
    // Reject rather than strip NUL: a name containing one is malformed, and silently
    // rewriting it could turn a rejected name into an accepted different one.
    if filename.contains('\0') {
        return Err("文件名无效".to_string());
    }
    let candidate = filename.trim();

    // Take the last segment under either separator; Windows accepts both.
    let basename = candidate
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches('.')
        .trim();

    if basename.is_empty()
        || basename == "."
        || basename == ".."
        || basename.contains(':')
        || basename.chars().any(|c| c.is_control())
    {
        return Err("文件名无效".to_string());
    }

    // Defense in depth: reject anything that still parses as more than one plain segment.
    let as_path = PathBuf::from(basename);
    let mut components = as_path.components();
    let Some(Component::Normal(only)) = components.next() else {
        return Err("文件名无效".to_string());
    };
    if components.next().is_some() {
        return Err("文件名无效".to_string());
    }

    Ok(only.to_string_lossy().to_string())
}

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
struct LocalTextFilePayload {
    path: String,
    name: String,
    content: String,
    size: usize,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaFilePayload {
    path: String,
    name: String,
    mime_type: String,
    base64_data: String,
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

fn allowed_local_roots(trusted_dirs: &[String]) -> Result<Vec<PathBuf>, String> {
    let mut roots = vec![normalize_pathbuf(current_workspace_root()?)?];
    for dir in trusted_dirs {
        let dir = dir.trim();
        if dir.is_empty() || dir.starts_with("content://") {
            continue;
        }
        roots.push(normalize_path(dir)?);
    }
    Ok(roots)
}

fn ensure_local_path_allowed(path: &str, trusted_dirs: &[String]) -> Result<PathBuf, String> {
    let normalized = normalize_path(path)?;
    let roots = allowed_local_roots(trusted_dirs)?;
    if roots.iter().any(|root| normalized.starts_with(root)) {
        return Ok(normalized);
    }

    Err(format!(
        "拒绝访问未授权路径：{}。仅允许工作目录和用户授权目录。",
        normalized.to_string_lossy()
    ))
}

fn ensure_mutation_allowed(path: &str, trusted_dirs: &[String]) -> Result<PathBuf, String> {
    ensure_local_path_allowed(path, trusted_dirs)
}

fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(addr) => {
            let octets = addr.octets();
            addr.is_loopback()
                || addr.is_private()
                || addr.is_link_local()
                || addr.is_multicast()
                || addr.is_broadcast()
                || addr.is_unspecified()
                || octets[0] == 0
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
        }
        IpAddr::V6(addr) => {
            if let Some(mapped) = addr.to_ipv4_mapped() {
                return is_blocked_ip(IpAddr::V4(mapped));
            }
            let segments = addr.segments();
            addr.is_loopback()
                || addr.is_unspecified()
                || addr.is_multicast()
                || (segments[0] & 0xfe00) == 0xfc00
                || (segments[0] & 0xffc0) == 0xfe80
        }
    }
}

fn is_blocked_host_name(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "localhost" || host.ends_with(".localhost")
}

/// Validate a URL and return it alongside the addresses it resolved to.
///
/// The caller must pin the connection to these addresses. Validating a hostname and
/// then letting the HTTP client resolve it again leaves a DNS-rebinding window in
/// which the second lookup can return an internal address.
fn validate_public_http_url_resolved(raw_url: &str) -> Result<(Url, Vec<std::net::SocketAddr>), String> {
    let parsed = Url::parse(raw_url).map_err(|e| format!("URL 无效: {}", e))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("仅支持 http/https URL".to_string());
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "URL 缺少主机名".to_string())?
        .to_string();
    if is_blocked_host_name(&host) {
        return Err("拒绝访问本机地址".to_string());
    }

    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| "URL 缺少端口信息".to_string())?;

    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err("拒绝访问内网或本机地址".to_string());
        }
        return Ok((parsed, vec![std::net::SocketAddr::new(ip, port)]));
    }

    let mut resolved = Vec::new();
    for address in (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|e| format!("解析主机失败: {}", e))?
    {
        if is_blocked_ip(address.ip()) {
            return Err("拒绝访问解析到内网或本机地址的 URL".to_string());
        }
        resolved.push(address);
    }

    if resolved.is_empty() {
        return Err("主机未解析到可用地址".to_string());
    }

    Ok((parsed, resolved))
}

fn validate_public_http_url(raw_url: &str) -> Result<Url, String> {
    validate_public_http_url_resolved(raw_url).map(|(url, _)| url)
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
fn get_workspace_root(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let data_dir = app.path().app_data_dir()
            .map_err(|e| e.to_string())?;
        fs::create_dir_all(&data_dir)
            .map_err(|e| format!("创建数据目录失败: {}", e))?;
        Ok(data_dir.to_string_lossy().to_string())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = app;
        Ok(normalize_pathbuf(current_workspace_root()?)?
            .to_string_lossy()
            .to_string())
    }
}

#[tauri::command]
fn search_local_files(
    root: Option<String>,
    query: String,
    max_results: Option<usize>,
    trusted_dirs: Option<Vec<String>>,
) -> Result<Vec<LocalFileEntry>, String> {
    let trusted_dirs = trusted_dirs.unwrap_or_default();
    let root_path = match root {
        Some(value) if !value.trim().is_empty() => {
            ensure_local_path_allowed(&value, &trusted_dirs)?
        }
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
fn read_local_file(
    path: String,
    max_bytes: Option<usize>,
    trusted_dirs: Option<Vec<String>>,
) -> Result<LocalFileReadResult, String> {
    let trusted_dirs = trusted_dirs.unwrap_or_default();
    let normalized = ensure_local_path_allowed(&path, &trusted_dirs)?;
    let bytes = fs::read(&normalized)
        .map_err(|e| format!("读取文件失败 {}: {}", normalized.to_string_lossy(), e))?;
    let limit = max_bytes.unwrap_or(16_000).clamp(512, 256_000);
    let truncated = bytes.len() > limit;
    let slice = if truncated {
        &bytes[..limit]
    } else {
        bytes.as_slice()
    };
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
        .user_agent(concat!(
            "Mozilla/5.0 (compatible; WorkPlan/",
            env!("CARGO_PKG_VERSION"),
            "; +https://github.com/MakotoArai-CN/WorkPlan-with-AI)"
        ))
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
async fn fetch_web_content(url: String, max_chars: Option<usize>) -> Result<String, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("URL 不能为空".to_string());
    }
    let (url, resolved) = validate_public_http_url_resolved(&url)?;

    let limit = max_chars.unwrap_or(4000).clamp(200, 12000);
    let mut builder = reqwest::Client::builder()
        .user_agent(concat!(
            "Mozilla/5.0 (compatible; WorkPlan/",
            env!("CARGO_PKG_VERSION"),
            "; +https://github.com/MakotoArai-CN/WorkPlan-with-AI)"
        ))
        .timeout(std::time::Duration::from_secs(10));

    // Pin the host to the addresses we just validated, closing the DNS-rebinding
    // window between validation and the client's own lookup.
    if let Some(host) = url.host_str() {
        if host.parse::<IpAddr>().is_err() && !resolved.is_empty() {
            builder = builder.resolve_to_addrs(host, &resolved);
        }
    }

    let client = builder
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "重定向次数过多",
                ));
            }
            if let Err(error) = validate_public_http_url(attempt.url().as_str()) {
                return attempt.error(std::io::Error::new(std::io::ErrorKind::Other, error));
            }
            attempt.follow()
        }))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(url)
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

    // Cap the body: the URL can come from AI-generated plans, and an endpoint that
    // streams indefinitely would otherwise exhaust memory.
    const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;
    let mut body = Vec::new();
    let mut stream = response;
    while let Some(chunk) = stream
        .chunk()
        .await
        .map_err(|e| format!("读取内容失败: {}", e))?
    {
        body.extend_from_slice(&chunk);
        if body.len() >= MAX_BODY_BYTES {
            body.truncate(MAX_BODY_BYTES);
            break;
        }
    }
    let html = String::from_utf8_lossy(&body).to_string();

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

/// Exports send text as-is, but binary formats (PDF) can only cross the IPC
/// boundary as base64, optionally still wrapped in a `data:` URL by the producer.
fn decode_save_payload(content: &str, is_base64: bool) -> Result<Vec<u8>, String> {
    if !is_base64 {
        return Ok(content.as_bytes().to_vec());
    }

    let payload = if content.starts_with("data:") {
        match content.find(',') {
            Some(idx) => &content[idx + 1..],
            None => return Err("无效的 data URL".to_string()),
        }
    } else {
        content
    };

    base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|e| format!("解码文件内容失败: {}", e))
}

#[tauri::command]
async fn save_file_to_downloads(
    app: tauri::AppHandle,
    filename: String,
    content: String,
    base64: Option<bool>,
) -> Result<String, String> {
    let filename = sanitize_download_filename(&filename)?;
    let bytes = decode_save_payload(&content, base64.unwrap_or(false))?;

    // Determine downloads directory based on platform
    let download_dir = {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            // On Android/iOS: use app's external data dir or fallback to app data dir
            app.path()
                .download_dir()
                .or_else(|_| app.path().app_data_dir())
                .map_err(|e| format!("无法获取下载目录: {}", e))?
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = &app;
            dirs::download_dir().unwrap_or_else(|| {
                dirs::home_dir()
                    .map(|h| h.join("Downloads"))
                    .unwrap_or_else(|| PathBuf::from("."))
            })
        }
    };

    fs::create_dir_all(&download_dir)
        .map_err(|e| format!("创建下载目录失败: {}", e))?;

    let mut target = download_dir.join(&filename);

    // If file already exists, add a number suffix to avoid overwriting
    if target.exists() {
        let stem = target.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let ext = target.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        let mut counter = 1u32;
        loop {
            target = download_dir.join(format!("{} ({}){}", stem, counter, ext));
            if !target.exists() {
                break;
            }
            counter += 1;
            if counter > 999 {
                return Err("文件名冲突过多".to_string());
            }
        }
    }

    fs::write(&target, &bytes)
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
async fn save_file_via_dialog(
    app: tauri::AppHandle,
    filename: String,
    content: String,
    filters: Option<Vec<serde_json::Value>>,
    base64: Option<bool>,
) -> Result<String, String> {
    // The user confirms the final location in the save dialog, but the suggested name
    // still goes through sanitization so a crafted default cannot smuggle in separators.
    let filename = sanitize_download_filename(&filename)?;
    let bytes = decode_save_payload(&content, base64.unwrap_or(false))?;

    let mut dialog_builder = app.dialog().file().set_file_name(&filename);

    if let Some(items) = filters {
        for item in items {
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Files")
                .to_string();
            let extensions = item
                .get("extensions")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|entry| entry.as_str().map(|s| s.to_string()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            if !extensions.is_empty() {
                let ext_refs = extensions.iter().map(|s| s.as_str()).collect::<Vec<_>>();
                dialog_builder = dialog_builder.add_filter(&name, &ext_refs);
            }
        }
    }

    let Some(file_path) = dialog_builder.blocking_save_file() else {
        // Machine-readable prefix: the frontend must tell a deliberate cancel apart
        // from a real failure, otherwise it reports a phantom "export succeeded".
        return Err("CANCELLED:用户取消了保存".to_string());
    };
    let target_label = file_path.to_string();

    match file_path.clone() {
        FilePath::Url(_) => {
            let mut options = OpenOptions::default();
            options.write(true).create(true).truncate(true);
            let mut file = app
                .fs()
                .open(file_path, options)
                .map_err(|e| format!("写入文件失败: {}", e))?;
            file.write_all(&bytes)
                .map_err(|e| format!("写入文件失败: {}", e))?;
        }
        FilePath::Path(target) => {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
            }
            fs::write(&target, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;
        }
    }

    Ok(target_label)
}

/// Open a native file picker and record every selection as an authorized read.
///
/// Runs in the backend so the grant is recorded where the user actually consents,
/// rather than trusting a path list that came back through the webview.
#[tauri::command]
async fn pick_files_for_read(
    app: tauri::AppHandle,
    filters: Option<Vec<serde_json::Value>>,
) -> Result<Vec<String>, String> {
    let mut dialog_builder = app.dialog().file();

    if let Some(items) = filters {
        for item in items {
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Files")
                .to_string();
            let extensions = item
                .get("extensions")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|entry| entry.as_str().map(|s| s.to_string()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            if !extensions.is_empty() {
                let ext_refs = extensions.iter().map(|s| s.as_str()).collect::<Vec<_>>();
                dialog_builder = dialog_builder.add_filter(&name, &ext_refs);
            }
        }
    }

    let Some(selected) = dialog_builder.blocking_pick_files() else {
        return Ok(Vec::new());
    };

    let labels = selected
        .into_iter()
        .map(|file_path| file_path.to_string())
        .collect::<Vec<_>>();
    grant_picked_paths(labels.clone());

    Ok(labels)
}

#[tauri::command]
fn read_selected_text_files(
    app: tauri::AppHandle,
    paths: Vec<String>,
    max_bytes: Option<usize>,
    trusted_dirs: Option<Vec<String>>,
) -> Result<Vec<LocalTextFilePayload>, String> {
    let trusted_dirs = trusted_dirs.unwrap_or_default();
    let limit = max_bytes.unwrap_or(128_000).clamp(1_024, 512_000);
    let mut items = Vec::new();

    for raw_path in paths {
        let file_path = raw_path
            .parse::<FilePath>()
            .unwrap_or_else(|_| FilePath::Path(PathBuf::from(&raw_path)));
        let label = file_path.to_string();

        let bytes = match &file_path {
            FilePath::Url(_) => {
                if !is_path_granted(&label) {
                    return Err(format!("拒绝访问未授权路径：{}", label));
                }
                app.fs()
                    .read(file_path.clone())
                    .map_err(|e| format!("读取文件失败 {}: {}", label, e))?
            }
            FilePath::Path(path) => {
                let normalized = normalize_pathbuf(path.clone())?;
                ensure_readable_path(&label, &normalized.to_string_lossy(), &trusted_dirs)?;
                let metadata = fs::metadata(&normalized)
                    .map_err(|e| format!("读取文件元数据失败 {}: {}", normalized.to_string_lossy(), e))?;
                if metadata.is_dir() {
                    continue;
                }
                fs::read(&normalized)
                    .map_err(|e| format!("读取文件失败 {}: {}", normalized.to_string_lossy(), e))?
            }
        };
        let truncated = bytes.len() > limit;
        let slice = if truncated { &bytes[..limit] } else { bytes.as_slice() };
        let content = String::from_utf8_lossy(slice).to_string();
        items.push(LocalTextFilePayload {
            path: label.clone(),
            name: extract_file_name(&label),
            content,
            size: bytes.len(),
            truncated,
        });
    }

    Ok(items)
}

fn extract_file_name(path: &str) -> String {
    if let Some(name) = path.rsplit('/').next().filter(|value| !value.is_empty()) {
        return name.to_string();
    }
    if let Some(name) = path.rsplit('\\').next().filter(|value| !value.is_empty()) {
        return name.to_string();
    }
    path.to_string()
}

fn mime_from_extension(path: &str) -> String {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "m4a" => "audio/mp4",
        "wma" => "audio/x-ms-wma",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
    .to_string()
}

#[tauri::command]
fn read_binary_files(
    app: tauri::AppHandle,
    paths: Vec<String>,
    max_bytes: Option<usize>,
    trusted_dirs: Option<Vec<String>>,
) -> Result<Vec<MediaFilePayload>, String> {
    let trusted_dirs = trusted_dirs.unwrap_or_default();
    let limit = max_bytes.unwrap_or(10_000_000).clamp(1_024, 50_000_000);
    let mut items = Vec::new();

    for raw_path in paths {
        let file_path = raw_path
            .parse::<FilePath>()
            .unwrap_or_else(|_| FilePath::Path(PathBuf::from(&raw_path)));
        let label = file_path.to_string();

        let bytes = match &file_path {
            FilePath::Url(_) => {
                if !is_path_granted(&label) {
                    return Err(format!("拒绝访问未授权路径：{}", label));
                }
                app.fs()
                    .read(file_path.clone())
                    .map_err(|e| format!("读取文件失败 {}: {}", label, e))?
            }
            FilePath::Path(path) => {
                let normalized = normalize_pathbuf(path.clone())?;
                ensure_readable_path(&label, &normalized.to_string_lossy(), &trusted_dirs)?;
                let metadata = fs::metadata(&normalized)
                    .map_err(|e| format!("读取文件元数据失败 {}: {}", normalized.to_string_lossy(), e))?;
                if metadata.is_dir() {
                    continue;
                }
                if metadata.len() as usize > limit {
                    return Err(format!(
                        "文件过大 {}: {} 字节（上限 {} 字节）",
                        normalized.to_string_lossy(),
                        metadata.len(),
                        limit
                    ));
                }
                fs::read(&normalized)
                    .map_err(|e| format!("读取文件失败 {}: {}", normalized.to_string_lossy(), e))?
            }
        };

        let name = extract_file_name(&label);
        let mime_type = mime_from_extension(&name);
        let base64_data = base64::engine::general_purpose::STANDARD.encode(&bytes);

        items.push(MediaFilePayload {
            path: label,
            name,
            mime_type,
            base64_data,
            size: bytes.len(),
        });
    }

    Ok(items)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_download_filename_keeps_plain_names() {
        assert_eq!(sanitize_download_filename("report.md").unwrap(), "report.md");
        assert_eq!(
            sanitize_download_filename("  generated_123.png  ").unwrap(),
            "generated_123.png"
        );
        assert_eq!(sanitize_download_filename("报告 2026.csv").unwrap(), "报告 2026.csv");
    }

    #[test]
    fn sanitize_download_filename_strips_traversal() {
        // Relative escapes collapse to their final segment.
        assert_eq!(sanitize_download_filename("../../evil.bat").unwrap(), "evil.bat");
        assert_eq!(
            sanitize_download_filename("..\\..\\Startup\\evil.bat").unwrap(),
            "evil.bat"
        );
        assert_eq!(sanitize_download_filename("sub/dir/note.txt").unwrap(), "note.txt");
    }

    #[test]
    fn sanitize_download_filename_reduces_absolute_paths_to_basename() {
        // Absolute paths would otherwise replace the download dir entirely via
        // Path::join; they must collapse to a bare name inside Downloads.
        assert_eq!(
            sanitize_download_filename("C:\\Windows\\System32\\evil.exe").unwrap(),
            "evil.exe"
        );
        assert_eq!(
            sanitize_download_filename("C:/Windows/evil.exe").unwrap(),
            "evil.exe"
        );
        assert_eq!(sanitize_download_filename("/etc/cron.d/evil").unwrap(), "evil");
    }

    #[test]
    fn sanitize_download_filename_rejects_unusable_names() {
        // Drive-relative names like "C:evil.exe" resolve against the process CWD
        // on Windows rather than Downloads, so they are refused outright.
        assert!(sanitize_download_filename("C:evil.exe").is_err());
        assert!(sanitize_download_filename("").is_err());
        assert!(sanitize_download_filename("   ").is_err());
        assert!(sanitize_download_filename("..").is_err());
        assert!(sanitize_download_filename("/").is_err());
        assert!(sanitize_download_filename("evil\0.txt").is_err());
    }

    #[test]
    fn ungranted_paths_are_rejected_outside_trusted_roots() {
        // A path the user never picked, outside workspace and trusted dirs, must fail.
        let outside = if cfg!(windows) {
            "C:\\Windows\\System32\\drivers\\etc\\hosts"
        } else {
            "/etc/passwd"
        };
        assert!(!is_path_granted(outside));
        assert!(ensure_readable_path(outside, outside, &[]).is_err());
    }

    #[test]
    fn granted_paths_bypass_root_check_only_after_being_picked() {
        let label = "/tmp/workplan-test-grant-fixture.txt";
        assert!(!is_path_granted(label));
        assert!(ensure_readable_path(label, label, &[]).is_err());

        grant_picked_paths([label.to_string()]);

        assert!(is_path_granted(label));
        // Once granted, authorization succeeds without touching the filesystem roots.
        assert!(ensure_readable_path(label, label, &[]).is_ok());
    }

    #[test]
    fn workspace_paths_remain_readable_without_a_grant() {
        let workspace = normalize_pathbuf(current_workspace_root().unwrap()).unwrap();
        let inside = workspace.join("Cargo.toml");
        let label = inside.to_string_lossy().to_string();
        assert!(ensure_readable_path(&label, &label, &[]).is_ok());
    }

    #[test]
    fn blocked_ips_cover_loopback_and_private_ranges() {
        for addr in [
            "127.0.0.1",
            "10.0.0.1",
            "192.168.1.1",
            "172.16.0.1",
            "169.254.169.254", // cloud metadata endpoint
            "0.0.0.0",
            "100.64.0.1",
        ] {
            assert!(
                is_blocked_ip(addr.parse().unwrap()),
                "expected {addr} to be blocked"
            );
        }
        assert!(!is_blocked_ip("8.8.8.8".parse().unwrap()));
        assert!(is_blocked_ip("::1".parse().unwrap()));
        assert!(is_blocked_ip("::ffff:127.0.0.1".parse().unwrap()));
    }

    #[test]
    fn validate_public_http_url_rejects_local_and_non_http() {
        assert!(validate_public_http_url("http://localhost:8080/x").is_err());
        assert!(validate_public_http_url("http://127.0.0.1/x").is_err());
        assert!(validate_public_http_url("http://169.254.169.254/latest/meta-data").is_err());
        assert!(validate_public_http_url("file:///etc/passwd").is_err());
        assert!(validate_public_http_url("ftp://example.com").is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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
            save_file_to_downloads,
            save_file_via_dialog,
            pick_files_for_read,
            read_selected_text_files,
            read_binary_files,
            open_github,
            open_releases,
            set_close_to_quit,
            get_close_to_quit,
            exit_app,
            device::get_device_key,
            device::reset_device_key
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
        // Android-only: the plugin has no desktop implementation, so it is registered
        // here rather than alongside the cross-platform plugins above.
        #[cfg(target_os = "android")]
        app.handle().plugin(tauri_plugin_biometric::init())?;
        Ok(())
    });

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        builder
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}
