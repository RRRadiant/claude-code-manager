// Claude Code Manager - Windows environment detection
use crate::error::AppError;
use serde::Serialize;
use std::path::PathBuf;

/// Create a hidden command (for detection only, no UI output needed)
fn cmd(program: &str) -> std::process::Command {
    let mut c = std::process::Command::new(program);
    use std::os::windows::process::CommandExt;
    c.creation_flags(0x08000000);
    c
}

/// Windows version information
#[derive(Debug, Clone, Serialize)]
pub struct WindowsInfo {
    pub version: String,
    pub display_version: String,
    pub architecture: String,
    pub display_architecture: String,
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
    pub install_method: Option<String>,
    pub config_path: Option<PathBuf>,
    pub health: Option<String>,
    pub details: Vec<String>,
}

/// PATH environment check
#[derive(Debug, Clone, Serialize)]
pub struct PathCheck {
    pub claude_bin_in_path: bool,
    pub claude_bin_path: Option<String>,
    pub path_directories: Vec<String>,
}

/// `WebView2` runtime status
#[derive(Debug, Clone, Serialize)]
pub struct WebView2Info {
    pub installed: bool,
    pub version: Option<String>,
}

/// Node.js & npm status
#[derive(Debug, Clone, Serialize)]
pub struct NodeInfo {
    pub node_version: Option<String>,
    pub npm_version: Option<String>,
    pub detection_method: NodeDetectionMethod,
    pub resolved_path: Option<String>,
}

/// How Node.js was detected (helps diagnose PATH issues)
#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum NodeDetectionMethod {
    /// Found via current process PATH (default `cmd /c` path)
    ProcessPath,
    /// Found via refreshed registry PATH
    RefreshedPath,
    /// Found via absolute path (known install directory)
    AbsolutePath,
    /// Found via app-managed portable runtime
    PortableRuntime,
    /// Not found by any method
    NotFound,
}

/// Detailed Node.js detection result with status classification
#[derive(Debug, Clone, Serialize)]
pub struct NodeDetectionResult {
    pub status: NodeInstallStatus,
    pub version: Option<String>,
    pub exe_path: Option<String>,
    pub detection_method: NodeDetectionMethod,
    pub npm_version: Option<String>,
    pub npm_exe_path: Option<String>,
}

/// Classified installation status
#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum NodeInstallStatus {
    /// Installed and available via current process PATH
    InstalledAndAvailable,
    /// Installed, but only via registry PATH (process PATH out of date)
    InstalledPathNotRefreshed,
    /// Binary found but can't get version (broken install)
    InstalledButBroken,
    /// Installation appears to have failed
    InstallationFailed,
    /// State cannot be determined
    Unknown,
}

/// Complete environment status
#[derive(Debug, Clone, Serialize)]
pub struct EnvironmentStatus {
    pub node: NodeInfo,
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

// ── Node.js detection helpers ────────────────────────────────────

/// Try to detect node/npm using the current process PATH (standard)
fn detect_node_process_path() -> (Option<String>, Option<String>) {
    use std::os::windows::process::CommandExt;
    const CF: u32 = 0x08000000;

    let node = std::process::Command::new("node")
        .args(["--version"])
        .creation_flags(CF)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().trim_start_matches('v').to_string());

    let npm = std::process::Command::new("npm")
        .args(["--version"])
        .creation_flags(CF)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
        .or_else(|| {
            std::process::Command::new("npm.cmd")
                .args(["--version"])
                .creation_flags(CF)
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
        });

    (node, npm)
}

/// Try to detect node/npm using refreshed registry PATH
fn detect_node_refreshed_path() -> (Option<String>, Option<String>) {
    let node = crate::env_refresh::detect_with_fresh_path("node", "--version")
        .map(|s| s.trim_start_matches('v').to_string());
    let mut npm = crate::env_refresh::detect_with_fresh_path("npm", "--version");
    if npm.is_none() {
        npm = crate::env_refresh::detect_with_fresh_path("npm.cmd", "--version");
    }
    (node, npm)
}

/// Find the absolute path to node.exe using refreshed PATH
fn find_node_exe() -> Option<String> {
    use std::os::windows::process::CommandExt;
    // First try standard where
    let std_path = std::process::Command::new("where")
        .arg("node.exe")
        .creation_flags(0x08000000)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.lines().next().unwrap_or("").trim().to_string());
    if std_path.is_some() {
        return std_path;
    }
    // Then try refreshed PATH where
    crate::env_refresh::where_on_refreshed_path("node.exe")
}

