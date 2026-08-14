// Claude Code Manager - Unified installer with environment refresh

//

// Strategy pipeline for each component:

//   1. Check if already installed (with PATH refresh)

//   2. Select installation method (portable -> winget -> MSI)

//   3. Download with source selection, caching, and verification

//   4. Install

//   5. Refresh Windows PATH from registry

//   6. Verify using absolute path + refreshed PATH

//   7. Re-detect full environment

//   8. Add to user PATH for terminal access



use crate::error::AppError;

use crate::process::{CommandSpec, execute_command};

use crate::task::TaskManager;

use serde::Serialize;

use std::sync::Arc;

use std::sync::atomic::{AtomicBool, Ordering};

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};



pub type AppResult<T> = Result<T, AppError>;



const NPM_MIRROR: &str = "https://registry.npmmirror.com/";



const NODE_SOURCES: &[(&str, &str, &str)] = &[

    ("official", "Official", "https://nodejs.org/dist/"),

    ("npmmirror", "Aliyun", "https://npmmirror.com/mirrors/node/"),

    ("huawei", "Huawei", "https://mirrors.huaweicloud.com/nodejs/"),

    ("tencent", "Tencent", "https://mirrors.cloud.tencent.com/nodejs/"),

];



const NODE_VERSION: &str = "v22.14.0";

const NODE_FILENAME: &str = "node-v22.14.0-win-x64";

const NODE_ZIP: &str = "node-v22.14.0-win-x64.zip";

const NODE_MSI_URL: &str = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi";



#[derive(Debug, Clone, Serialize)]

pub struct InstallStepResult {

    pub component: String,

    pub success: bool,

    pub version: Option<String>,

    pub message: String,

}



#[derive(Debug, Clone, Serialize)]

pub struct DownloadProgress {

    pub stage: String,

    pub percent: f64,

    pub speed_bytes_per_sec: f64,

    pub downloaded_bytes: u64,

    pub total_bytes: u64,

    pub source: String,

}



fn hidden_cmd() -> std::process::Command {

    let mut c = std::process::Command::new("cmd");

    use std::os::windows::process::CommandExt;

    c.creation_flags(0x08000000);

    c

}



fn detect_cmd(program: &str, arg: &str) -> Option<String> {

    let output = hidden_cmd().args(["/c", program, arg]).output().ok()?;

    if !output.status.success() { return None; }

    String::from_utf8(output.stdout).ok().map(|s| s.trim().to_string())

}



fn portable_node_root() -> String {

    format!("{}\\ClaudeCodeManager\\runtime\\node\\{}",

        std::env::var("APPDATA").unwrap_or_default(), NODE_VERSION)

}



fn portable_node_exe() -> String {

    format!("{}\\{}\\node.exe", portable_node_root(), NODE_FILENAME)

}



fn portable_npm_cmd() -> String {

    format!("{}\\{}\npm.cmd", portable_node_root(), NODE_FILENAME)

}



fn portable_bin_dir() -> String {

    format!("{}\\{}", portable_node_root(), NODE_FILENAME)

}



fn detect_node_refreshed() -> Option<String> {

    let r = crate::env_refresh::detect_with_fresh_path("node", "--version")

        .map(|s| s.trim_start_matches('v').to_string());

    if r.is_some() { return r; }

    let p = portable_node_exe();

    if std::path::Path::new(&p).exists() { return verify_node_at_path(&p); }

    detect_node()

}



fn detect_npm_refreshed() -> Option<String> {

    let r = crate::env_refresh::detect_with_fresh_path("npm", "--version");

    if r.is_some() { return r; }

    // Try npm.cmd explicitly (Windows batch file wrapper)
    let r_cmd = crate::env_refresh::detect_with_fresh_path("npm.cmd", "--version");
    if r_cmd.is_some() { return r_cmd; }

    let p = portable_npm_cmd();

    if std::path::Path::new(&p).exists() {

        let mut cmd = std::process::Command::new(&p);

        use std::os::windows::process::CommandExt;

        cmd.creation_flags(0x08000000);

        cmd.args(["--version"]);

        return cmd.output().ok().and_then(|o| if o.status.success() { String::from_utf8(o.stdout).ok() } else { None }).map(|s| s.trim().to_string());

    }

    detect_npm()

}



