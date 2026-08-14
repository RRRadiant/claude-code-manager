// Claude Code Manager - MCP server management
// Discovery Layer: user → project → local, layered merge with dedup
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// MCP transport type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum McpTransportType {
    Stdio,
    Http,
}

/// MCP server scope
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum McpScope {
    Local,
    Project,
    User,
}

/// HTTP header entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpHeader {
    pub key: String,
    pub value: String,
    pub sensitive: bool,
}

/// Environment variable entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
    pub sensitive: bool,
}

/// MCP server definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerDef {
    pub name: String,
    pub type_: McpTransportType,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub url: Option<String>,
    pub headers: Option<Vec<HttpHeader>>,
    pub env: Option<Vec<EnvVar>>,
    pub cwd: Option<String>,
    pub timeout_ms: Option<u64>,
    pub tool_timeout_ms: Option<u64>,
    pub scope: McpScope,
    pub enabled: bool,
    /// Source file path (for diagnostics / UX)
    pub source_file: Option<String>,
}

/// MCP test connection result
#[derive(Debug, Clone, Serialize)]
pub struct McpTestResult {
    pub success: bool,
    pub protocol_version: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tool_count: Option<u32>,
    pub tool_names: Vec<String>,
    pub response_time_ms: u64,
    pub stdout_summary: Option<String>,
    pub stderr_summary: Option<String>,
    pub suggestions: Vec<String>,
}

/// A discovered config source: (path, scope)
struct McpSource {
    path: PathBuf,
    scope: McpScope,
}

/// List all MCP servers by discovering and merging config sources.
/// Layered merge rule: User < Project < Local (later scope overrides earlier)
pub fn list_servers() -> AppResult<Vec<McpServerDef>> {
    let sources = discover_sources();
    let mut servers: Vec<McpServerDef> = Vec::new();

    for src in &sources {
        if !src.path.exists() {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&src.path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                // Try both "mcpServers" (camelCase) and "mcp_servers" (snake_case) keys
                let mcp_obj = json
                    .get("mcpServers")
                    .or_else(|| json.get("mcp_servers"))
                    .and_then(|v| v.as_object());

                if let Some(obj) = mcp_obj {
                    for (name, config) in obj {
                        // Skip if already discovered from a higher-priority scope
                        if servers.iter().any(|s: &McpServerDef| s.name == *name) {
                            continue;
                        }
                        if let Some(server) = parse_mcp_entry(name, config, src) {
                            servers.push(server);
                        }
                    }
                }
                // Also scan projects.*.mcpServers (Claude Code project-scoped MCP config)
                if let Some(projects) = json.get("projects").and_then(|v| v.as_object()) {
                    for (_proj_path, proj_cfg) in projects {
                        if let Some(p_ms) = proj_cfg.get("mcpServers").and_then(|v| v.as_object()) {
                            for (name, config) in p_ms {
                                if servers.iter().any(|s: &McpServerDef| s.name == *name) {
                                    continue;
                                }
                                if let Some(server) = parse_mcp_entry(name, config, src) {
                                    servers.push(server);
                                }
                            }
                        }
                    }
                }

                // Also check if the root has "name" + "command" — single server format
                if json.get("command").is_some() && json.get("name").is_some() {
                    let name = json
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unnamed");
                    if !servers.iter().any(|s| s.name == name) {
                        if let Some(server) = parse_mcp_entry(name, &json, src) {
                            servers.push(server);
                        }
                    }
                }
            }
            // If JSON parsing fails, skip silently (malformed file)
        }
    }

    Ok(servers)
}

