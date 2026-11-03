//! Argument policy for MCP stdio servers.
//!
//! The executable allowlist is not enough: `node`, `python`, `docker`, and
//! `cargo` are legitimate MCP launchers and also one-shot code runners
//! (`node -e`, `python -c`, `docker run … sh -c`, `npx -c`). Spawn always
//! receives a structured argv — one string per element, never a shell line —
//! and this module rejects the flag shapes that turn those runtimes into an
//! arbitrary-code primitive.
//!
//! Package runners (`npx -y <pkg>`) and real servers (`node server.js`,
//! `python -m mcp_server`, `docker run -i --rm <image>`, `cargo run`) stay
//! allowed.

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
        "python" | "python3" | "py" => validate_python(stem, args),
        "bun" => validate_bun(args),
        "deno" => validate_deno(args),
        "docker" => validate_docker(args),
        "cargo" => validate_cargo(args),
        "go" => validate_go(args),
        "npx" | "npm" | "uvx" | "uv" => validate_package_runner(args),
        "git" => validate_git(args),
        _ => Ok(()),
    }
}

fn denied(message: impl Into<String>) -> AppError {
    AppError::new(codes::SECURITY_INVALID_INPUT, "命令未授权", message)
}

fn flag_base(arg: &str) -> &str {
    if let Some((name, _)) = arg.split_once('=') {
        if name.starts_with("--") {
            return name;
        }
    }
    arg
}

fn is_positional(arg: &str) -> bool {
    !arg.starts_with('-')
}

fn positionals(args: &[String]) -> Vec<&str> {
    args.iter()
        .map(String::as_str)
        .filter(|a| is_positional(a))
        .collect()
}

/// `-e` / `--eval` and the attached form `-eCODE`.
fn is_eval_flag(arg: &str) -> bool {
    let name = flag_base(arg);
    if matches!(
        name,
        "-e" | "--eval" | "-p" | "--print" | "-c" | "--call" | "--command" | "--config"
    ) {
        return true;
    }
    match arg.strip_prefix('-') {
        Some(rest) if !rest.starts_with('-') && !rest.is_empty() => {
            let head = rest.chars().next().unwrap_or('\0');
            (head == 'e' || head == 'c') && rest.len() > 1
        }
        _ => false,
    }
}

fn validate_node(args: &[String]) -> Result<(), AppError> {
    if args.iter().any(|arg| {
        let name = flag_base(arg);
        matches!(
            name,
            "-e" | "--eval"
                | "-p"
                | "--print"
                | "-r"
                | "--require"
                | "--import"
                | "--loader"
                | "--experimental-loader"
        ) || short_contains(arg, &['e', 'p', 'r'])
    }) {
        return Err(denied(
            "node 不允许 -e/--eval、-p/--print、-r/--require、--import 或 --loader。请改为传入脚本文件。",
        ));
    }
    if !args.iter().any(|arg| is_positional(arg)) {
        return Err(denied(
            "node 需要一个脚本路径（例如 server.js），不能只带解释器选项。",
        ));
    }
    Ok(())
}

/// True when `arg` is a one-dash cluster containing any of `letters`.
fn short_contains(arg: &str, letters: &[char]) -> bool {
    let Some(rest) = arg.strip_prefix('-') else {
        return false;
    };
    if rest.starts_with('-') || rest.is_empty() {
        return false;
    }
    rest.chars().any(|ch| letters.contains(&ch))
}

