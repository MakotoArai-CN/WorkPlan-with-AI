use serde_json::{json, Value};
use std::time::Duration;

fn version_parts(value: &str) -> Option<Vec<u32>> {
    let value = value.strip_prefix('v').unwrap_or(value);
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3 { return None; }
    parts.into_iter().map(|part| {
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) { None } else { part.parse().ok() }
    }).collect()
}

fn release_info(data: Value, current: &str) -> Result<Value, String> {
    if data["draft"].as_bool().unwrap_or(true) || data["prerelease"].as_bool().unwrap_or(true) {
        return Err("更新源没有提供正式发布版本".into());
    }
    let latest = data["tag_name"].as_str().ok_or("更新源缺少版本信息")?;
    let latest_parts = version_parts(latest).ok_or("更新源版本格式无效")?;
    let current_parts = version_parts(current).ok_or("当前版本格式无效")?;
    let version = latest.trim_start_matches('v');
    // Derive an official, version-specific destination; never trust a URL
    // embedded in a remote release response or its Markdown body.
    Ok(json!({
        "has_update": latest_parts > current_parts,
        "current_version": current,
        "latest_version": version,
        "published_at": data["published_at"].as_str().unwrap_or(""),
        "release_name": data["name"].as_str().unwrap_or("").chars().take(200).collect::<String>(),
        "release_notes": data["body"].as_str().unwrap_or("").chars().take(40000).collect::<String>(),
        "release_url": format!("https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/tag/v{version}"),
        "download": crate::update_download::select_asset(&data, version, std::env::consts::OS, std::env::consts::ARCH).ok()
    }))
}

#[tauri::command]
pub async fn check_update() -> Result<Value, String> {
    check_release_for_download(fetch_release(None).await?)
}

pub fn check_release_for_download(data: Value) -> Result<Value, String> {
    release_info(data, env!("CARGO_PKG_VERSION"))
}

pub async fn fetch_release(version: Option<&str>) -> Result<Value, String> {
    match fetch_api_release(version).await {
        Ok(data) => Ok(data),
        Err(_) => crate::update_download::fetch_public_release(version).await,
    }
}

async fn fetch_api_release(version: Option<&str>) -> Result<Value, String> {
    let endpoint = match version {
        Some(version) if version_parts(version).is_some() => format!("https://api.github.com/repos/MakotoArai-CN/WorkPlan-with-AI/releases/tags/v{version}"),
        Some(_) => return Err("Invalid update version".into()),
        None => "https://api.github.com/repos/MakotoArai-CN/WorkPlan-with-AI/releases/latest".into(),
    };
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())?;
    let mut response = client.get(endpoint)
        .header("User-Agent", "WorkPlan").header("Accept", "application/vnd.github+json")
        .send().await.map_err(|_| "无法连接更新服务，请检查网络后重试".to_string())?;
    if !response.status().is_success() { return Err(format!("更新服务返回 HTTP {}，请稍后重试", response.status().as_u16())); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "更新信息下载中断")? {
        if bytes.len() + chunk.len() > 512 * 1024 { return Err("更新信息超过允许大小".into()); }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "更新服务返回格式无效".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(version: &str) -> Value {
        json!({"tag_name":version,"draft":false,"prerelease":false,"body":"## Changes\n- Improved updates", "published_at":"2026-11-12T00:00:00Z","html_url":"https://attacker.invalid"})
    }
    #[test]
    fn stable_versions_compare_correctly_and_notes_are_bounded() {
        let result = release_info(fixture("v0.5.17"), "0.5.16").unwrap();
        assert_eq!(result["has_update"], true);
        assert!(result["release_url"].as_str().unwrap().ends_with("/v0.5.17"));
        assert_eq!(release_info(fixture("v0.5.16"), "0.5.16").unwrap()["has_update"], false);
        assert_eq!(release_info(fixture("v0.5.9"), "0.5.16").unwrap()["has_update"], false);
        let mut large = fixture("v0.5.17"); large["body"] = Value::String("x".repeat(50000));
        assert_eq!(release_info(large, "0.5.16").unwrap()["release_notes"].as_str().unwrap().len(), 40000);
    }
    #[test]
    fn malformed_tags_drafts_and_prereleases_are_not_offered() {
        for tag in ["", "v0.5", "v0.5.17-beta", "v0.5.17/../../evil", "v0.5.x"] {
            assert!(release_info(fixture(tag), "0.5.16").is_err());
        }
        for key in ["draft", "prerelease"] {
            let mut item = fixture("v0.5.17"); item[key] = json!(true);
            assert!(release_info(item, "0.5.16").is_err());
        }
    }
}