/// Discover all config sources across scopes
fn discover_sources() -> Vec<McpSource> {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let appdata = std::env::var("APPDATA").unwrap_or_default();

    let mut sources = Vec::new();

    // ── User scope (lowest priority) ──
    let claude_dir = std::path::Path::new(&home).join(".claude");

    // %USERPROFILE%\.claude\settings.json — primary user config
    sources.push(McpSource {
        path: claude_dir.join("settings.json"),
        scope: McpScope::User,
    });

    // %USERPROFILE%\.claude\claude.json — alternative user config
    sources.push(McpSource {
        path: claude_dir.join("claude.json"),
        scope: McpScope::User,
    });

    // %USERPROFILE%\.claude\mcp.json — standalone MCP config (Claude Code Desktop)
    sources.push(McpSource {
        path: claude_dir.join("mcp.json"),
        scope: McpScope::User,
    });

    // %USERPROFILE%\.claude\settings.local.json — local user overrides
    sources.push(McpSource {
        path: claude_dir.join("settings.local.json"),
        scope: McpScope::User,
    });

    // %USERPROFILE%\.claude.json — Claude Code CLI user config (root-level single file)
    sources.push(McpSource {
        path: std::path::Path::new(&home).join(".claude.json"),
        scope: McpScope::User,
    });

    // %APPDATA%\Claude\claude_desktop_config.json — Claude Desktop app
    if !appdata.is_empty() {
        sources.push(McpSource {
            path: std::path::Path::new(&appdata)
                .join("Claude")
                .join("claude_desktop_config.json"),
            scope: McpScope::User,
        });
    }

    // ── Project scope (medium priority) ──
    // .mcp.json in current working directory
    sources.push(McpSource {
        path: PathBuf::from(".mcp.json"),
        scope: McpScope::Project,
    });

    // .claude/settings.json in project directory
    sources.push(McpSource {
        path: PathBuf::from(".claude").join("settings.json"),
        scope: McpScope::Project,
    });

    // .claude/mcp.json in project directory
    sources.push(McpSource {
        path: PathBuf::from(".claude").join("mcp.json"),
        scope: McpScope::Project,
    });

    // ── Local scope (highest priority) ──
    // .claude/settings.local.json in project directory
    sources.push(McpSource {
        path: PathBuf::from(".claude").join("settings.local.json"),
        scope: McpScope::Local,
    });

    sources
}

fn parse_mcp_entry(
    name: &str,
    config: &serde_json::Value,
    src: &McpSource,
) -> Option<McpServerDef> {
    let type_str = config
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("stdio");
    let type_ = match type_str {
        "http" | "sse" => McpTransportType::Http,
        _ => McpTransportType::Stdio,
    };

    Some(McpServerDef {
        name: name.to_string(),
        type_,
        command: config
            .get("command")
            .and_then(|v| v.as_str())
            .map(String::from),
        args: config.get("args").and_then(|v| v.as_array()).map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        }),
        url: config.get("url").and_then(|v| v.as_str()).map(String::from),
        headers: None,
        env: None,
        cwd: config.get("cwd").and_then(|v| v.as_str()).map(String::from),
        timeout_ms: config.get("timeoutMs").and_then(serde_json::Value::as_u64),
        tool_timeout_ms: None,
        scope: src.scope.clone(),
        enabled: true,
        source_file: Some(src.path.to_string_lossy().to_string()),
    })
}

/// Update an MCP server entry in its source file (atomic write with backup)
pub fn update_server_config(
    source_file: &str,
    name: &str,
    config_json: &serde_json::Value,
    original_name: Option<&str>,
) -> AppResult<()> {
    // SECURITY: confine writes to known MCP config locations
    let roots = crate::security::mcp_allowed_roots();
    let root_refs: Vec<&std::path::Path> = roots.iter().map(std::path::PathBuf::as_path).collect();
    let files = crate::security::mcp_allowed_files();
    let file_refs: Vec<&std::path::Path> = files.iter().map(std::path::PathBuf::as_path).collect();
    let path = crate::security::sanitize_path(source_file, &root_refs, &file_refs)?;
    let content = if path.exists() {
        std::fs::read_to_string(&path)?
    } else {
        "{}".to_string()
    };

    let mut root: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
        crate::error::AppError::new("CONFIG_PARSE_ERROR", "JSON 格式无效", "")
            .with_details(e.to_string())
    })?;
    if !root.is_object() {
        root = serde_json::json!({"mcpServers":{}});
    }
    if root.get("mcpServers").is_none() {
        if let Some(obj) = root.as_object_mut() {
            obj.insert("mcpServers".into(), serde_json::json!({}));
        }
    }
    if let Some(orig) = original_name {
        if orig != name {
            if let Some(o) = root.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
                o.remove(orig);
            }
        }
    }
    if let Some(o) = root.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
        o.insert(name.into(), config_json.clone());
    }
    crate::config::write_config_inner(
        &path,
        &serde_json::to_string_pretty(&root).map_err(|e| {
            crate::error::AppError::new("WRITE_ERROR", "序列化失败", "").with_details(e.to_string())
        })?,
    )?;
    log::info!("MCP '{name}' saved to {source_file}");
    Ok(())
}

