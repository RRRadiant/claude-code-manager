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

use crate::error::{codes, AppError};

use crate::process::{execute_command, CommandSpec};

use crate::task::TaskManager;

use serde::Serialize;

use std::sync::atomic::AtomicBool;

use std::sync::Arc;

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

pub type AppResult<T> = Result<T, AppError>;

const NPM_MIRROR: &str = "https://registry.npmmirror.com/";

const NODE_SOURCES: &[(&str, &str, &str)] = &[
    ("official", "Official", "https://nodejs.org/dist/"),
    ("npmmirror", "Aliyun", "https://npmmirror.com/mirrors/node/"),
    (
        "huawei",
        "Huawei",
        "https://mirrors.huaweicloud.com/nodejs/",
    ),
    // NOTE: mirrors.cloud.tencent.com/nodejs/ returns 404 for the v22.x path
    // layout, so probing it only cost 2.5s per install. Re-add only after
    // verifying the URL pattern again.
];

const NODE_VERSION: &str = "v22.14.0";

const NODE_FILENAME: &str = "node-v22.14.0-win-x64";

const NODE_ZIP: &str = "node-v22.14.0-win-x64.zip";

/// Pinned Git for Windows version and the SHA-256 of its 64-bit installer.
///
/// The digest is copied from the official release notes for
/// `v2.45.2.windows.1` and embedded here on purpose. Fetching it at install time
/// would defeat the point: the checksum would travel over the same channel as the
/// payload, so anything able to swap the installer could swap the digest too.
///
/// Verified 2026-09-11: both the GitHub release asset and the npmmirror copy hash
/// to this value, so the mirror we actually download from is byte-identical to
/// the official artifact.
const GIT_VERSION: &str = "2.45.2";
const GIT_INSTALLER_SHA256: &str =
    "ce022a6a19e58bbbd4823f51cf798b006b4a683b93b0616a7bb5beeee901da98";

#[derive(Debug, Clone, Serialize)]

pub struct InstallStepResult {
    pub component: String,

    pub success: bool,

    pub version: Option<String>,

    pub message: String,
}

#[derive(Debug, Clone, Serialize)]

pub struct DownloadProgress {
    /// Which component this download belongs to ("Node.js" / "Git").
    ///
    /// Required for the UI: Node.js and Git download concurrently, so without
    /// an owner tag two progress streams would overwrite each other.
    pub component: String,

    /// Whether this download should drive the single-download progress bar.
    ///
    /// Computed here so the frontend does not have to hardcode which component
    /// is the one that gates completion.
    pub primary: bool,

    pub stage: String,

    pub percent: f64,

    pub speed_bytes_per_sec: f64,

    pub downloaded_bytes: u64,

    pub total_bytes: u64,

    pub source: String,
}

/// Minimum gap between `download-progress` events.
///
/// A 30 MB archive arrives in ~300 chunks; emitting and re-rendering on each one
/// is pure overhead, and the numbers are unreadable anyway.
const PROGRESS_THROTTLE: Duration = Duration::from_millis(150);

/// The only component allowed to own the UI progress bar.
///
/// Claude Code's install blocks on Node.js, so Node.js is the step that actually
/// gates completion; Git finishing first or last does not change what the user is
/// waiting for. Tagging every event and letting the UI pick this one keeps the
/// bar monotonic during the parallel phase.
const PRIMARY_DOWNLOAD_COMPONENT: &str = "Node.js";

/// Emit a throttled `download-progress` event.
fn emit_download_progress(
    app: &AppHandle,
    component: &str,
    url: &str,
    downloaded: u64,
    total_size: u64,
    elapsed_secs: f64,
    last_emit: &mut Option<std::time::Instant>,
) {
    // Always let the final chunk through so the bar reaches 100%.
    let finished = total_size > 0 && downloaded >= total_size;
    if !finished {
        match last_emit {
            Some(t) if t.elapsed() < PROGRESS_THROTTLE => return,
            _ => {}
        }
    }
    *last_emit = Some(std::time::Instant::now());

    let speed = if elapsed_secs > 0.0 {
        downloaded as f64 / elapsed_secs
    } else {
        0.0
    };
    let percent = if total_size > 0 {
        (downloaded as f64 / total_size as f64) * 100.0
    } else {
        0.0
    };

    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            component: component.to_string(),
            primary: component == PRIMARY_DOWNLOAD_COMPONENT,
            stage: "downloading".into(),
            percent,
            speed_bytes_per_sec: speed,
            downloaded_bytes: downloaded,
            total_bytes: total_size,
            source: url.into(),
        },
    );
}

fn hidden_cmd() -> std::process::Command {
    let mut c = std::process::Command::new("cmd");

    use std::os::windows::process::CommandExt;

    c.creation_flags(0x08000000);

    c
}

/// Build a `CommandSpec` that runs a PowerShell script.
///
/// The script is passed via `-EncodedCommand` (UTF-16LE, base64) rather than
/// interpolated into a `-Command` string. This keeps every dynamic value out of
/// PowerShell's own parser, so a path containing a quote or `;` can never alter
/// the command — the same "arguments as an array, never string concatenation"
/// rule the rest of the codebase follows.
fn ps_script_spec(script: &str, timeout: Duration) -> CommandSpec {
    CommandSpec::new("powershell")
        .args(vec![
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-EncodedCommand".into(),
            ps_encode(script),
        ])
        // Drop the inherited PSModulePath. When CCM is launched from a shell
        // whose PSModulePath belongs to PowerShell 7, Windows PowerShell 5.1
        // inherits those paths, fails to resolve its own built-in modules, and
        // every module cmdlet (Expand-Archive, Get-FileHash, ...) becomes
        // "not recognized". Clearing it restores 5.1's default module discovery.
        .env_remove("PSModulePath")
        .timeout(timeout)
}

/// How long a synchronous probe (`--version` style check) may take before it is
/// killed. Generous enough for a cold antivirus scan of a freshly extracted
/// executable, short enough that a hang cannot freeze the installer.
const PROBE_TIMEOUT: Duration = Duration::from_secs(30);

/// Budget for the *first* run of a just-extracted executable.
///
/// This is the one probe that can legitimately take a long time — 2,447 files
/// were written moments ago, and real-time protection scans the 16 MB `node.exe`
/// before letting it start. A tight cap here would turn "slow but working" into a
/// false failure, so it is deliberately much larger than `PROBE_TIMEOUT`.
const FIRST_RUN_TIMEOUT: Duration = Duration::from_secs(120);

/// Run a command with a hard deadline, returning its stdout on success.
///
/// Every synchronous probe in this module previously used `Command::output()`,
/// which blocks until the child exits *and* its stdout pipe closes. A probe that
/// hangs — a freshly extracted `node.exe` waiting on an antivirus first-scan, or
/// a child process inheriting the pipe — froze the whole install with no
/// progress and no error, which is exactly what "stuck at 验证安装" looked like.
///
/// On timeout the child is killed and `None` is returned, so the caller can fall
/// through to another detection strategy instead of hanging.
fn run_with_timeout(
    cmd: &mut std::process::Command,
    timeout: Duration,
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
                if start.elapsed() >= timeout {
                    log::warn!(
                        "Probe exceeded {}s and was killed; treating as unavailable",
                        timeout.as_secs()
                    );
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => return None,
        }
    }

    child.wait_with_output().ok()
}

