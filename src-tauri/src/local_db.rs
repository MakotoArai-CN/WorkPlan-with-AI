use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FilePath;

const LEGACY_MAGIC: &[u8; 5] = b"WPDB1";
const MAGIC: &[u8; 5] = b"WPDB2";
const PORTABLE_MAGIC: &[u8; 5] = b"WPBP2";
const PORTABLE_ITERATIONS: u32 = 600_000;
const MAX_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;
const SNAPSHOT_KEY: &[u8] = b"snapshot";
const SAVED_AT_KEY: &[u8] = b"saved_at";
// Compatibility only: new snapshots never use the old globally shared key.
const LEGACY_APP_DB_SECRET: &[u8] = b"WorkPlan::LocalDatabase::sled::AES-GCM::v1";
static DB: OnceLock<sled::Db> = OnceLock::new();
static WRITE_LOCK: Mutex<()> = Mutex::new(());
static HIDDEN: OnceLock<()> = OnceLock::new();
#[cfg(any(target_os = "android", target_os = "ios"))]
static MOBILE_ROOT: OnceLock<PathBuf> = OnceLock::new();

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

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法定位用户目录".to_string())
}

fn root_dir() -> Result<PathBuf, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    { Ok(home_dir()?.join(".workplan")) }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    { MOBILE_ROOT.get().cloned().ok_or_else(|| "应用私有数据库目录尚未初始化".to_string()) }
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
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for dir in [root_dir()?, db_dir()?, backup_dir()?] {
            fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
        }
    }
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

fn key_error() -> String {
    "本地数据库密钥丢失或损坏；请恢复原 .local-db-key 或导入使用备份密码加密的可移植备份，禁止覆盖原数据库".into()
}

fn read_or_create_key(path: &Path, allow_create: bool) -> Result<[u8; 32], String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if !meta.file_type().is_file() || meta.len() != 32 { return Err(key_error()); }
            let bytes = fs::read(path).map_err(|_| key_error())?;
            let key: [u8; 32] = bytes.try_into().map_err(|_| key_error())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
            }
            Ok(key)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && allow_create => {
            let mut key = [0u8; 32];
            getrandom::fill(&mut key).map_err(|e| e.to_string())?;
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            match options.open(path) {
                Ok(mut file) => {
                    file.write_all(&key).map_err(|e| e.to_string())?;
                    file.sync_all().map_err(|e| e.to_string())?;
                    Ok(key)
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => read_or_create_key(path, false),
                Err(error) => Err(format!("无法创建本地数据库密钥: {error}")),
            }
        }
        Err(_) => Err(key_error()),
    }
}

fn has_local_v2_data() -> Result<bool, String> {
    if open_db()?.get(SNAPSHOT_KEY).map_err(|e| e.to_string())?.map(|blob| blob.starts_with(MAGIC)).unwrap_or(false) {
        return Ok(true);
    }
    let mut files = vec![root_dir()?.join("account-recovery.wpb")];
    for entry in fs::read_dir(backup_dir()?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_file() { files.push(entry.path()); }
    }
    for path in files {
        if !path.exists() { continue; }
        let mut header = [0u8; 5];
        let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
        if file.read_exact(&mut header).is_ok() && &header == MAGIC { return Ok(true); }
    }
    Ok(false)
}

fn installation_key(allow_create: bool) -> Result<[u8; 32], String> {
    ensure_dirs()?;
    let path = root_dir()?.join(".local-db-key");
    if fs::symlink_metadata(&path).is_ok() { return read_or_create_key(&path, false); }
    let can_create = allow_create && !has_local_v2_data()?;
    read_or_create_key(&path, can_create)
}

fn seal_with_key(json: &str, key: &[u8; 32], header: &[u8]) -> Result<Vec<u8>, String> {
    let compressed = zstd::encode_all(json.as_bytes(), 3).map_err(|e| format!("压缩数据库失败: {e}"))?;
    let mut nonce_bytes = [0u8; 12];
    getrandom::fill(&mut nonce_bytes).map_err(|e| format!("生成数据库随机数失败: {e}"))?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), Payload { msg: compressed.as_ref(), aad: header })
        .map_err(|_| "加密数据库失败".to_string())?;
    let mut blob = Vec::with_capacity(header.len() + nonce_bytes.len() + ciphertext.len());
    blob.extend_from_slice(header);
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);
    Ok(blob)
}

