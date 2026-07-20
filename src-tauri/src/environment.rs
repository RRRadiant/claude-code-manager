// Claude Code Manager - Windows environment detection
use crate::error::{AppError, codes, AppResult};
use serde::Serialize;
use std::path::PathBuf;

/// Windows version information
#[derive(Debug, Clone, Serialize)]
pub struct WindowsInfo {
    pub version: String,
    pub display_version: String,
    pub architecture: String,
    pub is_arm64: bool,
    pub is_elevated: bool,
}

/// PowerShell availability
#[derive(Debug, Clone, Serialize)]
pub struct PowerShellInfo {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<PathBuf>,
}

/// Git for Windows detection
#[derive(Debug, Clone, Serialize)]
pub struct GitInfo {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<PathBuf>,
}

/// Claude Code installation status
#[derive(Debug, Clone, Serialize)]
pub struct ClaudeCodeInfo {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<PathBuf>,
    pub install_source: Option<String>,
}

/// PATH environment check
#[derive(Debug, Clone, Serialize)]
pub struct PathCheck {
    pub claude_bin_in_path: bool,
    pub claude_bin_path: Option<String>,
    pub path_directories: Vec<String>,
}

/// WebView2 runtime status
#[derive(Debug, Clone, Serialize)]
pub struct WebView2Info {
    pub installed: bool,
    pub version: Option<String>,
}

/// Complete environment status
#[derive(Debug, Clone, Serialize)]
pub struct EnvironmentStatus {
    pub windows: WindowsInfo,
    pub powershell: PowerShellInfo,
    pub git: GitInfo,
    pub path: PathCheck,
    pub claude_code: ClaudeCodeInfo,
    pub webview2: WebView2Info,
    pub network_reachable: Option<bool>,
    pub errors: Vec<AppError>,
    pub warnings: Vec<String>,
}

/// Detect Windows version and architecture
pub fn detect_windows() -> WindowsInfo {
    let arch = std::env::var("PROCESSOR_ARCHITECTURE")
        .unwrap_or_else(|_| "Unknown".to_string());

    let is_arm = arch.contains("ARM") || arch.contains("arm");
    let is_arm64 = is_arm && arch.contains("64");

    WindowsInfo {
        version: os_info(),
        display_version: os_display_version(),
        architecture: arch,
        is_arm64,
        is_elevated: crate::security::is_elevated(),
    }
}

fn os_info() -> String {
    #[cfg(windows)]
    {
        std::env::var("OS")
            .unwrap_or_else(|_| "Windows".to_string())
            + " "
            + &std::env::var("PROCESSOR_ARCHITECTURE")
                .unwrap_or_else(|_| "Unknown".to_string())
    }
    #[cfg(not(windows))]
    {
        std::env::consts::OS.to_string()
    }
}

fn os_display_version() -> String {
    #[cfg(windows)]
    {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;
        use winreg::enums::*;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(key) = hklm.open_subkey_with_flags(
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion",
            KEY_READ,
        ) {
            let product: String = key
                .get_value("ProductName")
                .unwrap_or_else(|_| "Windows".to_string());
            let major: u32 = key.get_value("CurrentMajorVersionNumber").unwrap_or(10);
            let minor: u32 = key.get_value("CurrentMinorVersionNumber").unwrap_or(0);
            let build: u32 = key
                .get_value("CurrentBuildNumber")
                .and_then(|v: String| v.parse().map_err(|_| {
                    std::io::Error::new(std::io::ErrorKind::InvalidData, "parse error")
                }))
                .unwrap_or(0);
            let ubr: u32 = key.get_value("UBR").unwrap_or(0);
            return format!("{} (Build {}.{}.{})", product, major, minor, build);
        }
        "Windows (Unknown)".to_string()
    }
    #[cfg(not(windows))]
    {
        "Unknown".to_string()
    }
}

/// Detect PowerShell availability and version
pub fn detect_powershell() -> PowerShellInfo {
    let path = which("powershell.exe");
    if let Some(ref pwsh_path) = path {
        let version = get_powershell_version(pwsh_path);
        PowerShellInfo {
            available: true,
            version,
            path: Some(PathBuf::from(pwsh_path)),
        }
    } else {
        PowerShellInfo {
            available: false,
            version: None,
            path: None,
        }
    }
}

fn which(exe: &str) -> Option<String> {
    std::process::Command::new("where")
        .arg(exe)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout)
                    .ok()
                    .map(|s| s.trim().to_string())
            } else {
                None
            }
        })
}

fn get_powershell_version(path: &str) -> Option<String> {
    std::process::Command::new(path)
        .args(["$PSVersionTable.PSVersion.ToString()"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout)
                    .ok()
                    .map(|s| s.trim().to_string())
            } else {
                None
            }
        })
}

