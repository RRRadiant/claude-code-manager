// Claude Code Manager - Security: input validation, path sanitization, IPC guard
use crate::error::{codes, AppError};
use std::path::{Component, Path, PathBuf};

/// Validate and normalize a file path, preventing path traversal.
///
/// Resolution strategy (Windows-aware):
/// 1. Resolve relative inputs against the current working directory.
/// 2. Walk upward to the deepest *existing* ancestor directory.
/// 3. `canonicalize` that ancestor (resolves junctions/symlinks, `..`, case).
/// 4. Lexically append the remaining (non-existent) segments.
/// 5. Compare the result against `allowed_roots` (directory containment) and
///    `allowed_files` (exact file match) using case-insensitive comparison.
pub fn sanitize_path(
    input: &str,
    allowed_roots: &[&Path],
    allowed_files: &[&Path],
) -> Result<PathBuf, AppError> {
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

    let raw = PathBuf::from(input);

    // Resolve relative paths against cwd so project-scope sources
    // (e.g. ".mcp.json", ".claude\\settings.json") compare against absolute roots.
    let path = if raw.is_absolute() {
        raw
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(&raw))
            .unwrap_or(raw)
    };

    let canonical = canonicalize_deepest(&path)?;

    // Verify the resolved path is within allowed roots or is an allowed file.
    let has_restriction = !allowed_roots.is_empty() || !allowed_files.is_empty();
    if has_restriction {
        let in_allowed_root = allowed_roots.iter().any(|root| {
            let root_canon = canonicalize_loose(root);
            is_within(&canonical, &root_canon)
        });
        let is_allowed_file = allowed_files.iter().any(|file| {
            let file_canon = canonicalize_loose(file);
            is_same_path(&canonical, &file_canon)
        });
        if !in_allowed_root && !is_allowed_file {
            return Err(AppError::new(
                codes::SECURITY_PATH_TRAVERSAL,
                "路径访问被拒绝",
                "指定的路径超出了允许的访问范围。",
            ));
        }
    }

    Ok(canonical)
}

/// Find the deepest existing ancestor directory, canonicalize it, then lexically
/// append the remaining non-existent segments.
fn canonicalize_deepest(path: &Path) -> Result<PathBuf, AppError> {
    // Own the "leaf" components (Normal / CurDir / ParentDir) so we can mutate
    // `existing` below without fighting the borrow checker over `Component`.
    let mut segments: Vec<std::ffi::OsString> = path
        .components()
        .filter_map(|c| match c {
            Component::Normal(p) => Some(p.to_os_string()),
            Component::ParentDir => Some(std::ffi::OsString::from("..")),
            Component::CurDir => Some(std::ffi::OsString::from(".")),
            _ => None,
        })
        .collect();

    // Walk upward to the deepest existing directory, remembering the segments
    // we trimmed off (in reverse order).
    let mut existing = path.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    while !existing.is_dir() {
        match segments.pop() {
            Some(seg) => {
                tail.push(seg);
                existing.pop();
            }
            None => break,
        }
    }

    let base = std::fs::canonicalize(&existing).map_err(|_| {
        AppError::new(
            codes::SECURITY_PATH_TRAVERSAL,
            "路径无效",
            "无法解析文件路径的祖先目录。",
        )
    })?;

    // Lexically re-append the trimmed tail. ParentDir segments here are purely
    // defensive: `..` inside the existing portion is already resolved by
    // canonicalize, and any `..` that would escape the canonical base is rejected.
    let mut result = base;
    for seg in tail.into_iter().rev() {
        let s = seg.to_string_lossy();
        if s == ".." {
            if !result.pop() {
                return Err(AppError::new(
                    codes::SECURITY_PATH_TRAVERSAL,
                    "路径访问被拒绝",
                    "路径包含过多的上级目录引用。",
                ));
            }
        } else if s != "." {
            result.push(seg);
        }
    }
    Ok(result)
}

