//! Argument policy for MCP stdio servers.
//!
//! The executable allowlist is not enough: `node`, `python`, `uv`, `docker`,
//! and `git` are legitimate MCP launchers and also one-shot code runners.
//! Spawn always receives a structured argv — one string per element, never a
//! shell line — and each runtime below only accepts a known-safe shape.
//! Unknown flags fail closed. Blocking a few famous flags is not the policy:
//! `uv run -- cmd`, `git --upload-pack=<cmd>`, `python -m timeit`, and
//! `docker run … env -S "sh -c …"` all slip past a denylist.

use super::{validate_mcp_command, validate_shell_arg};
use crate::error::{codes, AppError};

const MAX_MCP_ARGS: usize = 64;

/// Validate a stdio MCP launch: allowlisted bare command, per-argument
/// checks, and an interpreter policy that requires a script or package.
pub fn validate_mcp_invocation(command: &str, args: &[String]) -> Result<(), AppError> {
    validate_mcp_command(command)?;
    if args.len() > MAX_MCP_ARGS {
        return Err(denied(format!("MCP 参数不能超过 {MAX_MCP_ARGS} 个。")));
    }
    for arg in args {
        validate_shell_arg(arg)?;
    }
    apply_policy(&command_stem(command), args)
}

fn command_stem(command: &str) -> String {
    std::path::Path::new(command)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| command.to_lowercase())
}

fn apply_policy(stem: &str, args: &[String]) -> Result<(), AppError> {
    match stem {
        "node" => validate_node(args),
        "python" | "python3" | "pythonw" => validate_python(args),
        "py" => validate_py(args),
        "bun" => validate_bun(args),
        "deno" => validate_deno(args),
        "docker" => validate_docker(args),
        "cargo" => validate_cargo(args),
        "go" => validate_go(args),
        "npx" => validate_npx(args),
        "npm" => validate_npm(args),
        "uvx" => validate_uvx(args),
        "uv" => validate_uv(args),
        "git" => validate_git(args),
        _ => Ok(()),
    }
}

fn denied(message: impl Into<String>) -> AppError {
    AppError::new(codes::SECURITY_INVALID_INPUT, "命令未授权", message)
}

fn flag_name(arg: &str) -> &str {
    if let Some((name, _)) = arg.split_once('=') {
        if name.starts_with("--") {
            return name;
        }
    }
    arg
}

fn is_long_flag(arg: &str) -> bool {
    arg.starts_with('-') && arg != "-"
}

/// A path the runtime will open as a script, not a bare executable name.
fn is_script_path(arg: &str) -> bool {
    !arg.is_empty()
        && arg != "-"
        && !arg.starts_with('-')
        && !arg.contains("://")
        && (arg.contains('.') || arg.contains('/') || arg.contains('\\'))
}

/// Bare program name: last path segment, lowercased, without a Windows suffix.
fn program_name(arg: &str) -> String {
    let base = arg.rsplit(['/', '\\']).next().unwrap_or(arg);
    let lower = base.to_ascii_lowercase();
    lower
        .strip_suffix(".exe")
        .or_else(|| lower.strip_suffix(".cmd"))
        .or_else(|| lower.strip_suffix(".bat"))
        .or_else(|| lower.strip_suffix(".com"))
        .unwrap_or(&lower)
        .to_string()
}

fn is_version_suffix(rest: &str) -> bool {
    !rest.is_empty()
        && !rest.starts_with('.')
        && !rest.ends_with('.')
        && !rest.contains("..")
        && rest.chars().all(|ch| ch.is_ascii_digit() || ch == '.')
}

/// Programs that run whatever comes after them, or split a string into a command.
///
/// Versioned interpreter names (`python3.12`, `node20`, `Python.EXE`) count.
/// A dotted name is otherwise a script path, so missing these would let
/// `uv run python3.12 -c …` and `docker run debian python3.12 -c …` through.
fn is_wrapper(arg: &str) -> bool {
    let name = program_name(arg);
    if matches!(
        name.as_str(),
        "sh" | "bash"
            | "ash"
            | "dash"
            | "zsh"
            | "ksh"
            | "fish"
            | "csh"
            | "tcsh"
            | "rbash"
            | "cmd"
            | "powershell"
            | "pwsh"
            | "wsl"
            | "forfiles"
            | "mshta"
            | "cscript"
            | "wscript"
            | "eval"
            | "exec"
            | "env"
            | "busybox"
            | "toybox"
            | "xargs"
            | "nice"
            | "nohup"
            | "timeout"
            | "setsid"
            | "stdbuf"
            | "ionice"
            | "taskset"
            | "chrt"
            | "unshare"
            | "nsenter"
            | "chroot"
            | "setpriv"
            | "capsh"
            | "sudo"
            | "su"
            | "doas"
            | "find"
            | "awk"
            | "gawk"
            | "mawk"
            | "sed"
            | "perl"
            | "ruby"
            | "php"
            | "python"
            | "python3"
            | "pythonw"
            | "pypy"
            | "py"
            | "node"
            | "nodejs"
            | "bun"
            | "deno"
            | "lua"
            | "luajit"
            | "script"
            | "flock"
            | "watch"
            | "ssh"
            | "socat"
            | "nc"
            | "ncat"
            | "netcat"
    ) {
        return true;
    }
    const VERSIONED: &[&str] = &[
        "pythonw", "python", "pypy", "node", "nodejs", "bun", "deno", "ruby", "perl", "php", "lua",
        "luajit", "bash", "dash", "zsh", "ksh", "fish", "pwsh", "ash", "py",
    ];
    VERSIONED
        .iter()
        .any(|family| name.strip_prefix(family).is_some_and(is_version_suffix))
}

fn mentions_wrapper(arg: &str) -> bool {
    is_wrapper(arg) || arg.split_whitespace().any(is_wrapper)
}