/// Delete an MCP server entry from its source file
pub fn delete_server_config(source_file: &str, name: &str) -> AppResult<()> {
    // SECURITY: confine deletes to known MCP config locations
    let roots = crate::security::mcp_allowed_roots();
    let root_refs: Vec<&std::path::Path> = roots.iter().map(std::path::PathBuf::as_path).collect();
    let files = crate::security::mcp_allowed_files();
    let file_refs: Vec<&std::path::Path> = files.iter().map(std::path::PathBuf::as_path).collect();
    let path = crate::security::sanitize_path(source_file, &root_refs, &file_refs)?;
    if !path.exists() {
        return Ok(());
    }
    let content = std::fs::read_to_string(&path)?;
    let mut root: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
        crate::error::AppError::new("CONFIG_PARSE_ERROR", "JSON 格式无效", "")
            .with_details(e.to_string())
    })?;
    if let Some(o) = root.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
        o.remove(name);
    }
    crate::config::write_config_inner(
        &path,
        &serde_json::to_string_pretty(&root).map_err(|e| {
            crate::error::AppError::new("WRITE_ERROR", "序列化失败", "").with_details(e.to_string())
        })?,
    )?;
    log::info!("MCP '{name}' deleted");
    Ok(())
}

/// Test a stdio MCP server by starting it and performing a real initialization handshake
pub async fn test_stdio_server(def: &McpServerDef) -> McpTestResult {
    use std::time::{Duration, Instant};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let start = Instant::now();

    let command = match &def.command {
        Some(cmd) => cmd,
        None => {
            return McpTestResult {
                success: false,
                protocol_version: None,
                server_name: None,
                server_version: None,
                tool_count: None,
                tool_names: vec![],
                response_time_ms: start.elapsed().as_millis() as u64,
                stdout_summary: None,
                stderr_summary: None,
                suggestions: vec!["MCP 服务器未指定 command。".to_string()],
            }
        }
    };

    // SECURITY: validate command before spawning (defends against malicious
    // config entries discovered by list_servers, which bypass the IPC layer).
    if let Err(e) = crate::security::validate_mcp_command(command) {
        return McpTestResult {
            success: false,
            protocol_version: None,
            server_name: None,
            server_version: None,
            tool_count: None,
            tool_names: vec![],
            response_time_ms: start.elapsed().as_millis() as u64,
            stdout_summary: Some(format!("命令校验失败: {e}")),
            stderr_summary: None,
            suggestions: vec!["命令包含非法字符或路径穿越，已拒绝执行。".to_string()],
        };
    }

    let mut child = match tokio::process::Command::new(command)
        .args(def.args.clone().unwrap_or_default())
        .kill_on_drop(true)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return McpTestResult {
                success: false,
                protocol_version: None,
                server_name: None,
                server_version: None,
                tool_count: None,
                tool_names: vec![],
                response_time_ms: start.elapsed().as_millis() as u64,
                stdout_summary: Some(format!("启动失败: {e}")),
                stderr_summary: None,
                suggestions: vec![format!("请检查 command '{}' 是否存在/可执行。", command)],
            }
        }
    };

    // SAFETY: stdin/stdout/stderr were configured as `Stdio::piped()` above, so
    // `take()` always yields `Some` here. These unwraps cannot be triggered by
    // user input.
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let reader = BufReader::new(stdout);
    let stderr_reader = BufReader::new(stderr);
    let mut lines = reader.lines();

    // Send initialize request
    let init_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": { "name": "claude-code-manager", "version": "0.1.0" }
        }
    });

    // SAFETY: serializing a `serde_json::Value` never fails.
    let mut init_str = serde_json::to_string(&init_request).unwrap();
    init_str.push('\n');

    // Write to stdin
    let mut writer = stdin;
    if let Err(e) = writer.write_all(init_str.as_bytes()).await {
        let _ = child.kill().await;
        return McpTestResult {
            success: false,
            protocol_version: None,
            server_name: None,
            server_version: None,
            tool_count: None,
            tool_names: vec![],
            response_time_ms: start.elapsed().as_millis() as u64,
            stdout_summary: Some(format!("写入 stdin 失败: {e}")),
            stderr_summary: None,
            suggestions: vec!["检查 MCP 服务器进程是否可接收输入。".to_string()],
        };
    }
    drop(writer);

    // Read response with timeout
    let timeout_dur = Duration::from_secs(def.timeout_ms.unwrap_or(10000) / 1000);
    let read_result = tokio::time::timeout(timeout_dur, async {
        let mut response_lines = Vec::new();
        loop {
            tokio::select! {
                line = lines.next_line() => {
                    match line {
                        Ok(Some(l)) => {
                            response_lines.push(l.clone());
                            // Try to parse accumulated lines as JSON.
                            // Only return when we have a complete parseable JSON-RPC response.
                            // This handles both compact (single-line) and pretty-printed (multi-line) responses.
                            let combined = response_lines.join("\n");
                            if serde_json::from_str::<serde_json::Value>(&combined).is_ok() {
                                return Ok::<Vec<String>, String>(response_lines);
                            }
                        }
                        Ok(None) => break,
                        Err(e) => return Err(format!("读取错误: {e}")),
                    }
                }
                () = tokio::time::sleep(Duration::from_millis(50)) => {}
            }
        }
        Ok(response_lines)
    })
    .await;

    // Collect stderr summary
    let mut stderr_lines = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(2), async {
        let mut err_lines = stderr_reader.lines();
        while let Ok(Some(line)) = err_lines.next_line().await {
            stderr_lines.push(line);
        }
    })
    .await;

    // Cleanup
    let _ = child.kill().await;
    let _ = child.wait().await;
    let elapsed_ms = start.elapsed().as_millis() as u64;

    match read_result {
        Ok(Ok(response_lines)) => {
            let response_text = response_lines.join("\n");
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&response_text) {
                if let Some(result) = parsed.get("result") {
                    let protocol = result
                        .get("protocolVersion")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let server_info = result.get("serverInfo");
                    let s_name = server_info
                        .and_then(|i| i.get("name"))
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let s_ver = server_info
                        .and_then(|i| i.get("version"))
                        .and_then(|v| v.as_str())
                        .map(String::from);

                    // Report capabilities
                    let mut tool_names = Vec::new();
                    if let Some(caps) = result.get("capabilities") {
                        if caps.get("tools").is_some() {
                            tool_names.push("工具列表可用".to_string());
                        }
                    }

                    return McpTestResult {
                        success: true,
                        protocol_version: protocol,
                        server_name: s_name,
                        server_version: s_ver,
                        tool_count: Some(tool_names.len() as u32),
                        tool_names,
                        response_time_ms: elapsed_ms,
                        stdout_summary: Some(response_text.chars().take(200).collect()),
                        stderr_summary: if stderr_lines.is_empty() {
                            None
                        } else {
                            Some(stderr_lines.join("\n").chars().take(200).collect())
                        },
                        suggestions: if stderr_lines.is_empty() {
                            vec![]
                        } else {
                            vec!["stderr 中有输出，可能是非致命警告。".to_string()]
                        },
                    };
                }
            }
            McpTestResult {
                success: false,
                protocol_version: None,
                server_name: None,
                server_version: None,
                tool_count: None,
                tool_names: vec![],
                response_time_ms: elapsed_ms,
                stdout_summary: Some(response_text.chars().take(200).collect()),
                stderr_summary: if stderr_lines.is_empty() {
                    None
                } else {
                    Some(stderr_lines.join("\n").chars().take(200).collect())
                },
                suggestions: vec!["MCP 服务器未能正确响应 initialize 请求。".to_string()],
            }
        }
        _ => McpTestResult {
            success: false,
            protocol_version: None,
            server_name: None,
            server_version: None,
            tool_count: None,
            tool_names: vec![],
            response_time_ms: elapsed_ms,
            stdout_summary: None,
            stderr_summary: if stderr_lines.is_empty() {
                None
            } else {
                Some(stderr_lines.join("\n").chars().take(200).collect())
            },
            suggestions: vec!["MCP 服务器未在超时时间内响应。".to_string()],
        },
    }
}

