use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, Manager};

const MAX_SIZE: u64 = 600 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
pub struct Asset {
    name: String,
    size: u64,
    digest: String,
    #[serde(skip_serializing)]
    url: String,
}

fn asset_name(version: &str, os: &str, arch: &str) -> Result<String, String> {
    let arch = match arch {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "x86",
        "arm" => "arm",
        _ => return Err("Unsupported update architecture".into()),
    };
    match (os, arch) {
        ("windows", "x64" | "arm64" | "x86") => Ok(format!("WorkPlan_{version}_{arch}-setup.exe")),
        ("macos", "x64") => Ok(format!("WorkPlan_{version}_x64.dmg")),
        ("macos", "arm64") => Ok(format!("WorkPlan_{version}_aarch64.dmg")),
        ("linux", "x64") => Ok(format!("WorkPlan_{version}_amd64.AppImage")),
        ("android", _) => Ok(format!(
            "workplan-android-{}.apk",
            if arch == "x64" { "x86_64" } else { arch }
        )),
        _ => Err("No compatible in-app update package".into()),
    }
}

pub fn select_asset(data: &Value, version: &str, os: &str, arch: &str) -> Result<Asset, String> {
    if data["draft"] != false
        || data["prerelease"] != false
        || data["tag_name"] != format!("v{version}")
    {
        return Err("Not a stable matching release".into());
    }
    let name = asset_name(version, os, arch)?;
    let matches: Vec<_> = data["assets"]
        .as_array()
        .ok_or("Release has no assets")?
        .iter()
        .filter(|asset| asset["name"] == name)
        .collect();
    if matches.len() != 1 {
        return Err("Compatible package missing or ambiguous".into());
    }
    let item = matches[0];
    let digest = item["digest"]
        .as_str()
        .and_then(|value| value.strip_prefix("sha256:"))
        .ok_or("Package has no SHA-256 digest")?;
    if digest.len() != 64 || !digest.bytes().all(|value| value.is_ascii_hexdigit()) {
        return Err("Invalid package digest".into());
    }
    let size = item["size"]
        .as_u64()
        .filter(|size| *size > 0 && *size <= MAX_SIZE)
        .ok_or("Invalid package size")?;
    let url = format!(
        "https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/download/v{version}/{name}"
    );
    if item["browser_download_url"] != url {
        return Err("Package is not from the official release".into());
    }
    Ok(Asset {
        name,
        size,
        digest: digest.to_ascii_lowercase(),
        url,
    })
}

fn allowed_url(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && matches!(
            url.host_str(),
            Some(
                "github.com"
                    | "release-assets.githubusercontent.com"
                    | "objects.githubusercontent.com"
                    | "github-releases.githubusercontent.com"
            )
        )
}

fn release_version(url: &url::Url) -> Result<String, String> {
    if url.scheme() != "https" || url.host_str() != Some("github.com") {
        return Err("Invalid official release URL".into());
    }
    let version = url
        .path()
        .strip_prefix("/MakotoArai-CN/WorkPlan-with-AI/releases/tag/v")
        .ok_or("Missing official release version")?;
    if version.split('.').count() != 3
        || version.split('.').any(|part| {
            part.is_empty()
                || !part.bytes().all(|byte| byte.is_ascii_digit())
                || part.parse::<u32>().is_err()
        })
    {
        return Err("Invalid stable release version".into());
    }
    Ok(version.into())
}

fn manifest_digest(manifest: &str, name: &str) -> Result<String, String> {
    let values: Vec<_> = manifest
        .lines()
        .filter_map(|line| {
            let (hash, filename) = line.split_once(char::is_whitespace)?;
            (filename.trim().trim_start_matches('*') == name).then_some(hash)
        })
        .collect();
    if values.len() != 1
        || values[0].len() != 64
        || !values[0].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("Missing or invalid official checksum".into());
    }
    Ok(values[0].to_ascii_lowercase())
}