fn take_value(args: &[String], index: &mut usize) -> Result<String, AppError> {
    let arg = args.get(*index).map(String::as_str).unwrap_or("");
    if let Some((name, value)) = arg.split_once('=') {
        if name.starts_with("--") {
            if value.is_empty() {
                return Err(denied(format!("选项 '{name}' 缺少参数。")));
            }
            *index += 1;
            return Ok(value.to_string());
        }
    }
    let name = arg;
    *index += 1;
    match args.get(*index).map(String::as_str) {
        Some(value) if value != "-" && !value.starts_with('-') => {
            *index += 1;
            Ok(value.to_string())
        }
        _ => Err(denied(format!("选项 '{name}' 缺少参数。"))),
    }
}

fn is_npm_name_part(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(ch) if ch.is_ascii_alphanumeric() || ch == '_' => {}
        _ => return false,
    }
    chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~'))
}

/// `@scope/name`, `name`, and the same with `@version` or `@tag`.
fn is_package_spec(spec: &str) -> bool {
    if spec.is_empty() || spec.len() > 256 || spec.starts_with('-') || spec.contains("..") {
        return false;
    }
    if spec.contains('\\') || spec.contains("://") {
        return false;
    }
    let (body, version) = split_package_version(spec);
    if let Some(version) = version {
        if version.is_empty()
            || !version.chars().all(|ch| {
                ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | '~' | '^' | '*' | '+')
            })
        {
            return false;
        }
    }
    let name = if let Some(rest) = body.strip_prefix('@') {
        let Some((scope, name)) = rest.split_once('/') else {
            return false;
        };
        if scope.contains('/') || !is_npm_name_part(scope) {
            return false;
        }
        name
    } else if body.contains('/') {
        return false;
    } else {
        body
    };
    is_npm_name_part(name) && !is_wrapper(name)
}

fn split_package_version(spec: &str) -> (&str, Option<&str>) {
    if let Some(rest) = spec.strip_prefix('@') {
        return match rest.split_once('@') {
            Some((scope_name, version)) => (&spec[..=scope_name.len()], Some(version)),
            None => (spec, None),
        };
    }
    match spec.split_once('@') {
        Some((name, version)) => (name, Some(version)),
        None => (spec, None),
    }
}

/// A single executable name from a package, not a path and not a shell.
fn is_bin_name(arg: &str) -> bool {
    !arg.is_empty()
        && arg.len() <= 128
        && !arg.starts_with('-')
        && !arg.starts_with('.')
        && !arg.contains('/')
        && !arg.contains('\\')
        && arg
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        && !is_wrapper(arg)
}

fn is_task_name(arg: &str) -> bool {
    !arg.is_empty()
        && arg.len() <= 128
        && !arg.starts_with('-')
        && arg
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ':' | '.'))
}

fn validate_node(args: &[String]) -> Result<(), AppError> {
    let mut index = 0usize;
    while index < args.len() && is_long_flag(&args[index]) {
        let arg = args[index].as_str();
        if arg == "--" {
            index += 1;
            break;
        }
        let name = flag_name(arg);
        if matches!(
            name,
            "--experimental-strip-types"
                | "--experimental-transform-types"
                | "--no-warnings"
                | "--enable-source-maps"
                | "--preserve-symlinks"
                | "--preserve-symlinks-main"
        ) {
            index += 1;
            continue;
        }
        if matches!(name, "--conditions" | "-C" | "--experimental-default-type") {
            let _ = take_value(args, &mut index)?;
            continue;
        }
        return Err(denied(
            "node 只允许脚本路径和少量开关（如 --experimental-strip-types）。不允许 -e / --eval / -p / -r / --import。",
        ));
    }
    let Some(script) = args.get(index).map(String::as_str) else {
        return Err(denied("node 需要一个脚本路径（例如 server.js）。"));
    };
    if !is_script_path(script) || mentions_wrapper(script) {
        return Err(denied("node 需要一个脚本路径（例如 server.js）。"));
    }
    Ok(())
}

fn validate_py(args: &[String]) -> Result<(), AppError> {
    let mut index = 0usize;
    while index < args.len() && is_py_version_selector(&args[index]) {
        index += 1;
    }
    validate_python(&args[index..])
}

fn validate_python(args: &[String]) -> Result<(), AppError> {
    let mut index = 0usize;
    let mut satisfied = false;
    while index < args.len() {
        let arg = args[index].as_str();
        if arg == "--" {
            index += 1;
            let Some(script) = args.get(index).map(String::as_str) else {
                return Err(denied("python 在 -- 之后需要脚本路径。"));
            };
            if !is_script_path(script) {
                return Err(denied("python 在 -- 之后需要脚本路径。"));
            }
            return Ok(());
        }
        if arg == "-" {
            return Err(denied("python 不允许从标准输入执行代码。"));
        }
        if let Some(name) = arg.strip_prefix("--") {
            let name = name.split('=').next().unwrap_or(name);
            match name {
                "isolated" => {
                    index += 1;
                    continue;
                }
                "check-hash-based-pycs" => {
                    let _ = take_value(args, &mut index)?;
                    continue;
                }
                _ => {
                    return Err(denied(format!(
                        "python 选项 '--{name}' 不在允许的选项集内。"
                    )));
                }
            }
        }
        if let Some(rest) = arg.strip_prefix('-') {
            if rest.is_empty() {
                return Err(denied("python 不允许从标准输入执行代码。"));
            }
            let chars: Vec<char> = rest.chars().collect();
            let mut cursor = 0usize;
            let mut consumed_module = false;
            while cursor < chars.len() {
                match chars[cursor] {
                    'c' | 'i' => {
                        return Err(denied(
                            "python 不允许 -c 或交互模式。请改用脚本文件或 python -m 模块名。",
                        ));
                    }
                    'm' => {
                        let inline: String = chars[cursor + 1..].iter().collect();
                        let module = if inline.is_empty() {
                            index += 1;
                            match args.get(index).map(String::as_str) {
                                Some(value) => value.to_string(),
                                None => return Err(denied("python -m 后面需要模块名。")),
                            }
                        } else {
                            inline
                        };
                        if !is_safe_python_module(&module) {
                            return Err(denied(
                                "python -m 不允许 timeit、runpy、pdb、profile 这类会执行参数中代码的模块。",
                            ));
                        }
                        satisfied = true;
                        consumed_module = true;
                        break;
                    }
                    'W' | 'X' => {
                        let inline: String = chars[cursor + 1..].iter().collect();
                        if inline.is_empty() {
                            index += 1;
                            if index >= args.len() || args[index].starts_with('-') {
                                return Err(denied("python 选项缺少参数。"));
                            }
                        }
                        break;
                    }
                    'b' | 'B' | 'd' | 'E' | 'I' | 'O' | 'q' | 's' | 'S' | 'u' | 'v' | 'x' => {}
                    other => {
                        return Err(denied(format!(
                            "python 选项 '-{other}' 不在允许的选项集内。"
                        )));
                    }
                }
                cursor += 1;
            }
            index += 1;
            if consumed_module {
                // Args after `-m <module>` belong to that module. The module
                // itself was allowlisted, so they are not parsed as Python.
                return Ok(());
            }
            continue;
        }

        if !is_script_path(arg) {
            return Err(denied(
                "python 需要脚本文件（例如 server.py）或 `python -m 模块名`。",
            ));
        }
        satisfied = true;
        break;
    }

    if satisfied {
        Ok(())
    } else {
        Err(denied(
            "python 需要脚本文件或 `python -m 模块名`，不能只带解释器选项。",
        ))
    }
}

