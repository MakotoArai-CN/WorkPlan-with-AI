use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MAGIC: &[u8; 5] = b"WPDB1";
const SNAPSHOT_KEY: &[u8] = b"snapshot";
const SAVED_AT_KEY: &[u8] = b"saved_at";
// Binds the local database to this application. The file is compressed with
// zstd and encrypted with AES-256-GCM; copying it to another app is useless.
const APP_DB_SECRET: &[u8] = b"WorkPlan::LocalDatabase::sled::AES-GCM::v1";
static DB: OnceLock<sled::Db> = OnceLock::new();
static WRITE_LOCK: Mutex<()> = Mutex::new(());
static HIDDEN: OnceLock<()> = OnceLock::new();

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

fn legacy_path() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("data.json"))
}

fn db_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("db"))
}

fn backup_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("backups"))
}

fn ensure_dirs() -> Result<(), String> {
    fs::create_dir_all(root_dir()?).map_err(|e| format!("创建数据目录失败: {e}"))?;
    fs::create_dir_all(db_dir()?).map_err(|e| format!("创建数据库目录失败: {e}"))?;
    fs::create_dir_all(backup_dir()?).map_err(|e| format!("创建备份目录失败: {e}"))?;
    HIDDEN.get_or_init(|| { if let Ok(root) = root_dir() { hide_dir(&root); } });
    Ok(())
}

#[cfg(windows)]
fn hide_dir(path: &std::path::Path) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("attrib")
        .args(["+h", &path.to_string_lossy()])
        .creation_flags(0x08000000)
        .status();
}

#[cfg(not(windows))]
fn hide_dir(_path: &std::path::Path) {}

fn timestamp() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn open_db() -> Result<&'static sled::Db, String> {
    if let Some(db) = DB.get() {
        return Ok(db);
    }
    ensure_dirs()?;
    let db = sled::open(db_dir()?).map_err(|e| format!("打开本地嵌入式数据库失败: {e}"))?;
    let _ = DB.set(db);
    DB.get().ok_or_else(|| "打开本地嵌入式数据库失败".to_string())
}

fn cipher() -> Result<Aes256Gcm, String> {
    let key = Sha256::digest(APP_DB_SECRET);
    Aes256Gcm::new_from_slice(&key).map_err(|e| format!("初始化数据库密钥失败: {e}"))
}

fn seal_json(json: &str) -> Result<Vec<u8>, String> {
    let compressed = zstd::encode_all(json.as_bytes(), 3).map_err(|e| format!("压缩数据库失败: {e}"))?;
    let mut nonce_bytes = [0u8; 12];
    getrandom::fill(&mut nonce_bytes).map_err(|e| format!("生成数据库随机数失败: {e}"))?;
    let ciphertext = cipher()?
        .encrypt(Nonce::from_slice(&nonce_bytes), compressed.as_ref())
        .map_err(|_| "加密数据库失败".to_string())?;
    let mut blob = Vec::with_capacity(MAGIC.len() + nonce_bytes.len() + ciphertext.len());
    blob.extend_from_slice(MAGIC);
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);
    Ok(blob)
}

fn open_json(blob: &[u8]) -> Result<String, String> {
    if blob.len() <= MAGIC.len() + 12 || &blob[..MAGIC.len()] != MAGIC {
        return Err("不是 WorkPlan 加密数据库".to_string());
    }
    let nonce = Nonce::from_slice(&blob[MAGIC.len()..MAGIC.len() + 12]);
    let compressed = cipher()?
        .decrypt(nonce, &blob[MAGIC.len() + 12..])
        .map_err(|_| "数据库解密失败：文件损坏或不属于本应用".to_string())?;
    let json = zstd::decode_all(compressed.as_slice()).map_err(|e| format!("解压数据库失败: {e}"))?;
    String::from_utf8(json).map_err(|e| format!("数据库内容不是 UTF-8: {e}"))
}

fn read_legacy() -> Result<Option<String>, String> {
    let path = legacy_path()?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| format!("读取旧数据库失败: {e}"))
}

fn backup_blob(db: &sled::Db) -> Result<(), String> {
    let Some(previous) = db.get(SNAPSHOT_KEY).map_err(|e| e.to_string())? else {
        return Ok(());
    };
    let target = backup_dir()?.join(format!("db-{}.wpb", timestamp()));
    fs::write(&target, previous.as_ref()).map_err(|e| format!("创建数据库备份失败: {e}"))?;
    rotate_backups()
}

fn rotate_backups() -> Result<(), String> {
    let dir = backup_dir()?;
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().map(|ext| ext == "wpb").unwrap_or(false))
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

