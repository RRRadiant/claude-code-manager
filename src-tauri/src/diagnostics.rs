// Claude Code Manager - Diagnostic system
use serde::Serialize;
use std::time::Instant;

/// Result of a single diagnostic check
#[derive(Debug, Clone, Serialize)]
pub struct DiagCheckResult {
    pub name: String,
    pub category: String,
    pub status: DiagStatus,
    pub message: String,
    pub details: Option<String>,
    pub fix_suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum DiagStatus {
    Pass,
    Warning,
    Error,
    Skipped,
}

/// Complete diagnostic report
#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticReport {
    pub timestamp: String,
    pub total_checks: usize,
    pub passed: usize,
    pub warnings: usize,
    pub errors: usize,
    pub checks: Vec<DiagCheckResult>,
    pub system_info: String,
}

/// Run all diagnostic checks
pub fn run_all_checks() -> DiagnosticReport {
    let start = Instant::now();
    let mut checks = Vec::new();
    let mut passed = 0;
    let mut warnings = 0;
    let mut errors = 0;

    // Environment checks
    checks.push(check_windows_version());
    checks.push(check_powershell());
    checks.push(check_git());
    checks.push(check_path());
    checks.push(check_claude_code_installed());
    checks.push(check_claude_code_version());
    checks.push(check_webview2());
    checks.push(check_permissions());

    // Aggregate results
    for check in &checks {
        match check.status {
            DiagStatus::Pass => passed += 1,
            DiagStatus::Warning => warnings += 1,
            DiagStatus::Error => errors += 1,
            DiagStatus::Skipped => {}
        }
    }

    let elapsed = start.elapsed();
    let total_checks = checks.len();

    DiagnosticReport {
        timestamp: chrono::Utc::now().to_rfc3339(),
        total_checks,
        passed,
        warnings,
        errors,
        checks,
        system_info: format!(
            "Claude Code Manager v{} | {} checks in {:?}",
            env!("CARGO_PKG_VERSION"),
            total_checks,
            elapsed
        ),
    }
}

fn check_windows_version() -> DiagCheckResult {
    let info = crate::environment::detect_windows();

    DiagCheckResult {
        name: "Windows 版本".to_string(),
        category: "environment".to_string(),
        status: DiagStatus::Pass,
        message: format!("系统: {}", info.display_version),
        details: Some(format!(
            "架构: {} | 管理权限: {}",
            info.display_architecture,
            if info.is_elevated { "是" } else { "否" }
        )),
        fix_suggestion: None,
    }
}

fn check_powershell() -> DiagCheckResult {
    let info = crate::environment::detect_powershell();
    DiagCheckResult {
        name: "PowerShell".to_string(),
        category: "environment".to_string(),
        status: if info.available {
            DiagStatus::Pass
        } else {
            DiagStatus::Error
        },
        message: if info.available {
            format!("PowerShell 可用 ({})", info.version.unwrap_or_default())
        } else {
            "PowerShell 不可用".to_string()
        },
        details: info.path.map(|p| p.to_string_lossy().to_string()),
        fix_suggestion: if !info.available {
            Some("PowerShell 是 Windows 自带组件，请检查系统完整性。".to_string())
        } else {
            None
        },
    }
}

fn check_git() -> DiagCheckResult {
    let info = crate::environment::detect_git();
    DiagCheckResult {
        name: "Git for Windows".to_string(),
        category: "environment".to_string(),
        status: if info.installed {
            DiagStatus::Pass
        } else {
            DiagStatus::Warning
        },
        message: if info.installed {
            format!("Git 已安装 ({})", info.version.unwrap_or_default())
        } else {
            "Git 未安装（可选）".to_string()
        },
        details: info.path.map(|p| p.to_string_lossy().to_string()),
        fix_suggestion: if !info.installed {
            Some("Claude Code 可以使用 Git 进行上下文管理。建议安装 git-scm.com。".to_string())
        } else {
            None
        },
    }
}