fn is_python_module(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(ch) if ch.is_ascii_alphabetic() || ch == '_' => {}
        _ => return false,
    }
    chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '.')
        && !name.starts_with('.')
        && !name.ends_with('.')
        && !name.contains("..")
}

/// Stdlib (and installer) modules whose CLI evaluates an argument as code
/// or opens a REPL. Everything else that is a dotted identifier is a server.
fn is_safe_python_module(name: &str) -> bool {
    if !is_python_module(name) {
        return false;
    }
    let root = name.split('.').next().unwrap_or(name);
    !matches!(
        root,
        "timeit"
            | "profile"
            | "cProfile"
            | "trace"
            | "pdb"
            | "runpy"
            | "code"
            | "pip"
            | "ensurepip"
            | "venv"
            | "idlelib"
    )
}

fn is_py_version_selector(arg: &str) -> bool {
    let Some(rest) = arg.strip_prefix('-') else {
        return false;
    };
    if rest.is_empty() || rest.starts_with('-') {
        return false;
    }
    let mut parts = rest.split('.');
    let major = parts.next().unwrap_or("");
    if major != "2" && major != "3" {
        return false;
    }
    match parts.next() {
        None => true,
        Some(minor) if !minor.is_empty() && minor.chars().all(|ch| ch.is_ascii_digit()) => {
            parts.next().is_none()
        }
        Some(_) => false,
    }
}

fn validate_bun(args: &[String]) -> Result<(), AppError> {
    let mut index = 0usize;
    while index < args.len() && is_long_flag(&args[index]) {
        let name = flag_name(&args[index]);
        if matches!(
            name,
            "--watch" | "--hot" | "--smol" | "--bun" | "--silent" | "--quiet" | "--no-install"
        ) {
            index += 1;
            continue;
        }
        return Err(denied("bun 不允许 -e / --eval，也不接受未列出的开关。"));
    }
    let Some(first) = args.get(index).map(String::as_str) else {
        return Err(denied("bun 需要脚本文件或 `bun x <包>`。"));
    };
    match first {
        "eval" | "repl" => Err(denied("bun 不允许 eval / repl。")),
        "run" => {
            let Some(script) = args.get(index + 1).map(String::as_str) else {
                return Err(denied("bun run 需要脚本或任务名。"));
            };
            if script == "eval" || script == "repl" || mentions_wrapper(script) {
                return Err(denied("bun run 不能执行 eval、repl 或 shell。"));
            }
            if is_script_path(script) || is_task_name(script) {
                Ok(())
            } else {
                Err(denied("bun run 需要脚本路径或任务名。"))
            }
        }
        "x" => {
            let Some(package) = args.get(index + 1).map(String::as_str) else {
                return Err(denied("bun x 需要包名。"));
            };
            if is_package_spec(package) {
                Ok(())
            } else {
                Err(denied("bun x 需要合法的包名。"))
            }
        }
        other if is_script_path(other) && !mentions_wrapper(other) => Ok(()),
        _ => Err(denied("bun 需要脚本文件或 `bun x <包>`。")),
    }
}

fn validate_deno(args: &[String]) -> Result<(), AppError> {
    let Some(sub) = args.first().map(String::as_str) else {
        return Err(denied(
            "deno 只允许 `deno run <脚本>` 或 `deno task <任务>`。",
        ));
    };
    match sub {
        "run" => validate_deno_run(&args[1..]),
        "task" => {
            let Some(name) = args.get(1).map(String::as_str) else {
                return Err(denied("deno task 需要任务名。"));
            };
            if is_task_name(name) {
                Ok(())
            } else {
                Err(denied("deno task 的任务名无效。"))
            }
        }
        _ => Err(denied(
            "deno 只允许 `deno run <脚本>` 或 `deno task <任务>`。",
        )),
    }
}