// Public release downloads remain usable when GitHub's anonymous API quota is
// exhausted. The checksum still comes from this repository's HTTPS release,
// never a user-supplied URL, API token or unverified alternate mirror.
pub async fn fetch_public_release(requested: Option<&str>) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && allowed_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .head("https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/latest")
        .header("User-Agent", "WorkPlan")
        .send()
        .await
        .map_err(|_| "Unable to connect to the official release page")?;
    if !response.status().is_success() {
        return Err("Official release page is unavailable".into());
    }
    let version = release_version(response.url())?;
    if requested.is_some_and(|requested| requested != version) {
        return Err("The latest release changed; check for updates again".into());
    }
    let name = asset_name(&version, std::env::consts::OS, std::env::consts::ARCH)?;
    let base =
        format!("https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/download/v{version}");
    let mut response = client
        .get(format!("{base}/SHA256SUMS"))
        .header("User-Agent", "WorkPlan")
        .send()
        .await
        .map_err(|_| "Unable to download official checksums")?;
    if !response.status().is_success() {
        return Err("Official checksums are unavailable".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Checksum download interrupted")?
    {
        if bytes.len() + chunk.len() > 128 * 1024 {
            return Err("Checksum manifest is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let hash = manifest_digest(
        std::str::from_utf8(&bytes).map_err(|_| "Invalid checksum manifest")?,
        &name,
    )?;
    let package_url = format!("{base}/{name}");
    let package = client
        .head(&package_url)
        .header("User-Agent", "WorkPlan")
        .header("Accept-Encoding", "identity")
        .send()
        .await
        .map_err(|_| "Unable to check official package size")?;
    if !package.status().is_success() {
        return Err("Official package is unavailable".into());
    }
    let size = package
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|size| *size > 0 && *size <= MAX_SIZE)
        .ok_or("Official package size is unavailable")?;
    Ok(
        json!({"tag_name":format!("v{version}"),"draft":false,"prerelease":false,"assets":[{"name":name,"size":size,"digest":format!("sha256:{hash}"),"browser_download_url":package_url}]}),
    )
}

#[derive(Default)]
struct Cancellation {
    canceled: AtomicBool,
    waker: Mutex<Option<std::task::Waker>>,
}
impl Cancellation {
    fn cancel(&self) {
        self.canceled.store(true, Ordering::Relaxed);
        if let Ok(waker) = self.waker.lock() {
            if let Some(waker) = waker.as_ref() {
                waker.wake_by_ref();
            }
        }
    }
}
async fn cancelable<T>(
    future: impl std::future::Future<Output = Result<T, String>>,
    token: &Cancellation,
) -> Result<T, String> {
    let mut future = Box::pin(future);
    std::future::poll_fn(|context| {
        if let Ok(mut waker) = token.waker.lock() {
            *waker = Some(context.waker().clone());
        }
        if token.canceled.load(Ordering::Relaxed) {
            std::task::Poll::Ready(Err("Download canceled".into()))
        } else {
            future.as_mut().poll(context)
        }
    })
    .await
}
struct Active {
    id: String,
    cancellation: Arc<Cancellation>,
}
#[derive(Clone)]
struct Verified {
    id: String,
    path: PathBuf,
    asset: Asset,
}
static ACTIVE: OnceLock<Mutex<Option<Active>>> = OnceLock::new();
static VERIFIED: OnceLock<Mutex<Option<Verified>>> = OnceLock::new();
fn active() -> &'static Mutex<Option<Active>> {
    ACTIVE.get_or_init(|| Mutex::new(None))
}
fn verified() -> &'static Mutex<Option<Verified>> {
    VERIFIED.get_or_init(|| Mutex::new(None))
}
struct DownloadGuard {
    id: String,
    partial: Option<PathBuf>,
}
impl Drop for DownloadGuard {
    fn drop(&mut self) {
        if let Some(path) = &self.partial {
            let _ = fs::remove_file(path);
        }
        if let Ok(mut state) = active().lock() {
            if state.as_ref().map(|job| &job.id) == Some(&self.id) {
                *state = None;
            }
        }
    }
}

fn verify_file(path: &std::path::Path, asset: &Asset) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "Downloaded package is missing")?;
    if !metadata.is_file() || metadata.len() != asset.size {
        return Err("Downloaded package size changed".into());
    }
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    if format!("{:x}", hash.finalize()) != asset.digest {
        return Err("Downloaded package SHA-256 verification failed".into());
    }
    Ok(())
}

fn cleanup_old_packages(directory: &std::path::Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for item in entries.flatten() {
        let name = item.file_name();
        let name = name.to_string_lossy();
        let Some((nonce, suffix)) = name.split_once('-') else {
            continue;
        };
        if nonce.len() != 32 || !nonce.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            continue;
        }
        if !(suffix.starts_with("WorkPlan_") || suffix.starts_with("workplan-android-")) {
            continue;
        }
        let Ok(meta) = item.file_type() else {
            continue;
        };
        if meta.is_file() {
            let _ = fs::remove_file(item.path());
        }
    }
}