/// Run comprehensive Node.js detection, classifying the result.
pub fn detect_node_classified() -> NodeDetectionResult {
    let (node_ver, npm_ver) = detect_node_process_path();

    if let Some(ref v) = node_ver {
        // Found via process PATH — best case
        let exe_path = find_node_exe();
        return NodeDetectionResult {
            status: NodeInstallStatus::InstalledAndAvailable,
            version: Some(v.clone()),
            exe_path,
            detection_method: NodeDetectionMethod::ProcessPath,
            npm_version: npm_ver,
            npm_exe_path: None,
        };
    }

    // Not found via process PATH — try refreshed PATH
    let (refreshed_node, refreshed_npm) = detect_node_refreshed_path();
    if let Some(ref v) = refreshed_node {
        let exe_path = crate::env_refresh::where_on_refreshed_path("node.exe");
        return NodeDetectionResult {
            status: NodeInstallStatus::InstalledPathNotRefreshed,
            version: Some(v.clone()),
            exe_path,
            detection_method: NodeDetectionMethod::RefreshedPath,
            npm_version: refreshed_npm,
            npm_exe_path: None,
        };
    }

    // Try app-managed portable runtime (scan all available versions)
    let portable_root = format!(
        "{}\\ClaudeCodeManager\\runtime\\node",
        std::env::var("APPDATA").unwrap_or_default()
    );
    let portable_root_path = std::path::Path::new(&portable_root);
    if portable_root_path.exists() {
        if let Ok(entries) = std::fs::read_dir(portable_root_path) {
            for entry in entries.flatten() {
                let ver_dir = entry.path();
                if !ver_dir.is_dir() {
                    continue;
                }
                if let Ok(sub_entries) = std::fs::read_dir(&ver_dir) {
                    for sub in sub_entries.flatten() {
                        let node_exe = sub.path().join("node.exe");
                        if node_exe.exists() {
                            let portable_node = node_exe.to_string_lossy().to_string();
                            let mut cmd = std::process::Command::new(&portable_node);
                            use std::os::windows::process::CommandExt;
                            cmd.creation_flags(0x08000000);
                            cmd.args(["--version"]);
                            let version = cmd
                                .output()
                                .ok()
                                .and_then(|o| String::from_utf8(o.stdout).ok())
                                .map(|s| s.trim().trim_start_matches('v').to_string());
                            let npm_exe = sub.path().join("npm.cmd");
                            let npm_version = if npm_exe.exists() {
                                std::process::Command::new(&npm_exe)
                                    .args(["--version"])
                                    .output()
                                    .ok()
                                    .and_then(|o| String::from_utf8(o.stdout).ok())
                                    .map(|s| s.trim().to_string())
                            } else {
                                None
                            };
                            return NodeDetectionResult {
                                status: if version.is_some() {
                                    NodeInstallStatus::InstalledAndAvailable
                                } else {
                                    NodeInstallStatus::InstalledButBroken
                                },
                                version,
                                exe_path: Some(portable_node),
                                detection_method: NodeDetectionMethod::PortableRuntime,
                                npm_version,
                                npm_exe_path: None,
                            };
                        }
                    }
                }
            }
        }
    }

    // Try known install locations (fallback for broken PATH scenarios)
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let mut known_paths: Vec<String> = Vec::new();

    // nvm-for-windows stores each version in a `vX.Y.Z` directory. The previous
    // literal `v20.*` path never matched, so scan for real version dirs instead.
    let nvm_root = std::path::Path::new(&home)
        .join("AppData")
        .join("Roaming")
        .join("nvm");
    if let Ok(entries) = std::fs::read_dir(&nvm_root) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir()
                && p.file_name()
                    .is_some_and(|n| n.to_string_lossy().starts_with('v'))
            {
                known_paths.push(p.join("node.exe").to_string_lossy().to_string());
            }
        }
    }

    known_paths.push(format!("{home}\\scoop\\apps\\nodejs\\current\\node.exe"));
    known_paths.push("C:\\Program Files\\nodejs\\node.exe".to_string());
    known_paths.push("C:\\Program Files (x86)\\nodejs\\node.exe".to_string());
    for pattern in &known_paths {
        let path = std::path::Path::new(pattern);
        if path.exists() {
            use std::os::windows::process::CommandExt;
            let version = std::process::Command::new(path)
                .args(["--version"])
                .creation_flags(0x08000000)
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().trim_start_matches('v').to_string());
            return NodeDetectionResult {
                status: if version.is_some() {
                    NodeInstallStatus::InstalledPathNotRefreshed
                } else {
                    NodeInstallStatus::InstalledButBroken
                },
                version,
                exe_path: Some(path.to_string_lossy().to_string()),
                detection_method: NodeDetectionMethod::AbsolutePath,
                npm_version: None,
                npm_exe_path: None,
            };
        }
    }

    NodeDetectionResult {
        status: NodeInstallStatus::InstallationFailed,
        version: None,
        exe_path: None,
        detection_method: NodeDetectionMethod::NotFound,
        npm_version: None,
        npm_exe_path: None,
    }
}

