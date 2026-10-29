use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDbInfo {
    pub path: String,
    pub backup_dir: String,
    pub exists: bool,
    pub bytes: u64,
    pub saved_at: Option<u64>,
    pub backups: usize,
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法定位用户目录".to_string())
}

fn root_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".workplan"))
}

fn data_path() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("data.json"))
}

fn backup_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("backups"))
}

fn ensure_dirs() -> Result<(), String> {
    fs::create_dir_all(root_dir()?).map_err(|e| format!("创建数据目录失败: {e}"))?;
    fs::create_dir_all(backup_dir()?).map_err(|e| format!("创建备份目录失败: {e}"))?;
    hide_dir(&root_dir()?);
    Ok(())
}

#[cfg(windows)]
fn hide_dir(path: &Path) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("attrib")
        .args(["+h", &path.to_string_lossy()])
        .creation_flags(0x08000000)
        .status();
}

#[cfg(not(windows))]
fn hide_dir(_path: &Path) {}

fn timestamp() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn rotate_backups() -> Result<(), String> {
    let dir = backup_dir()?;
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().map(|ext| ext == "json").unwrap_or(false))
        .collect();
    entries.sort_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok());
    while entries.len() > 20 {
        if let Some(oldest) = entries.first() {
            let _ = fs::remove_file(oldest.path());
            entries.remove(0);
        }
    }
    Ok(())
}

fn backup_current() -> Result<(), String> {
    let source = data_path()?;
    if !source.exists() {
        return Ok(());
    }
    ensure_dirs()?;
    let target = backup_dir()?.join(format!("data-{}.json", timestamp()));
    fs::copy(&source, &target).map_err(|e| format!("创建数据库备份失败: {e}"))?;
    rotate_backups()
}

#[tauri::command]
pub fn local_db_load() -> Result<Option<String>, String> {
    ensure_dirs()?;
    let path = data_path()?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| format!("读取本地数据库失败: {e}"))
}

#[tauri::command]
pub fn local_db_save(content: String) -> Result<LocalDbInfo, String> {
    if content.len() > 64 * 1024 * 1024 {
        return Err("本地数据库超过 64MB，已拒绝写入".to_string());
    }
    ensure_dirs()?;
    backup_current()?;
    let path = data_path()?;
    let tmp = root_dir()?.join("data.json.tmp");
    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("写入临时数据库失败: {e}"))?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("替换旧数据库失败: {e}"))?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("保存本地数据库失败: {e}"))?;
    hide_dir(&root_dir()?);
    local_db_info()
}

#[tauri::command]
pub fn local_db_info() -> Result<LocalDbInfo, String> {
    ensure_dirs()?;
    let path = data_path()?;
    let metadata = fs::metadata(&path).ok();
    let backups = fs::read_dir(backup_dir()?)
        .map(|items| items.filter_map(|item| item.ok()).count())
        .unwrap_or(0);
    Ok(LocalDbInfo {
        path: path.to_string_lossy().to_string(),
        backup_dir: backup_dir()?.to_string_lossy().to_string(),
        exists: metadata.is_some(),
        bytes: metadata.as_ref().map(|m| m.len()).unwrap_or(0),
        saved_at: metadata
            .and_then(|m| m.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs()),
        backups,
    })
}

#[tauri::command]
pub fn local_db_backup(destination: String) -> Result<String, String> {
    let source = data_path()?;
    if !source.exists() {
        return Err("本地数据库尚未创建".to_string());
    }
    let target = PathBuf::from(destination);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建备份目录失败: {e}"))?;
    }
    fs::copy(&source, &target).map_err(|e| format!("导出数据库备份失败: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn local_db_restore(source: String) -> Result<String, String> {
    let content = fs::read_to_string(&source).map_err(|e| format!("读取备份文件失败: {e}"))?;
    if content.len() > 64 * 1024 * 1024 {
        return Err("备份文件超过 64MB".to_string());
    }
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| format!("备份文件不是有效 JSON: {e}"))?;
    if value.get("format").and_then(|v| v.as_str()) != Some("workplan-local-db") {
        return Err("不是 WorkPlan 本地数据库备份".to_string());
    }
    ensure_dirs()?;
    backup_current()?;
    local_db_save(content.clone())?;
    Ok(content)
}

#[tauri::command]
pub fn local_db_open_folder() -> Result<(), String> {
    ensure_dirs()?;
    let path = root_dir()?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .arg(path)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
    Ok(())
}