fn validate_deno_run(args: &[String]) -> Result<(), AppError> {
    let mut index = 0usize;
    while index < args.len() && is_long_flag(&args[index]) {
        let arg = args[index].as_str();
        if arg == "--" {
            index += 1;
            break;
        }
        let name = flag_name(arg);
        if matches!(name, "-e" | "--eval" | "-c" | "--command") {
            return Err(denied("deno 不允许 -e / --eval。"));
        }
        if name.starts_with("--allow-")
            || name.starts_with("--deny-")
            || matches!(
                name,
                "--quiet"
                    | "--no-check"
                    | "--watch"
                    | "--unstable"
                    | "--reload"
                    | "--cached-only"
                    | "--no-prompt"
                    | "--node-modules-dir"
            )
        {
            index += 1;
            continue;
        }
        if matches!(name, "--lock" | "--config") {
            let _ = take_value(args, &mut index)?;
            continue;
        }
        return Err(denied(format!("deno 选项 '{arg}' 不在允许范围内。")));
    }
    let Some(script) = args.get(index).map(String::as_str) else {
        return Err(denied("deno run 需要脚本。"));
    };
    if is_script_path(script) && !mentions_wrapper(script) {
        Ok(())
    } else {
        Err(denied("deno run 需要本地脚本路径，不能是 - 或远程 URL。"))
    }
}

fn validate_npm(args: &[String]) -> Result<(), AppError> {
    let mut index = 0usize;
    while index < args.len() && is_long_flag(&args[index]) {
        let name = flag_name(&args[index]);
        if matches!(
            name,
            "-y" | "--yes" | "-q" | "--quiet" | "--offline" | "--ignore-scripts"
        ) {
            index += 1;
            continue;
        }
        return Err(denied(format!(
            "npm 选项 '{}' 不在允许范围内。",
            args[index]
        )));
    }
    match args.get(index).map(String::as_str) {
        Some("exec" | "x") => validate_npx(&args[index + 1..]),
        _ => Err(denied("npm 只允许 `npm exec <包>` 或 `npm x <包>`。")),
    }
}

fn validate_npx(args: &[String]) -> Result<(), AppError> {
    let mut index = 0usize;
    let mut explicit_package = false;
    while index < args.len() {
        let arg = args[index].as_str();
        if arg == "--" {
            index += 1;
            break;
        }
        if !is_long_flag(arg) {
            break;
        }
        let name = flag_name(arg);
        if matches!(
            name,
            "-y" | "--yes"
                | "-q"
                | "--quiet"
                | "--offline"
                | "--prefer-offline"
                | "--prefer-online"
                | "--ignore-existing"
                | "--no-install"
                | "-n"
                | "--ignore-scripts"
        ) {
            index += 1;
            continue;
        }
        if matches!(
            name,
            "-c" | "--call" | "--shell" | "--shell-auto-fallback" | "--node-arg" | "--npm"
        ) {
            return Err(denied("npx 不允许 -c / --call / --shell。"));
        }
        // `-p` / `--package` selects the package. The next positional is the
        // bin inside that package, which is a normal MCP shape — not eval.
        if matches!(name, "-p" | "--package") {
            let spec = take_value(args, &mut index)?;
            if !is_package_spec(&spec) {
                return Err(denied("npx --package 的包名无效。"));
            }
            explicit_package = true;
            continue;
        }
        return Err(denied(format!("npx 选项 '{arg}' 不在允许范围内。")));
    }

    let Some(first) = args.get(index).map(String::as_str) else {
        return Err(denied("npx 需要包名。"));
    };
    if explicit_package {
        if is_bin_name(first) {
            Ok(())
        } else {
            Err(denied(
                "npx --package 后面的命令必须是包内可执行文件名，不能是 shell 或路径。",
            ))
        }
    } else if is_package_spec(first) {
        Ok(())
    } else {
        Err(denied("npx 需要合法的包名，不能直接运行任意命令。"))
    }
}

fn validate_uv(args: &[String]) -> Result<(), AppError> {
    let positional = args
        .iter()
        .find(|arg| !is_long_flag(arg))
        .map(String::as_str);
    match positional {
        Some("tool") => validate_uv_tool(args),
        Some("run") => validate_uv_run(args),
        _ if args.iter().any(|arg| flag_name(arg) == "--from") => validate_uvx(args),
        _ => Err(denied(
            "uv 只允许 `uv tool run <包>`、`uv --from <包> <命令>` 或 `uv run <脚本>`。",
        )),
    }
}

fn validate_uv_tool(args: &[String]) -> Result<(), AppError> {
    let mut index = 0usize;
    while index < args.len() && is_long_flag(&args[index]) {
        if !matches!(
            flag_name(&args[index]),
            "--quiet" | "--offline" | "--verbose" | "--no-cache"
        ) {
            return Err(denied("uv 的这个开关不在允许范围内。"));
        }
        index += 1;
    }
    if args.get(index).map(String::as_str) != Some("tool") {
        return Err(denied("uv 只允许 `uv tool run <包>`。"));
    }
    index += 1;
    if args.get(index).map(String::as_str) != Some("run") {
        return Err(denied("uv tool 只允许 run。"));
    }
    validate_uvx(&args[index + 1..])
}

fn validate_uv_run(args: &[String]) -> Result<(), AppError> {
    let mut index = 0usize;
    let mut seen_run = false;
    while index < args.len() {
        let arg = args[index].as_str();
        if arg == "--" {
            index += 1;
            break;
        }
        if !seen_run && arg == "run" {
            seen_run = true;
            index += 1;
            continue;
        }
        if is_long_flag(arg) && is_uv_run_bool(flag_name(arg)) {
            index += 1;
            continue;
        }
        if is_long_flag(arg) && is_uv_run_value(flag_name(arg)) {
            let name = flag_name(arg).to_string();
            let value = take_value(args, &mut index)?;
            if matches!(name.as_str(), "--with" | "--from") && !is_package_spec(&value) {
                return Err(denied("uv run 的包名无效。"));
            }
            if name == "--python" && !is_python_request(&value) {
                return Err(denied(
                    "uv 的 --python 只能是版本或解释器名（例如 3.12），不能是路径或任意程序。",
                ));
            }
            continue;
        }
        if is_long_flag(arg) {
            return Err(denied(format!("uv run 选项 '{arg}' 不在允许范围内。")));
        }
        if !seen_run {
            return Err(denied("uv 只允许 `uv run <脚本>`。"));
        }
        break;
    }
    if !seen_run {
        return Err(denied("uv 只允许 `uv run <脚本>`。"));
    }
    let Some(command) = args.get(index).map(String::as_str) else {
        return Err(denied("uv run 需要脚本路径。"));
    };
    // `uv run -- cmd /c …` and `uv run python -c …` are arbitrary commands.
    // A script path is the only shape that stays.
    if mentions_wrapper(command) || !is_script_path(command) {
        return Err(denied(
            "uv run 只允许脚本路径（例如 server.py），不能在 -- 后面接任意命令。",
        ));
    }
    Ok(())
}