/// Detect Windows version and architecture
pub fn detect_windows() -> WindowsInfo {
    let arch = std::env::var("PROCESSOR_ARCHITECTURE").unwrap_or_else(|_| "Unknown".to_string());

    let is_arm = arch.contains("ARM") || arch.contains("arm");
    let is_arm64 = is_arm && arch.contains("64");

    // Previously any non-ARM64 machine (including x64/AMD64) was reported as
    // "x86". Distinguish arm64 / x64 / x86 correctly.
    let display_arch = if is_arm64 {
        "arm64".to_string()
    } else if arch.to_lowercase().contains("64") {
        "x64".to_string()
    } else {
        "x86".to_string()
    };

    let (version, display_version) = os_version_info();

    WindowsInfo {
        version,
        display_version,
        architecture: arch,
        display_architecture: display_arch,
        is_arm64,
        is_elevated: crate::security::is_elevated(),
    }
}

/// Get OS version strings from Windows registry
/// Reliably distinguish Win 10 vs 11 by build number (Win 11: build >= 22000)
fn os_version_info() -> (String, String) {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(key) =
        hklm.open_subkey_with_flags(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", KEY_READ)
    {
        let product: String = key
            .get_value("ProductName")
            .unwrap_or_else(|_| "Windows".to_string());
        let display_ver: String = key
            .get_value("DisplayVersion")
            .unwrap_or_else(|_| String::new());
        let build: String = key
            .get_value("CurrentBuildNumber")
            .unwrap_or_else(|_| "0".to_string());
        let build_num: u32 = build.parse().unwrap_or(0);
        let ubr: u32 = key.get_value("UBR").unwrap_or(0);

        // Fix: ProductName can say "Windows 10" on Win11 systems upgraded
        // from Win10. The definitive check is the build number.
        let corrected_product = if build_num >= 22000 && !product.contains("Windows 11") {
            // Replace "Windows 10" with "Windows 11" in the product string
            product.replace("Windows 10", "Windows 11")
        } else {
            product
        };

        let simple = if display_ver.is_empty() {
            corrected_product
        } else {
            format!("{corrected_product} {display_ver}")
        };

        let detailed = if ubr > 0 {
            format!("{simple} (Build {build}.{ubr})")
        } else {
            format!("{simple} (Build {build})")
        };

        return (simple, detailed);
    }
    ("Windows".to_string(), "Windows (Unknown)".to_string())
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
    cmd("where").arg(exe).output().ok().and_then(|o| {
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
    cmd(path)
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

pub fn detect_git() -> GitInfo {
    // 1. Try PATH (current process)
    let proc_path = which("git.exe");
    if let Some(ref git_path) = proc_path {
        let version = get_git_version_path(git_path);
        return GitInfo {
            installed: true,
            version,
            path: Some(PathBuf::from(git_path)),
        };
    }

    // 2. Try refreshed registry PATH (catches new installs without restart)
    let fresh = crate::env_refresh::detect_with_fresh_path("git", "--version");
    if let Some(ref ver) = fresh {
        let exe_path = crate::env_refresh::where_on_refreshed_path("git.exe");
        return GitInfo {
            installed: true,
            version: Some(ver.clone()),
            path: exe_path.map(PathBuf::from),
        };
    }

    // 3. Try known Git installation directories
    let known_git_paths = [
        // Standard Program Files locations
        "C:\\Program Files\\Git\\cmd\\git.exe",
        "C:\\Program Files\\Git\\mingw64\\bin\\git.exe",
        "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
        "C:\\Program Files\\Git\\bin\\git.exe",
        // User-local installations
        &format!(
            "{}\\scoop\\apps\\git\\current\\cmd\\git.exe",
            std::env::var("USERPROFILE").unwrap_or_default()
        ),
        &format!(
            "{}\\AppData\\Local\\Programs\\Git\\cmd\\git.exe",
            std::env::var("USERPROFILE").unwrap_or_default()
        ),
        // Chocolatey
        "C:\\ProgramData\\chocolatey\\lib\\git\\tools\\cmd\\git.exe",
        // PortableGit
        &format!(
            "{}\\scoop\\apps\\git\\current\\mingw64\\bin\\git.exe",
            std::env::var("USERPROFILE").unwrap_or_default()
        ),
    ];

    for path_str in &known_git_paths {
        let pb = std::path::Path::new(path_str);
        if pb.exists() {
            let version = get_git_version(path_str);
            return GitInfo {
                installed: true,
                version,
                path: Some(PathBuf::from(path_str)),
            };
        }
    }

    GitInfo {
        installed: false,
        version: None,
        path: None,
    }
}

fn get_git_version_path(path: &str) -> Option<String> {
    cmd(path)
        .args(["--version"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
}

fn get_git_version(path: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CF: u32 = 0x08000000;
    std::process::Command::new(path)
        .args(["--version"])
        .creation_flags(CF)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
}

/// Detect Claude Code installation via multiple methods
pub fn detect_claude_code() -> ClaudeCodeInfo {
    let mut details: Vec<String> = Vec::new();
    let home = std::env::var("USERPROFILE").unwrap_or_default();

    // Priority 1: Native install at %USERPROFILE%\.local\bin\claude.exe
    let native_paths = vec![
        format!("{}\\.local\\bin\\claude.exe", home),
        format!("{}\\.local\\bin\\claude.cmd", home),
    ];
    for path in &native_paths {
        let pb = std::path::Path::new(path);
        if pb.exists() {
            details.push(format!("发现本机安装: {path}"));
            let version = get_claude_code_version(path);
            let config = get_claude_config_dir();
            let health = assess_health(pb.exists(), &version);
            return ClaudeCodeInfo {
                installed: true,
                version,
                path: Some(PathBuf::from(path)),
                install_source: Some("native".to_string()),
                install_method: Some("manual".to_string()),
                config_path: config,
                health,
                details,
            };
        }
    }

    // Priority 2: npm global install
    if let Some(npm_info) = detect_npm_claude() {
        let npm_path = npm_info.to_string_lossy().to_string();
        details.push(format!("通过 npm 发现: {npm_path}"));
        let version = get_claude_code_version(&npm_path);
        let config = get_claude_config_dir();
        let health = assess_health(true, &version);
        return ClaudeCodeInfo {
            installed: true,
            version,
            path: Some(npm_info),
            install_source: Some("npm".to_string()),
            install_method: Some("npm".to_string()),
            config_path: config,
            health,
            details,
        };
    }

    // Priority 3: Common npm directories
    let npm_dirs = vec![
        format!("{}\\AppData\\Roaming\\npm\\claude.exe", home),
        format!("{}\\AppData\\Local\\npm\\claude.exe", home),
        format!("{}\\AppData\\Roaming\\npm\\claude.cmd", home),
        format!("{}\\.npm\\claude.exe", home),
    ];
    for dir in &npm_dirs {
        let pb = std::path::Path::new(dir);
        if pb.exists() {
            details.push(format!("在 npm 目录发现: {dir}"));
            let version = get_claude_code_version(dir);
            let config = get_claude_config_dir();
            let health = assess_health(true, &version);
            return ClaudeCodeInfo {
                installed: true,
                version,
                path: Some(PathBuf::from(dir)),
                install_source: Some("npm".to_string()),
                install_method: Some("npm".to_string()),
                config_path: config,
                health,
                details,
            };
        }
    }

    // Priority 4: pnpm global locations
    let pnpm_paths = vec![
        format!("{}\\AppData\\Local\\pnpm\\claude.exe", home),
        format!("{}\\AppData\\Local\\pnpm\\claude.cmd", home),
        format!(
            "{}\\AppData\\Local\\pnpm\\global\\5\\node_modules\\@anthropic-ai\\claude-code\\cli.js",
            home
        ),
    ];
    for dir in &pnpm_paths {
        let pb = std::path::Path::new(dir);
        if pb.exists() {
            details.push(format!("通过 pnpm 发现: {dir}"));
            let version = get_claude_code_version(dir);
            let config = get_claude_config_dir();
            let health = assess_health(true, &version);
            return ClaudeCodeInfo {
                installed: true,
                version,
                path: Some(PathBuf::from(dir)),
                install_source: Some("pnpm".to_string()),
                install_method: Some("pnpm".to_string()),
                config_path: config,
                health,
                details,
            };
        }
    }

    // Priority 5: yarn global locations
    let yarn_paths = vec![
        format!("{}\\AppData\\Local\\Yarn\\bin\\claude.cmd", home),
        format!("{}\\AppData\\Local\\Yarn\\Data\\global\\node_modules\\@anthropic-ai\\claude-code\\cli.js", home),
    ];
    for dir in &yarn_paths {
        let pb = std::path::Path::new(dir);
        if pb.exists() {
            details.push(format!("通过 yarn 发现: {dir}"));
            let version = get_claude_code_version(dir);
            let config = get_claude_config_dir();
            let health = assess_health(true, &version);
            return ClaudeCodeInfo {
                installed: true,
                version,
                path: Some(PathBuf::from(dir)),
                install_source: Some("yarn".to_string()),
                install_method: Some("yarn".to_string()),
                config_path: config,
                health,
                details,
            };
        }
    }

    // Priority 6: PATH lookup
    if let Some(path) = which("claude.exe") {
        details.push(format!("在 PATH 中发现: {path}"));
        let version = get_claude_code_version(&path);
        let config = get_claude_config_dir();
        let health = assess_health(true, &version);
        return ClaudeCodeInfo {
            installed: true,
            version,
            path: Some(PathBuf::from(&path)),
            install_source: Some("path".to_string()),
            install_method: Some("unknown".to_string()),
            config_path: config,
            health,
            details,
        };
    }

    // Priority 7: claude without .exe extension
    if let Some(path) = which("claude") {
        details.push(format!("在 PATH 中发现: {path}"));
        let version = get_claude_code_version(&path);
        let config = get_claude_config_dir();
        let health = assess_health(true, &version);
        return ClaudeCodeInfo {
            installed: true,
            version,
            path: Some(PathBuf::from(&path)),
            install_source: Some("path".to_string()),
            install_method: Some("unknown".to_string()),
            config_path: config,
            health,
            details,
        };
    }

    // Not installed
    let claude_config = get_claude_config_dir();
    let config_has_settings = claude_config
        .as_ref()
        .is_some_and(|d| d.join("settings.json").exists());

    details.push("未在任何路径发现 Claude Code".to_string());
    if config_has_settings {
        details.push("配置目录存在但未安装二进制文件".to_string());
    }

    ClaudeCodeInfo {
        installed: false,
        version: None,
        path: None,
        install_source: None,
        install_method: None,
        config_path: if config_has_settings {
            claude_config
        } else {
            None
        },
        health: Some("broken".to_string()),
        details,
    }
}

/// Try to find claude via npm global list
fn detect_npm_claude() -> Option<std::path::PathBuf> {
    // Check npm root global directory (with 8s timeout to prevent hanging)
    use std::time::Duration;
    let mut c = cmd("npm");
    c.args(["root", "-g"]);
    c.stdout(std::process::Stdio::piped());
    c.stderr(std::process::Stdio::null());
    let mut child = c.spawn().ok()?;
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(8);
    let output = loop {
        if let Some(status) = child.try_wait().ok()? {
            if status.success() {
                break child.wait_with_output().ok()?;
            }
            return None;
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    if !output.status.success() {
        return None;
    }
    let npm_root = String::from_utf8(output.stdout).ok()?;
    let npm_root = npm_root.trim();

    let claude_path = std::path::Path::new(npm_root)
        .join("@anthropic-ai")
        .join("claude-code");
    if claude_path.join("cli.js").exists() {
        // On Windows, there should be a .cmd or .exe wrapper in npm global bin
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        let bin_path = format!("{home}\\AppData\\Roaming\\npm\\claude");
        let bin = std::path::Path::new(&bin_path);
        // Return the actual file that exists (.cmd or .exe), not always .exe
        if bin.with_extension("exe").exists() {
            return Some(bin.with_extension("exe"));
        }
        if bin.with_extension("cmd").exists() {
            return Some(bin.with_extension("cmd"));
        }
        if bin.exists() {
            return Some(bin.to_path_buf());
        }
        // Fallback: return the cli.js path
        return Some(claude_path.join("cli.js"));
    }
    None
}

fn get_claude_code_version(path: &str) -> Option<String> {
    use std::time::Duration;
    let pb = std::path::Path::new(path);
    if !pb.exists() {
        return None;
    }
    let mut c = cmd(path);
    c.args(["--version"]);
    c.stdout(std::process::Stdio::piped());
    c.stderr(std::process::Stdio::null());
    let mut child = c.spawn().ok()?;
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(8);
    loop {
        if let Some(status) = child.try_wait().ok()? {
            if status.success() {
                let out = child.wait_with_output().ok()?;
                return String::from_utf8(out.stdout)
                    .ok()
                    .map(|s| s.trim().to_string());
            }
            return None;
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn assess_health(binary_exists: bool, _version: &Option<String>) -> Option<String> {
    if !binary_exists {
        return Some("broken".to_string());
    }
    // Binary exists -> always healthy, even if --version failed (e.g. first-run init)
    Some("healthy".to_string())
}

fn get_claude_config_dir() -> Option<PathBuf> {
    let home = std::env::var("USERPROFILE").ok()?;
    let config_dir = PathBuf::from(format!("{home}\\.claude"));
    if config_dir.exists() {
        Some(config_dir)
    } else {
        None
    }
}

/// Check PATH for Claude Code binary directory
pub fn check_path() -> PathCheck {
    let user_bin = format!(
        "{}\\.local\\bin",
        std::env::var("USERPROFILE").unwrap_or_default()
    );

    let path_var = std::env::var("PATH").unwrap_or_default();
    let directories: Vec<String> = path_var
        .split(';')
        .map(std::string::ToString::to_string)
        .collect();

    let in_path = directories.iter().any(|d| {
        d.trim() == user_bin || d.trim().trim_end_matches('\\') == user_bin.trim_end_matches('\\')
    });

    PathCheck {
        claude_bin_in_path: in_path,
        claude_bin_path: Some(user_bin),
        path_directories: directories,
    }
}

/// Detect `WebView2` runtime using multiple strategies
pub fn detect_webview2() -> WebView2Info {
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
        use winreg::RegKey;

        // Strategy 1: Check multiple registry locations
        let reg_checks = [
            // EdgeUpdate Clients (HKLM)
            (
                HKEY_LOCAL_MACHINE,
                r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            ),
            (
                HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            ),
            // EdgeUpdate ClientState (alternative key)
            (
                HKEY_LOCAL_MACHINE,
                r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\ClientState\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            ),
            (
                HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\EdgeUpdate\ClientState\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            ),
            // HKCU (per-user install)
            (
                HKEY_CURRENT_USER,
                r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            ),
            (
                HKEY_CURRENT_USER,
                r"SOFTWARE\Microsoft\EdgeUpdate\ClientState\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            ),
            // Microsoft Edge\WebView2
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Edge\WebView2"),
            (HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Edge\WebView2"),
        ];

        for (predef, key_path) in &reg_checks {
            if let Ok(key) = RegKey::predef(*predef).open_subkey_with_flags(key_path, KEY_READ) {
                // Try "pv" first, then "Version"
                let version: String = key
                    .get_value("pv")
                    .or_else(|_| key.get_value("Version"))
                    .unwrap_or_default();
                if !version.is_empty() {
                    return WebView2Info {
                        installed: true,
                        version: Some(version),
                    };
                }
            }
        }

        // Strategy 2: Check WebView2Loader.dll on disk
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let dll_checks = [
            format!("{system_root}\\System32\\WebView2Loader.dll"),
            format!("{system_root}\\SysWOW64\\WebView2Loader.dll"),
        ];
        for dll in &dll_checks {
            let pb = std::path::Path::new(dll);
            if pb.exists() {
                // Try to get file version from the DLL
                if let Some(ver) = get_dll_version(dll) {
                    return WebView2Info {
                        installed: true,
                        version: Some(ver),
                    };
                }
                // DLL exists but couldn't read version
                return WebView2Info {
                    installed: true,
                    version: Some("已安装".to_string()),
                };
            }
        }

        // Strategy 3: Check installed program directory
        let prog_dirs = [
            format!(
                "{} (x86)\\Microsoft\\EdgeWebView2\\Application",
                std::env::var("ProgramFiles").unwrap_or_default()
            ),
            format!(
                "{}\\Microsoft\\EdgeWebView2\\Application",
                std::env::var("ProgramW6432").unwrap_or_default()
            ),
            format!(
                "{}\\Microsoft\\EdgeWebView2\\Application",
                std::env::var("LOCALAPPDATA").unwrap_or_default()
            ),
        ];
        for dir in &prog_dirs {
            let pb = std::path::Path::new(dir);
            if pb.exists() {
                // Look for version-named subdirectories
                if let Ok(entries) = std::fs::read_dir(pb) {
                    for entry in entries.flatten() {
                        let name = entry.file_name();
                        let name_str = name.to_string_lossy();
                        if name_str.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                            // Contains msedgewebview2.exe
                            let exe = entry.path().join("msedgewebview2.exe");
                            if exe.exists() {
                                return WebView2Info {
                                    installed: true,
                                    version: Some(name_str.to_string()),
                                };
                            }
                        }
                    }
                }
                return WebView2Info {
                    installed: true,
                    version: Some("已安装".to_string()),
                };
            }
        }
    }

    WebView2Info {
        installed: false,
        version: None,
    }
}

/// Get DLL file version using Windows API (via powershell as fallback)
fn get_dll_version(dll_path: &str) -> Option<String> {
    // Use PowerShell to read the file version info
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("(Get-Item '{dll_path}').VersionInfo.FileVersion"),
        ])
        .creation_flags(0x08000000)
        .output()
        .ok()?;
    if output.status.success() {
        String::from_utf8(output.stdout)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    } else {
        None
    }
}

/// Detect Claude Code config directory
pub fn get_user_config_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
    PathBuf::from(format!("{home}\\.claude"))
}

/// Detect whether the Claude Code managed config exists
pub fn get_managed_config_dir() -> PathBuf {
    PathBuf::from("C:\\ProgramData\\ClaudeCode")
}

/// Detect Node.js and npm versions with detailed resolution
pub fn detect_node() -> NodeInfo {
    let result = detect_node_classified();

    NodeInfo {
        node_version: result.version.clone(),
        npm_version: result.npm_version.clone(),
        detection_method: result.detection_method,
        resolved_path: result.exe_path.clone(),
    }
}

/// Run full environment detection
pub fn detect_environment() -> EnvironmentStatus {
    let mut warnings = Vec::new();
    let errors = Vec::new();

    let node = detect_node();
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
        warnings.push("Claude Code 已安装但 %USERPROFILE%\\.local\\bin 不在 PATH 中。".to_string());
    }

    EnvironmentStatus {
        node,
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

    // ── Windows detection ────────────────────────────────────────

    #[test]
    fn test_windows_info_fields() {
        let info = detect_windows();
        assert!(!info.version.is_empty(), "version should not be empty");
        assert!(
            !info.architecture.is_empty(),
            "architecture should not be empty"
        );
        // display_version should contain "Windows" or "Unknown" on non-Windows
        assert!(
            info.display_version.contains("Windows") || info.display_version.contains("Unknown"),
        );
    }

    #[test]
    fn test_windows_info_serialization() {
        let info = detect_windows();
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("version"));
        assert!(json.contains("display_version"));
        assert!(json.contains("architecture"));
        assert!(json.contains("is_arm64"));
        assert!(json.contains("is_elevated"));
    }

    #[test]
    fn test_windows_info_debug() {
        let info = detect_windows();
        let fmt = format!("{:?}", info);
        assert!(fmt.contains("WindowsInfo"));
    }

    // ── PowerShell detection ─────────────────────────────────────

    #[test]
    fn test_powershell_info_serialization() {
        let info = detect_powershell();
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("available"));
        assert!(json.contains("version"));
    }

    // ── Git detection ────────────────────────────────────────────

    #[test]
    fn test_detect_git_no_panic() {
        let info = detect_git();
        // Just ensure no panic
        println!("Git installed: {}", info.installed);
    }

    #[test]
    fn test_git_info_serialization() {
        let info = detect_git();
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("installed"));
        assert!(json.contains("version"));
    }

    #[test]
    fn test_git_info_debug() {
        let info = detect_git();
        let fmt = format!("{:?}", info);
        assert!(fmt.contains("installed"));
    }

    // ── Claude Code detection ────────────────────────────────────

    #[test]
    fn test_detect_claude_code_no_panic() {
        let info = detect_claude_code();
        println!(
            "Claude Code installed: {} (source: {:?})",
            info.installed, info.install_source
        );
    }

    #[test]
    fn test_claude_code_info_serialization() {
        let info = detect_claude_code();
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("installed"));
        assert!(json.contains("install_source"));
    }

    // ── PATH check ───────────────────────────────────────────────

    #[test]
    fn test_check_path_fields() {
        let info = check_path();
        assert!(
            !info.path_directories.is_empty(),
            "PATH should have at least one directory"
        );
        assert!(
            info.claude_bin_path.is_some(),
            "claude_bin_path should be Some"
        );
    }

    #[test]
    fn test_check_path_serialization() {
        let info = check_path();
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("claude_bin_in_path"));
        assert!(json.contains("path_directories"));
    }

    #[test]
    fn test_check_path_user_bin_path_format() {
        let info = check_path();
        let bin_path = info.claude_bin_path.unwrap_or_default();
        assert!(
            bin_path.contains(".local\\bin"),
            "claude bin path should contain .local\\bin"
        );
    }

    // ── WebView2 detection ───────────────────────────────────────

    #[test]
    fn test_detect_webview2_no_panic() {
        let info = detect_webview2();
        println!("WebView2 installed: {}", info.installed);
    }

    #[test]
    fn test_webview2_info_serialization() {
        let info = detect_webview2();
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("installed"));
    }

    // ── Config directory paths ───────────────────────────────────

    #[test]
    fn test_get_user_config_dir() {
        let dir = get_user_config_dir();
        let dir_str = dir.to_string_lossy().to_string();
        assert!(
            dir_str.ends_with("\\.claude") || dir_str.ends_with("/.claude"),
            "user config dir should end with .claude: {}",
            dir_str,
        );
    }

    #[test]
    fn test_get_managed_config_dir() {
        let dir = get_managed_config_dir();
        let dir_str = dir.to_string_lossy().to_string();
        assert!(
            dir_str.contains("ProgramData"),
            "managed dir should be under ProgramData"
        );
        assert!(
            dir_str.contains("ClaudeCode"),
            "managed dir should contain ClaudeCode"
        );
    }

    // ── which() private helper ───────────────────────────────────

    #[test]
    fn test_which_known_exe() {
        // cmd.exe should always be found via `where`
        let result = which("cmd.exe");
        assert!(result.is_some(), "cmd.exe should be found on PATH");
        let path = result.unwrap();
        assert!(!path.is_empty(), "path should not be empty");
    }

    #[test]
    fn test_which_nonexistent_exe() {
        let result = which("xyz_nonexistent_exe_98765.exe");
        assert!(result.is_none(), "non-existent exe should return None");
    }

    // ── Full environment detection ───────────────────────────────

    #[test]
    fn test_detect_environment_complete() {
        let env = detect_environment();
        assert!(!env.windows.version.is_empty());
        assert!(!env.path.path_directories.is_empty());
        // errors should be empty unless something goes wrong
        assert!(env.errors.is_empty(), "unexpected errors: {:?}", env.errors);
        // network_reachable is always None in current implementation
        assert!(env.network_reachable.is_none());
    }

    #[test]
    fn test_detect_environment_serialization() {
        let env = detect_environment();
        let json = serde_json::to_string(&env).unwrap();
        assert!(json.contains("node"), "JSON should contain node field");
        assert!(
            json.contains("windows"),
            "JSON should contain windows field"
        );
        assert!(
            json.contains("powershell"),
            "JSON should contain powershell field"
        );
        assert!(json.contains("git"), "JSON should contain git field");
        assert!(json.contains("path"), "JSON should contain path field");
        assert!(
            json.contains("claude_code"),
            "JSON should contain claude_code field"
        );
        assert!(
            json.contains("webview2"),
            "JSON should contain webview2 field"
        );
        assert!(json.contains("errors"), "JSON should contain errors field");
        assert!(
            json.contains("warnings"),
            "JSON should contain warnings field"
        );
    }

    #[test]
    fn test_detect_environment_warnings_consistency() {
        let env = detect_environment();
        // If PowerShell is missing, there should be a corresponding warning
        if !env.powershell.available {
            assert!(
                env.warnings.iter().any(|w| w.contains("PowerShell")),
                "missing PowerShell should produce a warning",
            );
        }
    }

    #[test]
    fn test_detect_environment_warnings_path_consistency() {
        let env = detect_environment();
        // If Claude Code is installed but not in PATH, a warning should exist
        if env.claude_code.installed && !env.path.claude_bin_in_path {
            assert!(
                env.warnings
                    .iter()
                    .any(|w| w.contains("Claude Code") && w.contains("PATH")),
                "installed Claude Code without PATH entry should produce a warning",
            );
        }
    }

    // ── Struct Debug implementations ─────────────────────────────

    #[test]
    fn test_powershell_info_debug() {
        let info = detect_powershell();
        let fmt = format!("{:?}", info);
        assert!(fmt.contains("available"));
    }

    #[test]
    fn test_path_check_debug() {
        let info = check_path();
        let fmt = format!("{:?}", info);
        assert!(fmt.contains("claude_bin_in_path"));
    }

    #[test]
    fn test_environment_status_debug() {
        let env = detect_environment();
        let fmt = format!("{:?}", env);
        assert!(fmt.contains("EnvironmentStatus"));
        assert!(fmt.contains("windows"));
    }
}