async fn receive_package(
    mut response: reqwest::Response,
    file: &mut fs::File,
    asset: &Asset,
    canceled: &AtomicBool,
    notify: impl Fn(Value),
) -> Result<(), String> {
    if response
        .content_length()
        .is_some_and(|size| size != asset.size)
    {
        return Err("Update content length does not match release metadata".into());
    }
    let mut received = 0u64;
    let mut hash = Sha256::new();
    let mut last_progress = Instant::now();
    notify(json!({"received":0,"total":asset.size,"stage":"downloading"}));
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Update download interrupted")?
    {
        if canceled.load(Ordering::Relaxed) {
            return Err("Download canceled".into());
        }
        received += chunk.len() as u64;
        if received > asset.size {
            return Err("Update package exceeds declared size".into());
        }
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        hash.update(&chunk);
        if last_progress.elapsed() >= Duration::from_millis(150) {
            notify(json!({"received":received,"total":asset.size,"stage":"downloading"}));
            last_progress = Instant::now();
        }
    }
    if canceled.load(Ordering::Relaxed) {
        return Err("Download canceled".into());
    }
    notify(json!({"received":received,"total":asset.size,"stage":"verifying"}));
    if received != asset.size || format!("{:x}", hash.finalize()) != asset.digest {
        return Err("Update package SHA-256 verification failed".into());
    }
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cancel_update_download(id: String) {
    if let Ok(state) = active().lock() {
        if let Some(job) = state.as_ref().filter(|job| job.id == id) {
            job.cancellation.cancel();
        }
    }
}

#[tauri::command]
pub async fn download_update(
    app: tauri::AppHandle,
    version: String,
    id: String,
    progress: Channel<Value>,
) -> Result<Value, String> {
    if id.len() > 80 || id.is_empty() || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Invalid download ID".into());
    }
    let cancellation = Arc::new(Cancellation::default());
    {
        let mut state = active().lock().map_err(|e| e.to_string())?;
        if state.is_some() {
            return Err("An update is already downloading".into());
        }
        *state = Some(Active {
            id: id.clone(),
            cancellation: cancellation.clone(),
        });
    }
    let mut guard = DownloadGuard {
        id: id.clone(),
        partial: None,
    };
    let _ = progress.send(json!({"id":id,"received":0,"stage":"downloading"}));
    let check_cancel = || {
        if cancellation.canceled.load(Ordering::Relaxed) {
            Err("Download canceled".to_string())
        } else {
            Ok(())
        }
    };
    let data = cancelable(crate::updates::fetch_release(Some(&version)), &cancellation).await?;
    // IPC callers cannot supply arbitrary URLs, paths or hashes, or downgrade.
    let info = crate::updates::check_release_for_download(data.clone())?;
    if info["latest_version"] != version || info["has_update"] != true {
        return Err("Release is not newer than this installation".into());
    }
    let asset = select_asset(
        &data,
        &version,
        std::env::consts::OS,
        std::env::consts::ARCH,
    )?;
    check_cancel()?;
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("updates");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    // Only our own nonce-prefixed files are eligible. Do not recurse or touch
    // exported packages, installation data, or arbitrary user files.
    cleanup_old_packages(&directory);
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|e| e.to_string())?;
    let nonce: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let path = directory.join(format!("{nonce}-{}", asset.name));
    let partial = path.with_extension("part");
    guard.partial = Some(partial.clone());
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&partial).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(1800))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && allowed_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let response = cancelable(
        async {
            client
                .get(&asset.url)
                .header("User-Agent", "WorkPlan")
                .header("Accept-Encoding", "identity")
                .send()
                .await
                .map_err(|_| "Unable to download the update package".to_string())
        },
        &cancellation,
    )
    .await?;
    if !response.status().is_success() || !allowed_url(response.url()) {
        return Err(format!(
            "Update download returned HTTP {}",
            response.status().as_u16()
        ));
    }
    cancelable(
        receive_package(
            response,
            &mut file,
            &asset,
            &cancellation.canceled,
            |mut event| {
                event["id"] = json!(id);
                let _ = progress.send(event);
            },
        ),
        &cancellation,
    )
    .await?;
    drop(file);
    fs::rename(&partial, &path).map_err(|e| e.to_string())?;
    guard.partial = Some(path.clone());
    check_cancel()?;
    let previous = verified()
        .lock()
        .map_err(|e| e.to_string())?
        .replace(Verified {
            id: id.clone(),
            path: path.clone(),
            asset: asset.clone(),
        });
    guard.partial = None;
    if let Some(previous) = previous {
        let _ = fs::remove_file(previous.path);
    }
    Ok(json!({"id":id,"name":asset.name,"size":asset.size,"verified":true}))
}

