// Claude Code Manager - Security: input validation, path sanitization, IPC guard
use crate::error::{AppError, codes};
use std::path::{Path, PathBuf};

/// Validate and normalize a file path, preventing path traversal
pub fn sanitize_path(input: &str, allowed_roots: &[&Path]) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(input);

    // Reject empty paths
    if input.is_empty() {
        return Err(AppError::new(
            codes::SECURITY_INVALID_INPUT,
            "路径无效",
            "文件路径不能为空。",
        ));
    }

    // Reject paths containing null bytes
    if input.contains('\0') {
        return Err(AppError::new(
            codes::SECURITY_INVALID_INPUT,
            "路径无效",
            "文件路径包含无效字符。",
        ));
    }

    // Canonicalize if path exists; otherwise resolve relative to current dir
    let canonical = if path.exists() {
        std::fs::canonicalize(&path)
            .map_err(|_| {
                AppError::new(
                    codes::SECURITY_PATH_TRAVERSAL,
                    "路径无效",
                    "无法解析文件路径。",
                )
            })?
    } else {
        // For non-existent paths, resolve manually to prevent traversal
        let resolved = resolve_safe(&path);
        if let Some(parent) = resolved.parent() {
            if !parent.exists() {
                return Err(AppError::new(
                    codes::SECURITY_PATH_TRAVERSAL,
                    "父目录不存在",
                    "目标文件的父目录不存在。",
                ));
            }
        }
        resolved
    };

    // Verify the resolved path is within allowed roots
    if !allowed_roots.is_empty() {
        let in_allowed = allowed_roots.iter().any(|root| {
            canonical.starts_with(root)
        });
        if !in_allowed {
            return Err(AppError::new(
                codes::SECURITY_PATH_TRAVERSAL,
                "路径访问被拒绝",
                "指定的路径超出了允许的访问范围。",
            ));
        }
    }

    Ok(canonical)
}

/// Safely resolve a path without following symlinks (prevents TOCTOU)
pub fn resolve_safe(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Prefix(prefix) => {
                result.push(prefix.as_os_str());
            }
            std::path::Component::RootDir => {
                result.push(std::path::Component::RootDir);
            }
            std::path::Component::ParentDir => {
                result.pop();
            }
            std::path::Component::Normal(part) => {
                result.push(part);
            }
            _ => {}
        }
    }
    result
}

/// Validate that a string is safe (no shell metacharacters)
pub fn validate_shell_arg(input: &str) -> Result<&str, AppError> {
    let dangerous = ['&', '|', ';', '$', '`', '\'', '"', '(', ')', '{', '}', '<', '>', '\n', '\r'];

    if input.is_empty() {
        return Err(AppError::new(
            codes::SECURITY_INVALID_INPUT,
            "输入无效",
            "参数不能为空。",
        ));
    }

    if input.len() > 4096 {
        return Err(AppError::new(
            codes::SECURITY_INVALID_INPUT,
            "输入过长",
            "参数长度超过限制（4096 字符）。",
        ));
    }

    if let Some(c) = input.chars().find(|ch| dangerous.contains(ch)) {
        return Err(AppError::new(
            codes::SECURITY_INVALID_INPUT,
            "输入包含危险字符",
            format!("参数包含不允许的字符 '{}'。", c),
        ));
    }

    Ok(input)
}

/// Validate an MCP command (no relative paths, no shell injection)
pub fn validate_mcp_command(command: &str) -> Result<(), AppError> {
    let path = Path::new(command);

    // Must not be a relative path with traversal
    if path.components().any(|c| c == std::path::Component::ParentDir) {
        return Err(AppError::new(
            codes::SECURITY_PATH_TRAVERSAL,
            "命令路径无效",
            "MCP 命令不能包含相对路径。",
        ));
    }

    // Must not contain shell metacharacters
    validate_shell_arg(command)?;

    Ok(())
}

/// Check if the application has admin/elevated privileges
pub fn is_elevated() -> bool {
    #[cfg(windows)]
    {
        // Use shell command to check elevation
        // This avoids direct Win32 API calls
        std::process::Command::new("net")
            .args(["session"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[cfg(not(windows))]
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_path_normal() {
        // Use an existing directory path to test canonicalization
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        let result = sanitize_path(&home, &[]);
        assert!(result.is_ok());
    }

    #[test]
    fn test_reject_null_bytes() {
        let result = sanitize_path("C:\\Users\\test\\.claude\\settings.json\0", &[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_reject_empty_path() {
        let result = sanitize_path("", &[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_shell_arg_normal() {
        assert!(validate_shell_arg("npx").is_ok());
        assert!(validate_shell_arg("npm").is_ok());
    }

    #[test]
    fn test_reject_shell_metacharacters() {
        assert!(validate_shell_arg("npx; rm -rf /").is_err());
        assert!(validate_shell_arg("$(malicious)").is_err());
        assert!(validate_shell_arg("`command`").is_err());
        assert!(validate_shell_arg("arg | other").is_err());
    }

    #[test]
    fn test_reject_empty_shell_arg() {
        assert!(validate_shell_arg("").is_err());
    }

    #[test]
    fn test_validate_mcp_command_valid() {
        assert!(validate_mcp_command("npx").is_ok());
        assert!(validate_mcp_command("C:\\Program Files\\node\\node.exe").is_ok());
    }

    #[test]
    fn test_validate_mcp_command_traversal() {
        assert!(validate_mcp_command("../malicious").is_err());
    }

    #[test]
    fn test_resolve_safe() {
        let path = Path::new("C:\\Users\\test\\..\\test2\\file.txt");
        let resolved = resolve_safe(path);
        assert_eq!(resolved, PathBuf::from("C:\\Users\\test2\\file.txt"));
    }
}
