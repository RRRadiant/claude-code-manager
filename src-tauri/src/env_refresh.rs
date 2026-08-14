// Claude Code Manager — Windows environment refresh utility
//
// Reads PATH from the Windows registry (user + system), merges with
// the current process PATH, and provides the result for subprocesses.
//
// On Windows, a running process inherits its environment block at
// creation time. Installers (MSI, setx, npm -g) modify the *registry*
// copy. This module bridges that gap so the app can use freshly
// installed tools without a restart.

use serde::Serialize;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
use winreg::RegKey;

/// Result of refreshing PATH from the registry
#[derive(Debug, Clone, Serialize)]
pub struct RefreshedPath {
    /// Merged user + system PATH ready for subprocesses
    pub merged_path: String,
    /// Just the user-level PATH component
    pub user_path: String,
    /// Just the system-level PATH component
    pub system_path: String,
    /// The original process PATH (before refresh)
    pub process_path: String,
    /// Directories in `merged_path` that were NOT in `process_path`
    pub added_directories: Vec<String>,
    /// Whether the refresh changed anything meaningful
    pub changed: bool,
}

/// Read the *user* PATH from HKCU\Environment
pub fn read_user_path_registry() -> Option<String> {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(r"Environment", KEY_READ)
        .ok()
        .and_then(|k| k.get_value::<String, _>("PATH").ok())
        .map(expand_environment_variables)
}

/// Read the *system* PATH from HKLM\...\Session Manager\Environment
pub fn read_system_path_registry() -> Option<String> {
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
            KEY_READ,
        )
        .ok()
        .and_then(|k| k.get_value::<String, _>("PATH").ok())
        .map(expand_environment_variables)
}

/// Expand %VAR% references in a string using Windows `ExpandEnvironmentStringsW`
fn expand_environment_variables(input: String) -> String {
    // Use the Win32 API to expand %SystemRoot%, %USERPROFILE%, etc.
    // SAFETY: ExpandEnvironmentStringsW is safe to call with a valid input string.
    unsafe {
        let wide: Vec<u16> = input.encode_utf16().chain(std::iter::once(0)).collect();
        let mut buf = vec![0u16; 32768]; // max env var size
        let len = windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW(
            wide.as_ptr(),
            buf.as_mut_ptr(),
            buf.len() as u32,
        );
        if len > 0 && len <= buf.len() as u32 {
            String::from_utf16_lossy(&buf[..len as usize - 1])
        } else {
            input
        }
    }
}

/// Get the current process PATH
fn get_process_path() -> String {
    std::env::var("PATH").unwrap_or_default()
}

/// Merge two PATH strings, deduplicating entries (first occurrence wins).
/// Preserves order within each source. The `base` entries come first.
fn merge_path_strings(base: &str, overlay: &str) -> (String, Vec<String>) {
    let mut seen = std::collections::HashSet::new();
    let mut result: Vec<String> = Vec::new();
    let mut added: Vec<String> = Vec::new();

    // Normalise a path for dedup comparison (lowercase, trim trailing backslash)
    let normalise = |p: &str| -> String {
        p.trim()
            .trim_end_matches('\\')
            .trim_end_matches('/')
            .to_lowercase()
    };

    // Add base entries
    for entry in base.split(';') {
        let trimmed = entry.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        let key = normalise(&trimmed);
        if seen.insert(key) {
            result.push(trimmed);
        }
    }

    // Add overlay entries, tracking which are new
    for entry in overlay.split(';') {
        let trimmed = entry.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        let key = normalise(&trimmed);
        if seen.insert(key) {
            result.push(trimmed.clone());
            added.push(trimmed);
        }
    }

    (result.join(";"), added)
}

/// Perform a full PATH refresh: read registry, merge, resolve.
///
/// Returns a `RefreshedPath` containing the merged result and a delta
/// of what changed compared to the process-level PATH.
pub fn refresh_windows_path() -> RefreshedPath {
    let process_path = get_process_path();
    let user_path = read_user_path_registry().unwrap_or_default();
    let system_path = read_system_path_registry().unwrap_or_default();

    // Priority: system PATH first (base), then user PATH (overlay),
    // then current process PATH (highest priority overlay).
    // This matches how Windows resolves PATH at login time.
    let (merged, added) = merge_path_strings(&system_path, &user_path);
    let (merged, added_more) = merge_path_strings(&merged, &process_path);
    let mut all_added = added;
    all_added.extend(added_more);

    // Dedup added list
    all_added.sort();
    all_added.dedup();

    let changed = all_added.iter().any(|p| !process_path.contains(p));

    RefreshedPath {
        merged_path: merged,
        user_path,
        system_path,
        process_path,
        added_directories: all_added,
        changed,
    }
}

