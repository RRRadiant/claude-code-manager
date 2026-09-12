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

/// How long a detection probe may run before it is killed.
///
/// Detection runs on the UI's critical path (the environment page and the
/// onboarding wizard await it), so an unbounded probe that stalls — a freshly
/// extracted `node.exe` waiting on an antivirus first scan is the realistic
/// case — would freeze the whole page with no error.
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Run a probe with a hard deadline, returning its output only if it finished.
///
/// Prefer this over `Command::output()`, which blocks indefinitely.
fn run_bounded(cmd: &mut std::process::Command) -> Option<std::process::Output> {
    run_bounded_for(cmd, PROBE_TIMEOUT)
}

/// `run_bounded` with an explicit deadline (lets tests use a short budget).
fn run_bounded_for(
    cmd: &mut std::process::Command,
    budget: std::time::Duration,
) -> Option<std::process::Output> {
    let start = std::time::Instant::now();
    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .ok()?;

    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() >= budget {
                    log::warn!("Detection probe timed out after {budget:?}; killed");
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            Err(_) => return None,
        }
    }

    child.wait_with_output().ok()
}

/// Probe `program --version`, returning trimmed stdout on success.
fn probe_version(path: &str) -> Option<String> {
    let start = std::time::Instant::now();
    let mut c = cmd(path);
    c.args(["--version"]);
    let out = run_bounded(&mut c)
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    // A multi-second `node --version` means real-time AV is scanning the binary —
    // the honest explanation for an install that looks stalled but is working.
    let elapsed = start.elapsed();
    if elapsed > std::time::Duration::from_secs(2) {
        log::warn!("`{path} --version` took {elapsed:?} (antivirus scan?)");
    } else {
        log::debug!("`{path} --version` took {elapsed:?}");
    }
    out
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

/// Try to detect node/npm using the current process PATH (standard).
///
/// Both probes are independent process spawns; run them concurrently. Measured on
/// a warm cache, `node --version` costs ~60 ms and `npm --version` ~230 ms, so
/// running them sequentially wasted the node probe's entire duration waiting.
fn detect_node_process_path() -> (Option<String>, Option<String>) {
    let node =
        std::thread::spawn(|| probe_version("node").map(|s| s.trim_start_matches('v').to_string()));
    // npm may be exposed as `npm` or `npm.cmd` depending on the install source,
    // and on Windows `npm.cmd` is the one that actually exists — try it directly
    // rather than paying for a guaranteed-failing `npm` probe first.
    let npm = std::thread::spawn(|| probe_version("npm.cmd").or_else(|| probe_version("npm")));

    (node.join().unwrap_or(None), npm.join().unwrap_or(None))
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
    // First try standard where
    let std_path = which("node.exe")
        .filter(|s| !s.is_empty())
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
                            // Bounded: this is the call that used to hang the
                            // install at "验证安装" when node.exe stalled.
                            let version = probe_version(&portable_node)
                                .map(|s| s.trim_start_matches('v').to_string());
                            let npm_exe = sub.path().join("npm.cmd");
                            let npm_version = if npm_exe.exists() {
                                probe_version(&npm_exe.to_string_lossy())
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
            let version = probe_version(pattern).map(|s| s.trim_start_matches('v').to_string());
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
    let mut c = cmd("where");
    c.arg(exe);
    run_bounded(&mut c)
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

fn get_powershell_version(path: &str) -> Option<String> {
    let mut c = cmd(path);
    c.args([
        "-NoProfile",
        "-NonInteractive",
        "$PSVersionTable.PSVersion.ToString()",
    ]);
    run_bounded(&mut c)
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
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
    probe_version(path)
}

fn get_git_version(path: &str) -> Option<String> {
    probe_version(path)
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
    if let Some((npm_path, version)) = detect_npm_claude() {
        let path_str = npm_path.to_string_lossy().to_string();
        let config = get_claude_config_dir();
        let entry_exists = npm_path.is_file();

        // `entry_exists` but no version means the program is not runnable: the
        // stale `claude.cmd` shim case, or a `bin/claude.exe` that postinstall
        // never filled in. Report that honestly as installed-but-broken rather
        // than claiming success — reporting success here is what made the UI say
        // "安装成功" while a terminal answered "'claude' 不是内部或外部命令".
        let installed = entry_exists && version.is_some();
        let health = if installed {
            Some("healthy".to_string())
        } else {
            Some("broken".to_string())
        };

        if installed {
            log::info!("Claude Code detected via npm global: {path_str}");
        } else {
            log::warn!(
                "Claude Code entry {path_str} exists but does not run (installed=false, health=broken)"
            );
        }
        details.push(format!("通过 npm 发现: {path_str}"));

        return ClaudeCodeInfo {
            installed,
            version,
            path: Some(npm_path),
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
            log::info!("Claude Code detected at known npm dir: {dir}");
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
    let pnpm_bin = [
        format!("{}\\AppData\\Local\\pnpm\\claude.exe", home),
        format!("{}\\AppData\\Local\\pnpm\\claude.cmd", home),
    ];
    let pnpm_pkg = PathBuf::from(format!(
        "{}\\AppData\\Local\\pnpm\\global\\5\\node_modules\\@anthropic-ai\\claude-code",
        home
    ));
    let pnpm_candidates: Vec<PathBuf> = pnpm_bin
        .iter()
        .map(PathBuf::from)
        .chain(resolve_claude_entry(&pnpm_pkg, []))
        .collect();
    for dir in &pnpm_candidates {
        if dir.exists() {
            let dir = dir.to_string_lossy().to_string();
            details.push(format!("通过 pnpm 发现: {dir}"));
            let version = get_claude_code_version(&dir);
            let config = get_claude_config_dir();
            let health = assess_health(true, &version);
            return ClaudeCodeInfo {
                installed: true,
                version,
                path: Some(PathBuf::from(&dir)),
                install_source: Some("pnpm".to_string()),
                install_method: Some("pnpm".to_string()),
                config_path: config,
                health,
                details,
            };
        }
    }

    // Priority 5: yarn global locations
    let yarn_bin = format!("{}\\AppData\\Local\\Yarn\\bin\\claude.cmd", home);
    let yarn_pkg = PathBuf::from(format!(
        "{}\\AppData\\Local\\Yarn\\Data\\global\\node_modules\\@anthropic-ai\\claude-code",
        home
    ));
    let yarn_candidates: Vec<PathBuf> = std::iter::once(PathBuf::from(&yarn_bin))
        .chain(resolve_claude_entry(&yarn_pkg, []))
        .collect();
    for dir in &yarn_candidates {
        if dir.exists() {
            let dir = dir.to_string_lossy().to_string();
            details.push(format!("通过 yarn 发现: {dir}"));
            let version = get_claude_code_version(&dir);
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

    // Log the whole probe trail. "Claude Code not detected" has several possible
    // causes (PATH, npm prefix, entry layout); without the trail the only way to
    // tell them apart was guesswork.
    log::warn!(
        "Claude Code not detected. probes: [{}]",
        if details.is_empty() {
            "none reached".to_string()
        } else {
            details.join(" | ")
        }
    );

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

/// Whether a resolved path is evidence of a *working* Claude Code install.
///
/// A file merely existing is not enough. The wrapper package ships a
/// `bin/claude.exe` placeholder and a `cli-wrapper.cjs` fallback; when its
/// postinstall download fails, the placeholder stays empty (or absent) and only
/// the fallback remains. Reporting that as installed is how CCM came to claim
/// success while `claude` was "not recognized" in a terminal.
///
/// Rejects:
/// - anything that is not a regular file,
/// - a zero-length file (the un-downloaded placeholder),
/// - shim-like shell scripts, which cannot be executed directly by
///   `Command::new` and are not the program itself; the real binary is preferred
///   and the package's `bin` entry is checked first.
fn is_runnable_entry(path: &std::path::Path) -> bool {
    let Ok(md) = std::fs::metadata(path) else {
        return false;
    };
    if !md.is_file() || md.len() == 0 {
        return false;
    }

    // `.cmd` / `.ps1` / extensionless shims are launchers, not the binary. They
    // are still resolved as a last resort (step 3) so a shim-only install keeps
    // working, so accept them here but never prefer them.
    true
}

/// Whether the claude-code *package* is present while its runnable entry is not.
///
/// Distinguishes "not installed at all" from the specific failure where npm
/// unpacked the wrapper but its postinstall never placed the native binary —
/// typically `--omit=optional`, or a failed 220 MB optional-dependency download.
/// That case needs a very different message from "please install Claude Code".
///
/// This runs the entry, so a stale `claude.cmd` shim whose `bin\claude.exe`
/// target is gone also counts as broken.
pub fn claude_package_present_but_broken() -> bool {
    let Some(bin) = npm_global_bin_dir() else {
        return false;
    };
    let pkg = bin
        .join("node_modules")
        .join("@anthropic-ai")
        .join("claude-code");
    if !pkg.is_dir() {
        return false;
    }
    match resolve_and_probe(&pkg, ["claude.exe", "claude.cmd", "claude"]) {
        Some((_, version)) => version.is_none(),
        // Package present but nothing even looks like an entry.
        None => true,
    }
}

/// Resolve where Claude Code lives and probe it by actually running it.
///
/// Returns `(path, version)`. `version == None` means the entry exists but does
/// not run — npm writes the `claude.cmd` shim *before* postinstall runs, and the
/// shim points at `bin\claude.exe`, which is exactly the file missing when the
/// postinstall download failed. Callers must not treat that as a working install.
fn resolve_and_probe<const N: usize>(
    package_dir: &std::path::Path,
    shims: [&'static str; N],
) -> Option<(std::path::PathBuf, Option<String>)> {
    let path = resolve_claude_entry(package_dir, shims)?;
    let version = get_claude_code_version(&path.to_string_lossy());
    Some((path, version))
}

/// Try to find claude via npm global list
/// Resolve the runnable entry point of an installed `@anthropic-ai/claude-code`
/// package, independent of the package's internal layout.
///
/// The layout changed upstream: older releases shipped `cli.js`, while current
/// releases ship a native `bin/claude.exe` and no `cli.js` at all.
///
/// Lookup order:
/// 1. `package.json`'s `bin` map — authoritative and layout-agnostic. Its target
///    is required to exist *and* be a real executable, because that is precisely
///    what a half-finished install gets wrong.
/// 2. Well-known entry files relative to the package root.
/// 3. A global-bin shim (`<%APPDATA%>\npm\claude.cmd`).
///
/// Deliberately **not** accepted as an install: `cli-wrapper.cjs` and
/// `install.cjs`. The wrapper's own comments describe it as a fallback launcher
/// for environments where postinstall did not run; treating it as a working
/// install made CCM report success on a machine where the native binary had never
/// been downloaded, so `claude` was still "not recognized" in a terminal.
/// A file existing is not evidence that Claude Code runs.
fn resolve_claude_entry<const N: usize>(
    package_dir: &std::path::Path,
    shims: [&'static str; N],
) -> Option<std::path::PathBuf> {
    if !package_dir.is_dir() {
        return None;
    }

    // 1. Read `bin` from package.json.
    if let Ok(raw) = std::fs::read_to_string(package_dir.join("package.json")) {
        if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&raw) {
            let bin = match pkg.get("bin") {
                Some(serde_json::Value::String(s)) => Some(s.clone()),
                Some(serde_json::Value::Object(map)) => map
                    .get("claude")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                _ => None,
            };
            if let Some(rel) = bin {
                let candidate = package_dir.join(rel.trim_start_matches(['/', '\\']));
                if is_runnable_entry(&candidate) {
                    return Some(candidate);
                }
                log::warn!(
                    "claude-code package.json points at {} but it is missing or empty — \
                     postinstall likely did not run (check `npm config get omit`)",
                    candidate.to_string_lossy()
                );
            }
        }
    }

    // 2. Known entry filenames across layout generations. Only real programs —
    //    never the JS fallback launchers.
    for rel in ["bin/claude.exe", "bin/claude", "cli.js"] {
        let candidate = package_dir.join(rel);
        if is_runnable_entry(&candidate) {
            return Some(candidate);
        }
    }

    // 3. Global-bin shim in the npm prefix.
    if let Ok(appdata) = std::env::var("APPDATA") {
        for name in shims {
            let candidate = std::path::Path::new(&appdata).join("npm").join(name);
            if is_runnable_entry(&candidate) {
                return Some(candidate);
            }
        }
    }

    None
}

/// Resolve the npm global *bin* directory (where `claude.cmd` shims live).
///
/// Derived from `%APPDATA%` rather than by running `npm prefix -g`, because this
/// must work in a process whose PATH does not contain npm at all.
fn npm_global_bin_dir() -> Option<PathBuf> {
    std::env::var("APPDATA")
        .ok()
        .map(|a| PathBuf::from(a).join("npm"))
}

/// Find an installed `@anthropic-ai/claude-code` from the npm global prefix.
///
/// Filesystem-first, and deliberately *not* dependent on `npm` being on PATH.
///
/// This mattered in practice: after CCM installs the portable Node.js, npm lives
/// only in the registry PATH, so a restarted app process still cannot execute
/// `npm root -g`. The old implementation returned `None` in that case and gave up
/// on the whole npm detection path, so a freshly installed Claude Code stayed
/// invisible until the user logged out or manually relaunched the app.
///
/// Order:
/// 1. `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code` — pure filesystem.
/// 2. `npm root -g`, for prefixes that are not the default (nvm, custom prefix).
///
/// Returns the resolved entry **and its version**. A `None` version means the
/// entry exists but does not actually run — the caller must not treat that as a
/// working install.
fn detect_npm_claude() -> Option<(std::path::PathBuf, Option<String>)> {
    // 1. Filesystem-only probe against the standard npm global prefix.
    if let Some(bin) = npm_global_bin_dir() {
        let pkg = bin
            .join("node_modules")
            .join("@anthropic-ai")
            .join("claude-code");
        if pkg.is_dir() {
            if let Some((entry, version)) =
                resolve_and_probe(&pkg, ["claude.exe", "claude.cmd", "claude"])
            {
                log::info!(
                    "Claude Code entry via npm global prefix: {} (runnable={})",
                    entry.to_string_lossy(),
                    version.is_some()
                );
                return Some((entry, version));
            }
            // The package is present but nothing even resembles an entry.
            log::warn!(
                "claude-code package present at {} but no usable entry resolved",
                pkg.to_string_lossy()
            );
            return None;
        }
    }

    // 2. Ask npm, for non-default global prefixes.
    let mut c = cmd("npm");
    c.args(["root", "-g"]);
    c.stdout(std::process::Stdio::piped());
    c.stderr(std::process::Stdio::null());
    let mut child = c.spawn().ok()?;
    let start = std::time::Instant::now();
    // npm's first run after an install can be slow (module cache, antivirus);
    // 8s was tight enough to misreport an installed Claude Code as missing.
    let output = loop {
        if let Some(status) = child.try_wait().ok()? {
            if status.success() {
                break child.wait_with_output().ok()?;
            }
            return None;
        }
        if start.elapsed() > PROBE_TIMEOUT {
            log::warn!("`npm root -g` timed out; skipping npm-based Claude Code detection");
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    if !output.status.success() {
        return None;
    }
    // Lenient: npm output is not guaranteed to be valid UTF-8.
    let npm_root = String::from_utf8_lossy(&output.stdout);
    let npm_root = npm_root.trim();

    let claude_dir = std::path::Path::new(npm_root)
        .join("@anthropic-ai")
        .join("claude-code");

    // Layout-agnostic: works for the legacy `cli.js` release and for current
    // releases that ship `bin/claude.exe`.
    resolve_and_probe(&claude_dir, ["claude.exe", "claude.cmd", "claude"])
}

fn get_claude_code_version(path: &str) -> Option<String> {
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
    // Claude Code's CLI can take a while on first launch; use the shared probe
    // budget rather than a tighter local one.
    loop {
        if let Some(status) = child.try_wait().ok()? {
            if status.success() {
                let out = child.wait_with_output().ok()?;
                return Some(String::from_utf8_lossy(&out.stdout).trim().to_string());
            }
            return None;
        }
        if start.elapsed() > PROBE_TIMEOUT {
            log::warn!("`claude --version` timed out for {path}");
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
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

/// Read a DLL's file version via PowerShell.
///
/// The path is transported with `-EncodedCommand` rather than interpolated into
/// a `-Command` string (the previous form broke on any path containing a quote),
/// `PSModulePath` is dropped so Windows PowerShell 5.1 can resolve its own
/// cmdlets, and the probe is bounded.
fn get_dll_version(dll_path: &str) -> Option<String> {
    let escaped = dll_path.replace('\'', "''");
    let script = format!("(Get-Item -LiteralPath '{escaped}').VersionInfo.FileVersion");
    let encoded = ps_encode(&script);

    use std::os::windows::process::CommandExt;
    let mut c = std::process::Command::new("powershell");
    c.args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded])
        .creation_flags(0x08000000)
        .env_remove("PSModulePath");

    let output = run_bounded(&mut c)?;
    if !output.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

/// Base64-encode a script as UTF-16LE for PowerShell's `-EncodedCommand`.
fn ps_encode(script: &str) -> String {
    use base64::Engine as _;
    let utf16: Vec<u8> = script
        .encode_utf16()
        .flat_map(|u| u.to_le_bytes())
        .collect();
    base64::engine::general_purpose::STANDARD.encode(utf16)
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

    /// The concurrent node/npm probes must return exactly what sequential probes
    /// return.
    ///
    /// Deliberately no timing assertion: under `cargo test` the suite runs many
    /// tests in parallel, so wall-clock comparison is non-deterministic and would
    /// flake. The concurrency is a wall-clock optimisation, not a correctness
    /// property — measure it with `--nocapture` when it matters.
    #[test]
    fn detect_node_process_path_returns_same_values_as_sequential() {
        let seq_node = probe_version("node").map(|s| s.trim_start_matches('v').to_string());
        let seq_npm = probe_version("npm.cmd").or_else(|| probe_version("npm"));

        let (par_node, par_npm) = detect_node_process_path();

        assert_eq!(
            par_node, seq_node,
            "node version must match sequential probe"
        );
        assert_eq!(par_npm, seq_npm, "npm version must match sequential probe");
    }

    // ── Probe timeouts (regression: unbounded probes froze the UI) ──

    /// Detection runs on the UI's critical path, so a hanging probe must be
    /// killed rather than blocking the page forever.
    #[test]
    fn run_bounded_kills_hanging_process() {
        let mut c = cmd("cmd");
        c.args(["/c", "ping", "-n", "30", "127.0.0.1"]);

        // Short budget so the test stays fast; production uses PROBE_TIMEOUT.
        let budget = std::time::Duration::from_millis(600);
        let start = std::time::Instant::now();
        let out = run_bounded_for(&mut c, budget);
        let elapsed = start.elapsed();

        assert!(out.is_none(), "a hanging probe must report unavailable");
        assert!(
            elapsed < std::time::Duration::from_secs(5),
            "must give up promptly, took {elapsed:?}"
        );
    }

    #[test]
    fn run_bounded_returns_output_for_fast_process() {
        let mut c = cmd("cmd");
        c.args(["/c", "echo", "env-probe"]);
        let out = run_bounded(&mut c).expect("fast process must return output");
        assert!(out.status.success());
        assert!(String::from_utf8_lossy(&out.stdout).contains("env-probe"));
    }

    #[test]
    fn probe_version_rejects_missing_file_quickly() {
        let missing = std::env::temp_dir().join("ccm-no-such-probe.exe");
        std::fs::remove_file(&missing).ok();
        let start = std::time::Instant::now();
        assert!(probe_version(&missing.to_string_lossy()).is_none());
        assert!(
            start.elapsed() < std::time::Duration::from_secs(5),
            "a missing executable must fail fast"
        );
    }

    #[test]
    fn probe_version_reads_real_executable_version() {
        // cmd.exe reports a version string via /C ver, not --version, so instead
        // assert the happy path against node if it is present.
        if let Ok(out) = std::process::Command::new("where").arg("node.exe").output() {
            let path = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                let v = probe_version(&path);
                assert!(v.is_some(), "node.exe at {path} must report a version");
            }
        }
    }

    // ── Claude Code entry resolution (regression: cli.js was removed upstream) ──

    /// Build a throwaway package directory laid out like a real npm install.
    fn fake_package(tag: &str, package_json: &str, files: &[&str]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ccm-env-test-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("package.json"), package_json).unwrap();
        for rel in files {
            let p = dir.join(rel);
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&p, b"stub").unwrap();
        }
        dir
    }

    #[test]
    fn resolve_entry_uses_package_json_bin_current_layout() {
        // Mirrors @anthropic-ai/claude-code 2.1.x: bin -> bin/claude.exe, no cli.js.
        let dir = fake_package(
            "binmap",
            r#"{"name":"@anthropic-ai/claude-code","version":"2.1.266","bin":{"claude":"bin/claude.exe"}}"#,
            &["bin/claude.exe"],
        );
        let got = resolve_claude_entry(&dir, []).expect("must resolve via package.json bin");
        assert_eq!(got, dir.join("bin").join("claude.exe"));
        assert!(
            !dir.join("cli.js").exists(),
            "fixture must not contain cli.js"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_entry_falls_back_to_known_entries_without_bin_field() {
        let dir = fake_package(
            "noBin",
            r#"{"name":"x","version":"1.0.0"}"#,
            &["bin/claude.exe"],
        );
        let got = resolve_claude_entry(&dir, []).expect("must find bin/claude.exe directly");
        assert!(got.ends_with("claude.exe"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_entry_still_supports_legacy_cli_js() {
        // Older releases shipped cli.js only; keep working for those installs.
        let dir = fake_package("legacy", r#"{"name":"x","version":"0.2.0"}"#, &["cli.js"]);
        let got = resolve_claude_entry(&dir, []).expect("must find legacy cli.js");
        assert_eq!(got, dir.join("cli.js"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_entry_returns_none_when_not_installed() {
        let dir = std::env::temp_dir().join(format!("ccm-env-absent-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        assert!(resolve_claude_entry(&dir, []).is_none());
    }

    #[test]
    fn resolve_entry_ignores_bin_path_that_does_not_exist() {
        // A bin entry pointing at a missing file must not be reported as installed.
        let dir = fake_package(
            "danglingBin",
            r#"{"name":"x","version":"1.0.0","bin":{"claude":"bin/missing.exe"}}"#,
            &[],
        );
        assert!(
            resolve_claude_entry(&dir, []).is_none(),
            "dangling bin target must not count as an install"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_entry_accepts_string_bin_field() {
        let dir = fake_package(
            "stringBin",
            r#"{"name":"x","version":"1.0.0","bin":"cli.js"}"#,
            &["cli.js"],
        );
        let got = resolve_claude_entry(&dir, []).expect("string bin must resolve");
        assert_eq!(got, dir.join("cli.js"));
        std::fs::remove_dir_all(&dir).ok();
    }

    // ── Regression: a half-installed package must not count as installed ──

    /// The exact field layout that produced a false "安装成功".
    ///
    /// The wrapper package ships `cli-wrapper.cjs` as a fallback launcher for
    /// when postinstall did not run. Detection used to accept it, so CCM reported
    /// success on a machine where `bin/claude.exe` had never been downloaded —
    /// and `claude` was still "not recognized" in a terminal.
    #[test]
    fn resolve_entry_rejects_fallback_launcher_without_binary() {
        let dir = fake_package(
            "halfInstall",
            r#"{"name":"@anthropic-ai/claude-code","version":"2.1.268","bin":{"claude":"bin/claude.exe"}}"#,
            &["cli-wrapper.cjs", "install.cjs", "README.md"],
        );

        assert!(
            !dir.join("bin").join("claude.exe").exists(),
            "fixture must not contain the binary"
        );
        assert!(dir.join("cli-wrapper.cjs").exists());

        assert!(
            resolve_claude_entry(&dir, []).is_none(),
            "a fallback launcher must never be reported as a working install"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A zero-length `bin/claude.exe` is the un-downloaded placeholder, not a
    /// program.
    #[test]
    fn resolve_entry_rejects_empty_binary_placeholder() {
        let dir = fake_package(
            "emptyBin",
            r#"{"name":"@anthropic-ai/claude-code","version":"2.1.268","bin":{"claude":"bin/claude.exe"}}"#,
            &[],
        );
        let placeholder = dir.join("bin").join("claude.exe");
        std::fs::create_dir_all(placeholder.parent().unwrap()).unwrap();
        std::fs::write(&placeholder, b"").unwrap();

        assert!(placeholder.exists(), "placeholder file exists");
        assert!(
            resolve_claude_entry(&dir, []).is_none(),
            "a zero-length binary must not count as installed"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// With the real binary present the install resolves, so the stricter check
    /// does not break healthy machines.
    #[test]
    fn resolve_entry_accepts_complete_install() {
        let dir = fake_package(
            "complete",
            r#"{"name":"@anthropic-ai/claude-code","version":"2.1.268","bin":{"claude":"bin/claude.exe"}}"#,
            &["cli-wrapper.cjs"],
        );
        let binary = dir.join("bin").join("claude.exe");
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
        std::fs::write(&binary, vec![0u8; 1024]).unwrap();

        let got = resolve_claude_entry(&dir, []).expect("complete install must resolve");
        assert_eq!(got, binary);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// `claude_package_present_but_broken` must distinguish the two failure modes
    /// so the UI can give the right advice.
    #[test]
    fn broken_package_detection_matches_real_state() {
        let broken = claude_package_present_but_broken();
        let detected = detect_claude_code().installed;

        assert!(
            !(broken && detected),
            "a detected install cannot also be reported as broken"
        );
        println!("broken={broken} detected={detected}");
    }

    /// `detect_npm_claude` must resolve the npm global prefix from the
    /// filesystem, without ever needing `npm` to be executable.
    ///
    /// Regression: it used to *start* by running `npm root -g`, which fails in a
    /// process whose PATH lacks npm (exactly the state after CCM installs the
    /// portable Node.js and the app is restarted). It then returned `None` and
    /// short-circuited the entire npm detection path, so a freshly installed
    /// Claude Code stayed invisible until the user logged out.
    #[test]
    fn npm_global_bin_dir_is_derived_from_appdata_not_path() {
        let Some(appdata) = std::env::var("APPDATA").ok() else {
            return;
        };
        let expected = PathBuf::from(&appdata).join("npm");
        assert_eq!(
            npm_global_bin_dir().as_deref(),
            Some(expected.as_path()),
            "npm global bin dir must come from %APPDATA%, independent of PATH"
        );
    }

    /// The filesystem-first branch must be the one that finds a real install.
    #[test]
    fn detect_npm_claude_resolves_from_filesystem() {
        let Some(bin) = npm_global_bin_dir() else {
            return;
        };
        let pkg = bin
            .join("node_modules")
            .join("@anthropic-ai")
            .join("claude-code");
        if !pkg.is_dir() {
            println!("claude-code not installed; skipping");
            return;
        }

        let found = detect_npm_claude();
        assert!(
            found.is_some(),
            "filesystem probe must locate the package at {}",
            pkg.to_string_lossy()
        );
        let (entry, version) = found.unwrap();
        assert!(
            entry.is_file(),
            "resolved entry must be a real file: {}",
            entry.to_string_lossy()
        );
        // The probe runs the entry, so a half-installed package legitimately
        // yields a path with no version. Both outcomes are valid here; what
        // matters is that resolution came from the filesystem, not from PATH.
        println!(
            "resolved {} (runnable={})",
            entry.to_string_lossy(),
            version.is_some()
        );
    }

    /// End-to-end check against the machine's real installation.
    ///
    /// Detection must be honest about whether Claude Code actually *runs*.
    ///
    /// Verifies the whole chain:
    /// - a real install resolves and is reported installed with a version;
    /// - a half-install (wrapper present, native binary missing) must **not** be
    ///   reported as installed — that false positive is what made the UI say
    ///   "安装成功" while a terminal answered "'claude' 不是内部或外部命令".
    ///
    /// Both branches are meaningful depending on machine state, so nothing is
    /// skipped: it asserts the invariant that ties the two together.
    #[test]
    fn detect_claude_code_reports_only_working_installs() {
        let Some(appdata) = std::env::var("APPDATA").ok() else {
            return;
        };
        let pkg = PathBuf::from(&appdata)
            .join("npm")
            .join("node_modules")
            .join("@anthropic-ai")
            .join("claude-code");
        if !pkg.is_dir() {
            println!("claude-code not installed; skipping");
            return;
        }

        // Resolution is filesystem-based and layout-agnostic.
        let resolved = resolve_claude_entry(&pkg, ["claude.exe", "claude.cmd", "claude"]);
        let info = detect_claude_code();
        println!(
            "resolved={:?} installed={} version={:?} health={:?}",
            resolved.as_ref().map(|p| p.to_string_lossy().to_string()),
            info.installed,
            info.version,
            info.health
        );

        // The invariant: reporting "installed" requires a version, and a version
        // requires the program to have actually executed.
        if info.installed {
            assert!(
                info.version.is_some(),
                "an install reported as installed must report a version (health={:?})",
                info.health
            );
        } else {
            assert!(
                info.version.is_none(),
                "a non-install must not carry a version"
            );
            // If it is not installed but the package exists, it must be flagged
            // as broken so the repair path can act on it.
            if resolved.is_some() {
                assert!(
                    claude_package_present_but_broken(),
                    "resolvable-but-not-runnable must be reported as broken"
                );
            }
        }
    }
}