fn is_uv_run_bool(name: &str) -> bool {
    matches!(
        name,
        "--no-project"
            | "--no-sync"
            | "--frozen"
            | "--offline"
            | "--quiet"
            | "--verbose"
            | "--isolated"
            | "--no-dev"
            | "--all-extras"
            | "--inexact"
            | "--refresh"
            | "--exact"
            | "--no-editable"
            | "--no-cache"
    )
}

fn is_uv_run_value(name: &str) -> bool {
    matches!(
        name,
        "--with" | "--from" | "--python" | "--directory" | "--project" | "--group" | "--extra"
    )
}

/// A Python selector uv may resolve itself. A filesystem path would be an
/// arbitrary executable (`uv run --python /tmp/evil server.py`).
fn is_python_request(value: &str) -> bool {
    if value.is_empty()
        || value.len() > 80
        || value.starts_with('-')
        || value.contains('/')
        || value.contains('\\')
        || value.contains("..")
    {
        return false;
    }
    let lower = value.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "python" | "python2" | "python3" | "pythonw" | "pypy" | "pypy3" | "cpython"
    ) {
        return true;
    }
    let body = lower
        .strip_prefix("cpython-")
        .or_else(|| lower.strip_prefix("python"))
        .or_else(|| lower.strip_prefix("pypy"))
        .unwrap_or(lower.as_str());
    body.chars().any(|ch| ch.is_ascii_digit())
        && body
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
        && !body.starts_with('-')
        && !body.ends_with('.')
        && !body.ends_with('-')
}

fn validate_uvx(args: &[String]) -> Result<(), AppError> {
    let mut index = 0usize;
    let mut from_package = false;
    while index < args.len() {
        let arg = args[index].as_str();
        if arg == "--" {
            index += 1;
            break;
        }
        if !is_long_flag(arg) {
            break;
        }
        let name = flag_name(arg);
        if matches!(
            name,
            "--offline"
                | "--quiet"
                | "--no-cache"
                | "--refresh"
                | "--isolated"
                | "--prerelease"
                | "--verbose"
        ) {
            index += 1;
            continue;
        }
        if matches!(name, "--from" | "--with" | "--python") {
            let value = take_value(args, &mut index)?;
            if name == "--python" {
                if !is_python_request(&value) {
                    return Err(denied(
                        "uv 的 --python 只能是版本或解释器名（例如 3.12），不能是路径或任意程序。",
                    ));
                }
                continue;
            }
            if !is_package_spec(&value) {
                return Err(denied("uvx 的包名无效。"));
            }
            if name == "--from" {
                from_package = true;
            }
            continue;
        }
        return Err(denied(format!("uvx 选项 '{arg}' 不在允许范围内。")));
    }
    let Some(first) = args.get(index).map(String::as_str) else {
        return Err(denied("uvx 需要包名。"));
    };
    if from_package {
        if is_bin_name(first) {
            Ok(())
        } else {
            Err(denied(
                "uvx --from 后面的命令必须是包内可执行文件名，不能是 shell。",
            ))
        }
    } else if is_package_spec(first) {
        Ok(())
    } else {
        Err(denied("uvx 需要合法的包名，不能直接运行任意命令。"))
    }
}