fn find_node_exe_absolute() -> Option<String> {

    crate::env_refresh::where_on_refreshed_path("node.exe")

}



fn verify_node_at_path(path: &str) -> Option<String> {

    let pb = std::path::Path::new(path);

    if !pb.exists() { return None; }

    let mut cmd = std::process::Command::new(path);

    use std::os::windows::process::CommandExt;

    cmd.creation_flags(0x08000000);

    cmd.args(["--version"]);

    cmd.output().ok().and_then(|o| if o.status.success() { String::from_utf8(o.stdout).ok() } else { None }).map(|s| s.trim().trim_start_matches('v').to_string())

}



pub fn detect_node() -> Option<String> {

    detect_cmd("node", "--version").map(|s| s.trim_start_matches('v').to_string())

}



pub fn detect_npm() -> Option<String> {

    detect_cmd("npm", "--version")

}



pub fn detect_git_usable() -> Option<String> {

    detect_cmd("git", "--version")

}

/// Detect git using refreshed registry PATH (catches new installs without restart)
pub fn detect_git_refreshed() -> Option<String> {
    let r = crate::env_refresh::detect_with_fresh_path("git", "--version");
    if r.is_some() { return r; }
    let known = [
        "C:\\Program Files\\Git\\cmd\\git.exe",
        "C:\\Program Files\\Git\\mingw64\\bin\\git.exe",
        "C:\\Program Files (x86)\\Git\\cmd\\git.exe",  ];
    for exe in &known {
        if std::path::Path::new(exe).exists() {
            use std::os::windows::process::CommandExt;
            let mut c = std::process::Command::new(exe);
            c.creation_flags(0x08000000);
            c.args(["--version"]);
            if let Ok(o) = c.output() {
                if o.status.success() {
                    return String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string());
                }
            }
        }
    }
    detect_git_usable()
}

pub fn refresh_env() -> crate::env_refresh::RefreshedPath {

    crate::env_refresh::refresh_windows_path()

}



fn check_winget_available() -> WingetStatus {

    if crate::process::which("winget.exe").is_none() {

        return WingetStatus::NotInstalled;

    }

    match std::process::Command::new("winget").arg("--version").output() {

        Ok(o) if o.status.success() => {

            let ver = String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

            WingetStatus::Available(ver)

        }

        Ok(_) => WingetStatus::Failed("winget non-zero exit".into()),

        Err(e) => WingetStatus::Failed(format!("winget error: {}", e)),

    }

}



#[derive(Debug, Clone, Serialize)]

pub enum WingetStatus {

    Available(Option<String>),

    NotInstalled,

    Failed(String),

}



async fn benchmark_source(source_url: &str) -> Option<u64> {

    use std::time::Instant;

    let client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build().ok()?;

    let start = Instant::now();

    let resp = client.head(source_url).send().await.ok()?;

    if resp.status().is_success() || resp.status().is_redirection() {

        Some(start.elapsed().as_millis() as u64)

    } else { None }

}



async fn select_fastest_source(version: &str, filename: &str) -> (String, String) {

    let mut candidates: Vec<(u64, String, String)> = Vec::new();

    let file_url = format!("{}{}/{}", "{base}", version, filename);

    for (id, _name, base_url) in NODE_SOURCES {

        let url = file_url.replace("{base}", base_url);

        if let Some(latency) = benchmark_source(&format!("{}{}/", base_url, version)).await {

            candidates.push((latency, id.to_string(), url));

        }

    }

    candidates.sort_by_key(|(lat, _, _)| *lat);

    if let Some((_lat, _id, url)) = candidates.into_iter().next() {

        (url, _id)

    } else {

        (file_url.replace("{base}", "https://nodejs.org/dist/"), "official".to_string())

    }

}