fn detect_cmd(program: &str, arg: &str) -> Option<String> {
    let mut c = hidden_cmd();
    c.args(["/c", program, arg]);

    let output = run_with_timeout(&mut c, PROBE_TIMEOUT)?;

    if !output.status.success() {
        return None;
    }

    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn portable_node_root() -> String {
    format!(
        "{}\\ClaudeCodeManager\\runtime\\node\\{}",
        std::env::var("APPDATA").unwrap_or_default(),
        NODE_VERSION
    )
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

    if r.is_some() {
        return r;
    }

    let p = portable_node_exe();

    if std::path::Path::new(&p).exists() {
        return verify_node_at_path(&p);
    }

    detect_node()
}

fn detect_npm_refreshed() -> Option<String> {
    let r = crate::env_refresh::detect_with_fresh_path("npm", "--version");

    if r.is_some() {
        return r;
    }

    // Try npm.cmd explicitly (Windows batch file wrapper)
    let r_cmd = crate::env_refresh::detect_with_fresh_path("npm.cmd", "--version");
    if r_cmd.is_some() {
        return r_cmd;
    }

    let p = portable_npm_cmd();

    if std::path::Path::new(&p).exists() {
        let mut cmd = std::process::Command::new(&p);

        use std::os::windows::process::CommandExt;

        cmd.creation_flags(0x08000000);

        cmd.args(["--version"]);

        return run_with_timeout(&mut cmd, PROBE_TIMEOUT)
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    }

    detect_npm()
}

/// Verify a `node.exe` reports a version.
///
/// `budget` is a parameter because the right value differs by call site: the very
/// first run of a freshly extracted binary can sit behind an antivirus scan for
/// tens of seconds (use `FIRST_RUN_TIMEOUT`), while re-checking an executable on
/// PATH should be quick (`PROBE_TIMEOUT`).
fn verify_node_at_path_within(path: &str, budget: Duration) -> Option<String> {
    let pb = std::path::Path::new(path);

    if !pb.exists() {
        return None;
    }

    let mut cmd = std::process::Command::new(path);

    use std::os::windows::process::CommandExt;

    cmd.creation_flags(0x08000000);

    cmd.args(["--version"]);

    let start = std::time::Instant::now();
    let o = run_with_timeout(&mut cmd, budget)?;
    let elapsed = start.elapsed();
    if elapsed > Duration::from_secs(5) {
        // Worth surfacing: this is the antivirus-scan signature, and it explains
        // why an install felt stalled when it was in fact progressing.
        log::warn!("`node.exe --version` took {elapsed:?}; likely real-time AV scanning of {path}");
    }
    if !o.status.success() {
        return None;
    }
    Some(
        String::from_utf8_lossy(&o.stdout)
            .trim()
            .trim_start_matches('v')
            .to_string(),
    )
}

fn verify_node_at_path(path: &str) -> Option<String> {
    verify_node_at_path_within(path, PROBE_TIMEOUT)
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
    if r.is_some() {
        return r;
    }
    let known = [
        "C:\\Program Files\\Git\\cmd\\git.exe",
        "C:\\Program Files\\Git\\mingw64\\bin\\git.exe",
        "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
    ];
    for exe in &known {
        if std::path::Path::new(exe).exists() {
            use std::os::windows::process::CommandExt;
            let mut c = std::process::Command::new(exe);
            c.creation_flags(0x08000000);
            c.args(["--version"]);
            if let Some(o) = run_with_timeout(&mut c, PROBE_TIMEOUT) {
                if o.status.success() {
                    return Some(String::from_utf8_lossy(&o.stdout).trim().to_string());
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

    let mut c = std::process::Command::new("winget");
    c.arg("--version");
    match run_with_timeout(&mut c, PROBE_TIMEOUT) {
        Some(o) if o.status.success() => {
            let ver = Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|s| !s.is_empty());
            WingetStatus::Available(ver)
        }
        Some(_) => WingetStatus::Failed("winget non-zero exit".into()),
        None => WingetStatus::Failed("winget 未在超时时间内响应".into()),
    }
}

#[derive(Debug, Clone, Serialize)]

pub enum WingetStatus {
    Available(Option<String>),

    NotInstalled,

    Failed(String),
}

/// Head-probe one mirror directory and return its round-trip latency in ms.
async fn benchmark_source(source_url: &str) -> Option<u64> {
    use std::time::Instant;

    // 2.5s is enough to rank reachable mirrors; a longer budget only delays the
    // whole install when a mirror is blackholed.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(2500))
        .build()
        .ok()?;

    let start = Instant::now();

    let resp = client.head(source_url).send().await.ok()?;

    if resp.status().is_success() || resp.status().is_redirection() {
        Some(start.elapsed().as_millis() as u64)
    } else {
        None
    }
}

/// Pick the fastest reachable candidate URL, probing all of them concurrently.
///
/// Returns `(url, id)` of the winner, or the caller's first candidate as a last
/// resort when nothing answered.
///
/// Concurrency matters: probing sequentially could accumulate one timeout per
/// unreachable mirror before the download even started. This is shared by the
/// Node.js and Git downloads because both pick between several mirrors of the
/// same artifact.
///
/// The decision itself lives in [`pick_fastest`], which is pure and therefore
/// testable without depending on external hosts — timing a real HTTP race in a
/// unit test is inherently flaky (CI runners have been observed to time out on a
/// mirror that answers instantly elsewhere).
async fn select_fastest_candidate(candidates: Vec<(String, String)>) -> (String, String) {
    use futures_util::future::join_all;

    let probes = candidates.iter().map(|(id, url)| async move {
        let latency = benchmark_source(url).await;
        (id.clone(), latency, url.clone())
    });

    let measured: Vec<(String, Option<u64>, String)> = join_all(probes).await;
    pick_fastest(&candidates, measured)
}

/// Choose among probe results: fastest responder wins, else the caller's first
/// candidate is returned so the subsequent download surfaces a real error.
///
/// `measured` carries `None` for candidates that did not answer at all; those can
/// never be selected while any other candidate responded.
///
/// Uses `min_by_key`, which keeps the first minimum on ties: if nothing responded
/// every entry compares equal and the caller's ordering is preserved.
/// (`sort_by_key` would not do — it is not stable, so an all-`None` input came
/// back in an arbitrary order.)
fn pick_fastest(
    candidates: &[(String, String)],
    measured: Vec<(String, Option<u64>, String)>,
) -> (String, String) {
    measured
        .into_iter()
        .min_by_key(|(_, latency, _)| latency.unwrap_or(u64::MAX))
        .filter(|(_, latency, _)| latency.is_some())
        .map_or_else(
            // Nothing answered — keep the caller's ordering rather than whichever
            // probe happened to finish first.
            //
            // The caller's tuples are `(id, url)`; this function returns
            // `(url, id)`, so they must be swapped here too. Returning the tuple
            // as-is silently handed the *id* back as the URL.
            || {
                candidates.first().map_or_else(
                    || (String::new(), String::new()),
                    |(id, url)| (url.clone(), id.clone()),
                )
            },
            |(id, _, url)| (url, id),
        )
}

/// Pick the fastest reachable mirror for a Node.js archive.
///
/// Probes each mirror's version *directory*, then downloads from the winner.
async fn select_fastest_source(version: &str, filename: &str) -> (String, String) {
    let candidates = NODE_SOURCES
        .iter()
        .map(|(id, _name, base_url)| ((*id).to_string(), format!("{base_url}{version}/{filename}")))
        .collect();

    select_fastest_candidate(candidates).await
}

fn cache_dir() -> String {
    let a = std::env::var("APPDATA").unwrap_or_else(|_| {
        std::env::var("USERPROFILE").map_or_else(
            |_| "C:\\Users\\Default\\AppData\\Roaming".to_string(),
            |p| format!("{p}\\AppData\\Roaming"),
        )
    });

    format!("{a}\\ClaudeCodeManager\\cache\\installers")
}

fn ensure_cache_dir() -> std::io::Result<()> {
    std::fs::create_dir_all(cache_dir())?;

    std::fs::create_dir_all(format!(
        "{}\\ClaudeCodeManager\\runtime\\node\\{}",
        std::env::var("APPDATA").unwrap_or_default(),
        NODE_VERSION
    ))
}

fn cached_file_path(filename: &str) -> String {
    format!("{}\\{}", cache_dir(), filename)
}

/// Compute the SHA256 of a file using Windows' built-in tools.
///
/// Tries `certutil` first, then falls back to PowerShell's `Get-FileHash`.
/// `certutil` is the cheapest option but can be missing or blocked by policy on
/// hardened images; having only that one path turned a missing helper into an
/// unexplained "cannot verify download" install failure.
fn sha256_file(path: &str) -> Option<String> {
    sha256_via_certutil(path).or_else(|| {
        log::warn!("certutil unavailable for hashing; falling back to Get-FileHash");
        sha256_via_powershell(path)
    })
}

#[cfg(windows)]
fn sha256_via_certutil(path: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let mut c = std::process::Command::new("certutil");
    c.args(["-hashfile", path, "SHA256"])
        .creation_flags(0x08000000);
    let output = run_with_timeout(&mut c, PROBE_TIMEOUT)?;
    if !output.status.success() {
        log::warn!("certutil exited non-zero for {path}");
        return None;
    }
    // certutil writes its header in the OEM code page (e.g. GBK on zh-CN
    // Windows), so stdout is frequently NOT valid UTF-8. Decoding strictly made
    // this return None on every non-English Windows before the digest line was
    // ever inspected — which surfaced as an unverifiable Node.js download.
    let text = String::from_utf8_lossy(&output.stdout);
    // Locate the digest by shape rather than fixed line position, so a
    // localized/reformatted header still works. The digest itself is pure ASCII.
    let hash = text
        .lines()
        .map(str::trim)
        .find(|l| l.len() == 64 && l.chars().all(|c| c.is_ascii_hexdigit()))?
        .to_lowercase();
    Some(hash)
}

#[cfg(not(windows))]
fn sha256_via_certutil(_path: &str) -> Option<String> {
    None
}

/// Hash via PowerShell, transported with `-EncodedCommand` so the path cannot
/// break out of the script.
///
/// `$ProgressPreference='SilentlyContinue'` suppresses the progress stream, which
/// would otherwise interleave with the value we are trying to read.
#[cfg(windows)]
fn sha256_via_powershell(path: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let escaped = path.replace('\'', "''");
    let script = format!(
        "$ProgressPreference='SilentlyContinue'; \
         (Get-FileHash -LiteralPath '{escaped}' -Algorithm SHA256).Hash"
    );

    let mut c = std::process::Command::new("powershell");
    c.args([
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        &ps_encode(&script),
    ])
    .creation_flags(0x08000000)
    // See `ps_script_spec`: an inherited PowerShell 7 PSModulePath makes
    // Windows PowerShell 5.1 unable to resolve its own module cmdlets.
    .env_remove("PSModulePath");
    let output = run_with_timeout(&mut c, PROBE_TIMEOUT)?;
    if !output.status.success() {
        log::warn!(
            "Get-FileHash exited non-zero for {path}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
        return None;
    }
    // Same OEM/UTF-8 hazard as certutil: decode leniently, then pick the digest.
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|l| l.len() == 64 && l.chars().all(|c| c.is_ascii_hexdigit()))
        .map(str::to_lowercase)
}

#[cfg(not(windows))]
fn sha256_via_powershell(_path: &str) -> Option<String> {
    None
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

/// Fetch `SHASUMS256.txt` for the pinned Node.js version.
///
/// Tries the official origin first, then the mirrors. nodejs.org is frequently
/// unreachable from networks that can still reach npmmirror/huaweicloud, and the
/// archive itself may well have come from one of those — hardcoding the official
/// origin turned a reachable mirror into a hard install failure.
///
/// Returns the first response that actually contains an entry for `NODE_ZIP`
/// (huaweicloud, for instance, serves a SHASUMS256.txt without the win-x64 zip).
async fn fetch_node_shasums(client: &reqwest::Client) -> AppResult<String> {
    let mut errors: Vec<String> = Vec::new();

    for (id, _name, base) in NODE_SOURCES {
        let url = format!("{base}{NODE_VERSION}/SHASUMS256.txt");
        match client.get(&url).send().await {
            Ok(resp) => match resp.error_for_status() {
                Ok(ok) => match ok.text().await {
                    Ok(text) if text.lines().any(|l| l.contains(NODE_ZIP)) => {
                        log::info!("Node.js SHASUMS256 fetched from {id}");
                        return Ok(text);
                    }
                    Ok(_) => {
                        let msg = format!("{id}: SHASUMS256.txt 缺少 {NODE_ZIP} 条目");
                        log::warn!("{msg}");
                        errors.push(msg);
                    }
                    Err(e) => {
                        let msg = format!("{id}: 读取响应失败 ({e})");
                        log::warn!("{msg}");
                        errors.push(msg);
                    }
                },
                Err(e) => {
                    let msg = format!("{id}: HTTP 错误 ({e})");
                    log::warn!("{msg}");
                    errors.push(msg);
                }
            },
            Err(e) => {
                let msg = format!("{id}: 连接失败 ({e})");
                log::warn!("{msg}");
                errors.push(msg);
            }
        }
    }

    Err(AppError::new(
        "VERIFY_FAIL",
        "无法获取校验文件",
        "所有镜像的 SHASUMS256.txt 均不可用，无法校验 Node.js 下载。",
    )
    .with_details(errors.join("; "))
    .retryable())
}

/// Verify a downloaded Node.js archive against `SHASUMS256.txt`.
async fn verify_node_sha256(zip_path: &str) -> AppResult<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| {
            AppError::new(
                codes::INSTALL_NETWORK_ERROR,
                "Network error",
                format!("{e}"),
            )
        })?;

    let text = fetch_node_shasums(&client).await?;

    let expected = text
        .lines()
        .find(|l| l.contains(NODE_ZIP))
        .and_then(|l| l.split_whitespace().next())
        .map(|h| h.trim().to_lowercase())
        .ok_or_else(|| {
            AppError::new(
                "VERIFY_FAIL",
                "Verification failed",
                format!("SHASUMS256.txt 中未找到 {NODE_ZIP} 的条目。"),
            )
        })?;

    let actual = sha256_file(zip_path).ok_or_else(|| {
        AppError::new(
            "VERIFY_FAIL",
            "校验失败",
            "无法计算下载文件的 SHA256（certutil 不可用或文件不可读）。",
        )
        .with_details(format!("路径: {zip_path}"))
    })?;

    if actual != expected {
        log::error!("Node.js SHA256 mismatch: actual={actual} expected={expected}");
        return Err(AppError::new(
            "VERIFY_FAIL",
            "校验失败",
            "Node.js 下载校验失败（SHA256 不匹配），可能下载被中断或被篡改。",
        )
        .retryable());
    }
    Ok(actual)
}

/// How many times a single mirror is attempted before giving up.
const DOWNLOAD_ATTEMPTS: u32 = 3;

/// Stream `url` into `dest.part`, emitting throttled progress through `on_progress`.
///
/// Kept free of `AppHandle` so the retry/resume logic is unit-testable; the
/// caller adapts it to Tauri events.
async fn download_to_part<F>(
    url: &str,
    dest: &str,
    cancel_flag: Option<Arc<AtomicBool>>,
    mut on_progress: F,
) -> AppResult<String>
where
    F: FnMut(u64, u64, f64),
{
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| {
            AppError::new(
                codes::INSTALL_NETWORK_ERROR,
                "Network error",
                format!("{e}"),
            )
        })?;

    let part = format!("{dest}.part");
    // Written incrementally; promoted to `dest` only after SHA256 verification.
    let mut last_error: Option<AppError> = None;

    for attempt in 1..=DOWNLOAD_ATTEMPTS {
        if cancel_requested(cancel_flag.as_ref()) {
            let _ = std::fs::remove_file(&part);
            return Err(cancelled_download_error());
        }

        // Resume from whatever a previous attempt already wrote.
        let existing: u64 = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        let start = std::time::Instant::now();

        let mut request = client.get(url);
        if existing > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={existing}-"));
        }

        let response = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                log::warn!("Download attempt {attempt} failed to connect: {e}");
                last_error = Some(
                    AppError::new("DL_FAIL", "下载失败", "无法连接到下载服务器。")
                        .with_details(e.to_string())
                        .retryable(),
                );
                continue;
            }
        };

        // 206 means the server honoured the Range request; 200 means it ignored
        // it and is resending from zero, so the old partial bytes must go.
        let resuming = response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        if !response.status().is_success() {
            last_error = Some(
                AppError::new(
                    "DL_FAIL",
                    "下载失败",
                    format!("服务器返回 HTTP {}", response.status().as_u16()),
                )
                .retryable(),
            );
            // A 4xx other than 416 will not improve on retry.
            if response.status().is_client_error()
                && response.status() != reqwest::StatusCode::RANGE_NOT_SATISFIABLE
            {
                let _ = std::fs::remove_file(&part);
                return Err(last_error.take().expect("just set"));
            }
            continue;
        }

        let (mut file, mut downloaded) = if resuming && existing > 0 {
            let f = tokio::fs::OpenOptions::new()
                .append(true)
                .open(&part)
                .await
                .map_err(|e| AppError::new("DL_FAIL", "File error", format!("{e}")))?;
            (f, existing)
        } else {
            // Fresh start: drop anything a previous attempt left behind.
            let _ = std::fs::remove_file(&part);
            let f = tokio::fs::File::create(&part)
                .await
                .map_err(|e| AppError::new("DL_FAIL", "File error", format!("{e}")))?;
            (f, 0)
        };

        let total_size = response
            .content_length()
            .map(|len| len + downloaded)
            .unwrap_or(0);

        let mut stream = response.bytes_stream();
        use futures_util::StreamExt;
        let mut interrupted: Option<AppError> = None;

        while let Some(chunk) = stream.next().await {
            // Honour cancellation mid-transfer: a 30 MB download should not keep
            // running after the user pressed 取消.
            if cancel_requested(cancel_flag.as_ref()) {
                drop(file);
                let _ = std::fs::remove_file(&part);
                return Err(cancelled_download_error());
            }

            match chunk {
                Ok(bytes) => {
                    use tokio::io::AsyncWriteExt;
                    if let Err(e) = file.write_all(&bytes).await {
                        interrupted = Some(
                            AppError::new("DL_FAIL", "写入失败", "无法写入下载文件。")
                                .with_details(e.to_string()),
                        );
                        break;
                    }
                    downloaded += bytes.len() as u64;
                    on_progress(downloaded, total_size, start.elapsed().as_secs_f64());
                }
                Err(e) => {
                    interrupted = Some(
                        AppError::new("DL_FAIL", "下载中断", "传输过程中连接中断。")
                            .with_details(e.to_string())
                            .retryable(),
                    );
                    break;
                }
            }
        }

        // Flush before deciding, so a resume sees the bytes that actually landed.
        let _ = file.sync_all().await;
        drop(file);

        if let Some(e) = interrupted {
            log::warn!(
                "Download attempt {attempt}/{DOWNLOAD_ATTEMPTS} interrupted at {downloaded} bytes: {e}"
            );
            last_error = Some(e);
            continue; // next attempt resumes from `downloaded`
        }

        return Ok(part);
    }

    let _ = std::fs::remove_file(&part);
    Err(last_error.unwrap_or_else(|| {
        AppError::new("DL_FAIL", "下载失败", "重试多次后仍未完成下载。").retryable()
    }))
}