#[tauri::command]
pub async fn local_db_load() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(local_db_load_impl).await.map_err(|e| e.to_string())?
}

fn local_db_load_impl() -> Result<Option<String>, String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let db = open_db()?;
    if let Some(blob) = db.get(SNAPSHOT_KEY).map_err(|e| e.to_string())? {
        return open_json(blob.as_ref()).map(Some);
    }
    // One-time migration from the v0.5.0 plaintext data.json format.
    if let Some(legacy) = read_legacy()? {
        let sealed = seal_json(&legacy)?;
        db.insert(SNAPSHOT_KEY, sealed).map_err(|e| e.to_string())?;
        db.insert(SAVED_AT_KEY, timestamp().to_string().into_bytes()).map_err(|e| e.to_string())?;
        db.flush().map_err(|e| e.to_string())?;
        let _ = fs::rename(legacy_path()?, root_dir()?.join("data.legacy.json"));
        return Ok(Some(legacy));
    }
    Ok(None)
}

/// If a save would replace a snapshot that had an account with one that has
/// none, keep a copy outside the rotating backup directory. This protects any
/// user from a bad flush (a rename bug once did exactly that).
fn protect_account_snapshot(db: &sled::Db, next: &str) -> Result<(), String> {
    fn has_access_key(json: &str) -> bool {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
            return false;
        };
        value
            .get("keys")
            .and_then(|keys| keys.as_object())
            .map(|keys| keys.keys().any(|key| key.ends_with("access_key")))
            .unwrap_or(false)
    }

    let Some(blob) = db.get(SNAPSHOT_KEY).map_err(|e| e.to_string())? else {
        return Ok(());
    };
    let Ok(previous) = open_json(blob.as_ref()) else {
        return Ok(());
    };
    if has_access_key(&previous) && !has_access_key(next) {
        fs::write(root_dir()?.join("account-recovery.wpb"), blob.as_ref())
            .map_err(|e| format!("创建账号保护快照失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn local_db_save(content: String) -> Result<LocalDbInfo, String> {
    tauri::async_runtime::spawn_blocking(move || local_db_save_impl(content)).await.map_err(|e| e.to_string())?
}

fn local_db_save_impl(content: String) -> Result<LocalDbInfo, String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    if content.len() > 64 * 1024 * 1024 {
        return Err("本地数据库超过 64MB，已拒绝写入".to_string());
    }
    let db = open_db()?;
    protect_account_snapshot(&db, &content)?;
    backup_blob(&db)?;
    let sealed = seal_json(&content)?;
    db.insert(SNAPSHOT_KEY, sealed).map_err(|e| format!("写入数据库失败: {e}"))?;
    db.insert(SAVED_AT_KEY, timestamp().to_string().into_bytes()).map_err(|e| e.to_string())?;
    db.flush().map_err(|e| format!("刷新数据库失败: {e}"))?;
    let _ = fs::rename(legacy_path()?, root_dir()?.join("data.legacy.json"));
    local_db_info()
}

/// Intentional protection erase must bypass backup/recovery preservation.
#[tauri::command]
pub async fn local_db_erase(content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || local_db_erase_impl(content)).await.map_err(|e| e.to_string())?
}