fn cache_dir() -> String {

    let a = std::env::var("APPDATA").unwrap_or_else(|_| std::env::var("USERPROFILE").map(|p| format!("{}\\AppData\\Roaming", p)).unwrap_or_else(|_| "C:\\Users\\Default\\AppData\\Roaming".to_string()));

    format!("{}\\ClaudeCodeManager\\cache\\installers", a)

}



fn ensure_cache_dir() -> std::io::Result<()> {

    std::fs::create_dir_all(cache_dir())?;

    std::fs::create_dir_all(format!("{}\\ClaudeCodeManager\\runtime\\node\\{}", std::env::var("APPDATA").unwrap_or_default(), NODE_VERSION))

}



fn cached_file_path(filename: &str) -> String { format!("{}\\{}", cache_dir(), filename) }

fn is_file_cached(path: &str) -> bool { std::path::Path::new(path).exists() && std::fs::metadata(path).map(|m| m.len() > 0).unwrap_or(false) }



async fn download_file(url: &str, dest: &str, app: &AppHandle, task_id: &str) -> AppResult<()> {

    let client = reqwest::Client::builder().timeout(Duration::from_secs(300)).build()

        .map_err(|e| AppError::new("NET_ERR", "Network error", format!("{}", e)))?;

    let response = client.get(url).send().await

        .map_err(|e| AppError::new("DL_FAIL", "Download failed", format!("{}", e)).retryable())?;

    let total_size = response.content_length().unwrap_or(0);

    let mut downloaded: u64 = 0;

    let start = std::time::Instant::now();

    let mut file = tokio::fs::File::create(dest).await

        .map_err(|e| AppError::new("DL_FAIL", "File error", format!("{}", e)))?;

    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;

    while let Some(chunk) = stream.next().await {

        let chunk = chunk.map_err(|e| AppError::new("DL_FAIL", "Stream error", format!("{}", e)).retryable())?;

        use tokio::io::AsyncWriteExt;

        file.write_all(&chunk).await.map_err(|e| AppError::new("DL_FAIL", "Write error", format!("{}", e)))?;

        downloaded += chunk.len() as u64;

        let elapsed = start.elapsed().as_secs_f64();

        let speed = if elapsed > 0.0 { downloaded as f64 / elapsed } else { 0.0 };

        let percent = if total_size > 0 { (downloaded as f64 / total_size as f64) * 100.0 } else { 0.0 };

        let _ = app.emit("download-progress", DownloadProgress {

            stage: "downloading".into(), percent, speed_bytes_per_sec: speed,

            downloaded_bytes: downloaded, total_bytes: total_size, source: url.into(),

        });

    }

    file.sync_all().await.map_err(|e| AppError::new("DL_FAIL", "Sync error", format!("{}", e)))

}



async fn extract_zip(zip_path: &str, destination: &str) -> AppResult<()> {

    let spec = CommandSpec::new("powershell").args(vec!["-NoProfile".into(), "-Command".into(),

        format!("Expand-Archive -Path '{}' -DestinationPath '{}' -Force", zip_path, destination)])

        .timeout(Duration::from_secs(120));

    let result = execute_command(&spec, None).await?;

    if !result.success { return Err(AppError::new("ZIP_FAIL", "Extraction failed", result.stderr)); }

    Ok(())

}



/// Add a directory to HKCU\Environment PATH. New terminals will see it.

fn add_dir_to_user_path(dir: &str) -> bool {

    use winreg::enums::*;

    use winreg::RegKey;

    let key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(r"Environment", KEY_READ | KEY_WRITE) {

        Ok(k) => k, Err(_) => return false,

    };

    let current: String = key.get_value("PATH").unwrap_or_default();

    let nd = dir.trim().trim_end_matches('\\').to_lowercase();

    if current.split(';').any(|e| e.trim().trim_end_matches('\\').to_lowercase() == nd) {

        return false;

    }

    let new_path = if current.is_empty() || current.ends_with(';') { format!("{}{}", current, dir) } else { format!("{};{}", current, dir) };

    key.set_value("PATH", &new_path).ok();

    true

}