/// Canonicalize when possible, otherwise fall back to the literal path.
fn canonicalize_loose(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Case-insensitive (Windows) normalized string form of a path.
///
/// `std::fs::canonicalize` may return verbatim paths prefixed with `\\?\`
/// (or `\\.\` for devices) on Windows; strip those so canonicalized and
/// literal paths compare equal.
fn normalized(path: &Path) -> String {
    let s = path.to_string_lossy();
    let s = s
        .strip_prefix(r"\\?\")
        .or_else(|| s.strip_prefix(r"\\.\"))
        .unwrap_or(&s);
    s.trim_end_matches(['\\', '/']).to_lowercase()
}

/// Case-insensitive containment check: `path` is `root` or a descendant of it.
fn is_within(path: &Path, root: &Path) -> bool {
    let p = normalized(path);
    let r = normalized(root);
    p == r || p.starts_with(&format!("{r}\\"))
}

/// Case-insensitive equality check between two paths.
fn is_same_path(a: &Path, b: &Path) -> bool {
    normalized(a) == normalized(b)
}

/// Validate that a string is safe (no shell metacharacters)
pub fn validate_shell_arg(input: &str) -> Result<&str, AppError> {
    let dangerous = [
        '&', '|', ';', '$', '`', '\'', '"', '(', ')', '{', '}', '<', '>', '\n', '\r',
    ];

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
            format!("参数包含不允许的字符 '{c}'。"),
        ));
    }

    Ok(input)
}

/// Validate an MCP command against a strict **allowlist** of bare executable names.
///
/// This replaces the previous blacklist (which `powershell -EncodedCommand <b64>`
/// could bypass). Only well-known package runners / runtimes are permitted, and
/// the command must be a single bare file name: no path separators, no drive
/// letter, no parent traversal. The allowlist is matched on the file stem
/// (so `npx`, `npx.exe`, `npx.cmd` all resolve to `npx`), case-insensitively.
pub fn validate_mcp_command(command: &str) -> Result<(), AppError> {
    const ALLOWED: &[&str] = &[
        "npx", "npm", "node", "uvx", "uv", "python", "python3", "py", "bun", "deno", "docker",
        "cargo", "git", "claude", "go",
    ];

    if command.is_empty() {
        return Err(AppError::new(
            codes::SECURITY_INVALID_INPUT,
            "命令路径无效",
            "MCP 命令不能为空。",
        ));
    }

    // Reject anything that is not a single bare file-name component. Paths with
    // separators, drive prefixes or `..` are all rejected outright.
    let path = Path::new(command);
    let mut components = path.components();
    let sole = components.next();
    if !matches!(sole, Some(Component::Normal(_))) || components.next().is_some() {
        return Err(AppError::new(
            codes::SECURITY_PATH_TRAVERSAL,
            "命令路径无效",
            "MCP 命令必须是裸可执行文件名（不允许路径或盘符）。",
        ));
    }

    // Defensive: even if `components()` normalises odd inputs, reject any
    // explicit separator / drive marker in the raw string.
    if command.contains('/') || command.contains('\\') || command.contains(':') {
        return Err(AppError::new(
            codes::SECURITY_PATH_TRAVERSAL,
            "命令路径无效",
            "MCP 命令不能包含路径分隔符或盘符。",
        ));
    }

    let stem = path.file_stem().map_or_else(
        || command.to_lowercase(),
        |s| s.to_string_lossy().to_lowercase(),
    );

    if ALLOWED.iter().any(|a| a.eq_ignore_ascii_case(&stem)) {
        Ok(())
    } else {
        Err(AppError::new(
            codes::SECURITY_INVALID_INPUT,
            "命令未授权",
            format!("MCP 命令 '{command}' 不在允许列表内。"),
        ))
    }
}

/// Build the list of directories where MCP config files may legitimately live.
/// Used by `sanitize_path` to confine MCP write/delete operations.
///
/// Directories (whole subtrees):
/// - `%USERPROFILE%\.claude` (user config)
/// - `%APPDATA%\Claude` (Claude Desktop)
/// - current working directory + `.claude` (project scope)
pub fn mcp_allowed_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(home) = std::env::var("USERPROFILE") {
        roots.push(PathBuf::from(&home).join(".claude"));
    }

    if let Ok(appdata) = std::env::var("APPDATA") {
        roots.push(PathBuf::from(&appdata).join("Claude"));
    }

    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd.join(".claude"));
    }

    roots
}

/// Build the list of individual files (not whole directories) that may be
/// written/deleted. Root-level single-file configs cannot be covered by a
/// directory root without also allowing the whole home/cwd directory, so they
/// are allow-listed here instead.
pub fn mcp_allowed_files() -> Vec<PathBuf> {
    let mut files = Vec::new();

    if let Ok(home) = std::env::var("USERPROFILE") {
        files.push(PathBuf::from(&home).join(".claude.json"));
        files.push(PathBuf::from(&home).join(".mcp.json"));
    }

    if let Ok(cwd) = std::env::current_dir() {
        files.push(cwd.join(".mcp.json"));
        files.push(cwd.join(".claude.json"));
    }

    files
}