/// Detect Git for Windows
pub fn detect_git() -> GitInfo {
    let path = which("git.exe");
    if let Some(ref git_path) = path {
        let version = std::process::Command::new("git")
            .args(["--version"])
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    String::from_utf8(o.stdout)
                        .ok()
                        .map(|s| s.trim().to_string())
                } else {
                    None
                }
            });
        GitInfo {
            installed: true,
            version,
            path: Some(PathBuf::from(git_path)),
        }
    } else {
        GitInfo {
            installed: false,
            version: None,
            path: None,
        }
    }
}

/// Detect Claude Code installation
pub fn detect_claude_code() -> ClaudeCodeInfo {
    let paths_to_check = vec![
        format!(
            "{}\\.local\\bin\\claude.exe",
            std::env::var("USERPROFILE").unwrap_or_default()
        ),
        format!(
            "{}\\.local\\bin\\claude.cmd",
            std::env::var("USERPROFILE").unwrap_or_default()
        ),
    ];

    for path in &paths_to_check {
        let pb = std::path::Path::new(path);
        if pb.exists() {
            let version = get_claude_code_version(path);
            return ClaudeCodeInfo {
                installed: true,
                version,
                path: Some(PathBuf::from(path)),
                install_source: Some("native".to_string()),
            };
        }
    }

    // Check if command is available on PATH
    if let Some(path) = which("claude.exe") {
        let version = get_claude_code_version(&path);
        return ClaudeCodeInfo {
            installed: true,
            version,
            path: Some(PathBuf::from(&path)),
            install_source: Some("path".to_string()),
        };
    }

    ClaudeCodeInfo {
        installed: false,
        version: None,
        path: None,
        install_source: None,
    }
}

fn get_claude_code_version(path: &str) -> Option<String> {
    std::process::Command::new(path)
        .args(["--version"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout)
                    .ok()
                    .map(|s| s.trim().to_string())
            } else {
                None
            }
        })
}

/// Check PATH for Claude Code binary directory
pub fn check_path() -> PathCheck {
    let user_bin = format!(
        "{}\\.local\\bin",
        std::env::var("USERPROFILE").unwrap_or_default()
    );

    let path_var = std::env::var("PATH").unwrap_or_default();
    let directories: Vec<String> = path_var.split(';').map(|s| s.to_string()).collect();

    let in_path = directories.iter().any(|d| {
        d.trim() == user_bin
            || d.trim().trim_end_matches('\\') == user_bin.trim_end_matches('\\')
    });

    PathCheck {
        claude_bin_in_path: in_path,
        claude_bin_path: Some(user_bin),
        path_directories: directories,
    }
}

/// Detect WebView2 runtime
pub fn detect_webview2() -> WebView2Info {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let paths = [
            r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ];

        for key_path in &paths {
            if let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE)
                .open_subkey_with_flags(key_path, KEY_READ)
            {
                let version: String = key.get_value("pv").unwrap_or_default();
                if !version.is_empty() {
                    return WebView2Info {
                        installed: true,
                        version: Some(version),
                    };
                }
            }
        }
    }

    WebView2Info {
        installed: false,
        version: None,
    }
}

/// Detect Claude Code config directory
pub fn get_user_config_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .unwrap_or_else(|_| "C:\\Users\\Default".to_string());
    PathBuf::from(format!("{}\\.claude", home))
}

/// Detect whether the Claude Code managed config exists
pub fn get_managed_config_dir() -> PathBuf {
    PathBuf::from("C:\\ProgramData\\ClaudeCode")
}

/// Run full environment detection
pub fn detect_environment() -> EnvironmentStatus {
    let mut warnings = Vec::new();
    let mut errors = Vec::new();

    let windows = detect_windows();
    let powershell = detect_powershell();
    let git = detect_git();
    let path_check = check_path();
    let claude_code = detect_claude_code();
    let webview2 = detect_webview2();

    if !powershell.available {
        warnings.push("PowerShell 不可用。Claude Code 安装需要 PowerShell。".to_string());
    }

    if !path_check.claude_bin_in_path && claude_code.installed {
        warnings.push(
            "Claude Code 已安装但 %USERPROFILE%\\.local\\bin 不在 PATH 中。".to_string(),
        );
    }

    EnvironmentStatus {
        windows,
        powershell,
        git,
        path: path_check,
        claude_code,
        webview2,
        network_reachable: None,
        errors,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_windows_no_panic() {
        let info = detect_windows();
        assert!(!info.version.is_empty());
    }

    #[test]
    fn test_detect_powershell_no_panic() {
        let info = detect_powershell();
        // On most Windows systems, PowerShell should be available
        // This test just verifies no panic occurs
        println!("PowerShell available: {}", info.available);
    }
}