async fn install_node_portable(task_id: &str, app: &AppHandle) -> AppResult<InstallStepResult> {

    let state = app.state::<crate::AppState>();

    let tm = &state.task_manager;

    let rt = format!("{}\\ClaudeCodeManager\\runtime\\node\\{}", std::env::var("APPDATA").unwrap_or_default(), NODE_VERSION);

    let ne = format!("{}\\{}\\node.exe", rt, NODE_FILENAME);

    if std::path::Path::new(&ne).exists() {

        if let Some(ver) = verify_node_at_path(&ne) {

            add_dir_to_user_path(&portable_bin_dir());

            return Ok(InstallStepResult { component: "Node.js".into(), success: true, version: Some(ver.clone()), message: format!("Portable Node.js {} ready (in PATH)", ver) });

        }

    }

    ensure_cache_dir().ok();

    tm.update_progress(task_id, 10.0, Some("Testing sources...".into()), app);

    let (url, src_id) = select_fastest_source(NODE_VERSION, NODE_ZIP).await;

    let cp = cached_file_path(NODE_ZIP);

    if !is_file_cached(&cp) {

        tm.update_progress(task_id, 20.0, Some(format!("Downloading Node.js {}...", NODE_VERSION)), app);

        download_file(&url, &cp, app, task_id).await?;

        tm.update_progress(task_id, 60.0, Some("Verifying...".into()), app);

    } else { tm.update_progress(task_id, 40.0, Some("Using cache...".into()), app); }

    tm.update_progress(task_id, 50.0, Some("Extracting...".into()), app);

    extract_zip(&cp, &rt).await?;

    tm.update_progress(task_id, 80.0, Some("Verifying...".into()), app);

    let ver = verify_node_at_path(&ne);

    if let Some(ref v) = ver {

        let pa = add_dir_to_user_path(&portable_bin_dir());

        return Ok(InstallStepResult { component: "Node.js".into(), success: true, version: Some(v.clone()), message: format!("Portable Node.js {} done{}", v, if pa { " (in PATH)" } else { "" }) });

    }

    if let Ok(entries) = std::fs::read_dir(&rt) {

        for entry in entries.flatten() {

            let p = entry.path().join("node.exe");

            if p.exists() {

                if let Some(ref v) = verify_node_at_path(&p.to_string_lossy()) {

                    return Ok(InstallStepResult { component: "Node.js".into(), success: true, version: Some(v.clone()), message: format!("Portable Node.js {} done", v) });

                }

            }

        }

    }

    Err(AppError::new("INSTALL_FAIL", "Extraction failed", "node.exe not found").retryable())

}



async fn install_node_msi(task_id: &str, app: &AppHandle) -> AppResult<InstallStepResult> {

    let state = app.state::<crate::AppState>();

    let tm = &state.task_manager;

    tm.update_progress(task_id, 20.0, Some("Downloading MSI...".into()), app);

    let msi = format!("{}\\AppData\\Local\\Temp\\node-install.msi", std::env::var("USERPROFILE").unwrap_or_default());

    download_file(NODE_MSI_URL, &msi, app, task_id).await?;

    tm.update_progress(task_id, 60.0, Some("Installing (MSI)...".into()), app);

    if let Err(e) = execute_command(&CommandSpec::new("msiexec").args(vec!["/i".into(), msi, "/quiet".into(), "/norestart".into()]).timeout(Duration::from_secs(300)), None).await {

        return Err(AppError::new("MSI_FAIL", "MSI install failed", format!("{}", e.message)));

    }

    tm.update_progress(task_id, 80.0, Some("Refreshing PATH...".into()), app);

    refresh_env();

    if let Some(ref v) = detect_node_refreshed() {

        return Ok(InstallStepResult { component: "Node.js".into(), success: true, version: Some(v.clone()), message: format!("Node.js {} installed (MSI)", v) });

    }

    if let Some(exe) = find_node_exe_absolute() {

        if let Some(ref v) = verify_node_at_path(&exe) {

            return Ok(InstallStepResult { component: "Node.js".into(), success: true, version: Some(v.clone()), message: format!("Node.js {} installed", v) });

        }

    }

    Ok(InstallStepResult { component: "Node.js".into(), success: false, version: None, message: "Node.js install failed.".into() })

}



