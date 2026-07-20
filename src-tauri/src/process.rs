// Claude Code Manager - Command executor: safe process execution
use crate::error::{AppError, codes, AppResult};
use crate::logging::LogSanitizer;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

/// Specification for a command to execute
#[derive(Debug, Clone)]
pub struct CommandSpec {
    /// Path to the executable (must be absolute or resolved from PATH)
    pub program: String,
    /// Arguments passed to the executable (separate from program)
    pub args: Vec<String>,
    /// Optional working directory
    pub cwd: Option<PathBuf>,
    /// Environment variables (key, value) pairs
    pub env: Vec<(String, String)>,
    /// Timeout duration
    pub timeout: Duration,
    /// Whether to merge stderr into stdout
    pub merge_stderr: bool,
}

impl CommandSpec {
    pub fn new(program: impl Into<String>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            cwd: None,
            env: Vec::new(),
            timeout: Duration::from_secs(120),
            merge_stderr: true,
        }
    }

    pub fn arg(mut self, arg: impl Into<String>) -> Self {
        self.args.push(arg.into());
        self
    }

    pub fn args(mut self, args: Vec<String>) -> Self {
        self.args = args;
        self
    }

    pub fn cwd(mut self, path: impl Into<PathBuf>) -> Self {
        self.cwd = Some(path.into());
        self
    }

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
    pub exit_code: i32,
    pub success: bool,
}

/// Execute a command safely with timeout and cancellation
pub async fn execute_command(
    spec: &CommandSpec,
    cancel_flag: Option<Arc<AtomicBool>>,
) -> AppResult<ProcessOutput> {
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args)
        .kill_on_drop(true);

    if let Some(cwd) = &spec.cwd {
        cmd.current_dir(cwd);
    }

    for (key, value) in &spec.env {
        cmd.env(key, value);
    }

    // Start the process
    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(if spec.merge_stderr {
            std::process::Stdio::piped()
        } else {
            std::process::Stdio::piped()
        })
        .spawn()
        .map_err(|e| {
            AppError::new(
                codes::INSTALL_DOWNLOAD_FAILED,
                "进程启动失败",
                format!("无法启动进程 '{}'。", spec.program),
            )
            .with_details(e.to_string())
            .retryable()
        })?;

    // Wait with timeout, polling cancellation
    let result = timeout(spec.timeout, async {
        loop {
            // Check cancellation
            if let Some(ref cancel) = cancel_flag {
                if cancel.load(Ordering::SeqCst) {
                    let _ = child.kill().await;
                    return Err(AppError::new(
                        codes::INSTALL_CANCELLED,
                        "操作已取消",
                        "用户取消了操作。",
                    ));
                }
            }

            // Try to wait with a short timeout, polling
            tokio::select! {
                status = child.wait() => {
                    let exit_code = status.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
                    return Ok(ProcessOutput {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code,
                        success: exit_code == 0,
                    });
                }
                _ = tokio::time::sleep(Duration::from_millis(100)) => {}
            }
        }
    })
    .await;

    // Kill child if timeout occurred (child wasn't consumed by the timeout block)
    let _ = child.kill().await;

    match result {
        Ok(Ok(output)) => Ok(output),
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

/// Execute a command and return sanitized output
pub async fn execute_command_sanitized(
    spec: &CommandSpec,
    sanitizer: &LogSanitizer,
    cancel_flag: Option<Arc<AtomicBool>>,
) -> AppResult<ProcessOutput> {
    let result = execute_command(spec, cancel_flag).await?;
    Ok(ProcessOutput {
        stdout: sanitizer.sanitize_log(&result.stdout),
        stderr: sanitizer.sanitize_log(&result.stderr),
        exit_code: result.exit_code,
        success: result.success,
    })
}

/// Check if a command exists on PATH
pub fn command_exists(program: &str) -> bool {
    std::process::Command::new(if cfg!(windows) { "where" } else { "which" })
        .arg(program)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
