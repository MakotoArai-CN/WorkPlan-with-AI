use crate::update_files::publish_without_overwrite;
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
    #[serde(default)]
    download_only: bool,
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
        ("linux", "x64") => linux_asset_name(version),
        ("android", _) => Ok(format!(
            "workplan-android-{}.apk",
            if arch == "x64" { "x86_64" } else { arch }
        )),
        _ => Err("No compatible in-app update package".into()),
    }
}

fn linux_asset_name(version: &str) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        crate::linux_update::installed_package()
            .map(|package| crate::linux_update::asset_name(version, package))
            .ok_or(
                "Cannot identify a supported deb/rpm/zst installation; use the release page".into(),
            )
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = version;
        Err("Linux installation cannot be detected on this platform".into())
    }
}

pub fn select_asset(data: &Value, version: &str, os: &str, arch: &str) -> Result<Asset, String> {
    select_named_asset(data, version, &asset_name(version, os, arch)?)
}

fn select_named_asset(data: &Value, version: &str, name: &str) -> Result<Asset, String> {
    if data["draft"] != false
        || data["prerelease"] != false
        || data["tag_name"] != format!("v{version}")
    {
        return Err("Not a stable matching release".into());
    }
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
        name: name.into(),
        size,
        digest: digest.to_ascii_lowercase(),
        download_only: name.ends_with(".deb")
            || name.ends_with(".rpm")
            || name.ends_with(".pkg.tar.zst"),
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

const MIRRORS: [&str; 2] = ["https://ghfast.top/", "https://gh-proxy.com/"];

fn package_sources(official: &str) -> Result<Vec<String>, String> {
    let parsed = url::Url::parse(official).map_err(|_| "Invalid package source")?;
    if !allowed_url(&parsed)
        || parsed.host_str() != Some("github.com")
        || !parsed
            .path()
            .starts_with("/MakotoArai-CN/WorkPlan-with-AI/releases/download/v")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Invalid official package source".into());
    }
    Ok(std::iter::once(official.to_string())
        .chain(MIRRORS.iter().map(|mirror| format!("{mirror}{official}")))
        .collect())
}

fn allowed_package_url(url: &url::Url) -> bool {
    if allowed_url(url) {
        return true;
    }
    if url.scheme() != "https"
        || url.username() != ""
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return false;
    }
    matches!(url.host_str(), Some("ghfast.top" | "gh-proxy.com"))
        && url
            .path()
            .starts_with("/https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/download/v")
}

fn package_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(12))
        .read_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(1800))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && allowed_package_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|error| error.to_string())
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
    let Ok(name) = asset_name(&version, std::env::consts::OS, std::env::consts::ARCH) else {
        return Ok(
            json!({"tag_name":format!("v{version}"),"draft":false,"prerelease":false,"assets":[]}),
        );
    };
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
    // Mirrors supply transport only. The hash above must have been obtained
    // from the official HTTPS release; never use a mirror-provided checksum.
    let transport = package_client()?;
    let mut size = None;
    for source in package_sources(&package_url)? {
        let Ok(package) = transport
            .head(source)
            .header("User-Agent", "WorkPlan")
            .header("Accept-Encoding", "identity")
            .timeout(Duration::from_secs(20))
            .send()
            .await
        else {
            continue;
        };
        if !package.status().is_success() || !allowed_package_url(package.url()) {
            continue;
        }
        size = package
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|size| *size > 0 && *size <= MAX_SIZE);
        if size.is_some() {
            break;
        }
    }
    let size = size.ok_or("Official package and built-in mirrors are unavailable")?;
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
    verify_file_checked(path, asset, || Ok(()))
}