pub async fn install_node(task_id: &str, app: &AppHandle) -> AppResult<InstallStepResult> {

    let state = app.state::<crate::AppState>();

    let tm = &state.task_manager;

    if let Some(ref v) = detect_node_refreshed() {

        return Ok(InstallStepResult { component: "Node.js".into(), success: true, version: Some(v.clone()), message: format!("Node.js {} already installed", v) });

    }

    let pr = install_node_portable(task_id, app).await;

    if let Ok(ref r) = pr { if r.success { refresh_env(); return Ok(r.clone()); } }

    tm.update_progress(task_id, 15.0, Some("Checking winget...".into()), app);

    match check_winget_available() {

        WingetStatus::Available(ver) => {

            tm.update_progress(task_id, 20.0, Some(format!("winget {} available", ver.unwrap_or_default())), app);

            let _ = execute_command(&CommandSpec::new("winget").args(vec!["install".into(), "OpenJS.NodeJS.LTS".into(), "--silent".into(), "--accept-package-agreements".into(), "--accept-source-agreements".into()]).timeout(Duration::from_secs(120)), get_cancel_flag(tm, task_id)).await;

            refresh_env();

            if let Some(ref v) = detect_node_refreshed() {

                return Ok(InstallStepResult { component: "Node.js".into(), success: true, version: Some(v.clone()), message: format!("Node.js {} via winget", v) });

            }

        }

        _ => { tm.update_progress(task_id, 20.0, Some("winget not available".into()), app); }

    }

    tm.update_progress(task_id, 30.0, Some("Portable 和 winget 均失败".into()), app);

    Ok(InstallStepResult {
        component: "Node.js".into(),
        success: false,
        version: None,
        message: "Node.js 安装失败：便携版未成功，winget 不可用或失败。请手动安装 https://nodejs.org".into(),
    })

}



pub fn get_npm_registry() -> String {

    hidden_cmd().args(["/c", "npm config get registry"]).output().ok()

        .and_then(|o| String::from_utf8(o.stdout).ok()).map(|s| s.trim().to_string())

        .unwrap_or_else(|| "https://registry.npmjs.org/".into())

}



pub fn optimize_npm_registry() -> (String, String) {

    let orig = get_npm_registry();

    if orig.contains("npmmirror") || orig.contains("taobao") || orig.contains("tencent") { return (orig.clone(), orig); }

    set_npm_registry(NPM_MIRROR);

    (NPM_MIRROR.into(), orig)

}



fn set_npm_registry(url: &str) { hidden_cmd().args(["/c", "npm", "config", "set", "registry", url]).output().ok(); }