fn is_toolchain(arg: &str) -> bool {
    let Some(rest) = arg.strip_prefix('+') else {
        return false;
    };
    !rest.is_empty()
        && rest
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

fn validate_cargo(args: &[String]) -> Result<(), AppError> {
    let mut index = 0usize;
    if args.first().is_some_and(|arg| arg.starts_with('+')) {
        if !is_toolchain(&args[0]) {
            return Err(denied("cargo 的工具链名称无效。"));
        }
        index = 1;
    }
    if args.get(index).map(String::as_str) != Some("run") {
        return Err(denied(
            "cargo 只允许 `cargo run`（可带 --bin、--manifest-path、--release）。",
        ));
    }
    index += 1;
    while index < args.len() {
        let arg = args[index].as_str();
        if arg == "--" {
            break;
        }
        let name = flag_name(arg);
        if matches!(name, "--config" | "-c" | "-Z") {
            return Err(denied("cargo 不允许 -c / --config / -Z。"));
        }
        if matches!(
            name,
            "--release"
                | "--quiet"
                | "--offline"
                | "--frozen"
                | "--locked"
                | "--all-features"
                | "--no-default-features"
                | "--workspace"
        ) {
            index += 1;
            continue;
        }
        if matches!(
            name,
            "--bin"
                | "--example"
                | "--package"
                | "-p"
                | "--manifest-path"
                | "--features"
                | "--target"
                | "--target-dir"
                | "--profile"
        ) {
            let _ = take_value(args, &mut index)?;
            continue;
        }
        return Err(denied(format!("cargo run 选项 '{arg}' 不在允许范围内。")));
    }
    Ok(())
}

fn validate_go(args: &[String]) -> Result<(), AppError> {
    if args.first().map(String::as_str) != Some("run") {
        return Err(denied("go 只允许 `go run <文件或包>`。"));
    }
    let mut index = 1usize;
    let mut saw_target = false;
    while index < args.len() {
        let arg = args[index].as_str();
        if arg == "--" {
            index += 1;
            continue;
        }
        // Go accepts `-mod=readonly` as one argv element. `flag_name` only
        // splits GNU `--name=value`, so split the single dash here too.
        let name = arg.split_once('=').map(|(flag, _)| flag).unwrap_or(arg);
        if is_go_exec_flag(name) {
            return Err(denied("go 不允许 -exec / -toolexec / -ldflags。"));
        }
        if matches!(name, "-race" | "-msan" | "-asan" | "-trimpath") {
            index += 1;
            continue;
        }
        if matches!(name, "-mod" | "-modfile" | "-tags" | "-buildvcs") {
            if arg.contains('=') {
                index += 1;
            } else {
                let _ = take_value(args, &mut index)?;
            }
            continue;
        }
        if is_long_flag(arg) {
            return Err(denied(format!("go 选项 '{arg}' 不在允许范围内。")));
        }
        let package =
            arg == "." || arg.starts_with("./") || arg.starts_with(".\\") || is_script_path(arg);
        if !package {
            return Err(denied("go run 的目标必须是文件或包路径。"));
        }
        saw_target = true;
        index += 1;
    }
    if saw_target {
        Ok(())
    } else {
        Err(denied("go 只允许 `go run <文件或包>`。"))
    }
}

fn is_go_exec_flag(name: &str) -> bool {
    const PREFIXES: &[&str] = &[
        "-toolexec",
        "-exec",
        "-ldflags",
        "-overlay",
        "-pgo",
        "-gccgoflags",
        "-asmflags",
        "-gcflags",
    ];
    PREFIXES.iter().any(|prefix| name.starts_with(prefix))
}

fn is_git_exec_flag(arg: &str) -> bool {
    let name = flag_name(arg);
    matches!(
        name,
        "-c" | "--config"
            | "--config-env"
            | "--exec"
            | "--exec-path"
            | "--upload-pack"
            | "--receive-pack"
    )
}

fn validate_git(args: &[String]) -> Result<(), AppError> {
    const SUBCOMMANDS: &[&str] = &[
        "status",
        "log",
        "show",
        "diff",
        "rev-parse",
        "ls-files",
        "describe",
        "blame",
        "rev-list",
        "version",
        "help",
    ];
    let mut index = 0usize;
    while index < args.len() && is_long_flag(&args[index]) {
        let arg = args[index].as_str();
        if is_git_exec_flag(arg) {
            return Err(denied(
                "git 不允许 -c / --config / --upload-pack / --receive-pack / --exec。",
            ));
        }
        let name = flag_name(arg);
        if matches!(
            name,
            "--no-pager"
                | "--paginate"
                | "--bare"
                | "--no-replace-objects"
                | "--literal-pathspecs"
                | "--version"
                | "--help"
                | "--no-optional-locks"
        ) {
            index += 1;
            continue;
        }
        if matches!(name, "-C" | "--git-dir" | "--work-tree" | "--namespace") {
            let _ = take_value(args, &mut index)?;
            continue;
        }
        return Err(denied(format!("git 选项 '{arg}' 不在允许范围内。")));
    }
    let Some(sub) = args.get(index).map(String::as_str) else {
        return Ok(());
    };
    if !SUBCOMMANDS.contains(&sub) {
        return Err(denied(
            "git 只允许只读子命令（status、log、diff、show 等），不允许 clone / fetch / config。",
        ));
    }
    for arg in &args[index + 1..] {
        if is_git_exec_flag(arg) {
            return Err(denied(
                "git 不允许 -c / --config / --upload-pack / --receive-pack / --exec。",
            ));
        }
    }
    Ok(())
}

const DOCKER_BOOL: &[&str] = &[
    "-i",
    "--interactive",
    "-t",
    "--tty",
    "-d",
    "--detach",
    "--rm",
    "--init",
    "--read-only",
    "--sig-proxy",
    "--help",
    "--debug",
    "-D",
    "--quiet",
    "-q",
];

const DOCKER_VALUE: &[&str] = &[
    "-e",
    "--env",
    "-v",
    "--volume",
    "-p",
    "--publish",
    "-w",
    "--workdir",
    "-u",
    "--user",
    "--name",
    "--network",
    "--net",
    "--hostname",
    "-h",
    "--label",
    "-l",
    "--pull",
    "--platform",
    "--memory",
    "-m",
    "--cpus",
    "--mount",
    "--add-host",
    "--env-file",
    "--restart",
    "--device",
    "--cap-add",
    "--cap-drop",
    "--security-opt",
    "--tmpfs",
    "--log-driver",
    "--log-opt",
    "--pid",
    "--ipc",
    "--shm-size",
    "--ulimit",
    "--group-add",
    "--cpu-shares",
    "-c",
    "--context",
    "--host",
    "-H",
    "--log-level",
    "--gpus",
];

fn validate_docker(args: &[String]) -> Result<(), AppError> {
    if args
        .iter()
        .any(|arg| matches!(flag_name(arg), "--entrypoint" | "--privileged"))
    {
        return Err(denied("docker 不允许 --entrypoint 或 --privileged。"));
    }

    let mut index = skip_docker_flags(args, 0)?;
    if args.get(index).map(String::as_str) != Some("run") {
        return Err(denied(
            "docker 只允许 `docker run <镜像>`，不接受 exec / build 等子命令。",
        ));
    }
    index += 1;
    index = skip_docker_flags(args, index)?;
    let Some(image) = args.get(index).map(String::as_str) else {
        return Err(denied("docker run 需要镜像名。"));
    };
    if !is_docker_image(image) || is_wrapper(image) {
        return Err(denied("docker 镜像名无效。"));
    }
    for arg in &args[index + 1..] {
        // Flags before the image are docker's. Everything after the image is
        // the container command: a shell, `env -S`, `busybox`, or `xargs`
        // turns the image into an arbitrary-code runner.
        if mentions_wrapper(arg) {
            return Err(denied(
                "docker run 的容器命令不能是 shell、env、busybox、xargs 或其他包装器。镜像应当使用自带入口。",
            ));
        }
    }
    Ok(())
}

fn skip_docker_flags(args: &[String], mut index: usize) -> Result<usize, AppError> {
    while index < args.len() && args[index].starts_with('-') {
        let arg = args[index].as_str();
        if arg == "--" {
            return Ok(index + 1);
        }
        let name = flag_name(arg);
        if matches!(name, "--entrypoint" | "--privileged" | "--config") {
            return Err(denied(format!("docker 不允许 '{name}'。")));
        }
        let inline = arg
            .split_once('=')
            .is_some_and(|(name, _)| name.starts_with("--"));
        if DOCKER_BOOL.contains(&name) {
            index += 1;
            continue;
        }
        if DOCKER_VALUE.contains(&name) {
            if !inline {
                if index + 1 >= args.len() {
                    return Err(denied(format!("docker 选项 '{name}' 缺少参数。")));
                }
                index += 1;
            }
            index += 1;
            continue;
        }
        if is_docker_bool_cluster(arg) || is_attached_docker_value(arg) {
            index += 1;
            continue;
        }
        return Err(denied(format!("docker 选项 '{arg}' 不在允许范围内。")));
    }
    Ok(index)
}

fn is_docker_bool_cluster(arg: &str) -> bool {
    let Some(rest) = arg.strip_prefix('-') else {
        return false;
    };
    if rest.starts_with('-') || rest.len() < 2 {
        return false;
    }
    rest.chars()
        .all(|ch| matches!(ch, 'i' | 't' | 'd' | 'q' | 'D'))
}

fn is_attached_docker_value(arg: &str) -> bool {
    let Some(rest) = arg.strip_prefix('-') else {
        return false;
    };
    if rest.starts_with('-') || rest.chars().count() < 2 {
        return false;
    }
    matches!(
        rest.chars().next(),
        Some('e' | 'v' | 'p' | 'w' | 'u' | 'h' | 'l' | 'm' | 'c' | 'H')
    )
}

fn is_docker_image(name: &str) -> bool {
    if name.is_empty() || name.starts_with('-') || name.len() > 255 {
        return false;
    }
    name.chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | ':' | '@' | '/' | '-'))
}

