// Claude Code Manager - Command executor: safe process execution
use crate::error::{codes, AppError, AppResult};
use crate::logging::LogSanitizer;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::timeout;

/// Maximum bytes of stdout/stderr to capture per process, to bound memory usage
/// from a runaway child process.
const MAX_OUTPUT_BYTES: u64 = 8 * 1024 * 1024;

/// Specification for a command to execute
#[derive(Debug, Clone)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: Vec<(String, String)>,
    pub timeout: Duration,
}

impl CommandSpec {
    pub fn new(program: impl Into<String>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            cwd: None,
            env: Vec::new(),
            timeout: Duration::from_secs(120),
        }
    }
    // Convenience builder methods; production code uses `args(Vec)`, while the
    // per-item variants are exercised by the unit tests below.
    #[allow(dead_code)]
    pub fn arg(mut self, arg: impl Into<String>) -> Self {
        self.args.push(arg.into());
        self
    }
    pub fn args(mut self, args: Vec<String>) -> Self {
        self.args = args;
        self
    }
    #[allow(dead_code)]
    pub fn cwd(mut self, path: impl Into<PathBuf>) -> Self {
        self.cwd = Some(path.into());
        self
    }
    #[allow(dead_code)]
    pub fn env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.push((key.into(), value.into()));
        self
    }
    pub fn timeout(mut self, duration: Duration) -> Self {
        self.timeout = duration;
        self
    }
}

/// Output from a completed command
#[derive(Debug, Clone)]
pub struct ProcessOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

/// Execute a command safely with timeout, cancellation, and proper IO capture
pub async fn execute_command(
    spec: &CommandSpec,
    cancel_flag: Option<Arc<AtomicBool>>,
) -> AppResult<ProcessOutput> {
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    if let Some(cwd) = &spec.cwd {
        cmd.current_dir(cwd);
    }
    for (k, v) in &spec.env {
        cmd.env(k, v);
    }

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| {
        AppError::new(
            "INSTALL_DOWNLOAD_FAILED",
            "进程启动失败",
            format!("无法启动进程 '{}'。", spec.program),
        )
        .with_details(e.to_string())
        .retryable()
    })?;

    // Take stdout/stderr handles for concurrent reading
    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();

    // Spawn async reader tasks (bounded output capture)
    let stdout_task = tokio::spawn(read_all(stdout_handle));
    let stderr_task = tokio::spawn(read_all_stderr(stderr_handle));

    // Wait for process exit with cancellation polling
    let wait_result = timeout(spec.timeout, async {
        loop {
            if let Some(ref flag) = cancel_flag {
                if flag.load(Ordering::SeqCst) {
                    kill_process_tree(&mut child).await;
                    return Err(AppError::new(
                        codes::INSTALL_CANCELLED,
                        "操作已取消",
                        "用户取消了操作。",
                    ));
                }
            }
            tokio::select! {
                status = child.wait() => {
                    return Ok(status.map_or(-1, |s| s.code().unwrap_or(-1)));
                }
                () = tokio::time::sleep(Duration::from_millis(200)) => {}
            }
        }
    })
    .await;

    // On timeout, kill the whole process tree; on success/cancel leave it be.
    let timed_out = wait_result.is_err();
    if timed_out {
        kill_process_tree(&mut child).await;
    }

    // Collect output from reader tasks
    let stdout = stdout_task.await.unwrap_or_else(|_| String::new());
    let stderr = stderr_task.await.unwrap_or_else(|_| String::new());

    // Sanitize secrets before the output is surfaced to callers/logs/UI.
    let sanitizer = LogSanitizer::new();
    let stdout = sanitizer.sanitize(&stdout).to_string();
    let stderr = sanitizer.sanitize(&stderr).to_string();

    match wait_result {
        Ok(Ok(exit_code)) => Ok(ProcessOutput {
            stdout,
            stderr,
            success: exit_code == 0,
        }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(AppError::new(
            codes::INSTALL_TIMEOUT,
            "操作超时",
            format!("命令执行超过 {} 秒。", spec.timeout.as_secs()),
        )
        .with_suggestion("请检查网络连接后重试。")
        .retryable()),
    }
}