pub async fn install_git(task_id: &str, app: &AppHandle) -> AppResult<InstallStepResult> {

    let state = app.state::<crate::AppState>();

    let tm = &state.task_manager;

    if let Some(ref v) = detect_git_usable() { return Ok(InstallStepResult { component: "Git".into(), success: true, version: Some(v.clone()), message: v.clone() }); }

    let mut skipped = false;

    match check_winget_available() {

        WingetStatus::Available(ver) => {

            tm.update_progress(task_id, 10.0, Some(format!("winget {} available", ver.unwrap_or_default())), app);

            let _ = execute_command(&CommandSpec::new("winget").args(vec!["install".into(), "Git.Git".into(), "--silent".into(), "--accept-package-agreements".into(), "--accept-source-agreements".into()]).timeout(Duration::from_secs(120)), get_cancel_flag(tm, task_id)).await;

            refresh_env();

            if let Some(ref v) = detect_git_usable() { return Ok(InstallStepResult { component: "Git".into(), success: true, version: Some(v.clone()), message: v.clone() }); }

        }

        _ => { skipped = true; }

    }

    if skipped { tm.update_progress(task_id, 15.0, Some("winget unavailable, downloading...".into()), app); }

    tm.update_progress(task_id, 25.0, Some("Downloading Git...".into()), app);

    let gv = "2.45.2";

    let srcs = [

        ("github", format!("https://github.com/git-for-windows/git/releases/download/v{}.windows.1/Git-{}-64-bit.exe", gv, gv)),

        ("npmmirror", format!("https://npmmirror.com/mirrors/git-for-windows/v{}.windows.1/Git-{}-64-bit.exe", gv, gv)),

    ];

    let ip = format!("{}\\AppData\\Local\\Temp\\git-install.exe", std::env::var("USERPROFILE").unwrap_or_default());

    let mut ok = false;

    for (_id, url) in &srcs { if download_file(url, &ip, app, task_id).await.is_ok() { ok = true; break; } }

    if !ok { return Ok(InstallStepResult { component: "Git".into(), success: false, version: None, message: "Git download failed.".into() }); }

    tm.update_progress(task_id, 60.0, Some("Installing Git...".into()), app);

    if let Err(e) = execute_command(&CommandSpec::new(&ip).args(vec!["/VERYSILENT".into(), "/NORESTART".into(), "/NOCANCEL".into(), "/SP-".into()]).timeout(Duration::from_secs(300)), None).await {

        return Ok(InstallStepResult { component: "Git".into(), success: false, version: None, message: format!("{}", e.message) });

    }

    tm.update_progress(task_id, 80.0, Some("Refreshing PATH...".into()), app);

    refresh_env();

    if let Some(ref v) = detect_git_refreshed() { Ok(InstallStepResult { component: "Git".into(), success: true, version: Some(v.clone()), message: v.clone() }) }

    else { Ok(InstallStepResult { component: "Git".into(), success: false, version: None, message: "Git installed but not in PATH yet.".into() }) }

}



pub async fn install_claude(task_id: &str, app: &AppHandle) -> AppResult<InstallStepResult> {

    let state = app.state::<crate::AppState>();

    let tm = &state.task_manager;

    let ex = crate::environment::detect_claude_code();

    if ex.installed { return Ok(InstallStepResult { component: "Claude Code".into(), success: true, version: ex.version, message: format!("Already installed ({})", ex.install_method.unwrap_or_default()) }); }

    if detect_npm_refreshed().or_else(|| detect_npm()).is_none() { return Ok(InstallStepResult { component: "Claude Code".into(), success: false, version: None, message: "npm required first.".into() }); }

    tm.update_progress(task_id, 15.0, Some("Optimizing npm...".into()), app);

    let (chosen, orig) = optimize_npm_registry();

    let mirror = chosen != orig;

    if mirror { tm.update_progress(task_id, 20.0, Some(format!("Mirror: {}", chosen)), app); }

    tm.update_progress(task_id, 30.0, Some("Installing Claude Code...".into()), app);

    let out = execute_command(&CommandSpec::new("cmd").args(vec!["/c".into(), "npm".into(), "install".into(), "-g".into(), "@anthropic-ai/claude-code".into()]).timeout(Duration::from_secs(300)), get_cancel_flag(tm, task_id)).await;

    if mirror { set_npm_registry(&orig); }

    let out = out?;

    tm.update_progress(task_id, 80.0, Some("Refreshing PATH...".into()), app);

    refresh_env();

    tm.update_progress(task_id, 90.0, Some("Verifying...".into()), app);

    // Try detection via environment.rs (uses process PATH)
    let mut inst = crate::environment::detect_claude_code();

    // Fallback: check via refreshed PATH (npm installs to %APPDATA%/npm, which is added to
    // USER PATH but the current process won't see it until restart)
    if !inst.installed {
        let refreshed = crate::env_refresh::detect_with_fresh_path("claude.cmd", "--version")
            .or_else(|| crate::env_refresh::detect_with_fresh_path("claude", "--version"))
            .or_else(|| crate::env_refresh::detect_with_fresh_path("claude.exe", "--version"));
        if let Some(ref v) = refreshed {
            inst = crate::environment::ClaudeCodeInfo {
                installed: true,
                version: Some(v.clone()),
                path: None,
                install_source: Some("npm".to_string()),
                install_method: Some("npm global".to_string()),
                config_path: None,
                health: Some("healthy".to_string()),
                details: vec!["通过刷新 PATH 验证成功".to_string()],
            };
        }
    }

    if inst.installed { Ok(InstallStepResult { component: "Claude Code".into(), success: true, version: inst.version.clone(), message: format!("Claude Code {} 安装成功", inst.version.unwrap_or_default()) }) }

    else { let e = format!("{} {}", out.stdout, out.stderr); Ok(InstallStepResult { component: "Claude Code".into(), success: false, version: None, message: if e.trim().is_empty() { "验证失败，请手动运行 npm install -g @anthropic-ai/claude-code".into() } else { e.trim().into() } }) }

}