fn open_with_key(blob: &[u8], key: &[u8; 32], header: &[u8], legacy: bool) -> Result<String, String> {
    if blob.len() <= header.len() + 12 || !blob.starts_with(header) {
        return Err("不是 WorkPlan 加密数据库".to_string());
    }
    let nonce = Nonce::from_slice(&blob[header.len()..header.len() + 12]);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let compressed = cipher
        .decrypt(nonce, Payload { msg: &blob[header.len() + 12..], aad: if legacy { &[] } else { header } })
        .map_err(|_| "数据库解密失败：密钥或备份密码不匹配，或文件已损坏".to_string())?;
    let decoder = zstd::stream::read::Decoder::new(compressed.as_slice()).map_err(|e| format!("解压数据库失败: {e}"))?;
    let mut json = Vec::new();
    decoder.take(MAX_SNAPSHOT_BYTES as u64 + 1).read_to_end(&mut json).map_err(|e| format!("解压数据库失败: {e}"))?;
    if json.len() > MAX_SNAPSHOT_BYTES { return Err("解压后的数据库超过64MB，已拒绝载入".into()); }
    String::from_utf8(json).map_err(|e| format!("数据库内容不是 UTF-8: {e}"))
}

fn seal_json(json: &str) -> Result<Vec<u8>, String> {
    let key = installation_key(true)?;
    // A syntactically valid but wrong key file must not overwrite a database
    // whose existing authentication tag can no longer be verified.
    if let Some(current) = open_db()?.get(SNAPSHOT_KEY).map_err(|e| e.to_string())? {
        if current.starts_with(MAGIC) { open_with_key(&current, &key, MAGIC, false)?; }
    }
    seal_with_key(json, &key, MAGIC)
}

fn open_json(blob: &[u8]) -> Result<String, String> {
    if blob.starts_with(LEGACY_MAGIC) {
        let key: [u8; 32] = Sha256::digest(LEGACY_APP_DB_SECRET).into();
        return open_with_key(blob, &key, LEGACY_MAGIC, true);
    }
    open_with_key(blob, &installation_key(false)?, MAGIC, false)
}

fn seal_portable(json: &str, passphrase: &str) -> Result<Vec<u8>, String> {
    if passphrase.chars().count() < 8 || passphrase.len() > 4096 {
        return Err("Portable backup passphrase must contain at least 8 characters".into());
    }
    let mut salt = [0u8; 16];
    getrandom::fill(&mut salt).map_err(|e| e.to_string())?;
    let mut header = PORTABLE_MAGIC.to_vec();
    header.extend_from_slice(&PORTABLE_ITERATIONS.to_le_bytes());
    header.extend_from_slice(&salt);
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), &salt, PORTABLE_ITERATIONS, &mut key);
    seal_with_key(json, &key, &header)
}

fn open_portable(blob: &[u8], passphrase: &str) -> Result<String, String> {
    if passphrase.len() > 4096 { return Err("Invalid backup passphrase".into()); }
    const HEADER_LEN: usize = 5 + 4 + 16;
    if !blob.starts_with(PORTABLE_MAGIC) || blob.len() < HEADER_LEN + 12 + 16 {
        return Err("Invalid portable backup format".into());
    }
    let iterations = u32::from_le_bytes(blob[5..9].try_into().map_err(|_| "Invalid backup parameters")?);
    if !(100_000..=2_000_000).contains(&iterations) {
        return Err("Backup key parameters outside supported range".into());
    }
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), &blob[9..25], iterations, &mut key);
    open_with_key(blob, &key, &blob[..HEADER_LEN], false)
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
pub async fn local_db_load(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        use tauri::Manager;
        let private = app.path().app_data_dir().map_err(|e| e.to_string())?;
        // Android applications do not reliably expose HOME. Resolve private
        // storage through the native runtime before any filesystem operation.
        let _ = MOBILE_ROOT.set(private.join(".workplan"));
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let _ = app;
    tauri::async_runtime::spawn_blocking(local_db_load_impl).await.map_err(|e| e.to_string())?
}