/// Kill a child process and (on Windows) its entire process tree via `taskkill`.
#[cfg(windows)]
async fn kill_process_tree(child: &mut tokio::process::Child) {
    if let Some(pid) = child.id() {
        let _ = tokio::process::Command::new("taskkill")
            .arg("/PID")
            .arg(pid.to_string())
            .arg("/T")
            .arg("/F")
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
    }
    let _ = child.kill().await;
}

#[cfg(not(windows))]
async fn kill_process_tree(child: &mut tokio::process::Child) {
    let _ = child.kill().await;
}

async fn read_all(handle: Option<tokio::process::ChildStdout>) -> String {
    let h = match handle {
        Some(h) => h,
        None => return String::new(),
    };
    let mut buf = Vec::new();
    let mut limited = h.take(MAX_OUTPUT_BYTES);
    let _ = limited.read_to_end(&mut buf).await;
    String::from_utf8_lossy(&buf).to_string()
}

// Support stderr too - need a method that works for both types
async fn read_all_stderr(handle: Option<tokio::process::ChildStderr>) -> String {
    let h = match handle {
        Some(h) => h,
        None => return String::new(),
    };
    let mut buf = Vec::new();
    let mut limited = h.take(MAX_OUTPUT_BYTES);
    let _ = limited.read_to_end(&mut buf).await;
    String::from_utf8_lossy(&buf).to_string()
}

/// Execute a quick synchronous command and return its stdout (for detection only)
pub fn quick_command(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.output().ok().and_then(|o| {
        if o.status.success() {
            String::from_utf8(o.stdout).ok()
        } else {
            None
        }
    })
}

// ── find binary on PATH ──
pub fn which(program: &str) -> Option<String> {
    quick_command("where", &[program]).map(|s| s.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_command_spec_builder() {
        let spec = CommandSpec::new("node.exe")
            .arg("--version")
            .arg("--no-warnings")
            .env("NODE_ENV", "production")
            .timeout(Duration::from_secs(30));
        assert_eq!(spec.program, "node.exe");
        assert_eq!(spec.args, vec!["--version", "--no-warnings"]);
        assert_eq!(
            spec.env,
            vec![("NODE_ENV".to_string(), "production".to_string())]
        );
    }

    #[test]
    fn test_quick_command_cmd_exists() {
        let out = quick_command("cmd.exe", &["/c", "echo", "hello"]);
        assert!(out.is_some());
        assert!(out.unwrap().contains("hello"));
    }

    #[test]
    fn test_quick_command_nonexistent() {
        let out = quick_command("xyz_noexist_99999.exe", &[]);
        assert!(out.is_none());
    }

    #[test]
    fn test_which_known() {
        let path = which("cmd.exe");
        assert!(path.is_some());
    }

    #[test]
    fn test_which_nonexistent() {
        let path = which("nonexistent_binary_99999.exe");
        assert!(path.is_none());
    }

    #[tokio::test]
    async fn test_execute_simple_command() {
        let spec = CommandSpec::new("cmd.exe")
            .args(vec!["/c".into(), "echo".into(), "hello".into()])
            .timeout(Duration::from_secs(10));
        let result = execute_command(&spec, None).await;
        assert!(result.is_ok());
        let out = result.unwrap();
        assert!(
            out.stdout.contains("hello"),
            "stdout should contain 'hello', got: '{}'",
            out.stdout
        );
        assert!(out.success);
    }

    #[tokio::test]
    async fn test_execute_command_fails_gracefully() {
        let spec = CommandSpec::new("nonexistent_cmd_99999.exe").timeout(Duration::from_secs(5));
        let result = execute_command(&spec, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_execute_with_timeout() {
        let spec = CommandSpec::new("cmd.exe")
            .args(vec!["/c".into(), "ping -n 20 127.0.0.1 >nul".into()])
            .timeout(Duration::from_secs(1));
        let result = execute_command(&spec, None).await;
        assert!(result.is_err(), "should time out after 1s");
    }

    #[tokio::test]
    async fn test_execute_cancellation() {
        let flag = Arc::new(AtomicBool::new(false));
        let flag_clone = flag.clone();
        let spec = CommandSpec::new("cmd.exe")
            .args(vec!["/c".into(), "ping -n 10 127.0.0.1 >nul".into()])
            .timeout(Duration::from_secs(30));

        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            flag_clone.store(true, Ordering::SeqCst);
        });

        let result = execute_command(&spec, Some(flag)).await;
        assert!(result.is_err(), "should be cancelled");
    }
}