fn get_cancel_flag(tm: &TaskManager, task_id: &str) -> Option<Arc<AtomicBool>> {

    tm.get_cancel_flag(task_id).map(|m| {

        let flag = Arc::new(AtomicBool::new(false));

        let f = flag.clone();

        std::thread::spawn(move || { for _ in 0..600 { if *m.lock().unwrap() { f.store(true, Ordering::SeqCst); break; } std::thread::sleep(Duration::from_millis(200)); } });

        flag

    })

}



pub fn generate_install_plan() -> Vec<InstallStepResult> {

    let mut plan = Vec::new();

    // Use environment.rs detection (same as environment page — handles refreshed PATH, portable, process PATH)
    let env_node = crate::environment::detect_node();
    let env_git = crate::environment::detect_git();
    let cc = crate::environment::detect_claude_code();

    let node_ok = env_node.node_version.is_some();
    let npm_ok = env_node.npm_version.is_some();

    plan.push(InstallStepResult { component: "Node.js".into(), success: node_ok, version: env_node.node_version, message: if node_ok { "Installed".into() } else { "Needs install".into() } });

    plan.push(InstallStepResult { component: "npm".into(), success: npm_ok, version: env_node.npm_version, message: if npm_ok { "Installed".into() } else { "With Node.js".into() } });

    plan.push(InstallStepResult { component: "Git".into(), success: env_git.installed, version: env_git.version, message: if env_git.installed { "Installed".into() } else { "Optional".into() } });

    plan.push(InstallStepResult { component: "Claude Code".into(), success: cc.installed, version: cc.version, message: if cc.installed { "Installed".into() } else { "Needs install".into() } });

    plan

}



pub async fn run_full_install(task_id: &str, app: &AppHandle) -> AppResult<Vec<InstallStepResult>> {
    let state = app.state::<crate::AppState>();
    let tm = &state.task_manager;
    let mut results = Vec::new();

    tm.update_progress(task_id, 5.0, Some("Installing Node.js...".into()), app);
    match install_node(task_id, app).await { Ok(r) => results.push(r), Err(e) => results.push(InstallStepResult { component: "Node.js".into(), success: false, version: None, message: e.message }) }

    refresh_env();

    tm.update_progress(task_id, 50.0, Some("Installing Git...".into()), app);
    match install_git(task_id, app).await { Ok(r) => results.push(r), Err(e) => results.push(InstallStepResult { component: "Git".into(), success: false, version: None, message: e.message }) }

    refresh_env();

    if results.iter().all(|r| r.success) {
        tm.update_progress(task_id, 90.0, Some("Base ready, restart for Claude Code".into()), app);
        let _ = app.emit("restart-required", true);
    }

    let _ = app.emit("environment-changed", true);
    Ok(results)
}