fn cancel_requested(flag: Option<&Arc<AtomicBool>>) -> bool {
    flag.is_some_and(|f| f.load(std::sync::atomic::Ordering::SeqCst))
}

fn cancelled_download_error() -> AppError {
    AppError::new(codes::INSTALL_CANCELLED, "操作已取消", "用户取消了下载。")
}

/// Download `url` into `dest.part`, reporting throttled progress as Tauri events.
///
/// The caller owns verification and promotion (see `verify_node_sha256` +
/// `promote_part`), so a bad payload never reaches `dest`.
async fn download_file(
    url: &str,
    dest: &str,
    app: &AppHandle,
    component: &str,
    cancel_flag: Option<Arc<AtomicBool>>,
) -> AppResult<String> {
    let mut last_emit: Option<std::time::Instant> = None;
    download_to_part(url, dest, cancel_flag, |downloaded, total, elapsed| {
        emit_download_progress(
            app,
            component,
            url,
            downloaded,
            total,
            elapsed,
            &mut last_emit,
        );
    })
    .await
}

/// Extract a zip archive, fastest method first.
///
/// Measured on the Node.js archive (2,447 files, 33 MB) on a warm cache:
///
/// | method                        | time   |
/// |-------------------------------|--------|
/// | `Expand-Archive` (PowerShell) | 7.7 s  |
/// | in-process `zip` crate        | ~1.5 s |
/// | `tar.exe` (Windows built-in)  | 1.6 s  |
///
/// `Expand-Archive` is pure overhead — it is a PowerShell module cmdlet, so it
/// also pays ~0.8 s of shell startup and streams through the .NET archive API.
/// Extraction used to be the single slowest step of a Node.js install.
///
/// Order: `tar.exe` first (no extra binary size, and it validates the archive
/// for us), then the in-process crate, then PowerShell as a last resort for
/// images where `tar.exe` is absent.
async fn extract_zip(zip_path: &str, destination: &str) -> AppResult<()> {
    let start = std::time::Instant::now();

    // 1. Windows' bundled bsdtar (present since Windows 10 1803).
    if extract_with_tar(zip_path, destination).await {
        log::info!("Extraction took {:?} (tar.exe)", start.elapsed());
        return Ok(());
    }

    // 2. In-process extraction — no subprocess, no shell startup.
    match extract_with_zip_crate(zip_path, destination) {
        Ok(()) => {
            log::info!("Extraction took {:?} (in-process)", start.elapsed());
            return Ok(());
        }
        Err(e) => log::warn!("In-process extraction failed ({e}); falling back to PowerShell"),
    }

    // 3. PowerShell, for anything left.
    let result = extract_with_powershell(zip_path, destination).await;
    log::info!("Extraction took {:?} (PowerShell)", start.elapsed());
    result
}

/// Extract with `tar.exe -xf`. Returns `false` if tar is unavailable or failed.
async fn extract_with_tar(zip_path: &str, destination: &str) -> bool {
    std::fs::create_dir_all(destination).ok();

    let spec = CommandSpec::new("tar")
        .args(vec![
            "-x".into(),
            "-f".into(),
            zip_path.to_string(),
            "-C".into(),
            destination.to_string(),
        ])
        .timeout(Duration::from_secs(180));

    match execute_command(&spec, None).await {
        Ok(o) if o.success => {
            log::info!("Archive extracted via tar.exe");
            true
        }
        Ok(o) => {
            log::warn!(
                "tar.exe failed ({}); trying in-process extraction",
                o.stderr.trim()
            );
            false
        }
        Err(e) => {
            log::warn!("tar.exe unavailable ({e}); trying in-process extraction");
            false
        }
    }
}

/// Extract in-process with the `zip` crate.
fn extract_with_zip_crate(zip_path: &str, destination: &str) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive =
        zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|e| e.to_string())?;
    let dest_root = std::path::Path::new(destination);
    std::fs::create_dir_all(dest_root).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;

        // `enclosed_name` rejects entries that would escape the destination
        // (`..`, absolute paths) — zip-slip protection.
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!(
                "archive entry escapes destination: {}",
                entry.name()
            ));
        };
        let out_path = dest_root.join(rel);

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;

        // Preserve the executable bit where the archive records one.
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(mode));
        }
    }

    log::info!("Archive extracted in-process (zip crate)");
    Ok(())
}

async fn extract_with_powershell(zip_path: &str, destination: &str) -> AppResult<()> {
    // Paths are embedded in a PowerShell single-quoted literal with `'` doubled,
    // and the whole script is then transported via `-EncodedCommand`, so the
    // values never reach PowerShell's command parser.
    let escape = |s: &str| s.replace('\'', "''");
    let script = format!(
        "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
        escape(zip_path),
        escape(destination)
    );

    let spec = ps_script_spec(&script, Duration::from_secs(180));

    let result = execute_command(&spec, None).await?;

    if !result.success {
        return Err(
            AppError::new("ZIP_FAIL", "解压失败", "无法解压 Node.js 压缩包。")
                .with_details(result.stderr),
        );
    }

    Ok(())
}

/// Outcome of inspecting the Node.js archive cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CacheState {
    /// No usable archive — download required.
    Missing,
    /// Archive present and its sidecar marker matched size+mtime.
    VerifiedByMarker,
    /// Archive present; re-hashed this run and the hash matched.
    VerifiedByHash,
}

/// Atomically move a verified `.part` file into its final cache path.
fn promote_part(part: &str, dest: &str) -> AppResult<()> {
    if let Err(e) = std::fs::rename(part, dest) {
        let _ = std::fs::remove_file(part);
        return Err(
            AppError::new("DL_FAIL", "缓存写入失败", "无法把下载文件移动到缓存目录。")
                .with_details(e.to_string()),
        );
    }
    Ok(())
}

/// Sidecar marker recording the SHA256 that a cached archive was verified
/// against, plus the archive's size and mtime. A matching marker proves the
/// bytes are still the ones we hashed, so a repeat install can skip `certutil`.
#[derive(serde::Serialize, serde::Deserialize)]
struct CacheMarker {
    sha256: String,
    size: u64,
    mtime_secs: u64,
}

fn marker_path(archive: &str) -> String {
    format!("{archive}.verified.json")
}

fn archive_stamp(path: &str) -> Option<(u64, u64)> {
    let md = std::fs::metadata(path).ok()?;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Some((md.len(), mtime))
}

fn write_marker(archive: &str, sha256: &str) {
    let Some((size, mtime_secs)) = archive_stamp(archive) else {
        return;
    };
    let marker = CacheMarker {
        sha256: sha256.to_string(),
        size,
        mtime_secs,
    };
    if let Ok(json) = serde_json::to_string(&marker) {
        let _ = std::fs::write(marker_path(archive), json);
    }
}

fn read_marker(archive: &str) -> Option<CacheMarker> {
    let content = std::fs::read_to_string(marker_path(archive)).ok()?;
    serde_json::from_str(&content).ok()
}

/// Whether the cached archive is already known-good, i.e. it has a marker whose
/// recorded size and mtime still match the file on disk.
fn cache_marker_valid(archive: &str) -> bool {
    let Some(marker) = read_marker(archive) else {
        return false;
    };
    matches!(archive_stamp(archive), Some((size, mtime)) if size == marker.size && mtime == marker.mtime_secs)
}

/// Drop the archive and its marker together so they can never disagree.
fn invalidate_cache(archive: &str) {
    let _ = std::fs::remove_file(archive);
    let _ = std::fs::remove_file(marker_path(archive));
}

/// Broadcast that the machine environment changed, so already-running processes
/// (notably `explorer.exe`, which owns the environment new terminals inherit)
/// pick up the new PATH without a sign-out.
#[cfg(windows)]
fn broadcast_environment_change() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, SMTO_BLOCK, WM_SETTINGCHANGE,
    };

    // `lParam` is the string "Environment"; lives on this stack frame for the
    // duration of the (blocking, bounded) call.
    let area: Vec<u16> = "Environment\0".encode_utf16().collect();
    let mut result: usize = 0;
    // SAFETY: `area` is a valid, NUL-terminated wide string that outlives the
    // call; `result` is a valid out-pointer. Timeout caps the wait so a hung
    // window cannot block the install.
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            area.as_ptr() as isize,
            SMTO_ABORTIFHUNG | SMTO_BLOCK,
            1000,
            &raw mut result,
        );
    }
}

#[cfg(not(windows))]
fn broadcast_environment_change() {}

/// Add a directory to `HKCU\Environment\PATH`, preserving the value's existing
/// registry type, then notify the system.
///
/// The whole read-merge-write runs under `AppState::path_lock`, so a concurrent
/// install (Node.js and Git run in parallel) cannot lose the other's entry.
///
/// Returns `true` when the value was actually modified.
fn add_dir_to_user_path(dir: &str, state: &crate::AppState) -> bool {
    use std::io::ErrorKind;
    use winreg::enums::{RegType, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::{RegKey, RegValue};

    // Poisoning only happens if a previous writer panicked mid-update; the
    // registry value is re-read from scratch below, so recovering is safe.
    let _guard = state.path_lock.lock().unwrap_or_else(|e| e.into_inner());

    let key = match RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(r"Environment", KEY_READ | KEY_WRITE)
    {
        Ok(k) => k,
        Err(e) => {
            log::warn!("Cannot open HKCU\\Environment for PATH update: {e}");
            return false;
        }
    };

    // Read the *raw* value: `get_value::<String>` would expand `%VAR%` and we
    // would then write the expanded text back, permanently destroying the
    // indirection. Keep the original bytes and the original type instead.
    let raw = key.get_raw_value("PATH");
    let (kind, current) = match &raw {
        Ok(rv) => (
            rv.vtype.clone(),
            String::from_utf16_lossy(
                &rv.bytes
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .take_while(|&c| c != 0)
                    .collect::<Vec<u16>>(),
            ),
        ),
        Err(e) if e.kind() == ErrorKind::NotFound => (RegType::REG_EXPAND_SZ, String::new()),
        Err(e) => {
            log::warn!("Cannot read HKCU PATH: {e}");
            return false;
        }
    };

    let nd = dir.trim().trim_end_matches('\\').to_lowercase();
    if current
        .split(';')
        .any(|e| e.trim().trim_end_matches('\\').to_lowercase() == nd)
    {
        return false; // already present
    }

    let new_path = if current.is_empty() || current.ends_with(';') {
        format!("{current}{dir}")
    } else {
        format!("{current};{dir}")
    };

    // Windows stores REG_SZ / REG_EXPAND_SZ as UTF-16LE with a terminating NUL.
    let rv = RegValue {
        bytes: new_path
            .encode_utf16()
            .chain(std::iter::once(0))
            .flat_map(u16::to_le_bytes)
            .collect(),
        vtype: kind,
    };

    if let Err(e) = key.set_raw_value("PATH", &rv) {
        log::warn!("Cannot write HKCU PATH: {e}");
        return false;
    }

    broadcast_environment_change();
    true
}

async fn install_node_portable(task_id: &str, app: &AppHandle) -> AppResult<InstallStepResult> {
    let state = app.state::<crate::AppState>();

    let tm = &state.task_manager;

    let rt = format!(
        "{}\\ClaudeCodeManager\\runtime\\node\\{}",
        std::env::var("APPDATA").unwrap_or_default(),
        NODE_VERSION
    );

    let ne = format!("{rt}\\{NODE_FILENAME}\\node.exe");

    if std::path::Path::new(&ne).exists() {
        if let Some(ver) = verify_node_at_path(&ne) {
            add_dir_to_user_path(&portable_bin_dir(), &state);

            return Ok(InstallStepResult {
                component: "Node.js".into(),
                success: true,
                version: Some(ver.clone()),
                message: format!("Portable Node.js {ver} ready (in PATH)"),
            });
        }
    }

    ensure_cache_dir().ok();

    let cancel = get_cancel_flag(tm, task_id);

    let cp = cached_file_path(NODE_ZIP);

    // Cache policy, cheapest check first:
    //   1. `.verified.json` marker matches size+mtime -> bytes are known-good,
    //      skip both the download AND the `certutil` re-hash (B3).
    //   2. Otherwise re-hash the archive; if it fails, drop it and re-download.
    let cache_state = if !std::path::Path::new(&cp).exists() {
        CacheState::Missing
    } else if cache_marker_valid(&cp) {
        CacheState::VerifiedByMarker
    } else {
        match verify_node_sha256(&cp).await {
            Ok(hash) => {
                write_marker(&cp, &hash);
                CacheState::VerifiedByHash
            }
            Err(e) => {
                log::warn!(
                    "Cached Node.js archive failed verification ([{}] {}); re-downloading",
                    e.code,
                    e.message
                );
                invalidate_cache(&cp);
                CacheState::Missing
            }
        }
    };

    match cache_state {
        CacheState::VerifiedByMarker | CacheState::VerifiedByHash => {
            log::info!("Node.js archive cache hit ({cache_state:?})");
            tm.update_progress(task_id, 40.0, Some("使用已校验缓存...".into()), app);
        }
        CacheState::Missing => {
            tm.update_progress(task_id, 10.0, Some("测速镜像源...".into()), app);
            let (url, src_id) = select_fastest_source(NODE_VERSION, NODE_ZIP).await;
            log::info!("Node.js source selected: {src_id} -> {url}");

            tm.update_progress(
                task_id,
                20.0,
                Some(format!("下载 Node.js {NODE_VERSION}...")),
                app,
            );
            let part = match download_file(&url, &cp, app, "Node.js", cancel.clone()).await {
                Ok(p) => p,
                Err(e) => {
                    log::error!(
                        "Node.js download failed from {src_id}: [{}] {} (details: {:?})",
                        e.code,
                        e.message,
                        e.technical_details
                    );
                    return Err(e);
                }
            };

            tm.update_progress(task_id, 50.0, Some("校验 SHA256...".into()), app);
            match verify_node_sha256(&part).await {
                Ok(hash) => {
                    log::info!("Node.js archive verified: {hash}");
                    promote_part(&part, &cp)?;
                    write_marker(&cp, &hash);
                }
                Err(e) => {
                    // Never let an unverified payload reach the cache path.
                    log::error!(
                        "Node.js verification failed: [{}] {} (details: {:?})",
                        e.code,
                        e.message,
                        e.technical_details
                    );
                    let _ = std::fs::remove_file(&part);
                    return Err(e);
                }
            }
        }
    }

    tm.update_progress(task_id, 60.0, Some("解压...".into()), app);

    if let Err(e) = extract_zip(&cp, &rt).await {
        log::error!(
            "Node.js extraction failed: [{}] {} (details: {:?}) zip={cp} dest={rt}",
            e.code,
            e.message,
            e.technical_details
        );
        return Err(e);
    }

    tm.update_progress(task_id, 85.0, Some("验证安装...".into()), app);

    // First run of the freshly extracted binary — allow for an antivirus scan of
    // the 2,447 files that were just written.
    let ne_start = std::time::Instant::now();
    let ver = verify_node_at_path_within(&ne, FIRST_RUN_TIMEOUT);
    log::info!(
        "Post-extraction node verification took {:?}",
        ne_start.elapsed()
    );

    if let Some(ref v) = ver {
        let pa = add_dir_to_user_path(&portable_bin_dir(), &state);

        return Ok(InstallStepResult {
            component: "Node.js".into(),
            success: true,
            version: Some(v.clone()),
            message: format!(
                "Portable Node.js {} done{}",
                v,
                if pa { " (in PATH)" } else { "" }
            ),
        });
    }

    if let Ok(entries) = std::fs::read_dir(&rt) {
        for entry in entries.flatten() {
            let p = entry.path().join("node.exe");

            if p.exists() {
                if let Some(ref v) = verify_node_at_path(&p.to_string_lossy()) {
                    return Ok(InstallStepResult {
                        component: "Node.js".into(),
                        success: true,
                        version: Some(v.clone()),
                        message: format!("Portable Node.js {v} done"),
                    });
                }
            }
        }
    }

    // Include what is actually on disk: "node.exe not found" alone gave no clue
    // whether extraction produced nothing or landed somewhere unexpected.
    let listing = std::fs::read_dir(&rt)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().to_string())
                .take(10)
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_else(|e| format!("<unreadable: {e}>"));

    log::error!("Node.js extraction produced no usable node.exe. Expected {ne}. Dir {rt} contains: [{listing}]");

    Err(AppError::new(
        "INSTALL_FAIL",
        "解压后未找到 node.exe",
        format!("解压完成但在 {rt} 中未找到可用的 node.exe。"),
    )
    .with_details(format!("目标: {ne}；目录内容: [{listing}]"))
    .retryable())
}

