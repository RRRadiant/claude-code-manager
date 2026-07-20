// Claude Code Manager - Application update management
use crate::error::{AppError, codes, AppResult};
use serde::{Serialize, Deserialize};

/// Update channel
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum UpdateChannel {
    Stable,
    Beta,
}

/// Update manifest entry from GitHub Releases
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateManifest {
    pub version: String,
    pub notes: String,
    pub pub_date: String,
    pub platforms: PlatformTargets,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformTargets {
    #[serde(rename = "windows-x86_64")]
    pub x64: Option<PlatformEntry>,
    #[serde(rename = "windows-aarch64")]
    pub arm64: Option<PlatformEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformEntry {
    pub signature: String,
    pub url: String,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateState {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub download_progress: Option<f64>,
    pub status: UpdateStatus,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum UpdateStatus {
    Idle,
    Checking,
    Available,
    Downloading,
    Verifying,
    Ready,
    Installing,
    Failed(String),
    UpToDate,
}

/// Get current application version from Cargo.toml
pub fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Compare two SemVer versions (returns true if v1 < v2)
pub fn is_newer_version(current: &str, latest: &str) -> bool {
    fn parse_version(v: &str) -> Vec<u32> {
        v.trim_start_matches('v')
            .split(['.', '-'])
            .filter_map(|s| s.parse::<u32>().ok())
            .collect()
    }
    let current_parts = parse_version(current);
    let latest_parts = parse_version(latest);

    for (c, l) in current_parts.iter().zip(latest_parts.iter()) {
        if c < l { return true; }
        if c > l { return false; }
    }
    latest_parts.len() > current_parts.len()
}

/// Fetch update manifest from GitHub Releases
pub async fn fetch_manifest(repo_url: &str) -> AppResult<UpdateManifest> {
    let manifest_url = format!("{}/releases/latest/download/update-manifest.json", repo_url);

    let manifest_text = reqwest::get(&manifest_url)
        .await
        .map_err(|e| {
            AppError::new(codes::UPDATE_CHECK_FAILED, "检查更新失败",
                "无法从服务器获取更新信息。").with_details(e.to_string()).retryable()
        })?
        .text()
        .await
        .map_err(|e| {
            AppError::new(codes::UPDATE_CHECK_FAILED, "读取响应失败",
                "无法读取更新服务器响应。").with_details(e.to_string()).retryable()
        })?;

    let manifest: UpdateManifest = serde_json::from_str(&manifest_text)
        .map_err(|e| {
            AppError::new(codes::UPDATE_CHECK_FAILED, "解析失败",
                "更新清单格式无效。").with_details(e.to_string())
        })?;

    Ok(manifest)
}

/// Determine the appropriate platform entry based on current architecture
pub fn get_platform_entry(manifest: &UpdateManifest) -> Option<&PlatformEntry> {
    let arch = std::env::var("PROCESSOR_ARCHITECTURE").unwrap_or_default();
    if arch.contains("ARM") {
        manifest.platforms.arm64.as_ref()
    } else {
        manifest.platforms.x64.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_comparison() {
        assert!(is_newer_version("0.1.0", "0.1.1"));
        assert!(is_newer_version("1.0.0", "1.1.0"));
        assert!(is_newer_version("0.9.9", "1.0.0"));
        assert!(!is_newer_version("1.0.0", "0.9.9"));
        assert!(!is_newer_version("0.1.1", "0.1.0"));
        assert!(!is_newer_version("1.0.0", "1.0.0"));
        // With v prefix
        assert!(is_newer_version("v0.1.0", "v0.1.1"));
    }

    #[test]
    fn test_current_version() {
        let v = current_version();
        assert!(!v.is_empty());
        assert!(v.contains('.'));
    }
}