/// Uninstall Claude Code binary only. User config (~/.claude) is preserved
/// so reinstalling picks up existing settings. Idempotent: returns success
/// if Claude Code is already absent.
pub async fn uninstall_claude(task_id: &str, app: &AppHandle) -> AppResult<InstallStepResult> {
    let state = app.state::<crate::AppState>();
    let tm = &state.task_manager;

    let info = crate::environment::detect_claude_code();
    if !info.installed {
        return Ok(InstallStepResult {
            component: "Claude Code".into(),
            success: true,
            version: None,
            message: "Claude Code 未安装，无需卸载。".into(),
        });
    }

    let source = info.install_source.as_deref().unwrap_or("npm");
    tm.update_progress(task_id, 20.0, Some(format!("Uninstalling (source: {})...", source)), app);

    let uninstalled = match source {
        "native" => {
            // Remove the binary only; leave ~/.claude config intact.
            let home = std::env::var("USERPROFILE").unwrap_or_default();
            let targets = [
                format!("{}\\.local\\bin\\claude.exe", home),
                format!("{}\\.local\\bin\\claude.cmd", home),
                format!("{}\\.local\\bin\\claude", home),
            ];
            let mut removed_any = false;
            for t in &targets {
                if std::path::Path::new(t).exists() {
                    match std::fs::remove_file(t) {
                        Ok(_) => { removed_any = true; }
                        Err(e) => log::warn!("Failed to remove {}: {}", t, e),
                    }
                }
            }
            removed_any
        }
        // npm / pnpm / yarn all go through npm global for uninstall
        _ => {
            if detect_npm_refreshed().or_else(|| detect_npm()).is_none() {
                log::warn!("npm not available for uninstall; attempting direct binary removal");
                false
            } else {
                let out = execute_command(
                    &CommandSpec::new("cmd").args(vec![
                        "/c".into(), "npm".into(), "uninstall".into(),
                        "-g".into(), "@anthropic-ai/claude-code".into(),
                    ]).timeout(Duration::from_secs(300)),
                    get_cancel_flag(tm, task_id),
                ).await;
                match out {
                    Ok(o) if o.success => true,
                    Ok(o) => {
                        log::warn!("npm uninstall non-zero exit: {}", o.stderr);
                        false
                    }
                    Err(e) => {
                        log::warn!("npm uninstall failed: {}", e);
                        false
                    }
                }
            }
        }
    };

    tm.update_progress(task_id, 80.0, Some("Refreshing PATH...".into()), app);
    refresh_env();

    tm.update_progress(task_id, 90.0, Some("Verifying...".into()), app);
    let after = crate::environment::detect_claude_code();

    // Fallback: if package manager claims success (or native removal ran)
    // but detection still sees the binary, try removing common npm bin paths.
    if after.installed && uninstalled {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        for bin in &[
            format!("{}\\AppData\\Roaming\\npm\\claude.exe", home),
            format!("{}\\AppData\\Roaming\\npm\\claude.cmd", home),
            format!("{}\\AppData\\Roaming\\npm\\claude", home),
            format!("{}\\AppData\\Local\\pnpm\\claude.exe", home),
            format!("{}\\AppData\\Local\\pnpm\\claude.cmd", home),
        ] {
            if std::path::Path::new(bin).exists() {
                let _ = std::fs::remove_file(bin);
            }
        }
    }

    let final_check = crate::environment::detect_claude_code();
    let _ = app.emit("environment-changed", true);

    if !final_check.installed {
        Ok(InstallStepResult {
            component: "Claude Code".into(),
            success: true,
            version: None,
            message: "Claude Code 已卸载（配置已保留）。".into(),
        })
    } else {
        Ok(InstallStepResult {
            component: "Claude Code".into(),
            success: false,
            version: final_check.version,
            message: "卸载未完成：二进制仍可检测到。请手动运行 npm uninstall -g @anthropic-ai/claude-code。".into(),
        })
    }
}