fn check_path() -> DiagCheckResult {
    let path_check = crate::environment::check_path();
    DiagCheckResult {
        name: "PATH 环境变量".to_string(),
        category: "environment".to_string(),
        status: if path_check.claude_bin_in_path {
            DiagStatus::Pass
        } else {
            DiagStatus::Warning
        },
        message: if path_check.claude_bin_in_path {
            "Claude Code 目录已在 PATH 中".to_string()
        } else {
            "Claude Code 目录可能不在 PATH 中".to_string()
        },
        details: path_check.claude_bin_path,
        fix_suggestion: if !path_check.claude_bin_in_path {
            Some("将 %USERPROFILE%\\.local\\bin 添加到用户 PATH 环境变量。".to_string())
        } else {
            None
        },
    }
}

fn check_claude_code_installed() -> DiagCheckResult {
    let info = crate::environment::detect_claude_code();
    let health_status = info.health.as_deref().unwrap_or("unknown");
    let status = if !info.installed {
        DiagStatus::Error
    } else if health_status == "healthy" {
        DiagStatus::Pass
    } else if health_status == "warning" {
        DiagStatus::Warning
    } else {
        DiagStatus::Warning
    };

    DiagCheckResult {
        name: "Claude Code 安装状态".to_string(),
        category: "claude_code".to_string(),
        status,
        message: if info.installed {
            let method = info.install_method.as_deref().unwrap_or("unknown");
            format!("Claude Code 已安装 (来源: {})", method)
        } else {
            "Claude Code 未安装".to_string()
        },
        details: Some(format!(
            "路径: {} | 健康: {}",
            info.path.as_deref().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            health_status,
        )),
        fix_suggestion: if !info.installed {
            Some("请前往「安装与环境」页面一键安装 Claude Code。".to_string())
        } else {
            None
        },
    }
}

fn check_claude_code_version() -> DiagCheckResult {
    let info = crate::environment::detect_claude_code();
    DiagCheckResult {
        name: "Claude Code 版本".to_string(),
        category: "claude_code".to_string(),
        status: if info.version.is_some() {
            DiagStatus::Pass
        } else if info.installed {
            DiagStatus::Warning
        } else {
            DiagStatus::Skipped
        },
        message: if let Some(ref v) = info.version {
            format!("Claude Code 版本: {}", v)
        } else if info.installed {
            "安装可能不完整（无法获取版本）".to_string()
        } else {
            "Claude Code 未安装，跳过版本检查".to_string()
        },
        details: info.path.as_ref().map(|p| p.to_string_lossy().to_string()),
        fix_suggestion: None,
    }
}

fn check_webview2() -> DiagCheckResult {
    let info = crate::environment::detect_webview2();
    DiagCheckResult {
        name: "WebView2 Runtime".to_string(),
        category: "environment".to_string(),
        status: if info.installed {
            DiagStatus::Pass
        } else {
            DiagStatus::Error
        },
        message: if info.installed {
            format!("WebView2 已安装 ({})", info.version.unwrap_or_default())
        } else {
            "WebView2 运行时未检测到".to_string()
        },
        details: None,
        fix_suggestion: if !info.installed {
            Some("WebView2 是应用必需的运行时，请从 Microsoft 官网安装。".to_string())
        } else {
            None
        },
    }
}

fn check_permissions() -> DiagCheckResult {
    let elevated = crate::security::is_elevated();
    DiagCheckResult {
        name: "用户权限".to_string(),
        category: "environment".to_string(),
        status: DiagStatus::Pass,
        message: if elevated {
            "管理员权限（部分操作无需管理员）".to_string()
        } else {
            "用户权限（正常）".to_string()
        },
        details: Some(
            "Claude Code Manager 大多数功能不需要管理员权限。".to_string(),
        ),
        fix_suggestion: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diagnostics_no_panic() {
        let report = run_all_checks();
        assert!(report.total_checks > 0);
        // Some checks may pass or warn, but it shouldn't crash
        println!("Diagnostics: {}/{} passed", report.passed, report.total_checks);
    }
}