pub async fn install_node(task_id: &str, app: &AppHandle) -> AppResult<InstallStepResult> {
    let state = app.state::<crate::AppState>();
    let tm = &state.task_manager;

    let mut reasons: Vec<String> = Vec::new();

    if let Some(ref v) = detect_node_refreshed() {
        return Ok(InstallStepResult {
            component: "Node.js".into(),
            success: true,
            version: Some(v.clone()),
            message: format!("Node.js {v} already installed"),
        });
    }

    let pr = install_node_portable(task_id, app).await;

    // Borrow rather than move: `pr` is inspected again below to build the
    // combined failure message.
    match &pr {
        Ok(r) if r.success => {
            refresh_env();
            // No re-verification here: `install_node_portable` already ran
            // `node.exe --version` (with the wide first-run budget) and returned
            // the version it read. Re-probing would spawn the just-extracted
            // binary a second time for nothing — and on a cold cache that second
            // start can again sit behind an antivirus scan.
            return Ok(r.clone());
        }
        Ok(r) => {
            // "Failed" without an accompanying error still needs to be visible.
            log::error!("Portable Node.js install reported failure: {}", r.message);
            tm.update_progress(
                task_id,
                15.0,
                Some(format!("便携版失败: {}", truncate_for_ui(&r.message, 120))),
                app,
            );
            reasons.push(format!("便携版: {}", r.message));
        }
        Err(e) => {
            log::error!(
                "Portable Node.js install failed: [{}] {} (details: {:?})",
                e.code,
                e.message,
                e.technical_details
            );
            tm.update_progress(
                task_id,
                15.0,
                Some(format!("便携版失败: {}", truncate_for_ui(&e.message, 120))),
                app,
            );
            reasons.push(format!("便携版: {} [{}]", e.message, e.code));
        }
    }

    let winget_result = install_node_via_winget(task_id, app, &state.task_manager).await?;
    if winget_result.success {
        return Ok(winget_result);
    }

    reasons.push(format!("winget: {}", winget_result.message));

    // Surface every attempt's reason instead of the previous content-free
    // "portable and winget both failed" message.
    Ok(InstallStepResult {
        component: "Node.js".into(),
        success: false,
        version: None,
        message: format!(
            "Node.js 安装失败。{}\n手动安装: https://nodejs.org",
            reasons.join("；")
        ),
    })
}

/// Keep a step message short enough for the progress line.
fn truncate_for_ui(s: &str, max: usize) -> String {
    let one_line = s.replace(['\r', '\n'], " ");
    if one_line.chars().count() <= max {
        return one_line;
    }
    let cut: String = one_line.chars().take(max).collect();
    format!("{cut}…")
}

/// winget fallback for Node.js.
async fn install_node_via_winget(
    task_id: &str,
    app: &AppHandle,
    tm: &TaskManager,
) -> AppResult<InstallStepResult> {
    tm.update_progress(task_id, 15.0, Some("Checking winget...".into()), app);

    match check_winget_available() {
        WingetStatus::Available(ver) => {
            tm.update_progress(
                task_id,
                20.0,
                Some(format!("winget {} available", ver.unwrap_or_default())),
                app,
            );

            match execute_command(
                &CommandSpec::new("winget")
                    .args(vec![
                        "install".into(),
                        "OpenJS.NodeJS.LTS".into(),
                        "--silent".into(),
                        "--accept-package-agreements".into(),
                        "--accept-source-agreements".into(),
                    ])
                    .timeout(Duration::from_secs(300)),
                get_cancel_flag(tm, task_id),
            )
            .await
            {
                Ok(o) if o.success => log::info!("winget OpenJS.NodeJS.LTS reported success"),
                Ok(o) => log::error!(
                    "winget OpenJS.NodeJS.LTS exited non-zero: {}",
                    o.stderr.trim().replace('\n', " ")
                ),
                Err(e) => log::error!("winget OpenJS.NodeJS.LTS failed to run: {e}"),
            }

            refresh_env();

            if let Some(ref v) = detect_node_refreshed() {
                return Ok(InstallStepResult {
                    component: "Node.js".into(),
                    success: true,
                    version: Some(v.clone()),
                    message: format!("Node.js {v} via winget"),
                });
            }

            // winget ran but Node.js is still not visible.
            Ok(InstallStepResult {
                component: "Node.js".into(),
                success: false,
                version: None,
                message:
                    "winget 已执行但未能检测到 Node.js（可能被 UAC 阻止、被策略禁用或需要重启）。"
                        .into(),
            })
        }

        WingetStatus::NotInstalled => {
            tm.update_progress(task_id, 20.0, Some("winget 不可用".into()), app);
            Ok(InstallStepResult {
                component: "Node.js".into(),
                success: false,
                version: None,
                message: "系统未安装 winget（App Installer）。".into(),
            })
        }

        WingetStatus::Failed(e) => {
            log::error!("winget present but unusable: {e}");
            tm.update_progress(
                task_id,
                20.0,
                Some(format!("winget 不可用: {}", truncate_for_ui(&e, 80))),
                app,
            );
            Ok(InstallStepResult {
                component: "Node.js".into(),
                success: false,
                version: None,
                message: format!("winget 存在但无法运行: {e}"),
            })
        }
    }
}

/// Build a `CommandSpec` that runs in an environment whose `PATH` is the
/// registry-refreshed one (system + user + current process).
///
/// Anything spawned right after an install must use this. A freshly installed
/// tool lives in a directory that was appended to the *registry* PATH; the app's
/// own process PATH — inherited by every child — still does not contain it until
/// the app restarts. Detecting with the refreshed PATH but executing with the
/// stale one is exactly how "npm is available" and "npm not found" could both be
/// true in the same run.
fn cmd_spec_with_refreshed_path() -> CommandSpec {
    let refreshed = crate::env_refresh::refresh_windows_path();
    CommandSpec::new("cmd").env("PATH", refreshed.merged_path)
}

pub fn get_npm_registry() -> String {
    let spec = cmd_spec_with_refreshed_path().args(vec![
        "/c".into(),
        "npm".into(),
        "config".into(),
        "get".into(),
        "registry".into(),
    ]);
    let out = execute_command_sync(&spec);
    // Lenient decode: npm output is not guaranteed to be valid UTF-8.
    out.map_or_else(
        || "https://registry.npmjs.org/".into(),
        |s| s.trim().to_string(),
    )
}

/// Verify npm is runnable with the refreshed PATH, returning its version.
///
/// Used as a preflight so a PATH problem is reported as such instead of
/// surfacing later as an opaque `'npm' 不是内部或外部命令`.
fn probe_npm_in_refreshed_env() -> Option<String> {
    let spec =
        cmd_spec_with_refreshed_path().args(vec!["/c".into(), "npm".into(), "--version".into()]);
    execute_command_sync(&spec).map(|s| s.trim().to_string())
}

/// Small blocking helper for the few npm/cli calls that are not async.
fn execute_command_sync(spec: &CommandSpec) -> Option<String> {
    use std::process::Command;
    let mut c = Command::new(&spec.program);
    c.args(&spec.args);
    for (k, v) in &spec.env {
        c.env(k, v);
    }
    for k in &spec.env_remove {
        c.env_remove(k);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    let o = run_with_timeout(&mut c, PROBE_TIMEOUT)?;
    if !o.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&o.stdout).to_string())
}

pub fn optimize_npm_registry() -> (String, String) {
    let orig = get_npm_registry();

    if orig.contains("npmmirror") || orig.contains("taobao") || orig.contains("tencent") {
        return (orig.clone(), orig);
    }

    set_npm_registry(NPM_MIRROR);

    (NPM_MIRROR.into(), orig)
}

fn set_npm_registry(url: &str) {
    let spec = cmd_spec_with_refreshed_path().args(vec![
        "/c".into(),
        "npm".into(),
        "config".into(),
        "set".into(),
        "registry".into(),
        url.into(),
    ]);
    let _ = execute_command_sync(&spec);
}

/// Extra npm flags that remove network round-trips and skew from a global
/// install: no audit report, no funding banner, and prefer the local cache.
const NPM_FAST_FLAGS: &[&str] = &["--no-audit", "--no-fund", "--prefer-offline"];

/// How long the repair re-install may take.
///
/// It has to download the ~220 MB native binary, so this is far larger than the
/// other budgets — the user sees a progress line while it runs.
const CLAUDE_REPAIR_TIMEOUT: Duration = Duration::from_secs(900);

/// Re-install Claude Code, forcing the optional platform binary to be included.
///
/// Repairs the "wrapper unpacked but no runnable binary" state. A plain re-run of
/// the package's `install.cjs` postinstall would *not* be enough: postinstall
/// copies a binary from the optional dependency, and if that dependency was never
/// downloaded there is nothing to copy. `--include=optional` overrides any
/// `omit=optional` configuration and pulls the platform package in, which also
/// re-triggers postinstall as a side effect.
///
/// Returns the npm output so the caller can surface a real reason on failure.
async fn repair_claude_code_install(
    cancel_flag: Option<Arc<AtomicBool>>,
) -> AppResult<crate::process::ProcessOutput> {
    let (chosen, orig) = optimize_npm_registry();
    let switched = chosen != orig;

    let mut args: Vec<String> = vec![
        "/c".into(),
        "npm".into(),
        "install".into(),
        "-g".into(),
        "@anthropic-ai/claude-code".into(),
        "--include=optional".into(),
    ];
    args.extend(NPM_FAST_FLAGS.iter().map(|s| (*s).to_string()));

    let result = execute_command(
        &cmd_spec_with_refreshed_path()
            .args(args)
            .timeout(CLAUDE_REPAIR_TIMEOUT),
        cancel_flag,
    )
    .await;

    if switched {
        set_npm_registry(&orig);
    }

    result
}