fn local_db_erase_impl(content: String) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let keys = value.get("keys").and_then(|v| v.as_object()).ok_or("Invalid erase snapshot")?;
    if keys.len() != 1 || !keys.contains_key("workplan_protection_erase") {
        return Err("Erase snapshot may only contain a deletion journal".into());
    }
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let db = open_db()?;
    let sealed = seal_json(&content)?;
    let mut batch = sled::Batch::default();
    for entry in db.iter() {
        let (key, _) = entry.map_err(|e| e.to_string())?;
        batch.remove(key);
    }
    batch.insert(SNAPSHOT_KEY, sealed);
    db.apply_batch(batch).map_err(|e| e.to_string())?;
    db.flush().map_err(|e| e.to_string())?;
    // Only app-owned, explicitly named files; never follow directory links.
    for name in ["data.json", "data.legacy.json", "account-recovery.wpb"] {
        let path = root_dir()?.join(name);
        if path.exists() { fs::remove_file(path).map_err(|e| e.to_string())?; }
    }
    for entry in fs::read_dir(backup_dir()?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_file()
            && entry.path().extension().map(|ext| ext == "wpb").unwrap_or(false) {
            fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Recovery for the `planpro_` → `workplan_` rename: the JS mirror briefly
/// flushed a snapshot containing only incidental keys, hiding the account
/// while the previous good snapshot was still in `backups/`. Prefer the stable
/// protected copy (backups rotate), then scan backups newest-first.
#[tauri::command]
pub fn local_db_recover() -> Result<Option<String>, String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let db = open_db()?;
    if let Some(blob) = db.get(SNAPSHOT_KEY).map_err(|e| e.to_string())? {
        if let Ok(json) = open_json(blob.as_ref()) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) {
                if value.get("keys").and_then(|keys| keys.get("workplan_protection_erase")).is_some() {
                    return Ok(None);
                }
            }
        }
    }
    fn has_account(json: &str) -> bool {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
            return false;
        };
        value
            .get("keys")
            .and_then(|keys| keys.as_object())
            .map(|keys| {
                keys.keys().any(|key| {
                    key.ends_with("access_key") || key.contains("account_stash")
                })
            })
            .unwrap_or(false)
    }

    let protected = root_dir()?.join("account-recovery.wpb");
    if let Ok(blob) = fs::read(&protected) {
        if let Ok(json) = open_json(&blob) {
            if has_account(&json) {
                return Ok(Some(json));
            }
        }
    }

    let dir = backup_dir()?;
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().map(|ext| ext == "wpb").unwrap_or(false))
        .collect();
    files.sort_by_key(|path| {
        std::cmp::Reverse(
            fs::metadata(path)
                .and_then(|meta| meta.modified())
                .unwrap_or(UNIX_EPOCH),
        )
    });

    for path in files {
        let Ok(blob) = fs::read(&path) else { continue };
        let Ok(json) = open_json(&blob) else { continue };
        if has_account(&json) {
            return Ok(Some(json));
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn local_db_info() -> Result<LocalDbInfo, String> {
    ensure_dirs()?;
    let db = open_db()?;
    let snapshot = db.get(SNAPSHOT_KEY).map_err(|e| e.to_string())?;
    let saved_at = db
        .get(SAVED_AT_KEY)
        .ok()
        .flatten()
        .and_then(|value| String::from_utf8(value.to_vec()).ok())
        .and_then(|value| value.parse::<u64>().ok());
    let backups = fs::read_dir(backup_dir()?)
        .map(|items| items.filter_map(|item| item.ok()).count())
        .unwrap_or(0);
    Ok(LocalDbInfo {
        path: db_dir()?.to_string_lossy().to_string(),
        backup_dir: backup_dir()?.to_string_lossy().to_string(),
        exists: snapshot.is_some(),
        bytes: snapshot.map(|value| value.len() as u64).unwrap_or(0),
        saved_at,
        backups,
    })
}

#[tauri::command]
pub fn local_db_backup(destination: String) -> Result<String, String> {
    let db = open_db()?;
    let blob = db
        .get(SNAPSHOT_KEY)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "本地数据库尚未创建".to_string())?;
    let target = PathBuf::from(destination);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建备份目录失败: {e}"))?;
    }
    fs::write(&target, blob.as_ref()).map_err(|e| format!("导出数据库备份失败: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn local_db_restore(source: String) -> Result<String, String> {
    let bytes = fs::read(&source).map_err(|e| format!("读取备份文件失败: {e}"))?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("备份文件超过 64MB".to_string());
    }
    // Accept both the encrypted .wpb snapshot and a legacy plaintext JSON export.
    let content = if bytes.starts_with(MAGIC) {
        open_json(&bytes)?
    } else {
        String::from_utf8(bytes).map_err(|e| format!("备份文件编码错误: {e}"))?
    };
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| format!("备份文件不是有效 JSON: {e}"))?;
    if value.get("format").and_then(|v| v.as_str()) != Some("workplan-local-db") {
        return Err("不是 WorkPlan 本地数据库备份".to_string());
    }
    local_db_save_impl(content.clone())?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_snapshot_round_trips_without_plaintext() {
        let json = r#"{"format":"workplan-local-db","version":1,"keys":{"planpro_notes":"[{\"title\":\"secret\"}]"}}"#;
        let blob = seal_json(json).expect("seal");
        assert!(blob.starts_with(MAGIC));
        assert!(!blob.windows("secret".len()).any(|window| window == b"secret"));
        assert!(blob.len() < json.len() + 64);
        assert_eq!(open_json(&blob).expect("open"), json);
    }

    #[test]
    fn tampered_snapshot_is_rejected() {
        let blob = seal_json("{\"format\":\"workplan-local-db\"}").expect("seal");
        let mut tampered = blob.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0xff;
        assert!(open_json(&tampered).is_err());
    }
}