fn local_db_load_impl() -> Result<Option<String>, String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let db = open_db()?;
    if let Some(blob) = db.get(SNAPSHOT_KEY).map_err(|e| e.to_string())? {
        let json = open_json(blob.as_ref())?;
        if blob.starts_with(LEGACY_MAGIC) {
            let upgraded = seal_json(&json)?;
            db.insert(SNAPSHOT_KEY, upgraded).map_err(|e| e.to_string())?;
            db.flush().map_err(|e| e.to_string())?;
        }
        return Ok(Some(json));
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

// Attempt state is a native-only sled record. Renderer snapshot writes cannot
// reset its counter, and callers cannot supply a substitute password verifier.
pub(crate) fn with_vault_guard<T>(verify: impl FnOnce(&str, &mut crate::vault_guard::AttemptState) -> Result<T, String>) -> Result<T, String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let db = open_db()?;
    let blob = db.get(SNAPSHOT_KEY).map_err(|e| e.to_string())?.ok_or("Vault not initialized")?;
    let snapshot: serde_json::Value = serde_json::from_str(&open_json(&blob)?).map_err(|e| e.to_string())?;
    let verifier = snapshot.get("keys").and_then(|keys| keys.get("workplan_master_hash")).and_then(|value| value.as_str()).ok_or("Vault not initialized")?;
    with_vault_attempt_state(db, verifier, verify)
}

fn with_vault_attempt_state<T>(db: &sled::Db, verifier: &str, verify: impl FnOnce(&str, &mut crate::vault_guard::AttemptState) -> Result<T, String>) -> Result<T, String> {
    let key = format!("vault-attempts:{:x}", Sha256::digest(verifier.as_bytes()));
    let mut state = match db.get(key.as_bytes()).map_err(|e| e.to_string())? {
        Some(value) => serde_json::from_slice(&value).map_err(|_| "Invalid verification state")?,
        None => crate::vault_guard::AttemptState::default(),
    };
    let result = verify(verifier, &mut state)?;
    db.insert(key.as_bytes(), serde_json::to_vec(&state).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    db.flush().map_err(|e| e.to_string())?;
    Ok(result)
}

fn validate_snapshot(content: &str) -> Result<(), String> {
    if content.len() > MAX_SNAPSHOT_BYTES { return Err("本地数据库超过64MB，已拒绝写入".into()); }
    let value: serde_json::Value = serde_json::from_str(content).map_err(|_| "无效的数据库快照JSON")?;
    if value.get("format").and_then(|value| value.as_str()) != Some("workplan-local-db")
        || value.get("version").and_then(|value| value.as_u64()) != Some(1) {
        return Err("不支持的数据库快照格式".into());
    }
    let keys = value.get("keys").and_then(|value| value.as_object()).ok_or("数据库快照缺少键值对象")?;
    if keys.iter().any(|(key, value)| !(key.starts_with("workplan_") || key.starts_with("planpro_")) || !value.is_string()) {
        return Err("数据库快照包含非法键值".into());
    }
    Ok(())
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
    validate_snapshot(&content)?;
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

/// Recovery for the `planpro_` → `workplan_` rename: the JS mirror briefly
/// flushed a snapshot containing only incidental keys, hiding the account
/// while the previous good snapshot was still in `backups/`. Prefer the stable
/// protected copy (backups rotate), then scan backups newest-first.
#[tauri::command]
pub fn local_db_recover() -> Result<Option<String>, String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let db = open_db()?;
    if let Some(blob) = db.get(SNAPSHOT_KEY).map_err(|e| e.to_string())? {
        // Do not conceal a missing/wrong installation key by loading an older
        // globally keyed backup and replacing the newer unreadable snapshot.
        if blob.starts_with(MAGIC) { open_json(&blob)?; }
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
pub async fn local_db_backup(app: tauri::AppHandle, destination: Option<String>, passphrase: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let passphrase = passphrase.unwrap_or_default();
        if passphrase.chars().count() < 8 { return Err("Portable backup requires a passphrase of at least 8 characters".into()); }
        let suggestion = crate::sanitize_download_filename(destination.as_deref().unwrap_or("WorkPlan-LocalDB.wpb"))?;
        let Some(selected) = app.dialog().file().set_file_name(suggestion).add_filter("WorkPlan Database", &["wpb"]).blocking_save_file() else {
            return Err("CANCELLED:Backup canceled".into());
        };
        let FilePath::Path(target) = selected else { return Err("Use the application backup screen for document-provider exports".into()); };
        local_db_backup_impl(target.to_string_lossy().into_owned(), passphrase)
    }).await.map_err(|e| e.to_string())?
}

fn local_db_backup_impl(destination: String, passphrase: String) -> Result<String, String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let db = open_db()?;
    let blob = db
        .get(SNAPSHOT_KEY)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "本地数据库尚未创建".to_string())?;
    let portable = seal_portable(&open_json(blob.as_ref())?, &passphrase)?;
    let target = PathBuf::from(destination);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建备份目录失败: {e}"))?;
    }
    fs::write(&target, portable).map_err(|e| format!("导出数据库备份失败: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn local_db_restore(app: tauri::AppHandle, passphrase: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app.dialog().file().add_filter("WorkPlan Database", &["wpb", "json"]).blocking_pick_file() else {
            return Err("CANCELLED:Restore canceled".into());
        };
        let FilePath::Path(source) = selected else { return Err("Use the application backup screen for document-provider imports".into()); };
        local_db_restore_impl(source.to_string_lossy().into_owned(), passphrase.unwrap_or_default())
    }).await.map_err(|e| e.to_string())?
}