#[tauri::command]
pub async fn open_downloaded_update(id: String) -> Result<Value, String> {
    let record = verified()
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .filter(|item| item.id == id)
        .cloned()
        .ok_or("No verified download for this request")?;
    tauri::async_runtime::spawn_blocking(move || {
        verify_file(&record.path, &record.asset)?;
        #[cfg(target_os = "android")]
        {
            return Ok(json!({"android_path": record.path.to_string_lossy()}));
        }
        #[cfg(not(target_os = "android"))]
        {
            #[cfg(target_os = "linux")]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&record.path, fs::Permissions::from_mode(0o700))
                    .map_err(|e| e.to_string())?;
            }
            open::that(&record.path).map_err(|e| e.to_string())?;
            Ok(json!({"opened":true}))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(os: &str, arch: &str) -> Value {
        let name = asset_name("0.6.0", os, arch).unwrap();
        json!({"tag_name":"v0.6.0","draft":false,"prerelease":false,"assets":[{"name":name,"size":4,"digest":format!("sha256:{:x}",Sha256::digest(b"test")),"browser_download_url":format!("https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/download/v0.6.0/{name}")}]})
    }
    #[test]
    fn platform_selection_and_untrusted_metadata() {
        for (os, arch) in [
            ("windows", "x86"),
            ("windows", "aarch64"),
            ("windows", "x86_64"),
            ("macos", "aarch64"),
            ("linux", "x86_64"),
            ("android", "arm"),
            ("android", "aarch64"),
            ("android", "x86_64"),
        ] {
            assert!(select_asset(&fixture(os, arch), "0.6.0", os, arch).is_ok());
        }
        for key in ["browser_download_url", "digest", "size"] {
            let mut data = fixture("windows", "x86_64");
            data["assets"][0][key] = json!("https://attacker.invalid");
            assert!(select_asset(&data, "0.6.0", "windows", "x86_64").is_err());
        }
        assert!(select_asset(
            &fixture("android", "aarch64"),
            "0.6.1",
            "android",
            "aarch64"
        )
        .is_err());
        assert!(asset_name("0.6.0", "linux", "arm").is_err());
    }
    #[test]
    fn redirects_are_restricted_to_official_https_hosts() {
        for url in [
            "https://github.com/a",
            "https://release-assets.githubusercontent.com/a",
        ] {
            assert!(allowed_url(&url::Url::parse(url).unwrap()));
        }
        for url in [
            "http://github.com/a",
            "https://github.com.attacker.invalid/a",
            "https://user@github.com/a",
            "https://127.0.0.1/a",
            "https://github.com:444/a",
        ] {
            assert!(!allowed_url(&url::Url::parse(url).unwrap()));
        }
    }

    #[test]
    fn official_fallback_rejects_untrusted_versions_and_ambiguous_checksums() {
        assert_eq!(
            release_version(
                &url::Url::parse(
                    "https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/tag/v0.6.0"
                )
                .unwrap()
            )
            .unwrap(),
            "0.6.0"
        );
        for value in [
            "https://attacker.invalid/MakotoArai-CN/WorkPlan-with-AI/releases/tag/v0.6.0",
            "https://github.com/other/repo/releases/tag/v0.6.0",
            "https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/tag/v0.6.0-beta",
        ] {
            assert!(release_version(&url::Url::parse(value).unwrap()).is_err());
        }
        let line = format!("{}  fixture.exe", "a".repeat(64));
        assert_eq!(
            manifest_digest(&line, "fixture.exe").unwrap(),
            "a".repeat(64)
        );
        assert!(manifest_digest(&format!("{line}\n{line}"), "fixture.exe").is_err());
        assert!(manifest_digest("bad  fixture.exe", "fixture.exe").is_err());
    }
    #[test]
    fn package_reverification_rejects_tampering_and_size_changes() {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let path =
            std::env::temp_dir().join(format!("workplan-update-{:x}", Sha256::digest(random)));
        let asset =
            select_asset(&fixture("windows", "x86_64"), "0.6.0", "windows", "x86_64").unwrap();
        fs::write(&path, b"test").unwrap();
        assert!(verify_file(&path, &asset).is_ok());
        fs::write(&path, b"evil").unwrap();
        assert!(verify_file(&path, &asset).is_err());
        fs::write(&path, b"longer").unwrap();
        assert!(verify_file(&path, &asset).is_err());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn streamed_download_validates_length_hash_cancellation_and_removes_partial_files() {
        for (body, declared, cancel, succeeds) in [
            ("test", 4, false, true),
            ("evil", 4, false, false),
            ("longer", 6, false, false),
            ("te", 4, false, false),
            ("test", 4, true, false),
        ] {
            let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = server.local_addr().unwrap();
            let writer = std::thread::spawn(move || {
                let (mut socket, _) = server.accept().unwrap();
                let mut request = [0u8; 4096];
                let _ = socket.read(&mut request);
                let _ = write!(socket,"HTTP/1.1 200 OK\r\nContent-Length: {declared}\r\nConnection: close\r\n\r\n{body}");
            });
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).unwrap();
            let path =
                std::env::temp_dir().join(format!("workplan-stream-{:x}", Sha256::digest(random)));
            let guard = DownloadGuard {
                id: "isolated-stream-fixture".into(),
                partial: Some(path.clone()),
            };
            let mut file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&path)
                .unwrap();
            let asset =
                select_asset(&fixture("windows", "x86_64"), "0.6.0", "windows", "x86_64").unwrap();
            let events = Mutex::new(Vec::new());
            let result = tauri::async_runtime::block_on(async {
                let response = reqwest::Client::new()
                    .get(format!("http://{address}"))
                    .send()
                    .await
                    .unwrap();
                receive_package(
                    response,
                    &mut file,
                    &asset,
                    &AtomicBool::new(cancel),
                    |event| events.lock().unwrap().push(event),
                )
                .await
            });
            assert_eq!(result.is_ok(), succeeds);
            drop(file);
            if succeeds {
                verify_file(&path, &asset).unwrap();
                assert_eq!(events.lock().unwrap().last().unwrap()["stage"], "verifying");
            }
            drop(guard);
            assert!(!path.exists());
            writer.join().unwrap();
        }
    }

    #[test]
    fn cache_cleanup_preserves_non_update_files_and_never_recurses() {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let root = std::env::temp_dir().join(format!(
            "workplan-update-clean-{:x}",
            Sha256::digest(random)
        ));
        fs::create_dir(&root).unwrap();
        let own = root.join(format!("{}-WorkPlan_0.6.0_x64-setup.part", "a".repeat(32)));
        let user = root.join("user-backup.exe");
        let nested = root.join(format!("{}-WorkPlan_folder", "b".repeat(32)));
        fs::write(&own, b"partial").unwrap();
        fs::write(&user, b"keep").unwrap();
        fs::create_dir(&nested).unwrap();
        cleanup_old_packages(&root);
        assert!(!own.exists());
        assert!(user.exists());
        assert!(nested.is_dir());
        fs::remove_file(user).unwrap();
        fs::remove_dir(nested).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn cancellation_interrupts_a_pending_network_future_without_waiting_for_timeout() {
        let token = Arc::new(Cancellation::default());
        let other = token.clone();
        let worker = std::thread::spawn(move || {
            while other.waker.lock().unwrap().is_none() {
                std::thread::sleep(Duration::from_millis(1));
            }
            other.cancel();
        });
        let result: Result<(), String> =
            tauri::async_runtime::block_on(cancelable(std::future::pending(), &token));
        assert_eq!(result.unwrap_err(), "Download canceled");
        worker.join().unwrap();
    }

    #[test]
    #[ignore = "Downloads a real official package; never launches or installs it"]
    fn official_package_download_round_trip() {
        tauri::async_runtime::block_on(async {
            let data = crate::updates::fetch_release(None).await.unwrap();
            let version = data["tag_name"].as_str().unwrap().trim_start_matches('v');
            let asset =
                select_asset(&data, version, std::env::consts::OS, std::env::consts::ARCH).unwrap();
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).unwrap();
            let path = std::env::temp_dir().join(format!(
                "workplan-official-download-{:x}",
                Sha256::digest(random)
            ));
            let guard = DownloadGuard {
                id: "official-download-fixture".into(),
                partial: Some(path.clone()),
            };
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .unwrap();
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(180))
                .read_timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if allowed_url(attempt.url()) && attempt.previous().len() < 5 {
                        attempt.follow()
                    } else {
                        attempt.stop()
                    }
                }))
                .build()
                .unwrap();
            let response = client
                .get(&asset.url)
                .header("User-Agent", "WorkPlan")
                .send()
                .await
                .unwrap();
            assert!(response.status().is_success());
            assert!(allowed_url(response.url()));
            receive_package(response, &mut file, &asset, &AtomicBool::new(false), |_| {})
                .await
                .unwrap();
            drop(file);
            verify_file(&path, &asset).unwrap();
            println!(
                "Verified official package {} ({} bytes), no installation performed",
                asset.name, asset.size
            );
            drop(guard);
            assert!(!path.exists());
        });
    }
}