fn validate_python(stem: &str, args: &[String]) -> Result<(), AppError> {
    let mut index = 0usize;
    if stem == "py" {
        while index < args.len() && is_py_version_selector(&args[index]) {
            index += 1;
        }
    }

    let mut satisfied = false;
    while index < args.len() {
        let arg = args[index].as_str();
        if arg == "--" {
            let script = args.get(index + 1).map(String::as_str).unwrap_or("");
            if !is_positional(script) {
                return Err(denied("python 在 -- 之后需要脚本路径。"));
            }
            return Ok(());
        }
        if arg == "-" {
            return Err(denied("python 不允许从标准输入执行代码。"));
        }
        if let Some(name) = arg.strip_prefix("--") {
            let name = name.split('=').next().unwrap_or(name);
            if name == "command" || name == "eval" {
                return Err(denied("python 不允许 --command / --eval。"));
            }
            index += 1;
            continue;
        }
        if let Some(rest) = arg.strip_prefix('-') {
            if rest.is_empty() {
                return Err(denied("python 不允许从标准输入执行代码。"));
            }
            let chars: Vec<char> = rest.chars().collect();
            let mut cursor = 0usize;
            while cursor < chars.len() {
                match chars[cursor] {
                    'c' => {
                        return Err(denied(
                            "python 不允许 -c 直接执行代码。请改用脚本文件或 python -m 模块名。",
                        ));
                    }
                    'm' => {
                        let inline: String = chars[cursor + 1..].iter().collect();
                        let module = if inline.is_empty() {
                            index += 1;
                            match args.get(index) {
                                Some(value) => value.clone(),
                                None => return Err(denied("python -m 后面需要模块名。")),
                            }
                        } else {
                            inline
                        };
                        if !is_python_module(&module) {
                            return Err(denied(
                                "python -m 的模块名只能包含字母、数字、下划线和点。",
                            ));
                        }
                        satisfied = true;
                        index = args.len();
                        break;
                    }
                    'W' | 'X' => {
                        let inline: String = chars[cursor + 1..].iter().collect();
                        if inline.is_empty() {
                            index += 1;
                            if index >= args.len() {
                                return Err(denied("python 选项缺少参数。"));
                            }
                        }
                        break;
                    }
                    'b' | 'B' | 'd' | 'E' | 'h' | 'i' | 'I' | 'O' | 'q' | 's' | 'S' | 'u' | 'v'
                    | 'V' | 'x' | '3' => {}
                    other => {
                        return Err(denied(format!(
                            "python 选项 '-{other}' 不在允许的选项集内。"
                        )));
                    }
                }
                cursor += 1;
            }
            index += 1;
            continue;
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
    if args.iter().any(|arg| {
        let name = flag_base(arg);
        matches!(name, "-e" | "--eval" | "-p" | "--print") || short_contains(arg, &['e'])
    }) {
        return Err(denied("bun 不允许 -e / --eval。"));
    }
    match positionals(args).as_slice() {
        ["eval" | "repl", ..] => Err(denied("bun 不允许 eval / repl。")),
        ["run" | "x"] => Err(denied("bun run / bun x 需要脚本或包名。")),
        [_, ..] => Ok(()),
        [] => Err(denied("bun 需要脚本文件或包名。")),
    }
}

fn validate_deno(args: &[String]) -> Result<(), AppError> {
    if args.iter().any(|arg| is_eval_flag(arg)) {
        return Err(denied("deno 不允许 -e / --eval / -c。"));
    }
    match positionals(args).as_slice() {
        ["eval" | "repl" | "install", ..] => Err(denied("deno 不允许 eval / repl / install。")),
        ["run" | "task", script, ..] if *script != "-" => Ok(()),
        ["run" | "task", ..] => Err(denied("deno run / deno task 需要脚本或任务名。")),
        _ => Err(denied(
            "deno 只允许 `deno run <脚本>` 或 `deno task <任务>`。",
        )),
    }
}

fn validate_package_runner(args: &[String]) -> Result<(), AppError> {
    if args.iter().any(|arg| is_eval_flag(arg)) {
        return Err(denied(
            "包运行器不允许 -c / --call / -e / eval。请直接传入包名。",
        ));
    }
    let mut has_package = false;
    let mut index = 0usize;
    while index < args.len() {
        let arg = args[index].as_str();
        let (name, inline) = match arg.split_once('=') {
            Some((name, _)) if name.starts_with("--") => (name, true),
            _ => (arg, false),
        };
        if matches!(name, "--package" | "-p" | "--from" | "--with" | "--spec") {
            if inline || index + 1 < args.len() {
                has_package = true;
            }
            if !inline {
                index += 1;
            }
        } else if is_positional(arg) && !matches!(arg, "exec" | "x" | "dlx" | "run") {
            has_package = true;
        }
        index += 1;
    }
    if has_package {
        Ok(())
    } else {
        Err(denied("需要包名或脚本名，不能只带运行器选项。"))
    }
}

fn validate_cargo(args: &[String]) -> Result<(), AppError> {
    if args.iter().any(|arg| is_eval_flag(arg)) {
        return Err(denied("cargo 不允许 -e / -c / --config / eval。"));
    }
    let mut positional = positionals(args);
    if positional.first().is_some_and(|item| item.starts_with('+')) {
        positional.remove(0);
    }
    if positional.first().copied() == Some("run") {
        Ok(())
    } else {
        Err(denied(
            "cargo 只允许 `cargo run`（可带 --bin、--manifest-path、--release）。",
        ))
    }
}

fn validate_go(args: &[String]) -> Result<(), AppError> {
    if args.iter().any(|arg| is_eval_flag(arg)) {
        return Err(denied("go 不允许 -e / --eval。"));
    }
    let positional = positionals(args);
    if positional.first().copied() == Some("run") && positional.len() >= 2 {
        Ok(())
    } else {
        Err(denied("go 只允许 `go run <文件或包>`。"))
    }
}

fn validate_git(args: &[String]) -> Result<(), AppError> {
    if args.iter().any(|arg| {
        let name = flag_base(arg);
        name == "-c" || name == "--config" || short_contains(arg, &['c'])
    }) {
        return Err(denied("git 不允许 -c / --config（可用来注入外部命令）。"));
    }
    // `git config core.sshCommand=…` persists the same injection `-c` does once.
    if positionals(args).first().copied() == Some("config") {
        return Err(denied("git 不允许 config 子命令。"));
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
    "--config",
    "--gpus",
];

fn validate_docker(args: &[String]) -> Result<(), AppError> {
    if args
        .iter()
        .any(|arg| matches!(flag_base(arg), "--entrypoint" | "--privileged"))
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
    if !is_docker_image(image) || is_shell_name(image) {
        return Err(denied("docker 镜像名无效。"));
    }
    for arg in &args[index + 1..] {
        // Flags before the image are docker's (`-e` is an env var). Flags
        // after it are the container command, where `-e` / `-c` / `-uc` are
        // interpreter eval forms (`node -e`, `python -uc`).
        if is_shell_name(arg) || is_container_eval(arg) {
            return Err(denied(
                "docker run 不允许把 shell 或 -e/-c 当作容器命令。镜像应当使用自带入口。",
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
        let (name, inline) = match arg.split_once('=') {
            Some((name, _)) if name.starts_with("--") => (name, true),
            _ => (arg, false),
        };
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

/// Eval-shaped arguments once they belong to the container command.
fn is_container_eval(arg: &str) -> bool {
    if is_eval_flag(arg) || arg == "eval" {
        return true;
    }
    // `python -uc` / `node -ce` do not match the exact flag `-c` or `-e`.
    let Some(rest) = arg.strip_prefix('-') else {
        return false;
    };
    if rest.starts_with('-') || rest.len() < 2 {
        return false;
    }
    rest.chars().any(|ch| ch == 'c' || ch == 'e')
}

fn is_shell_name(arg: &str) -> bool {
    let base = arg.rsplit(['/', '\\']).next().unwrap_or(arg);
    let base = base.strip_suffix(".exe").unwrap_or(base);
    matches!(
        base.to_ascii_lowercase().as_str(),
        "sh" | "bash"
            | "ash"
            | "dash"
            | "zsh"
            | "ksh"
            | "fish"
            | "cmd"
            | "powershell"
            | "pwsh"
            | "eval"
    )
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
    fn package_runners_need_a_package_and_reject_call_flags() {
        allow(
            "npx",
            &["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        );
        allow("npx.cmd", &["-y", "mcp-server"]);
        allow("npm", &["exec", "@scope/pkg"]);
        allow("uvx", &["mcp-server-fetch"]);
        allow("uv", &["--from", "mcp-server-git", "mcp-server-git"]);
        block("npx", &["-y"]);
        block("npx", &["-c", "node -v"]);
        block("npx", &["--call", "node -v"]);
        block("npm", &["exec", "-c", "id"]);
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
        allow("python", &["-m", "mcp.server"]);
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
    }

    #[test]
    fn docker_run_allows_images_and_rejects_shells() {
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
        block("cargo", &["install", "ripgrep"]);
        block("cargo", &["run", "--config", "build.rustc=x"]);
        block("cargo", &["test"]);
        allow("go", &["run", "."]);
        allow("go", &["run", "main.go"]);
        block("go", &["run"]);
        block("go", &["test", "./..."]);
        allow("git", &["status"]);
        allow("git", &[]);
        block("git", &["-c", "core.sshCommand=id"]);
        block("git", &["config", "core.sshCommand", "id"]);
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