/// Check if the application has admin/elevated privileges
pub fn is_elevated() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    std::process::Command::new("net")
        .args(["session"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .is_ok_and(|o| o.status.success())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_path_normal() {
        let home =
            std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        let result = sanitize_path(&home, &[], &[]);
        assert!(result.is_ok());
    }

    #[test]
    fn test_reject_null_bytes() {
        let result = sanitize_path("C:\\Users\\test\\.claude\\settings.json\0", &[], &[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_reject_empty_path() {
        let result = sanitize_path("", &[], &[]);
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
        assert!(validate_mcp_command("node.exe").is_ok());
        assert!(validate_mcp_command("npm.cmd").is_ok());
    }

    #[test]
    fn test_validate_mcp_command_whitelist_rejects_paths() {
        // Absolute paths are now rejected by the whitelist.
        assert!(validate_mcp_command("C:\\Program Files\\node\\node.exe").is_err());
        assert!(validate_mcp_command("../malicious").is_err());
        assert!(validate_mcp_command("..\\malicious").is_err());
    }

    #[test]
    fn test_validate_mcp_command_whitelist_rejects_unknown() {
        assert!(validate_mcp_command("powershell").is_err());
        assert!(validate_mcp_command("cmd").is_err());
        assert!(validate_mcp_command("bash").is_err());
        assert!(validate_mcp_command("python.exe").is_ok());
        assert!(validate_mcp_command("python3").is_ok());
        assert!(validate_mcp_command("cargo").is_ok());
        assert!(validate_mcp_command("go").is_ok());
        assert!(validate_mcp_command("uvx").is_ok());
    }

    #[test]
    fn test_validate_mcp_command_rejects_encoded_command() {
        // The classic bypass vector: powershell -EncodedCommand must be refused.
        assert!(validate_mcp_command("powershell").is_err());
        assert!(validate_mcp_command("pOwErShElL.exe").is_err());
    }

    // ── More sanitize_path edge cases ────────────────────────────

    #[test]
    fn test_sanitize_path_within_allowed_root() {
        let home =
            std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        let root = Path::new(&home);
        let canonical_root = std::fs::canonicalize(&home).unwrap_or_else(|_| root.to_path_buf());
        let result = sanitize_path(&home, &[&canonical_root], &[]);
        assert!(result.is_ok(), "path within root should be allowed");
    }

    #[test]
    fn test_sanitize_path_outside_allowed_roots() {
        let root = Path::new("C:\\Windows");
        let result = sanitize_path("C:\\Program Files\\test.txt", &[root], &[]);
        assert!(result.is_err(), "path outside root should be rejected");
        if let Err(ref e) = result {
            assert_eq!(e.code, codes::SECURITY_PATH_TRAVERSAL);
        }
    }

    #[test]
    fn test_sanitize_path_multiple_roots_second_matches() {
        let roots = &[Path::new("C:\\Users"), Path::new("C:\\Windows")];
        let result = sanitize_path("C:\\Users\\Public\\test.txt", roots, &[]);
        assert!(result.is_ok(), "path matching any allowed root should pass");
    }

    #[test]
    fn test_sanitize_path_multiple_roots_none_match() {
        let roots = &[Path::new("C:\\Users"), Path::new("C:\\ProgramData")];
        let result = sanitize_path("D:\\data\\file.txt", roots, &[]);
        assert!(result.is_err(), "path outside all roots should be rejected");
    }

    #[test]
    fn test_sanitize_path_empty_allowed_roots() {
        let home =
            std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        let result = sanitize_path(&home, &[], &[]);
        assert!(result.is_ok());
    }

    #[test]
    fn test_sanitize_path_non_existent_valid_parent() {
        let result = sanitize_path("C:\\Windows\\_test_tmp_file_12345.tmp", &[], &[]);
        assert!(
            result.is_ok(),
            "non-existent file with valid parent should resolve"
        );
    }

    #[test]
    fn test_sanitize_path_non_existent_under_existing_ancestor() {
        // New algorithm: deepest existing ancestor (C:\) is canonicalized and the
        // remaining non-existent segments are lexically appended.
        let result = sanitize_path("C:\\_nonexistent_dir_98765\\file.txt", &[], &[]);
        assert!(result.is_ok(), "deepest-ancestor resolution should succeed");
    }

    #[test]
    fn test_sanitize_path_traversal_escape_root() {
        let home =
            std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        let root = Path::new(&home);
        let canonical_root = std::fs::canonicalize(&home).unwrap_or_else(|_| root.to_path_buf());
        let result = sanitize_path(&home, &[&canonical_root], &[]);
        assert!(
            result.is_ok(),
            "traversal that stays within root should pass"
        );
    }

    #[test]
    fn test_sanitize_path_traversal_outside_root() {
        let root = Path::new("C:\\Windows\\System32");
        // ..\\.. lands in C:\ which is outside C:\Windows\System32
        let result = sanitize_path("C:\\Windows\\System32\\..\\..\\Program Files", &[root], &[]);
        assert!(
            result.is_err(),
            "traversal escaping root should be rejected"
        );
    }

    #[test]
    fn test_sanitize_path_allowed_file() {
        // A root-level file must only be allowed via the file allow-list, not a
        // dir root. Use a fresh temp dir so the test is environment-independent
        // (USERPROFILE on CI runners canonicalizes to verbatim `\\?\` paths).
        let dir = std::env::temp_dir().join(format!("ccm-sec-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("config.json");
        let result = sanitize_path(&file.to_string_lossy(), &[], &[file.as_path()]);
        std::fs::remove_dir_all(&dir).ok();
        assert!(
            result.is_ok(),
            "allow-listed file should pass: {result:?}"
        );
    }

    #[test]
    fn test_sanitize_path_file_not_allowed() {
        let home =
            std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        let file = PathBuf::from(&home).join(".claude.json");
        // A non-matching root with empty file list => rejected.
        let root = Path::new("C:\\Windows");
        let result = sanitize_path(&file.to_string_lossy(), &[root], &[]);
        assert!(
            result.is_err(),
            "file outside roots and file list should be rejected"
        );
    }

    // ── validate_shell_arg edge cases ────────────────────────────

    #[test]
    fn test_validate_shell_arg_length_boundary() {
        let len_4096 = "a".repeat(4096);
        assert!(
            validate_shell_arg(&len_4096).is_ok(),
            "4096 should be within limit"
        );
    }

    #[test]
    fn test_validate_shell_arg_max_valid_length() {
        let len_4095 = "a".repeat(4095);
        assert!(
            validate_shell_arg(&len_4095).is_ok(),
            "4095 chars should be within limit"
        );
    }

    #[test]
    fn test_validate_shell_arg_each_dangerous_char() {
        let dangerous = [
            '&', '|', ';', '$', '`', '\'', '"', '(', ')', '{', '}', '<', '>',
        ];
        for ch in &dangerous {
            let input = format!("arg{}val", ch);
            assert!(
                validate_shell_arg(&input).is_err(),
                "should reject dangerous character '{}'",
                ch,
            );
        }
    }

    #[test]
    fn test_validate_shell_arg_newline() {
        assert!(validate_shell_arg("arg\ncontent").is_err());
    }

    #[test]
    fn test_validate_shell_arg_carriage_return() {
        assert!(validate_shell_arg("arg\rcontent").is_err());
    }

    #[test]
    fn test_validate_shell_arg_unicode_safe() {
        assert!(validate_shell_arg("npx-很好").is_ok());
    }

    #[test]
    fn test_validate_shell_arg_numbers_and_symbols() {
        assert!(validate_shell_arg("--flag=value").is_ok());
        assert!(validate_shell_arg("path/to/file@1.0").is_ok());
        assert!(validate_shell_arg("C:\\Program Files\\app.exe").is_ok());
    }

    // ── validate_mcp_command edge cases ─────────────────────────

    #[test]
    fn test_validate_mcp_command_control_chars() {
        // Tab is not a path separator and the stem becomes the whole weird string,
        // which is not in the allowlist — so it must be rejected now.
        let result = validate_mcp_command("C:\\test\tmalicious");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_mcp_command_shell_chars() {
        assert!(validate_mcp_command("npx; echo hacked").is_err());
        assert!(validate_mcp_command("$(whoami)").is_err());
        assert!(validate_mcp_command("`id`").is_err());
    }

    #[test]
    fn test_validate_mcp_command_absolute_path_rejected() {
        assert!(validate_mcp_command("C:\\Program Files\\node\\node.exe").is_err());
        assert!(validate_mcp_command("C:\\tools\\claude.exe").is_err());
    }

    #[test]
    fn test_validate_mcp_command_simple_name() {
        assert!(validate_mcp_command("npx").is_ok());
        assert!(validate_mcp_command("npm").is_ok());
        assert!(validate_mcp_command("claude").is_ok());
        assert!(validate_mcp_command("CLAUDE").is_ok());
    }

    #[test]
    fn test_validate_mcp_command_empty_string() {
        assert!(validate_mcp_command("").is_err());
    }

    // ── is_elevated edge cases ──────────────────────────────────

    #[test]
    fn test_is_elevated_no_panic() {
        let elevated = is_elevated();
        let _ = elevated;
    }

    // ── Combination / integration-style tests ────────────────────

    #[test]
    fn test_validate_shell_arg_then_validate_mcp() {
        let valid = ["npx", "npm", "node", "claude"];
        for cmd in &valid {
            assert!(
                validate_shell_arg(cmd).is_ok(),
                "shell arg should accept '{}'",
                cmd
            );
            assert!(
                validate_mcp_command(cmd).is_ok(),
                "mcp cmd should accept '{}'",
                cmd
            );
        }
    }

    #[test]
    fn test_sanitize_path_with_null_byte_in_middle() {
        let result = sanitize_path("C:\\Users\\test\0\\config.json", &[], &[]);
        assert!(result.is_err(), "null byte in path should be rejected");
    }
}