fn verify_file_checked(
    path: &std::path::Path,
    asset: &Asset,
    check: impl Fn() -> Result<(), String>,
) -> Result<(), String> {
    check()?;
    let metadata = fs::symlink_metadata(path).map_err(|_| "Downloaded package is missing")?;
    if !metadata.is_file() || metadata.len() != asset.size {
        return Err("Downloaded package size changed".into());
    }
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        check()?;
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    if format!("{:x}", hash.finalize()) != asset.digest {
        return Err("Downloaded package SHA-256 verification failed".into());
    }
    check()
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

async fn receive_from_sources<F, Fut>(
    sources: Vec<String>,
    file: &mut fs::File,
    asset: &Asset,
    cancellation: &Cancellation,
    mut fetch: F,
    notify: impl Fn(Value),
) -> Result<(), String>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = Result<reqwest::Response, String>>,
{
    use std::io::{Seek, SeekFrom};
    for (attempt, source) in sources.into_iter().enumerate() {
        if cancellation.canceled.load(Ordering::Relaxed) {
            return Err("Download canceled".into());
        }
        file.set_len(0).map_err(|error| error.to_string())?;
        file.seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        notify(json!({"received":0,"total":asset.size,"stage":"downloading","attempt":attempt}));
        let result = cancelable(
            async {
                let response = fetch(source).await?;
                receive_package(
                    response,
                    file,
                    asset,
                    &cancellation.canceled,
                    |mut event| {
                        event["attempt"] = json!(attempt);
                        notify(event);
                    },
                )
                .await
            },
            cancellation,
        )
        .await;
        if result.is_ok() {
            return Ok(());
        }
        if cancellation.canceled.load(Ordering::Relaxed) {
            return Err("Download canceled".into());
        }
    }
    Err("Official source and built-in mirrors failed or checksum did not match".into())
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
    let directory = if asset.download_only {
        let directory = app
            .path()
            .download_dir()
            .map_err(|_| "System Downloads directory is unavailable")?;
        if !directory.is_absolute() {
            return Err("System Downloads directory is invalid".into());
        }
        directory
    } else {
        app.path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("updates")
    };
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    // Only our own nonce-prefixed files are eligible. Do not recurse or touch
    // exported packages, installation data, or arbitrary user files.
    if !asset.download_only {
        cleanup_old_packages(&directory);
    }
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
    let client = package_client()?;
    receive_from_sources(
        package_sources(&asset.url)?,
        &mut file,
        &asset,
        &cancellation,
        |source| {
            let client = client.clone();
            async move {
                let response = client
                    .get(source)
                    .header("User-Agent", "WorkPlan")
                    .header("Accept-Encoding", "identity")
                    .send()
                    .await
                    .map_err(|_| "Package download connection failed".to_string())?;
                if !response.status().is_success() || !allowed_package_url(response.url()) {
                    return Err(format!(
                        "Update download returned HTTP {}",
                        response.status().as_u16()
                    ));
                }
                Ok(response)
            }
        },
        |mut event| {
            event["id"] = json!(id);
            let _ = progress.send(event);
        },
    )
    .await?;
    drop(file);
    if asset.download_only {
        let token = cancellation.clone();
        // Slow/removable Downloads filesystems must not block async work or
        // make cancellation stop working during publication and verification.
        return tauri::async_runtime::spawn_blocking(move || {
            let mut guard = guard;
            let check = || {
                if token.canceled.load(Ordering::Relaxed) {
                    Err("Download canceled".to_string())
                } else {
                    Ok(())
                }
            };
            let destination = publish_without_overwrite(&partial, &directory, &asset.name, || {
                check().map_err(|error| std::io::Error::new(std::io::ErrorKind::Interrupted, error))
            })?;
            guard.partial = Some(destination.clone());
            verify_file_checked(&destination, &asset, check)?;
            guard.partial = None;
            Ok(json!({"id":id,"name":asset.name,"size":asset.size,"verified":true,"download_only":true,"saved_path":destination.to_string_lossy()}))
        })
        .await
        .map_err(|error| error.to_string())?;
    }
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
        if !previous.asset.download_only {
            let _ = fs::remove_file(previous.path);
        }
    }
    Ok(json!({"id":id,"name":asset.name,"size":asset.size,"verified":true}))
}