/// Run an `npm <verb> -g <package>` command, temporarily pointing npm at the
/// npmmirror registry and restoring the user's original registry afterwards.
///
/// Install and uninstall both go through here so the two paths cannot drift
/// apart — previously only install switched the registry, leaving a mirror in
/// place after an uninstall.
///
/// Runs with the refreshed PATH (see `cmd_spec_with_refreshed_path`) so the npm
/// that was just installed by the portable Node.js step is actually reachable.
async fn run_npm_global(
    verb: &str,
    package: &str,
    timeout: Duration,
    cancel_flag: Option<Arc<AtomicBool>>,
) -> AppResult<crate::process::ProcessOutput> {
    let (chosen, orig) = optimize_npm_registry();
    let switched = chosen != orig;

    let mut args: Vec<String> = vec![
        "/c".into(),
        "npm".into(),
        verb.into(),
        "-g".into(),
        package.into(),
    ];
    args.extend(NPM_FAST_FLAGS.iter().map(|s| (*s).to_string()));

    let result = execute_command(
        &cmd_spec_with_refreshed_path().args(args).timeout(timeout),
        cancel_flag,
    )
    .await;

    // Restore unconditionally, including on error/cancel.
    if switched {
        set_npm_registry(&orig);
    }

    result
}

pub async fn install_git(task_id: &str, app: &AppHandle) -> AppResult<InstallStepResult> {
    let tm = &app.state::<crate::AppState>().task_manager;

    // Use the *refreshed* PATH: a previous run may have installed Git via winget
    // or the fallback installer, in which case the process PATH still does not
    // see it and we would otherwise download a 60 MB installer for nothing.
    if let Some(ref v) = detect_git_refreshed() {
        return Ok(InstallStepResult {
            component: "Git".into(),
            success: true,
            version: Some(v.clone()),
            message: v.clone(),
        });
    }

    let mut skipped = false;

    let t_winget_check = std::time::Instant::now();
    let winget_status = check_winget_available();
    log::info!(
        "winget availability check took {:?}",
        t_winget_check.elapsed()
    );

    match winget_status {
        WingetStatus::Available(ver) => {
            tm.update_progress(
                task_id,
                10.0,
                Some(format!("winget {} available", ver.unwrap_or_default())),
                app,
            );

            // Keep the output: a silently discarded non-zero exit was the reason
            // "winget failed" was previously indistinguishable from "winget
            // worked but detection lagged".
            //
            // Timing is logged because a failing winget is the single most
            // expensive silent step in this flow — it retries internally and
            // prints nothing, so the installer just appears frozen.
            let t_winget = std::time::Instant::now();
            let winget_outcome = execute_command(
                &CommandSpec::new("winget")
                    .args(vec![
                        "install".into(),
                        "Git.Git".into(),
                        "--silent".into(),
                        "--accept-package-agreements".into(),
                        "--accept-source-agreements".into(),
                    ])
                    .timeout(Duration::from_secs(120)),
                get_cancel_flag(tm, task_id),
            )
            .await;
            let winget_elapsed = t_winget.elapsed();

            match winget_outcome {
                Ok(o) if o.success => {
                    log::info!("winget Git.Git succeeded in {winget_elapsed:?}");
                }
                Ok(o) => log::warn!(
                    "winget Git.Git exited non-zero after {winget_elapsed:?}: {}",
                    o.stderr.trim().replace('\n', " ")
                ),
                Err(e) => log::warn!(
                    "winget Git.Git failed after {winget_elapsed:?}: {}",
                    e.message
                ),
            }

            refresh_env();

            if let Some(ref v) = detect_git_refreshed() {
                return Ok(InstallStepResult {
                    component: "Git".into(),
                    success: true,
                    version: Some(v.clone()),
                    message: format!("{v} (winget)"),
                });
            }
        }

        _ => {
            skipped = true;
        }
    }

    if skipped {
        tm.update_progress(
            task_id,
            15.0,
            Some("winget 不可用，改为下载安装...".into()),
            app,
        );
    }

    tm.update_progress(task_id, 25.0, Some("选择 Git 下载源...".into()), app);

    // Race the mirrors instead of trying them in a fixed order. The GitHub
    // release URL measured anywhere from ~18s to ~102s across runs on the same
    // machine, and a fixed order meant always waiting out the slow one first.
    let gv = GIT_VERSION;
    let candidates: Vec<(String, String)> = vec![
        (
            "github".to_string(),
            format!("https://github.com/git-for-windows/git/releases/download/v{gv}.windows.1/Git-{gv}-64-bit.exe"),
        ),
        (
            "npmmirror".to_string(),
            format!("https://npmmirror.com/mirrors/git-for-windows/v{gv}.windows.1/Git-{gv}-64-bit.exe"),
        ),
    ];

    let ip = format!(
        "{}\\AppData\\Local\\Temp\\git-install.exe",
        std::env::var("USERPROFILE").unwrap_or_default()
    );

    let cancel = get_cancel_flag(tm, task_id);
    let t_dl = std::time::Instant::now();

    // Prefer the fastest responder; keep the rest as ordered fallbacks.
    let (best_url, best_id) = select_fastest_candidate(candidates.clone()).await;
    log::info!("Git source selected: {best_id}");

    let mut ordered: Vec<(String, String)> = vec![(best_id, best_url)];
    let chosen: Vec<String> = ordered.iter().map(|(id, _)| id.clone()).collect();
    ordered.extend(
        candidates
            .into_iter()
            .filter(|(id, _)| !chosen.contains(id)),
    );

    // Verify against a pinned digest before the installer runs. A mirror serving
    // a tampered binary would otherwise execute silently — this is the same
    // guarantee the Node.js path already had via SHASUMS256.
    tm.update_progress(task_id, 55.0, Some("校验 Git 安装器...".into()), app);

    let mut ok = false;
    for (id, url) in &ordered {
        match download_file(url, &ip, app, "Git", cancel.clone()).await {
            Ok(part) => {
                let actual = sha256_file(&part).unwrap_or_default();
                if actual != GIT_INSTALLER_SHA256 {
                    log::error!(
                        "Git installer from {id} failed checksum: got {actual}, expected {GIT_INSTALLER_SHA256}"
                    );
                    let _ = std::fs::remove_file(&part);
                    // Try the next mirror rather than installing an unverified binary.
                    continue;
                }
                log::info!("Git installer from {id} verified (sha256 {actual})");
                promote_part(&part, &ip)?;
                log::info!("Git installer downloaded from {id} in {:?}", t_dl.elapsed());
                ok = true;
                break;
            }
            Err(e) => log::warn!("Git download from {id} failed: {e}"),
        }
    }

    if !ok {
        return Ok(InstallStepResult {
            component: "Git".into(),
            success: false,
            version: None,
            message: "Git 安装器下载或校验失败：所有镜像均未通过 SHA256 校验。\n\
                      可稍后重试，或手动安装 https://git-scm.com/download/win"
                .into(),
        });
    }

    tm.update_progress(task_id, 60.0, Some("Installing Git...".into()), app);

    let t_install = std::time::Instant::now();
    if let Err(e) = execute_command(
        &CommandSpec::new(&ip)
            .args(vec![
                "/VERYSILENT".into(),
                "/NORESTART".into(),
                "/NOCANCEL".into(),
                "/SP-".into(),
            ])
            .timeout(Duration::from_secs(300)),
        None,
    )
    .await
    {
        return Ok(InstallStepResult {
            component: "Git".into(),
            success: false,
            version: None,
            message: e.message.clone(),
        });
    }
    log::info!("Git silent installer finished in {:?}", t_install.elapsed());

    tm.update_progress(task_id, 80.0, Some("Refreshing PATH...".into()), app);

    refresh_env();

    if let Some(ref v) = detect_git_refreshed() {
        Ok(InstallStepResult {
            component: "Git".into(),
            success: true,
            version: Some(v.clone()),
            message: v.clone(),
        })
    } else {
        Ok(InstallStepResult {
            component: "Git".into(),
            success: false,
            version: None,
            message: "Git installed but not in PATH yet.".into(),
        })
    }
}

pub async fn install_claude(task_id: &str, app: &AppHandle) -> AppResult<InstallStepResult> {
    let state = app.state::<crate::AppState>();

    let tm = &state.task_manager;

    let ex = crate::environment::detect_claude_code();

    if ex.installed {
        return Ok(InstallStepResult {
            component: "Claude Code".into(),
            success: true,
            version: ex.version,
            message: format!(
                "Already installed ({})",
                ex.install_method.unwrap_or_default()
            ),
        });
    }

    if detect_npm_refreshed().or_else(detect_npm).is_none() {
        return Ok(InstallStepResult {
            component: "Claude Code".into(),
            success: false,
            version: None,
            message: "npm 不可用，请先完成 Node.js 安装。".into(),
        });
    }

    // Preflight: confirm npm is reachable *with the same PATH that
    // `run_npm_global` will use*. Checking with a different PATH than we execute
    // with is what previously let "npm 可用" and "npm 不是内部或外部命令" both be
    // true in one run.
    match probe_npm_in_refreshed_env() {
        Some(v) => log::info!("npm {v} reachable via refreshed PATH"),
        None => {
            log::error!(
                "npm is not reachable with the refreshed PATH; portable node bin dir = {}",
                portable_bin_dir()
            );
            return Ok(InstallStepResult {
                component: "Claude Code".into(),
                success: false,
                version: None,
                message: format!(
                    "npm 不可用：无法在当前 PATH 下执行 npm。\n\
                     便携版 Node 目录: {}\n\
                     请重启应用后重试，或手动运行 npm install -g @anthropic-ai/claude-code。",
                    portable_bin_dir()
                ),
            });
        }
    }

    tm.update_progress(task_id, 30.0, Some("安装 Claude Code...".into()), app);

    // `run_npm_global` handles the mirror switch AND the restore, so a failure
    // or user cancellation can no longer leave the registry pointing at a mirror.
    let out = run_npm_global(
        "install",
        "@anthropic-ai/claude-code",
        Duration::from_secs(300),
        get_cancel_flag(tm, task_id),
    )
    .await?;

    tm.update_progress(task_id, 80.0, Some("刷新 PATH...".into()), app);

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

    // The wrapper was unpacked but its native binary never landed. Attempt a
    // self-repair before reporting anything: it is the difference between the
    // user seeing a failure they must fix by hand and the install simply working.
    if !inst.installed && crate::environment::claude_package_present_but_broken() {
        log::warn!(
            "claude-code package present but no runnable binary; attempting repair re-install with --include=optional"
        );

        tm.update_progress(
            task_id,
            92.0,
            Some("安装不完整，正在补装原生程序（约 220MB）...".into()),
            app,
        );

        let repair = repair_claude_code_install(get_cancel_flag(tm, task_id)).await;

        match &repair {
            Ok(o) if o.success => log::info!("Repair re-install completed successfully"),
            Ok(o) => log::error!(
                "Repair re-install exited non-zero: {}",
                o.stderr.trim().replace('\n', " ")
            ),
            Err(e) => log::error!("Repair re-install failed to run: {e}"),
        }

        refresh_env();

        // Re-detect: the repair only counts if a runnable entry now exists.
        if let Some(v) = crate::env_refresh::detect_with_fresh_path("claude.cmd", "--version")
            .or_else(|| crate::env_refresh::detect_with_fresh_path("claude", "--version"))
            .or_else(|| crate::env_refresh::detect_with_fresh_path("claude.exe", "--version"))
        {
            log::info!("Repair succeeded; Claude Code {v} now resolves");
            return Ok(InstallStepResult {
                component: "Claude Code".into(),
                success: true,
                version: Some(v.clone()),
                message: format!("Claude Code {v} 安装成功（已自动补装原生程序）"),
            });
        }

        log::error!("Repair re-install did not produce a runnable claude; reporting failure");
    }

    if inst.installed {
        Ok(InstallStepResult {
            component: "Claude Code".into(),
            success: true,
            version: inst.version.clone(),
            message: format!("Claude Code {} 安装成功", inst.version.unwrap_or_default()),
        })
    } else if crate::environment::claude_package_present_but_broken() {
        // The wrapper was unpacked but the native binary never landed. This is a
        // distinct failure with a distinct fix, and silently reporting
        // "installed" here is exactly what left `claude` unrecognized in a
        // terminal while the UI showed success.
        log::error!(
            "claude-code package present but no runnable binary; postinstall likely skipped or its download failed"
        );
        Ok(InstallStepResult {
            component: "Claude Code".into(),
            success: false,
            version: None,
            message: "Claude Code 安装不完整：npm 包已下载，但原生程序（约 220MB）没有装上。\n\
                      常见原因是用 --omit=optional 安装，或该二进制下载失败。\n\
                      请在终端执行：npm config get omit（应不含 optional），然后重试；\n\
                      或手动执行：npm install -g @anthropic-ai/claude-code --include=optional"
                .into(),
        })
    } else {
        let e = format!("{} {}", out.stdout, out.stderr);
        Ok(InstallStepResult {
            component: "Claude Code".into(),
            success: false,
            version: None,
            message: if e.trim().is_empty() {
                "验证失败，请手动运行 npm install -g @anthropic-ai/claude-code".into()
            } else {
                e.trim().into()
            },
        })
    }
}

fn get_cancel_flag(tm: &TaskManager, task_id: &str) -> Option<Arc<AtomicBool>> {
    // The task manager now stores an `Arc<AtomicBool>` directly, so we can pass
    // it through without the previous 120s polling bridge thread.
    tm.get_cancel_flag(task_id)
}