/// Test an HTTP MCP server
pub async fn test_http_server(def: &McpServerDef) -> McpTestResult {
    use std::time::Instant;
    let start = Instant::now();
    let mut suggestions: Vec<String> = Vec::new();

    let url = match &def.url {
        Some(u) => u.trim_end_matches('/').to_string(),
        None => {
            return McpTestResult {
                success: false,
                protocol_version: None,
                server_name: None,
                server_version: None,
                tool_count: None,
                tool_names: vec![],
                response_time_ms: start.elapsed().as_millis() as u64,
                stdout_summary: None,
                stderr_summary: None,
                suggestions: vec!["HTTP MCP 未指定 URL。".to_string()],
            }
        }
    };

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .danger_accept_invalid_certs(false)
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return McpTestResult {
                success: false,
                protocol_version: None,
                server_name: None,
                server_version: None,
                tool_count: None,
                tool_names: vec![],
                response_time_ms: start.elapsed().as_millis() as u64,
                stdout_summary: None,
                stderr_summary: None,
                suggestions: vec![format!("HTTP 客户端初始化失败: {}", e)],
            }
        }
    };

    let init_payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": { "name": "claude-code-manager", "version": "0.1.0" }
        }
    });

    let mcp_url = format!("{url}/v1/mcp");
    match client.post(&mcp_url).json(&init_payload).send().await {
        Ok(resp) => {
            let elapsed_ms = start.elapsed().as_millis() as u64;
            let status = resp.status();

            if status.is_success() {
                match resp.json::<serde_json::Value>().await {
                    Ok(json) => {
                        if let Some(result) = json.get("result") {
                            let protocol = result
                                .get("protocolVersion")
                                .and_then(|v| v.as_str())
                                .map(String::from);
                            let server_info = result.get("serverInfo");
                            let s_name = server_info
                                .and_then(|i| i.get("name"))
                                .and_then(|v| v.as_str())
                                .map(String::from);
                            let s_ver = server_info
                                .and_then(|i| i.get("version"))
                                .and_then(|v| v.as_str())
                                .map(String::from);
                            return McpTestResult {
                                success: true,
                                protocol_version: protocol,
                                server_name: s_name,
                                server_version: s_ver,
                                tool_count: None,
                                tool_names: vec![],
                                response_time_ms: elapsed_ms,
                                stdout_summary: None,
                                stderr_summary: None,
                                suggestions: vec![],
                            };
                        }
                        McpTestResult {
                            success: false,
                            protocol_version: None,
                            server_name: None,
                            server_version: None,
                            tool_count: None,
                            tool_names: vec![],
                            response_time_ms: elapsed_ms,
                            stdout_summary: Some(json.to_string().chars().take(200).collect()),
                            stderr_summary: None,
                            suggestions: vec!["MCP 初始化响应格式不正确。".to_string()],
                        }
                    }
                    Err(e) => McpTestResult {
                        success: false,
                        protocol_version: None,
                        server_name: None,
                        server_version: None,
                        tool_count: None,
                        tool_names: vec![],
                        response_time_ms: elapsed_ms,
                        stdout_summary: Some(format!("JSON 解析错误: {e}")),
                        stderr_summary: None,
                        suggestions: vec!["服务器返回了非 JSON 响应。".to_string()],
                    },
                }
            } else if status.as_u16() == 401 || status.as_u16() == 403 {
                suggestions.push("可能需要 OAuth 或 API Token。".to_string());
                McpTestResult {
                    success: false,
                    protocol_version: None,
                    server_name: None,
                    server_version: None,
                    tool_count: None,
                    tool_names: vec![],
                    response_time_ms: elapsed_ms,
                    stdout_summary: Some(format!("HTTP {status}")),
                    stderr_summary: None,
                    suggestions,
                }
            } else {
                suggestions.push(format!(
                    "服务器返回 HTTP {}，请检查 URL 和配置。",
                    status.as_u16()
                ));
                McpTestResult {
                    success: false,
                    protocol_version: None,
                    server_name: None,
                    server_version: None,
                    tool_count: None,
                    tool_names: vec![],
                    response_time_ms: elapsed_ms,
                    stdout_summary: Some(format!("HTTP {status}")),
                    stderr_summary: None,
                    suggestions,
                }
            }
        }
        Err(e) => {
            let elapsed_ms = start.elapsed().as_millis() as u64;
            if e.is_timeout() {
                suggestions.push("连接超时，请检查网络和目标服务器。".to_string());
            } else if e.is_connect() {
                suggestions.push("无法连接，请检查 DNS 和网络。".to_string());
            } else if e.is_status() {
                suggestions.push("TLS 错误，请检查证书。".to_string());
            }
            McpTestResult {
                success: false,
                protocol_version: None,
                server_name: None,
                server_version: None,
                tool_count: None,
                tool_names: vec![],
                response_time_ms: elapsed_ms,
                stdout_summary: Some(e.to_string().chars().take(200).collect()),
                stderr_summary: None,
                suggestions,
            }
        }
    }
}

/// Run MCP test based on transport type
pub async fn test_server(def: &McpServerDef) -> McpTestResult {
    match def.type_ {
        McpTransportType::Stdio => test_stdio_server(def).await,
        McpTransportType::Http => test_http_server(def).await,
    }
}