fn local_db_restore_impl(source: String, passphrase: String) -> Result<String, String> {
    if fs::metadata(&source).map_err(|e| e.to_string())?.len() > MAX_SNAPSHOT_BYTES as u64 {
        return Err("备份文件超过64MB".into());
    }
    let bytes = fs::read(&source).map_err(|e| format!("读取备份文件失败: {e}"))?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("备份文件超过 64MB".to_string());
    }
    // New exports are portable passphrase-encrypted; local auto backups are
    // installation-bound. Existing WPDB1 exports remain readable for migration.
    let content = if bytes.starts_with(PORTABLE_MAGIC) {
        open_portable(&bytes, &passphrase)?
    } else if bytes.starts_with(MAGIC) || bytes.starts_with(LEGACY_MAGIC) {
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
        let key = [0x51u8; 32];
        let blob = seal_with_key(json, &key, MAGIC).expect("seal");
        assert!(blob.starts_with(MAGIC));
        assert!(!blob.windows("secret".len()).any(|window| window == b"secret"));
        assert!(blob.len() < json.len() + 64);
        assert_eq!(open_with_key(&blob, &key, MAGIC, false).expect("open"), json);
    }

    #[test]
    fn tampered_snapshot_is_rejected() {
        let key = [0x52u8; 32];
        let blob = seal_with_key("{\"format\":\"workplan-local-db\"}", &key, MAGIC).expect("seal");
        let mut tampered = blob.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0xff;
        assert!(open_with_key(&tampered, &key, MAGIC, false).is_err());
        assert!(open_with_key(&blob, &[0x53u8; 32], MAGIC, false).is_err());
    }

    #[test]
    fn legacy_snapshot_opens_without_installation_key() {
        let key: [u8; 32] = Sha256::digest(LEGACY_APP_DB_SECRET).into();
        let json = "{\"format\":\"workplan-local-db\"}";
        let compressed = zstd::encode_all(json.as_bytes(), 3).expect("compress");
        let nonce = [0x37u8; 12];
        let encrypted = Aes256Gcm::new_from_slice(&key).expect("cipher")
            .encrypt(Nonce::from_slice(&nonce), compressed.as_ref()).expect("encrypt");
        let mut blob = LEGACY_MAGIC.to_vec();
        blob.extend_from_slice(&nonce);
        blob.extend_from_slice(&encrypted);
        assert_eq!(open_json(&blob).expect("legacy open"), json);
    }

    #[test]
    fn portable_backup_is_independent_of_installation_and_authenticates_parameters() {
        let json = "{\"format\":\"workplan-local-db\",\"keys\":{\"test\":\"value\"}}";
        let passphrase = "a separate portable backup phrase";
        let blob = seal_portable(json, passphrase).expect("portable encrypt");
        assert!(blob.starts_with(PORTABLE_MAGIC));
        assert_eq!(open_portable(&blob, passphrase).expect("portable decrypt"), json);
        assert!(open_portable(&blob, "wrong passphrase").is_err());
        assert!(seal_portable(json, "short").is_err());
        let mut tampered = blob;
        tampered[9] ^= 1;
        assert!(open_portable(&tampered, passphrase).is_err());
        tampered[5..9].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(open_portable(&tampered, passphrase).is_err());
    }

    #[test]
    fn installation_keys_are_random_stable_and_never_recreated_if_disallowed_or_corrupt() {
        let mut suffix = [0u8; 12];
        getrandom::fill(&mut suffix).expect("random");
        let root = std::env::temp_dir().join(format!("workplan-key-test-{:x}", u128::from_le_bytes({ let mut b = [0u8; 16]; b[..12].copy_from_slice(&suffix); b })));
        fs::create_dir(&root).expect("test dir");
        let first = root.join("first-key");
        let second = root.join("second-key");
        assert!(read_or_create_key(&first, false).is_err());
        assert!(!first.exists());
        let a = read_or_create_key(&first, true).expect("create");
        let b = read_or_create_key(&second, true).expect("create independent");
        assert_ne!(a, b);
        assert_eq!(read_or_create_key(&first, false).expect("stable"), a);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&first).expect("metadata").permissions().mode() & 0o777, 0o600);
        }
        fs::write(&first, b"corrupt").expect("corrupt fixture");
        assert!(read_or_create_key(&first, true).is_err());
        assert_eq!(fs::read(&first).expect("unchanged"), b"corrupt");
        fs::remove_file(first).expect("cleanup");
        fs::remove_file(second).expect("cleanup");
        fs::remove_dir(root).expect("cleanup dir");
    }

    #[test]
    fn malformed_renderer_snapshots_are_rejected_without_opening_a_database() {
        for invalid in ["bad", "{}", r#"{"format":"workplan-local-db","version":2,"keys":{}}"#,
            r#"{"format":"workplan-local-db","version":1,"keys":{"unrelated":"value"}}"#,
            r#"{"format":"workplan-local-db","version":1,"keys":{"workplan_notes":{}}}"#] {
            assert!(validate_snapshot(invalid).is_err());
        }
        assert!(validate_snapshot(r#"{"format":"workplan-local-db","version":1,"keys":{"planpro_notes":"[]","workplan_master_hash":"verifier"}}"#).is_ok());
    }

    #[test]
    fn native_attempt_state_survives_snapshot_replacement_in_an_isolated_database() {
        let db = sled::Config::new().temporary(true).open().expect("isolated db");
        with_vault_attempt_state(&db, "same-verifier", |_, state| {
            *state = serde_json::from_value(serde_json::json!({ "failures": 5, "next_allowed": 42000 })).unwrap();
            Ok(())
        }).expect("persist failure");
        db.insert(SNAPSHOT_KEY, b"renderer-replaced-snapshot").expect("replace renderer state");
        with_vault_attempt_state(&db, "same-verifier", |_, state| {
            let value = serde_json::to_value(state).unwrap();
            assert_eq!(value["failures"], 5);
            assert_eq!(value["next_allowed"], 42000);
            Ok(())
        }).expect("retained limiter");
        with_vault_attempt_state(&db, "another-verifier", |_, state| {
            assert_eq!(serde_json::to_value(state).unwrap()["failures"], 0);
            Ok(())
        }).expect("independent vault");
    }
}