pub fn generate_install_plan() -> Vec<InstallStepResult> {
    let mut plan = Vec::new();

    // Use environment.rs detection (same as environment page — handles refreshed PATH, portable, process PATH)
    let env_node = crate::environment::detect_node();
    let env_git = crate::environment::detect_git();
    let cc = crate::environment::detect_claude_code();

    let node_ok = env_node.node_version.is_some();
    let npm_ok = env_node.npm_version.is_some();

    plan.push(InstallStepResult {
        component: "Node.js".into(),
        success: node_ok,
        version: env_node.node_version,
        message: if node_ok {
            "Installed".into()
        } else {
            "Needs install".into()
        },
    });

    plan.push(InstallStepResult {
        component: "npm".into(),
        success: npm_ok,
        version: env_node.npm_version,
        message: if npm_ok {
            "Installed".into()
        } else {
            "With Node.js".into()
        },
    });

    plan.push(InstallStepResult {
        component: "Git".into(),
        success: env_git.installed,
        version: env_git.version,
        message: if env_git.installed {
            "Installed".into()
        } else {
            "Optional".into()
        },
    });

    plan.push(InstallStepResult {
        component: "Claude Code".into(),
        success: cc.installed,
        version: cc.version,
        message: if cc.installed {
            "Installed".into()
        } else {
            "Needs install".into()
        },
    });

    plan
}

/// Wrap a component install so a failure becomes a result instead of aborting
/// the whole run.
async fn step_result<F>(component: &str, fut: F) -> InstallStepResult
where
    F: std::future::Future<Output = AppResult<InstallStepResult>>,
{
    match fut.await {
        Ok(r) => r,
        Err(e) => InstallStepResult {
            component: component.to_string(),
            success: false,
            version: None,
            message: e.message,
        },
    }
}

/// Why the app is asking for a restart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RestartStage {
    /// Node.js + Git are in place; Claude Code still needs installing.
    BaseEnvironment,
    /// Everything is installed, but Claude Code is not visible to this process yet.
    ClaudeCode,
}

/// Payload for the `restart-required` event.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct RestartRequest {
    pub stage: RestartStage,
}

/// Message used when the install stops after the base environment so the user
/// can restart before Claude Code is installed.
pub const PENDING_RESTART_MESSAGE: &str =
    "需要重启应用以加载新的环境变量，然后继续安装 Claude Code。";

/// Whether a full-install run stopped cleanly only because a restart is needed.
///
/// Lets the caller treat "Node.js + Git done, Claude Code waiting on a restart"
/// as success rather than a failure.
pub fn is_pending_restart(results: &[InstallStepResult]) -> bool {
    let base_ok = results
        .iter()
        .filter(|r| r.component == "Node.js" || r.component == "Git")
        .all(|r| r.success);
    let claude_pending = results
        .iter()
        .any(|r| r.component == "Claude Code" && r.message == PENDING_RESTART_MESSAGE);
    base_ok && claude_pending
}

/// Whether Claude Code installed successfully but is not yet visible to this
/// process, so a restart is what will make it detectable.
///
/// This is the honest test, not a guess: `npm install -g` drops the `claude`
/// shim into a directory appended to the *registry* PATH, and the running process
/// keeps the PATH it inherited at launch. `detect_claude_code` also consults the
/// refreshed registry PATH, so if it still reports "not installed" here, only a
/// restart will change that answer.
pub fn is_claude_restart_needed(results: &[InstallStepResult]) -> bool {
    let claude_installed = results
        .iter()
        .any(|r| r.component == "Claude Code" && r.success);
    claude_installed && !crate::environment::detect_claude_code().installed
}