#[cfg(test)]
mod tests {
    use super::validate_mcp_invocation;

    fn argv(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    fn allow(command: &str, values: &[&str]) {
        let args = argv(values);
        assert!(
            validate_mcp_invocation(command, &args).is_ok(),
            "{command} {values:?} should be allowed, got {:?}",
            validate_mcp_invocation(command, &args)
        );
    }

    fn block(command: &str, values: &[&str]) {
        assert!(
            validate_mcp_invocation(command, &argv(values)).is_err(),
            "{command} {values:?} should be rejected"
        );
    }

    #[test]
    fn package_runners_need_a_package_and_reject_arbitrary_commands() {
        allow(
            "npx",
            &["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        );
        allow("npx.cmd", &["-y", "mcp-server"]);
        allow("npm", &["exec", "@scope/pkg"]);
        allow("uvx", &["mcp-server-fetch"]);
        allow("uv", &["--from", "mcp-server-git", "mcp-server-git"]);
        allow("uv", &["tool", "run", "mcp-server-git"]);
        allow("uv", &["run", "server.py"]);
        allow("uv", &["run", "--no-project", "server.py"]);
        block("npx", &["-y"]);
        block("npx", &["-c", "node -v"]);
        block("npx", &["--call", "node -v"]);
        block("npm", &["exec", "-c", "id"]);
        block("uv", &["pip", "install", "evil"]);
        block("uvx", &["cmd"]);
    }

    #[test]
    fn npx_package_flag_selects_a_bin_and_is_not_eval() {
        allow("npx", &["-p", "some-pkg", "some-bin"]);
        allow("npx", &["--package", "@scope/pkg", "server", "--stdio"]);
        allow("npx", &["--package=some-pkg", "server"]);
        block("npx", &["-p", "some-pkg", "cmd", "/c", "whoami"]);
        block("npx", &["-p", "some-pkg", "sh"]);
        block("npx", &["-p", "some-pkg", "/bin/sh"]);
        block("npx", &["-y", "cmd", "/c", "whoami"]);
    }

    #[test]
    fn uv_run_cannot_launch_an_arbitrary_command() {
        block("uv", &["run", "--no-project", "--", "cmd", "/c", "whoami"]);
        block("uv", &["run", "--", "sh", "-c", "id"]);
        block(
            "uv",
            &["run", "--no-project", "--", "env", "sh", "-c", "id"],
        );
        block("uv", &["run", "python", "-c", "import os"]);
        block("uv", &["run", "python3.12", "-c", "import os"]);
        block("uv", &["run", "Python.EXE", "-c", "import os"]);
        block("uv", &["run", "--", "busybox", "sh"]);
        block("uv", &["run", "--python", "/tmp/evil", "server.py"]);
        block("uv", &["run", "--python", "cmd", "server.py"]);
        allow("uv", &["run", "--directory", "project", "src/server.py"]);
        allow("uv", &["run", "--python", "3.12", "server.py"]);
        allow("uv", &["run", "--no-project", "--", "server.py"]);
    }

    #[test]
    fn node_requires_a_script_and_rejects_eval() {
        allow("node", &["server.js"]);
        allow("node.exe", &["--experimental-strip-types", "src/index.ts"]);
        allow("node", &["build/index.mjs", "--port", "3000"]);
        block("node", &[]);
        block("node", &["--version"]);
        block("node", &["-e", "process.version"]);
        block("node", &["--eval", "process.version"]);
        block("node", &["-p", "process.version"]);
        block("node", &["-r", "./preload.js", "server.js"]);
        block("node", &["--import", "./hook.mjs", "server.js"]);
        block("node", &["-eprocess.version"]);
    }

    #[test]
    fn python_allows_scripts_and_modules_not_command_strings() {
        allow("python", &["server.py"]);
        allow("python3", &["-u", "server.py"]);
        allow("python", &["-m", "mcp_server"]);
        allow("python", &["-m", "mcp.server", "--port", "1"]);
        allow("py", &["-3.12", "-m", "mcp_server"]);
        allow("python.exe", &["-X", "faulthandler", "server.py"]);
        block("python", &["-c", "import os"]);
        block("python", &["-uc", "import os"]);
        block("python3", &["--version"]);
        block("py", &["-3", "-c", "import os"]);
        block("python", &["-m", "os;system"]);
        block("python", &["-"]);
    }

    #[test]
    fn python_m_rejects_modules_that_execute_their_arguments() {
        block("python", &["-m", "timeit", "print(1)"]);
        block("python", &["-m", "timeit"]);
        block("python", &["-u", "-m", "timeit", "-n", "1", "print(1)"]);
        block("python", &["-mtimeit", "print(1)"]);
        block("python", &["-m", "runpy", "-c", "print(1)"]);
        block("python", &["-m", "profile", "server.py"]);
        block("python", &["-m", "cProfile", "server.py"]);
        block("python", &["-m", "pdb", "server.py"]);
        block("python", &["-W", "ignore", "-m", "code"]);
    }

    #[test]
    fn bun_and_deno_reject_eval_subcommands() {
        allow("bun", &["server.ts"]);
        allow("bun", &["run", "server.ts"]);
        allow("bun", &["x", "@scope/mcp"]);
        block("bun", &["eval", "console.log(1)"]);
        block("bun", &["-e", "console.log(1)"]);
        block("bun", &["repl"]);
        allow("deno", &["run", "--allow-net", "server.ts"]);
        allow("deno", &["task", "start"]);
        block("deno", &["eval", "console.log(1)"]);
        block("deno", &["run"]);
        block("deno", &["install", "server.ts"]);
        block("deno", &["run", "https://example.com/server.ts"]);
    }

    #[test]
    fn docker_run_allows_images_and_rejects_shells_and_wrappers() {
        allow(
            "docker",
            &["run", "-i", "--rm", "ghcr.io/example/mcp:latest"],
        );
        allow(
            "docker",
            &[
                "run",
                "-i",
                "--rm",
                "-e",
                "FOO=bar",
                "-v",
                "/data:/data",
                "--pull",
                "always",
                "mcp/server",
            ],
        );
        allow(
            "docker",
            &["run", "-it", "--rm", "mcp/server", "server", "--stdio"],
        );
        allow(
            "docker",
            &[
                "run",
                "-it",
                "--rm",
                "mcp/server",
                "server",
                "-c",
                "config",
                "--stdio",
            ],
        );
        block("docker", &["exec", "-it", "box", "sh"]);
        block("docker", &["run", "--rm", "alpine", "sh", "-c", "id"]);
        block("docker", &["run", "--entrypoint", "/bin/sh", "alpine"]);
        block("docker", &["run", "--privileged", "alpine"]);
        block(
            "docker",
            &["run", "--rm", "alpine", "python", "-c", "import os"],
        );
        block(
            "docker",
            &["run", "--rm", "alpine", "python", "-uc", "import os"],
        );
        block(
            "docker",
            &["run", "--rm", "alpine", "node", "-e", "process.exit(1)"],
        );
        block(
            "docker",
            &["run", "--rm", "alpine", "node", "--eval", "process.exit(1)"],
        );
        block("docker", &["run", "debian", "env", "-S", "sh -c id"]);
        block("docker", &["run", "--rm", "debian", "busybox", "sh"]);
        block(
            "docker",
            &["run", "--rm", "debian", "xargs", "sh", "-c", "id"],
        );
        block(
            "docker",
            &["run", "debian", "/usr/bin/env", "-S", "sh -c id"],
        );
        block("docker", &["run", "debian", "sh -c id"]);
        block(
            "docker",
            &["run", "--rm", "debian", "python3.12", "-c", "import os"],
        );
        block(
            "docker",
            &["run", "--rm", "debian", "node20", "-e", "process.exit(1)"],
        );
        block(
            "docker",
            &["run", "--rm", "debian", "Python.EXE", "-c", "import os"],
        );
        block("docker", &["run", "--rm", "debian", "timeout", "1", "sh"]);
        block("docker", &["run"]);
        block("docker", &["run", "-i", "--rm"]);
    }

    #[test]
    fn cargo_go_and_git_stay_on_their_safe_subcommands() {
        allow("cargo", &["run", "--release"]);
        allow(
            "cargo",
            &["run", "--manifest-path", "Cargo.toml", "--bin", "server"],
        );
        allow("cargo", &["+nightly", "run"]);
        allow("cargo", &["run", "-p", "server"]);
        block("cargo", &["install", "ripgrep"]);
        block("cargo", &["run", "--config", "build.rustc=x"]);
        block("cargo", &["test"]);
        allow("go", &["run", "."]);
        allow("go", &["run", "main.go"]);
        block("go", &["run"]);
        block("go", &["test", "./..."]);
        block("go", &["run", "-exec", "cmd", "."]);
        block("go", &["run", "-exec=cmd", "."]);
        block("go", &["run", "-ldflags=-s", "."]);
        allow("go", &["run", "-mod=readonly", "."]);
        allow("git", &["status"]);
        allow("git", &["status", "-u"]);
        allow("git", &[]);
        block("git", &["-c", "core.sshCommand=id"]);
        block("git", &["config", "core.sshCommand", "id"]);
        block("git", &["--upload-pack=calc", "status"]);
        block("git", &["status", "--upload-pack", "calc"]);
        block("git", &["fetch", "--upload-pack", "calc"]);
        block(
            "git",
            &["clone", "-u", "calc", "https://example.com/repo.git"],
        );
        block("git", &["push", "--exec", "calc"]);
        block("git", &["push", "--receive-pack=calc"]);
        block("git", &["rebase", "--exec", "id"]);
        block("git", &["--exec-path=/tmp/git", "status"]);
        allow("claude", &[]);
        allow("claude", &["--version"]);
    }

    #[test]
    fn shell_metacharacters_still_fail_closed() {
        block("npx", &["-y", "pkg;rm"]);
        block("node", &["server.js\n"]);
        block("docker", &["run", "image", "$(id)"]);
    }
}