/// Build a complete environment block for a subprocess that includes
/// the refreshed PATH. Returns key-value pairs suitable for
/// `std::process::Command::envs()` or `CommandSpec::env()`.
// Only exercised by unit tests today; kept as part of the PATH-refresh toolkit.
#[allow(dead_code)]
pub fn build_refreshed_env() -> Vec<(String, String)> {
    let refreshed = refresh_windows_path();
    vec![("PATH".to_string(), refreshed.merged_path)]
}

/// Check whether a specific directory path contains a given executable.
// Only exercised by unit tests today; kept as part of the PATH-refresh toolkit.
#[allow(dead_code)]
pub fn dir_contains_exe(dir: &str, exe_name: &str) -> bool {
    let path = std::path::Path::new(dir).join(exe_name);
    path.exists()
}

/// Execute a command and return its stdout, using a **fresh** PATH.
/// This is the key function that lets us detect newly installed tools.
pub fn detect_with_fresh_path(program: &str, arg: &str) -> Option<String> {
    let refreshed = refresh_windows_path();
    let mut cmd = std::process::Command::new(program);
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd.arg(arg);
    cmd.env("PATH", &refreshed.merged_path);

    cmd.output().ok().and_then(|o| {
        if o.status.success() {
            String::from_utf8(o.stdout)
                .ok()
                .map(|s| s.trim().to_string())
        } else {
            None
        }
    })
}

/// Execute a command using the refreshed PATH and return stdout.
/// Convenience wrapper for commands that take no arguments (e.g. `where node`).
pub fn where_on_refreshed_path(program: &str) -> Option<String> {
    let refreshed = refresh_windows_path();
    let mut cmd = std::process::Command::new("where");
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000);
    cmd.arg(program);
    cmd.env("PATH", &refreshed.merged_path);

    cmd.output().ok().and_then(|o| {
        if o.status.success() {
            String::from_utf8(o.stdout)
                .ok()
                .map(|s| s.lines().next().unwrap_or("").trim().to_string())
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_user_path_no_panic() {
        let path = read_user_path_registry();
        // May or may not have a user PATH — just don't panic
        println!("User PATH: {:?}", path);
    }

    #[test]
    fn test_read_system_path_no_panic() {
        let path = read_system_path_registry();
        assert!(path.is_some(), "System PATH should always exist on Windows");
        println!(
            "System PATH length: {}",
            path.as_ref().map(|s| s.len()).unwrap_or(0)
        );
    }

    #[test]
    fn test_refresh_windows_path() {
        let r = refresh_windows_path();
        assert!(!r.merged_path.is_empty(), "merged PATH should not be empty");
        assert!(!r.system_path.is_empty(), "system PATH should not be empty");
        println!(
            "Merged PATH length: {}, entries: {}",
            r.merged_path.len(),
            r.merged_path.split(';').count()
        );
    }

    #[test]
    fn test_refreshed_env() {
        let env = build_refreshed_env();
        assert_eq!(env.len(), 1);
        assert_eq!(env[0].0, "PATH");
        assert!(!env[0].1.is_empty());
    }

    #[test]
    fn test_merge_path_strings() {
        let (merged, _added) = merge_path_strings(
            r"C:\Windows;C:\Windows\System32",
            r"C:\Users\test\bin;C:\Windows",
        );
        assert!(merged.contains(r"C:\Windows"));
        assert!(merged.contains(r"C:\Users\test\bin"));
        // Verify dedup: "C:\Windows" should appear only once
        let entries: Vec<&str> = merged.split(';').collect();
        let count = entries
            .iter()
            .filter(|e| e.trim().eq_ignore_ascii_case(r"C:\Windows"))
            .count();
        assert_eq!(
            count, 1,
            "'C:\\Windows' should be deduplicated, got entries: {:?}",
            entries
        );
    }

    #[test]
    fn test_merge_path_strings_empty() {
        let (merged, added) = merge_path_strings("", "");
        assert!(merged.is_empty());
        assert!(added.is_empty());
    }

    #[test]
    fn test_dir_contains_exe() {
        assert!(dir_contains_exe(r"C:\Windows\System32", "cmd.exe"));
        assert!(!dir_contains_exe(
            r"C:\Windows\System32",
            "nonexistent_xyz_999.exe"
        ));
    }

    #[test]
    fn test_expand_variables() {
        let result = expand_environment_variables("%SystemRoot%\\System32".to_string());
        assert!(!result.contains('%'), "should expand %SystemRoot%");
        assert!(result.contains("\\System32"), "should keep literal parts");
    }
}