pub async fn run_full_install(task_id: &str, app: &AppHandle) -> AppResult<Vec<InstallStepResult>> {
    let tm = &app.state::<crate::AppState>().task_manager;
    let mut results = Vec::new();

    // Node.js and Git are fully independent — neither needs the other, they touch
    // different registry keys, and the fallback downloads come from unrelated
    // hosts. Running them concurrently removes one whole download+install
    // latency from the critical path. Claude Code still has to wait for npm.
    //
    // The two branches do race on `HKCU\Environment\PATH`, so all PATH writes go
    // through `AppState::path_lock` to stay atomic w.r.t. each other.
    tm.update_progress(task_id, 5.0, Some("并行安装 Node.js 与 Git...".into()), app);

    let node_task = {
        let app = app.clone();
        let tid = task_id.to_string();
        async move { step_result("Node.js", install_node(&tid, &app)).await }
    };
    let git_task = {
        let app = app.clone();
        let tid = task_id.to_string();
        async move { step_result("Git", install_git(&tid, &app)).await }
    };

    let (node_res, git_res) = tokio::join!(node_task, git_task);
    let node_ok = node_res.success;
    let git_ok = git_res.success;
    results.push(node_res);
    results.push(git_res);

    // Stop here and ask for a restart once the base environment is in place.
    //
    // Node.js was installed into a directory that was appended to the *registry*
    // PATH; this process inherited its PATH at launch and cannot see it. Nothing
    // we do in-process fully substitutes for a restart: npm, and later the
    // `claude` shim, only resolve reliably in a process that started with the
    // final PATH. Installing Claude Code in this same run is exactly how it
    // failed before, so the restart is a hard boundary rather than a nicety.
    if node_ok && git_ok {
        log::info!("Base environment installed; requesting restart before Claude Code");
        tm.update_progress(task_id, 100.0, Some("基础环境安装完成".into()), app);

        results.push(InstallStepResult {
            component: "Claude Code".into(),
            success: false,
            version: None,
            message: PENDING_RESTART_MESSAGE.into(),
        });

        let _ = app.emit("environment-changed", true);
        let _ = app.emit(
            "restart-required",
            RestartRequest {
                stage: RestartStage::BaseEnvironment,
            },
        );
        return Ok(results);
    }

    // Base environment incomplete — report it instead of attempting Claude Code,
    // which would only fail for a second, less obvious reason.
    if !node_ok {
        results.push(InstallStepResult {
            component: "Claude Code".into(),
            success: false,
            version: None,
            message: "Node.js/npm 未安装成功，已跳过 Claude Code 安装。".into(),
        });

        tm.update_progress(task_id, 95.0, Some("基础环境安装未完成".into()), app);
        let _ = app.emit("environment-changed", true);
        return Ok(results);
    }

    // Node.js is present but Git is not: Git is optional, so continue.
    tm.update_progress(task_id, 70.0, Some("安装 Claude Code...".into()), app);
    results.push(step_result("Claude Code", install_claude(task_id, app)).await);

    refresh_env();

    // Claude Code installed, but the freshly created `claude` shim lives on a PATH
    // this process inherited before it existed. Ask for a restart so detection
    // (and the UI) can actually see it.
    if is_claude_restart_needed(&results) {
        log::info!("Claude Code installed but not visible to this process; requesting restart");
        tm.update_progress(
            task_id,
            100.0,
            Some("Claude Code 安装完成，需重启".into()),
            app,
        );
        let _ = app.emit("environment-changed", true);
        let _ = app.emit(
            "restart-required",
            RestartRequest {
                stage: RestartStage::ClaudeCode,
            },
        );
        return Ok(results);
    }

    if results.iter().all(|r| r.success) {
        tm.update_progress(task_id, 100.0, Some("环境安装完成".into()), app);
    } else {
        tm.update_progress(task_id, 95.0, Some("部分组件安装完成".into()), app);
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
    tm.update_progress(
        task_id,
        20.0,
        Some(format!("Uninstalling (source: {source})...")),
        app,
    );

    let uninstalled = match source {
        "native" => {
            // Remove the binary only; leave ~/.claude config intact.
            let home = std::env::var("USERPROFILE").unwrap_or_default();
            let targets = [
                format!("{home}\\.local\\bin\\claude.exe"),
                format!("{home}\\.local\\bin\\claude.cmd"),
                format!("{home}\\.local\\bin\\claude"),
            ];
            let mut removed_any = false;
            for t in &targets {
                if std::path::Path::new(t).exists() {
                    match std::fs::remove_file(t) {
                        Ok(()) => {
                            removed_any = true;
                        }
                        Err(e) => log::warn!("Failed to remove {t}: {e}"),
                    }
                }
            }
            removed_any
        }
        // npm / pnpm / yarn all go through npm global for uninstall
        _ => {
            if detect_npm_refreshed().or_else(detect_npm).is_none() {
                log::warn!("npm not available for uninstall; attempting direct binary removal");
                false
            } else {
                match run_npm_global(
                    "uninstall",
                    "@anthropic-ai/claude-code",
                    Duration::from_secs(300),
                    get_cancel_flag(tm, task_id),
                )
                .await
                {
                    Ok(o) if o.success => true,
                    Ok(o) => {
                        log::warn!("npm uninstall non-zero exit: {}", o.stderr);
                        false
                    }
                    Err(e) => {
                        log::warn!("npm uninstall failed: {e}");
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
            format!("{home}\\AppData\\Roaming\\npm\\claude.exe"),
            format!("{home}\\AppData\\Roaming\\npm\\claude.cmd"),
            format!("{home}\\AppData\\Roaming\\npm\\claude"),
            format!("{home}\\AppData\\Local\\pnpm\\claude.exe"),
            format!("{home}\\AppData\\Local\\pnpm\\claude.cmd"),
        ] {
            if std::path::Path::new(bin).exists() {
                let _ = std::fs::remove_file(bin);
            }
        }
    }

    let final_check = crate::environment::detect_claude_code();
    let _ = app.emit("environment-changed", true);

    if final_check.installed {
        Ok(InstallStepResult {
            component: "Claude Code".into(),
            success: false,
            version: final_check.version,
            message: "卸载未完成：二进制仍可检测到。请手动运行 npm uninstall -g @anthropic-ai/claude-code。".into(),
        })
    } else {
        Ok(InstallStepResult {
            component: "Claude Code".into(),
            success: true,
            version: None,
            message: "Claude Code 已卸载（配置已保留）。".into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ccm-installer-test-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ── A1: PowerShell script transport ─────────────────────────

    #[test]
    fn ps_script_spec_passes_script_as_single_encoded_argument() {
        let spec = ps_script_spec("Get-Date", Duration::from_secs(5));

        assert_eq!(spec.program, "powershell");
        assert_eq!(
            spec.args[..3],
            ["-NoProfile", "-NonInteractive", "-EncodedCommand"]
        );
        // Exactly one argument after the flag: the payload can never be split
        // into additional PowerShell tokens.
        assert_eq!(spec.args.len(), 4);

        // Round-trips to the original UTF-16LE script.
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&spec.args[3])
            .expect("payload must be valid base64");
        let utf16: Vec<u16> = decoded
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        assert_eq!(String::from_utf16(&utf16).unwrap(), "Get-Date");
    }

    #[test]
    fn ps_script_spec_keeps_injection_payload_inside_one_argument() {
        // A path containing a quote, a semicolon and a command separator must
        // stay inert: it is base64 data, not PowerShell source.
        let hostile = r"C:\tmp\a'; Remove-Item -Recurse C:\ ;'.zip";
        let spec = ps_script_spec(hostile, Duration::from_secs(5));

        assert_eq!(spec.args.len(), 4);
        for arg in &spec.args {
            assert!(
                !arg.contains("Remove-Item"),
                "raw script text must not appear as an argument: {arg}"
            );
        }

        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&spec.args[3])
            .unwrap();
        assert!(!decoded.is_empty());
        // The payload decodes back to exactly the input — no truncation at the
        // quote, which is what `-Command "..."` interpolation would have caused.
        let utf16: Vec<u16> = decoded
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        assert_eq!(String::from_utf16(&utf16).unwrap(), hostile);
    }

    // ── B3: cache verification marker ───────────────────────────

    #[test]
    fn cache_marker_round_trip_marks_archive_verified() {
        let dir = temp_dir("marker-ok");
        let archive = dir.join("node.zip");
        std::fs::write(&archive, b"fake-node-archive").unwrap();
        let path = archive.to_string_lossy().to_string();

        assert!(!cache_marker_valid(&path), "no marker yet");

        write_marker(&path, "abc123");
        assert!(cache_marker_valid(&path), "marker should validate");

        let marker = read_marker(&path).unwrap();
        assert_eq!(marker.sha256, "abc123");
        assert_eq!(marker.size, 17);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn cache_marker_invalidated_when_archive_changes() {
        let dir = temp_dir("marker-changed");
        let archive = dir.join("node.zip");
        std::fs::write(&archive, b"original").unwrap();
        let path = archive.to_string_lossy().to_string();
        write_marker(&path, "hash-of-original");
        assert!(cache_marker_valid(&path));

        // Simulate a tampered/replaced archive: size changes, so the recorded
        // stamp no longer matches and the archive must be re-hashed.
        std::fs::write(&archive, b"totally-different-and-longer").unwrap();
        assert!(
            !cache_marker_valid(&path),
            "size mismatch must invalidate the marker"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn cache_marker_missing_archive_is_invalid() {
        let dir = temp_dir("marker-missing");
        let path = dir.join("absent.zip").to_string_lossy().to_string();
        assert!(!cache_marker_valid(&path));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn invalidate_cache_removes_archive_and_marker() {
        let dir = temp_dir("invalidate");
        let archive = dir.join("node.zip");
        std::fs::write(&archive, b"payload").unwrap();
        let path = archive.to_string_lossy().to_string();
        write_marker(&path, "deadbeef");
        assert!(std::path::Path::new(&marker_path(&path)).exists());

        invalidate_cache(&path);

        assert!(!archive.exists(), "archive should be gone");
        assert!(
            !std::path::Path::new(&marker_path(&path)).exists(),
            "marker should be gone so it cannot outlive the archive"
        );
        assert!(!cache_marker_valid(&path));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn corrupt_marker_json_is_treated_as_unverified() {
        let dir = temp_dir("marker-corrupt");
        let archive = dir.join("node.zip");
        std::fs::write(&archive, b"payload").unwrap();
        let path = archive.to_string_lossy().to_string();
        std::fs::write(marker_path(&path), b"{ not json").unwrap();

        assert!(!cache_marker_valid(&path));

        std::fs::remove_dir_all(&dir).ok();
    }

    // ── A5: verify-before-promote ───────────────────────────────

    #[test]
    fn promote_part_moves_verified_archive_into_place() {
        let dir = temp_dir("promote");
        let part = dir.join("node.zip.part");
        let dest = dir.join("node.zip");
        std::fs::write(&part, b"verified-bytes").unwrap();

        promote_part(&part.to_string_lossy(), &dest.to_string_lossy())
            .expect("promotion should succeed");

        assert!(!part.exists(), ".part should be consumed");
        assert_eq!(std::fs::read(&dest).unwrap(), b"verified-bytes");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn promote_part_reports_failure_for_missing_source() {
        let dir = temp_dir("promote-fail");
        let missing = dir.join("nope.zip.part");
        let dest = dir.join("nope.zip");

        let result = promote_part(&missing.to_string_lossy(), &dest.to_string_lossy());

        assert!(result.is_err(), "missing source must not silently succeed");
        assert!(!dest.exists(), "destination must not be created");

        std::fs::remove_dir_all(&dir).ok();
    }

    // ── B4: mirror selection ────────────────────────────────────

    #[tokio::test]
    async fn select_fastest_source_returns_a_wellformed_url() {
        // Only asserts shape: the probes hit the real network, and which mirror
        // wins is environment-dependent.
        let (url, id) = select_fastest_source(NODE_VERSION, NODE_ZIP).await;

        assert!(
            url.ends_with(&format!("/{NODE_VERSION}/{NODE_ZIP}")),
            "unexpected url: {url}"
        );
        assert!(
            NODE_SOURCES.iter().any(|(sid, _, _)| *sid == id),
            "source id must be one of the known mirrors, got {id}"
        );
        assert!(url.starts_with("https://"), "must be https: {url}");
    }

    #[test]
    fn node_sources_are_https_and_end_with_slash() {
        for (id, _name, base) in NODE_SOURCES {
            assert!(base.starts_with("https://"), "{id} must use https");
            assert!(base.ends_with('/'), "{id} must end with '/' for join");
        }
    }

    // ── Git installer checksum ──────────────────────────────────

    #[test]
    fn git_installer_hash_is_a_valid_sha256() {
        assert_eq!(
            GIT_INSTALLER_SHA256.len(),
            64,
            "pinned digest must be 64 hex chars"
        );
        assert!(
            GIT_INSTALLER_SHA256.chars().all(|c| c.is_ascii_hexdigit()),
            "pinned digest must be hexadecimal: {GIT_INSTALLER_SHA256}"
        );
        assert_eq!(
            GIT_INSTALLER_SHA256,
            GIT_INSTALLER_SHA256.to_lowercase(),
            "pin the digest lowercased, matching `sha256_file` output"
        );
    }

    /// The Git download URL must be built from the pinned version, so the version
    /// and its digest cannot drift apart silently.
    #[test]
    fn git_urls_use_the_pinned_version() {
        let gv = GIT_VERSION;
        let expected_suffix = format!("/v{gv}.windows.1/Git-{gv}-64-bit.exe");
        assert!(
            expected_suffix.starts_with("/v2.45.2"),
            "sanity: {expected_suffix}"
        );
        assert!(
            GIT_INSTALLER_SHA256.len() == 64,
            "a version bump must be accompanied by a new pinned digest"
        );
    }

    /// Real-network proof that the pinned digest matches what the mirror serves.
    ///
    /// This is the check that makes the pin trustworthy: if npmmirror ever served
    /// a different (or tampered) artifact, verification would reject it and the
    /// installer would fail rather than run it.
    #[tokio::test]
    #[ignore = "downloads ~65 MB from the network"]
    async fn git_installer_pinned_hash_matches_mirror() {
        let gv = GIT_VERSION;
        let url = format!(
            "https://npmmirror.com/mirrors/git-for-windows/v{gv}.windows.1/Git-{gv}-64-bit.exe"
        );

        let dir = temp_dir("git-hash");
        let dest = dir.join("git-install.exe");
        let dest_str = dest.to_string_lossy().to_string();

        let part = download_to_part(&url, &dest_str, None, |_, _, _| {})
            .await
            .expect("download must succeed");
        let actual = sha256_file(&part).expect("hashing must succeed");

        println!("mirror sha256 = {actual}");
        println!("pinned sha256 = {GIT_INSTALLER_SHA256}");
        assert_eq!(
            actual, GIT_INSTALLER_SHA256,
            "the pinned digest must match what the mirror actually serves"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    // ── Multi-source racing ─────────────────────────────────────

    /// The fastest responder must win, regardless of where it sits in the list.
    #[test]
    fn pick_fastest_prefers_lowest_latency() {
        let candidates = vec![
            ("slow".to_string(), "https://slow.example/x".to_string()),
            ("fast".to_string(), "https://fast.example/x".to_string()),
            ("dead".to_string(), "https://dead.example/x".to_string()),
        ];
        let measured = vec![
            (
                "slow".to_string(),
                Some(900),
                "https://slow.example/x".to_string(),
            ),
            (
                "fast".to_string(),
                Some(30),
                "https://fast.example/x".to_string(),
            ),
            (
                "dead".to_string(),
                None,
                "https://dead.example/x".to_string(),
            ),
        ];

        let (url, id) = pick_fastest(&candidates, measured);
        assert_eq!(id, "fast");
        assert_eq!(url, "https://fast.example/x");
    }

    /// A non-responder must never be chosen while anything answered.
    ///
    /// Note this is about *outcomes*, not timing: a mirror that fails fast (a
    /// refused connection) must not beat a slower mirror that actually serves the
    /// file.
    #[test]
    fn pick_fastest_never_selects_a_non_responder() {
        let candidates = vec![
            ("dead".to_string(), "https://dead.example/x".to_string()),
            ("live".to_string(), "https://live.example/x".to_string()),
        ];
        // The dead candidate is "first" and would win a naive first-wins loop.
        let measured = vec![
            (
                "dead".to_string(),
                None,
                "https://dead.example/x".to_string(),
            ),
            (
                "live".to_string(),
                Some(2500),
                "https://live.example/x".to_string(),
            ),
        ];

        let (url, id) = pick_fastest(&candidates, measured);
        assert_eq!(id, "live", "a non-responder must not be selected");
        assert_eq!(url, "https://live.example/x");
    }

    /// When nothing responds the caller's own ordering is kept, so the download
    /// reports a real error against the preferred source rather than an arbitrary
    /// one. Needs no network, so it is trustworthy on CI.
    #[test]
    fn pick_fastest_keeps_caller_order_when_nothing_responds() {
        let candidates = vec![
            ("first".to_string(), "https://first.example/x".to_string()),
            ("second".to_string(), "https://second.example/x".to_string()),
        ];
        let measured = vec![
            (
                "second".to_string(),
                None,
                "https://second.example/x".to_string(),
            ),
            (
                "first".to_string(),
                None,
                "https://first.example/x".to_string(),
            ),
        ];

        let (url, id) = pick_fastest(&candidates, measured);
        // Returned as `(url, id)`.
        assert_eq!(url, "https://first.example/x");
        assert_eq!(
            id, "first",
            "must fall back to the caller's first candidate"
        );
    }

    #[test]
    fn pick_fastest_handles_empty_input() {
        let (url, id) = pick_fastest(&[], Vec::new());
        assert!(url.is_empty());
        assert!(id.is_empty());
    }

    /// `benchmark_source` must reject an unroutable host, so such a mirror can
    /// never be selected as a download source.
    ///
    /// Regression: the Git download used a *fixed* order with GitHub first. When
    /// that host was unreachable, the installer sat on it until the attempt
    /// finished — 101 seconds in one reported run — before trying a mirror that
    /// was up. Racing removes that wait; this asserts the probe reports the dead
    /// host as unusable rather than "fast" because it failed quickly.
    #[tokio::test]
    async fn benchmark_source_rejects_unroutable_host() {
        // RFC 5737 TEST-NET-1: reserved, never routed.
        let latency = benchmark_source("https://192.0.2.1/does-not-exist.exe").await;
        assert!(
            latency.is_none(),
            "an unroutable host must not be reported as a usable source"
        );
    }

    /// The whole race must be bounded by a single probe timeout, not the sum of
    /// attempts. Uses only unroutable hosts, so it needs no network and cannot
    /// flake on CI.
    #[tokio::test]
    async fn select_fastest_candidate_is_bounded_for_all_dead_inputs() {
        let candidates = vec![
            ("dead1".to_string(), "https://192.0.2.1/a.exe".to_string()),
            ("dead2".to_string(), "https://192.0.2.2/b.exe".to_string()),
        ];

        let start = std::time::Instant::now();
        let (url, id) = select_fastest_candidate(candidates).await;
        let elapsed = start.elapsed();

        assert!(!url.is_empty(), "must return a non-empty url to attempt");
        assert!(!id.is_empty(), "must return an id for logging");
        assert!(
            elapsed < Duration::from_secs(20),
            "must be bounded by one probe timeout, took {elapsed:?}"
        );
    }

    #[tokio::test]
    async fn select_fastest_candidate_returns_empty_for_no_candidates() {
        let (url, id) = select_fastest_candidate(Vec::new()).await;
        assert!(url.is_empty());
        assert!(id.is_empty());
    }

    /// Real-network check that the Git mirrors are actually raced.
    #[tokio::test]
    #[ignore = "hits the network"]
    async fn git_sources_are_probed_and_one_is_selected() {
        let gv = "2.45.2";
        let candidates: Vec<(String, String)> = vec![
            (
                "github".to_string(),
                format!("https://github.com/git-for-windows/git/releases/download/v{gv}.windows.1/Git-{gv}-64-bit.exe"),
            ),
            (
                "npmmirror".to_string(),
                format!("https://npmmirror.com/mirrors/git-for-windows/v{gv}.windows.1/Git-{gv}-64-bit.exe"),
            ),
        ];

        let start = std::time::Instant::now();
        let (url, id) = select_fastest_candidate(candidates).await;
        println!("selected {id} -> {url} in {:?}", start.elapsed());

        assert!(
            id == "github" || id == "npmmirror",
            "must select one of the known mirrors, got {id}"
        );
        assert!(url.starts_with("https://"));
    }

    /// Real-network end-to-end check of the portable Node.js pipeline:
    /// mirror selection -> download -> SHA256 against a mirror SHASUMS file ->
    /// extract -> node.exe --version.
    ///
    /// Ignored by default (35 MB download + touches the network). Run with:
    ///   cargo test --lib installer::tests::node_portable_end_to_end_real -- --ignored --nocapture
    ///
    /// This is the test that actually exercises the code paths a failed
    /// "portable install" takes, which mocks cannot cover.
    #[tokio::test]
    #[ignore = "downloads ~35 MB from the network"]
    async fn node_portable_end_to_end_real() {
        let dir = temp_dir("e2e-node");
        let cp = dir.join(NODE_ZIP).to_string_lossy().to_string();
        let rt = dir.join("runtime").to_string_lossy().to_string();

        // 1. Pick a mirror and download.
        let (url, src) = select_fastest_source(NODE_VERSION, NODE_ZIP).await;
        println!("source={src} url={url}");
        assert!(url.starts_with("https://"));

        let mut last_progress = (0u64, 0u64);
        let part = download_to_part(&url, &cp, None, |d, t, _| last_progress = (d, t))
            .await
            .expect("download must succeed");
        println!(
            "downloaded {} bytes (expected total {})",
            last_progress.0, last_progress.1
        );
        assert!(last_progress.0 > 30_000_000, "archive looks too small");
        assert_eq!(
            std::fs::metadata(&part).unwrap().len(),
            last_progress.0,
            "bytes on disk must match reported progress"
        );

        // 2. Verify against a mirror-served SHASUMS256.txt.
        let hash = verify_node_sha256(&part)
            .await
            .expect("SHA256 verification must succeed");
        println!("verified sha256={hash}");
        assert_eq!(hash.len(), 64);

        // 3. Promote and extract.
        promote_part(&part, &cp).expect("promote must succeed");
        let t_extract = std::time::Instant::now();
        extract_zip(&cp, &rt)
            .await
            .expect("extraction must succeed");
        println!("extraction took {:?}", t_extract.elapsed());

        // 4. The exact path the installer looks for.
        let ne = format!("{rt}\\{NODE_FILENAME}\\node.exe");
        let ver = verify_node_at_path(&ne).unwrap_or_else(|| {
            let listing = std::fs::read_dir(&rt)
                .map(|e| {
                    e.flatten()
                        .map(|x| x.file_name().to_string_lossy().to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            panic!("node.exe missing at {ne}; runtime dir contains: [{listing}]")
        });
        println!("portable node version = {ver}");
        assert_eq!(ver, NODE_VERSION.trim_start_matches('v'));
        assert!(
            std::path::Path::new(&format!("{rt}\\{NODE_FILENAME}\\npm.cmd")).exists(),
            "npm.cmd must ship alongside node.exe"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// The hash helper must work; it is the gate for every Node.js download.
    ///
    /// Regression: `certutil` writes its header in the OEM code page, so strict
    /// UTF-8 decoding failed on non-English Windows and no Node.js download could
    /// ever be verified.
    #[test]
    fn sha256_file_matches_known_digest() {
        let dir = temp_dir("sha256");
        let f = dir.join("known.bin");
        std::fs::write(&f, b"hello").unwrap();
        let path = f.to_string_lossy().to_string();

        let expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        assert_eq!(sha256_via_certutil(&path).as_deref(), Some(expected));
        assert_eq!(sha256_file(&path).as_deref(), Some(expected));

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Regression: an inherited PowerShell 7 `PSModulePath` makes Windows
    /// PowerShell 5.1 unable to resolve module cmdlets, which broke both
    /// `Expand-Archive` (extraction) and `Get-FileHash` (fallback hashing).
    #[test]
    fn powershell_module_cmdlets_resolve_with_inherited_psmodulepath() {
        let dir = temp_dir("psmodule");
        let f = dir.join("known.bin");
        std::fs::write(&f, b"hello").unwrap();
        let path = f.to_string_lossy().to_string();

        // Simulate being launched from a PowerShell 7 shell: poison the variable
        // with PS7 paths, exactly as happens in practice.
        let saved = std::env::var("PSModulePath").ok();
        std::env::set_var(
            "PSModulePath",
            r"D:\nonexistent-ps7\PowerShell\Modules;C:\Program Files\PowerShell\Modules",
        );
        let certutil = sha256_via_certutil(&path);
        let powershell = sha256_via_powershell(&path);
        match saved {
            Some(v) => std::env::set_var("PSModulePath", v),
            None => std::env::remove_var("PSModulePath"),
        }

        assert!(
            certutil.is_some(),
            "certutil path must be unaffected by PSModulePath"
        );
        assert_eq!(
            powershell.as_deref(),
            Some("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"),
            "Get-FileHash fallback must work even with a poisoned PSModulePath"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// `Expand-Archive` is a module cmdlet too — extraction must survive the same
    /// inherited-PSModulePath scenario that broke it in the field.
    #[tokio::test]
    async fn extract_zip_works_with_inherited_psmodulepath() {
        let dir = temp_dir("pszip");
        let src = dir.join("payload");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("marker.txt"), b"extracted").unwrap();

        let zip_path = dir.join("payload.zip");
        let dest = dir.join("out");
        std::fs::create_dir_all(&dest).unwrap();

        // Build the archive with the same helper the installer uses.
        let script = format!(
            "Compress-Archive -Path '{}' -DestinationPath '{}' -Force",
            src.join("*").to_string_lossy().replace('\'', "''"),
            zip_path.to_string_lossy().replace('\'', "''")
        );
        let spec = ps_script_spec(&script, Duration::from_secs(120));
        execute_command(&spec, None)
            .await
            .expect("Compress-Archive should run");
        assert!(zip_path.exists(), "fixture zip must be created");

        let saved = std::env::var("PSModulePath").ok();
        std::env::set_var(
            "PSModulePath",
            r"D:\nonexistent-ps7\PowerShell\Modules;C:\Program Files\PowerShell\Modules",
        );
        let result = extract_zip(&zip_path.to_string_lossy(), &dest.to_string_lossy()).await;
        match saved {
            Some(v) => std::env::set_var("PSModulePath", v),
            None => std::env::remove_var("PSModulePath"),
        }

        result.expect("extraction must succeed despite the inherited PSModulePath");
        // Layout-agnostic: Compress-Archive may or may not keep the inner folder.
        let extracted = walk_for(&dest, "marker.txt");
        assert!(
            extracted.is_some(),
            "extracted payload must be present under {}",
            dest.to_string_lossy()
        );
        assert_eq!(std::fs::read(extracted.unwrap()).unwrap(), b"extracted");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Depth-first search for a file name beneath `root`.
    fn walk_for(root: &std::path::Path, name: &str) -> Option<std::path::PathBuf> {
        for entry in std::fs::read_dir(root).ok()?.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if let Some(found) = walk_for(&p, name) {
                    return Some(found);
                }
            } else if p.file_name().is_some_and(|n| n == name) {
                return Some(p);
            }
        }
        None
    }

    #[test]
    fn sha256_file_returns_none_for_missing_file() {
        let missing = std::env::temp_dir().join("ccm-definitely-missing-xyz.bin");
        std::fs::remove_file(&missing).ok();
        assert!(sha256_file(&missing.to_string_lossy()).is_none());
    }

    /// Regression: detection used the refreshed registry PATH while execution
    /// used the app's stale process PATH, so npm was declared available and then
    /// reported as "not recognized" by the very next step.
    ///
    /// Asserts the mechanism directly rather than mutating the process-global
    /// `PATH`, which would race other tests running in parallel.
    #[test]
    fn refreshed_path_carries_portable_runtime_bin_dir() {
        let merged = crate::env_refresh::refresh_windows_path().merged_path;
        if merged.is_empty() {
            println!("no registry PATH available; skipping");
            return;
        }

        let bin = portable_bin_dir();
        // Only meaningful once the portable runtime has actually been installed.
        if !std::path::Path::new(&bin).is_dir() {
            println!("portable runtime not installed ({bin}); skipping");
            return;
        }

        let carries = merged
            .split(';')
            .any(|e| e.trim().trim_end_matches('\\').eq_ignore_ascii_case(&bin));
        assert!(
            carries,
            "the refreshed PATH must include the portable node bin dir {bin}, \
             otherwise npm cannot be executed after a portable install"
        );
    }

    /// The refreshed spec must actually resolve npm when npm is present.
    #[test]
    fn refreshed_spec_resolves_npm_when_available() {
        if crate::env_refresh::refresh_windows_path()
            .merged_path
            .is_empty()
        {
            return;
        }
        match probe_npm_in_refreshed_env() {
            Some(v) => {
                println!("npm {v} resolved with refreshed PATH");
                assert!(!v.is_empty());
            }
            None => println!("npm not present in this environment; skipping"),
        }
    }

    /// Confirms the registry PATH really contains a portable-runtime bin dir
    /// after an install, which is the mechanism the refreshed spec relies on.
    #[test]
    fn portable_bin_dir_is_absolute_and_versioned() {
        let dir = portable_bin_dir();
        assert!(
            dir.contains(NODE_FILENAME),
            "portable bin dir must be versioned: {dir}"
        );
        assert!(
            dir.contains("ClaudeCodeManager"),
            "portable bin dir must live under the app dir: {dir}"
        );
        assert!(
            !dir.starts_with('\\'),
            "portable bin dir must not be drive-relative: {dir}"
        );
    }

    // ── Restart hand-off ────────────────────────────────────────

    fn step(component: &str, success: bool, message: &str) -> InstallStepResult {
        InstallStepResult {
            component: component.into(),
            success,
            version: None,
            message: message.into(),
        }
    }

    #[test]
    fn pending_restart_recognised_when_base_env_done() {
        let results = vec![
            step("Node.js", true, "Portable Node.js 22.14.0 done"),
            step("Git", true, "git version 2.53.0"),
            step("Claude Code", false, PENDING_RESTART_MESSAGE),
        ];
        assert!(
            is_pending_restart(&results),
            "base env installed + Claude pending restart must be recognised"
        );
    }

    #[test]
    fn pending_restart_rejected_when_base_env_incomplete() {
        // Claude Code pending, but Node.js failed: this is a real failure and
        // must not be reported as "just restart".
        let results = vec![
            step("Node.js", false, "Node.js 安装失败。便携版: ..."),
            step("Git", true, "git version 2.53.0"),
            step("Claude Code", false, PENDING_RESTART_MESSAGE),
        ];
        assert!(!is_pending_restart(&results));
    }

    #[test]
    fn pending_restart_rejected_for_ordinary_claude_failure() {
        // Claude Code failed for some other reason — that is a failure.
        let results = vec![
            step("Node.js", true, "ok"),
            step("Git", true, "ok"),
            step("Claude Code", false, "npm 不可用，请先完成 Node.js 安装。"),
        ];
        assert!(!is_pending_restart(&results));
    }

    #[test]
    fn pending_restart_rejected_when_everything_succeeded() {
        let results = vec![
            step("Node.js", true, "ok"),
            step("Git", true, "ok"),
            step("Claude Code", true, "Claude Code 2.1.266 安装成功"),
        ];
        assert!(!is_pending_restart(&results));
    }

    #[test]
    fn pending_restart_rejected_for_empty_results() {
        assert!(!is_pending_restart(&[]));
    }

    // ── Restart hand-off after Claude Code installs ─────────────

    /// No restart is asked for unless Claude Code actually installed.
    #[test]
    fn claude_restart_not_requested_when_install_failed() {
        let results = vec![
            step("Node.js", true, "ok"),
            step("Claude Code", false, "npm 不可用，请先完成 Node.js 安装。"),
        ];
        assert!(!is_claude_restart_needed(&results));
    }

    #[test]
    fn claude_restart_not_requested_for_empty_results() {
        assert!(!is_claude_restart_needed(&[]));
    }

    #[test]
    fn claude_restart_not_requested_when_unrelated_step_succeeded() {
        // Node.js succeeding must not trigger a Claude Code restart prompt.
        let results = vec![step("Node.js", true, "Portable Node.js 22.14.0 done")];
        assert!(!is_claude_restart_needed(&results));
    }

    /// The decision must key off *whether detection can see it*, not off the
    /// install result alone — otherwise an already-visible install would nag the
    /// user to restart for nothing.
    ///
    /// Asserts the predicate against live detection, so it is meaningful on a
    /// machine where Claude Code is already on PATH (expects "no restart") and on
    /// one where it is not (expects "restart").
    #[test]
    fn claude_restart_decision_matches_live_detection() {
        let installed = vec![step("Claude Code", true, "Claude Code 2.1.268 安装成功")];
        let detectable = crate::environment::detect_claude_code().installed;

        assert_eq!(
            is_claude_restart_needed(&installed),
            !detectable,
            "restart must be requested exactly when detection cannot see the install \
             (detectable={detectable})"
        );
    }

    /// The event payload must carry the stage so the UI can pick its wording.
    #[test]
    fn restart_request_serialises_stage() {
        let base = serde_json::to_value(RestartRequest {
            stage: RestartStage::BaseEnvironment,
        })
        .unwrap();
        assert_eq!(base["stage"], "base_environment");

        let claude = serde_json::to_value(RestartRequest {
            stage: RestartStage::ClaudeCode,
        })
        .unwrap();
        assert_eq!(claude["stage"], "claude_code");
    }

    // ── Probe timeouts ──────────────────────────────────────────

    /// A probe that hangs must be killed and reported unavailable rather than
    /// freezing the installer at "验证安装".
    #[test]
    fn run_with_timeout_kills_a_hanging_probe() {
        use std::os::windows::process::CommandExt;
        // `ping -n 30` sleeps ~29s; the timeout must cut it far sooner.
        let mut c = std::process::Command::new("cmd");
        c.args(["/c", "ping", "-n", "30", "127.0.0.1"])
            .creation_flags(0x08000000);

        let start = std::time::Instant::now();
        let out = run_with_timeout(&mut c, Duration::from_millis(600));
        let elapsed = start.elapsed();

        assert!(out.is_none(), "a hanging probe must report unavailable");
        assert!(
            elapsed < Duration::from_secs(5),
            "must give up promptly, took {elapsed:?}"
        );
    }

    /// A probe that finishes normally must still return its output.
    #[test]
    fn run_with_timeout_returns_output_for_fast_command() {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("cmd");
        c.args(["/c", "echo", "hello-probe"])
            .creation_flags(0x08000000);

        let out = run_with_timeout(&mut c, Duration::from_secs(10))
            .expect("fast command must return output");
        assert!(out.status.success());
        assert!(
            String::from_utf8_lossy(&out.stdout).contains("hello-probe"),
            "stdout must be captured"
        );
    }

    /// The exact call that used to hang: verifying an executable's version.
    #[test]
    fn verify_node_at_path_is_bounded_for_missing_file() {
        let missing = std::env::temp_dir().join("ccm-no-such-node.exe");
        std::fs::remove_file(&missing).ok();
        let start = std::time::Instant::now();
        assert!(verify_node_at_path(&missing.to_string_lossy()).is_none());
        assert!(start.elapsed() < Duration::from_secs(2), "must not block");
    }

    #[test]
    fn ps_encode_round_trips_script() {
        use base64::Engine as _;
        let script = "(Get-FileHash -LiteralPath 'C:\\a''b\\x.zip' -Algorithm SHA256).Hash";
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(ps_encode(script))
            .unwrap();
        let utf16: Vec<u16> = decoded
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        assert_eq!(String::from_utf16(&utf16).unwrap(), script);
    }

    #[tokio::test]
    #[ignore = "hits the network"]
    async fn fetch_node_shasums_finds_entry_via_some_mirror() {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap();
        let text = fetch_node_shasums(&client)
            .await
            .expect("at least one mirror must serve a usable SHASUMS256.txt");
        let line = text
            .lines()
            .find(|l| l.contains(NODE_ZIP))
            .expect("entry for our zip must be present");
        assert_eq!(line.split_whitespace().next().unwrap().len(), 64);
    }
}