#[tauri::command]
pub async fn open_downloaded_update(id: String) -> Result<Value, String> {
    #[cfg(target_os = "linux")]
    {
        let _ = id;
        return Err("Linux updates are download-only; use the saved deb/rpm/zst package with your system package manager".into());
    }
    #[cfg(not(target_os = "linux"))]
    {
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
                #[cfg(target_os = "windows")]
                {
                    std::process::Command::new(&record.path)
                        .arg("/UPDATE")
                        .spawn()
                        .map_err(|error| error.to_string())?;
                    return Ok(json!({"opened":true}));
                }
                #[cfg(not(target_os = "windows"))]
                {
                    open::that(&record.path).map_err(|e| e.to_string())?;
                    Ok(json!({"opened":true}))
                }
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
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
    fn mirrors_are_transport_only_and_cannot_change_repository_or_verification_rules() {
        let official = "https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/download/v0.5.27/WorkPlan_0.5.27_amd64.deb";
        let sources = package_sources(official).unwrap();
        assert_eq!(sources[0], official);
        assert_eq!(sources.len(), 3);
        for source in &sources {
            assert!(allowed_package_url(&url::Url::parse(source).unwrap()));
        }
        for invalid in ["https://github.com/other/repo/releases/download/v1.0.0/payload", "https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/download/v1.0.0/payload?mirror=evil", "http://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/download/v1.0.0/payload"] {
            assert!(package_sources(invalid).is_err());
        }
        for invalid in ["https://ghfast.top/https://attacker.invalid/payload", "https://ghfast.top.attacker.invalid/https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/download/v1.0.0/a", "http://gh-proxy.com/https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/download/v1.0.0/a"] {
            assert!(!allowed_package_url(&url::Url::parse(invalid).unwrap()));
        }
        assert!(!allowed_url(&url::Url::parse(&sources[1]).unwrap()));
    }

    #[test]
    fn distribution_packages_never_cross_select_or_become_executable_updates() {
        for package in [
            crate::linux_update::Package::Deb,
            crate::linux_update::Package::Rpm,
            crate::linux_update::Package::Arch,
        ] {
            let name = crate::linux_update::asset_name("0.6.0", package);
            let mut data = fixture("windows", "x86_64");
            data["assets"][0]["name"] = json!(name);
            data["assets"][0]["browser_download_url"] = json!(format!(
                "https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/download/v0.6.0/{name}"
            ));
            let asset = select_named_asset(&data, "0.6.0", &name).unwrap();
            assert!(asset.download_only);
            assert!(!asset.name.ends_with(".AppImage"));
            assert!(select_named_asset(&data, "0.6.0", "workplan-unrelated.rpm").is_err());
        }
    }

    #[test]
    fn download_publication_keeps_existing_files_and_does_not_execute_or_overwrite() {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let directory =
            std::env::temp_dir().join(format!("workplan-publish-{:x}", Sha256::digest(random)));
        fs::create_dir(&directory).unwrap();
        let existing = directory.join("workplan.pkg.tar.zst");
        let partial = directory.join("isolated.part");
        fs::write(&existing, b"user-owned-package").unwrap();
        fs::write(&partial, b"verified-fixture").unwrap();
        let saved =
            publish_without_overwrite(&partial, &directory, "workplan.pkg.tar.zst", || Ok(())).unwrap();
        assert_ne!(saved, existing);
        assert_eq!(fs::read(&existing).unwrap(), b"user-owned-package");
        assert_eq!(fs::read(&saved).unwrap(), b"verified-fixture");
        assert!(!partial.exists());
        fs::remove_file(existing).unwrap();
        fs::remove_file(saved).unwrap();
        fs::remove_dir(directory).unwrap();
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
    fn canceled_verification_cleans_published_file_but_preserves_existing_package() {
        use std::cell::Cell;
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let directory = std::env::temp_dir().join(format!(
            "workplan-cancel-publication-{:x}", Sha256::digest(random)
        ));
        fs::create_dir(&directory).unwrap();
        let existing = directory.join("fixture.rpm");
        let partial = directory.join("verified.part");
        let bytes = vec![11; 256 * 1024];
        fs::write(&existing, b"keep-existing").unwrap();
        fs::write(&partial, &bytes).unwrap();
        let asset = Asset {
            name: "fixture.rpm".into(),
            size: bytes.len() as u64,
            digest: format!("{:x}", Sha256::digest(&bytes)),
            download_only: true,
            url: String::new(),
        };
        let published = publish_without_overwrite(&partial, &directory, &asset.name, || Ok(())).unwrap();
        let guard = DownloadGuard { id: "isolated-verification-cancel".into(), partial: Some(published.clone()) };
        let checks = Cell::new(0);
        let result = verify_file_checked(&published, &asset, || {
            checks.set(checks.get() + 1);
            if checks.get() == 3 { Err("Download canceled".into()) } else { Ok(()) }
        });
        assert_eq!(result.unwrap_err(), "Download canceled");
        drop(guard);
        assert!(!published.exists());
        assert!(!partial.exists());
        assert_eq!(fs::read(&existing).unwrap(), b"keep-existing");
        fs::remove_file(existing).unwrap();
        fs::remove_dir(directory).unwrap();
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
    fn failed_or_corrupt_sources_retry_from_zero_and_the_final_verified_package_is_exact() {
        for all_bad in [false, true] {
            let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = server.local_addr().unwrap();
            let worker = std::thread::spawn(move || {
                for attempt in 0..3 {
                    let (mut socket, _) = server.accept().unwrap();
                    let mut request = [0u8; 4096];
                    let _ = socket.read(&mut request);
                    // first source returns HTTP failure, second valid-size but
                    // corrupt data; last source succeeds only in the first case.
                    let status = if attempt == 0 {
                        "503 Unavailable"
                    } else {
                        "200 OK"
                    };
                    let body = if attempt == 2 && !all_bad {
                        "test"
                    } else {
                        "evil"
                    };
                    let _ = write!(
                        socket,
                        "HTTP/1.1 {status}\r\nContent-Length: 4\r\nConnection: close\r\n\r\n{body}"
                    );
                }
            });
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).unwrap();
            let path =
                std::env::temp_dir().join(format!("workplan-mirrors-{:x}", Sha256::digest(random)));
            let guard = DownloadGuard {
                id: "mirror-test".into(),
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
                receive_from_sources(
                    vec!["official".into(), "mirror-one".into(), "mirror-two".into()],
                    &mut file,
                    &asset,
                    &Cancellation::default(),
                    |_| async {
                        // Only test transport uses loopback. Production creates
                        // requests from package_sources and enforces its allowlist.
                        let response = reqwest::Client::new()
                            .get(format!("http://{address}"))
                            .send()
                            .await
                            .map_err(|error| error.to_string())?;
                        if !response.status().is_success() {
                            return Err("test source unavailable".into());
                        }
                        Ok(response)
                    },
                    |event| events.lock().unwrap().push(event),
                )
                .await
            });
            assert_eq!(result.is_ok(), !all_bad);
            drop(file);
            let events = events.lock().unwrap();
            let restarts: Vec<_> = events
                .iter()
                .filter(|event| event["stage"] == "downloading" && event["received"] == 0)
                .map(|event| event["attempt"].as_u64().unwrap())
                .collect();
            assert!(restarts.contains(&0) && restarts.contains(&1) && restarts.contains(&2));
            if !all_bad {
                assert_eq!(fs::read(&path).unwrap(), b"test");
                verify_file(&path, &asset).unwrap();
            }
            drop(guard);
            assert!(!path.exists());
            worker.join().unwrap();
        }
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

    #[test]
    #[ignore = "Needs official metadata in WORKPLAN_TEST_RELEASE_METADATA; downloads isolated deb/rpm/zst fixtures without installing"]
    fn published_linux_packages_through_mirror_match_official_digests() {
        let metadata = std::env::var("WORKPLAN_TEST_RELEASE_METADATA")
            .expect("Provide the official GitHub release metadata JSON path");
        let data: Value = serde_json::from_slice(&fs::read(metadata).unwrap()).unwrap();
        let version = data["tag_name"].as_str().unwrap().trim_start_matches('v');
        for package in [
            crate::linux_update::Package::Deb,
            crate::linux_update::Package::Rpm,
            crate::linux_update::Package::Arch,
        ] {
            let name = crate::linux_update::asset_name(version, package);
            let asset = select_named_asset(&data, version, &name).unwrap();
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).unwrap();
            let path = std::env::temp_dir().join(format!(
                "workplan-mirror-fixture-{:x}",
                Sha256::digest(random)
            ));
            let guard = DownloadGuard {
                id: "isolated-mirror-download".into(),
                partial: Some(path.clone()),
            };
            let mut file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&path)
                .unwrap();
            tauri::async_runtime::block_on(async {
                let client = package_client().unwrap();
                // Exercise an actual built-in mirror using a hash obtained via
                // authenticated GitHub metadata outside the transfer process.
                let sources = package_sources(&asset.url)
                    .unwrap()
                    .into_iter()
                    .skip(1)
                    .collect();
                receive_from_sources(
                    sources,
                    &mut file,
                    &asset,
                    &Cancellation::default(),
                    |source| {
                        let client = client.clone();
                        async move {
                            let response = client
                                .get(source)
                                .header("User-Agent", "WorkPlan")
                                .header("Accept-Encoding", "identity")
                                .send()
                                .await
                                .map_err(|error| error.to_string())?;
                            if !response.status().is_success()
                                || !allowed_package_url(response.url())
                            {
                                return Err("Mirror fixture response invalid".into());
                            }
                            Ok(response)
                        }
                    },
                    |_| {},
                )
                .await
                .unwrap();
            });
            drop(file);
            verify_file(&path, &asset).unwrap();
            println!(
                "Verified mirror download {} ({} bytes); no installation attempted",
                asset.name, asset.size
            );
            drop(guard);
            assert!(!path.exists());
        }
    }
}
