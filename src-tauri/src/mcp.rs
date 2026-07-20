// Claude Code Manager - MCP server management
use crate::error::AppResult;
use serde::{Serialize, Deserialize};

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

/// List all MCP servers from all scopes
pub fn list_servers() -> AppResult<Vec<McpServerDef>> {
    let mut servers = Vec::new();

    // Read from user-level ~/.claude/settings.json
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let user_settings = std::path::Path::new(&home).join(".claude").join("settings.json");
    if let Ok(content) = std::fs::read_to_string(&user_settings) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(mcp) = json.get("mcpServers").and_then(|v| v.as_object()) {
                for (name, config) in mcp {
                    if let Some(server) = parse_mcp_entry(name, config, McpScope::User) {
                        servers.push(server);
                    }
                }
            }
        }
    }

    // Read from project .mcp.json (relative to cwd)
    let project_mcp = std::path::Path::new(".mcp.json");
    if project_mcp.exists() {
        if let Ok(content) = std::fs::read_to_string(project_mcp) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(mcp) = json.get("mcpServers").and_then(|v| v.as_object()) {
                    for (name, config) in mcp {
                        if let Some(server) = parse_mcp_entry(name, config, McpScope::Project) {
                            servers.push(server);
                        }
                    }
                }
            }
        }
    }

    Ok(servers)
}

fn parse_mcp_entry(name: &str, config: &serde_json::Value, scope: McpScope) -> Option<McpServerDef> {
    let type_str = config.get("type").and_then(|v| v.as_str()).unwrap_or("stdio");
    let type_ = match type_str {
        "http" => McpTransportType::Http,
        _ => McpTransportType::Stdio,
    };

    Some(McpServerDef {
        name: name.to_string(),
        type_,
        command: config.get("command").and_then(|v| v.as_str()).map(String::from),
        args: config.get("args").and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()),
        url: config.get("url").and_then(|v| v.as_str()).map(String::from),
        headers: None,
        env: None,
        cwd: config.get("cwd").and_then(|v| v.as_str()).map(String::from),
        timeout_ms: config.get("timeoutMs").and_then(|v| v.as_u64()),
        tool_timeout_ms: None,
        scope,
        enabled: true,
    })
}

/// Test a stdio MCP server by starting it and performing a real initialization handshake
pub async fn test_stdio_server(def: &McpServerDef) -> McpTestResult {
    use tokio::process::Command;
    use tokio::io::{AsyncWriteExt, AsyncBufReadExt, BufReader};
    use std::time::Instant;
    use std::time::Duration;

    let start = Instant::now();
    let mut suggestions: Vec<String> = Vec::new();

    let command = match &def.command {
        Some(cmd) => cmd,
        None => return McpTestResult {
            success: false, protocol_version: None, server_name: None,
            server_version: None, tool_count: None, tool_names: vec![],
            response_time_ms: start.elapsed().as_millis() as u64,
            stdout_summary: None, stderr_summary: None,
            suggestions: vec!["MCP 服务器未指定 command。".to_string()],
        },
    };

    let mut child = match Command::new(command)
        .args(def.args.clone().unwrap_or_default())
        .kill_on_drop(true)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return McpTestResult {
            success: false, protocol_version: None, server_name: None,
            server_version: None, tool_count: None, tool_names: vec![],
            response_time_ms: start.elapsed().as_millis() as u64,
            stdout_summary: Some(format!("启动失败: {}", e)),
            stderr_summary: None,
            suggestions: vec![format!("请检查 command '{}' 是否存在/可执行。", command)],
        },
    };

    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let reader = BufReader::new(stdout);
    let mut stderr_reader = BufReader::new(stderr);
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

    let mut init_str = serde_json::to_string(&init_request).unwrap();
    init_str.push('\n');

    // Write to stdin
    let mut writer = stdin;
    if let Err(e) = writer.write_all(init_str.as_bytes()).await {
        let _ = child.kill().await;
        return McpTestResult {
            success: false, protocol_version: None, server_name: None,
            server_version: None, tool_count: None, tool_names: vec![],
            response_time_ms: start.elapsed().as_millis() as u64,
            stdout_summary: Some(format!("写入 stdin 失败: {}", e)),
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
                            if l.contains("\"result\"") || l.contains("\"error\"") {
                                return Ok::<Vec<String>, String>(response_lines);
                            }
                        }
                        Ok(None) => break,
                        Err(e) => return Err(format!("读取错误: {}", e)),
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(50)) => {}
            }
        }
        Ok(response_lines)
    }).await;

    // Collect stderr summary
    let mut stderr_lines = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(2), async {
        let mut err_lines = stderr_reader.lines();
        while let Ok(Some(line)) = err_lines.next_line().await {
            stderr_lines.push(line);
        }
    }).await;

    // Cleanup
    let _ = child.kill().await;
    let _ = child.wait().await;
    let elapsed_ms = start.elapsed().as_millis() as u64;

    match read_result {
        Ok(Ok(response_lines)) => {
            let response_text = response_lines.join("\n");
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&response_text) {
                if let Some(result) = parsed.get("result") {
                    let protocol = result.get("protocolVersion").and_then(|v| v.as_str()).map(String::from);
                    let server_info = result.get("serverInfo");
                    let s_name = server_info.and_then(|i| i.get("name")).and_then(|v| v.as_str()).map(String::from);
                    let s_ver = server_info.and_then(|i| i.get("version")).and_then(|v| v.as_str()).map(String::from);

                    // Send tools/list request
                    // (simplified: report initialization success)
                    let mut tool_names = Vec::new();
                    if let Some(caps) = result.get("capabilities") {
                        if let Some(tools_cap) = caps.get("tools") {
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
                        stderr_summary: if stderr_lines.is_empty() { None } else {
                            Some(stderr_lines.join("\n").chars().take(200).collect())
                        },
                        suggestions: if stderr_lines.is_empty() { vec![] } else {
                            vec!["stderr 中有输出，可能是非致命警告。".to_string()]
                        },
                    };
                }
            }
            McpTestResult {
                success: false, protocol_version: None, server_name: None,
                server_version: None, tool_count: None, tool_names: vec![],
                response_time_ms: elapsed_ms,
                stdout_summary: Some(response_text.chars().take(200).collect()),
                stderr_summary: if stderr_lines.is_empty() { None } else {
                    Some(stderr_lines.join("\n").chars().take(200).collect())
                },
                suggestions: vec!["MCP 服务器未能正确响应 initialize 请求。".to_string()],
            }
        }
        _ => McpTestResult {
            success: false, protocol_version: None, server_name: None,
            server_version: None, tool_count: None, tool_names: vec![],
            response_time_ms: elapsed_ms,
            stdout_summary: None,
            stderr_summary: if stderr_lines.is_empty() { None } else {
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
        None => return McpTestResult {
            success: false, protocol_version: None, server_name: None,
            server_version: None, tool_count: None, tool_names: vec![],
            response_time_ms: start.elapsed().as_millis() as u64,
            stdout_summary: None, stderr_summary: None,
            suggestions: vec!["HTTP MCP 未指定 URL。".to_string()],
        },
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .danger_accept_invalid_certs(false)
        .build().unwrap();

    // Try DNS resolution first by making a simple request
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

    let mcp_url = format!("{}/v1/mcp", url);
    match client.post(&mcp_url).json(&init_payload).send().await {
        Ok(resp) => {
            let elapsed_ms = start.elapsed().as_millis() as u64;
            let status = resp.status();

            if status.is_success() {
                match resp.json::<serde_json::Value>().await {
                    Ok(json) => {
                        if let Some(result) = json.get("result") {
                            let protocol = result.get("protocolVersion")
                                .and_then(|v| v.as_str()).map(String::from);
                            let server_info = result.get("serverInfo");
                            let s_name = server_info.and_then(|i| i.get("name"))
                                .and_then(|v| v.as_str()).map(String::from);
                            let s_ver = server_info.and_then(|i| i.get("version"))
                                .and_then(|v| v.as_str()).map(String::from);
                            return McpTestResult {
                                success: true, protocol_version: protocol,
                                server_name: s_name, server_version: s_ver,
                                tool_count: None, tool_names: vec![],
                                response_time_ms: elapsed_ms,
                                stdout_summary: None, stderr_summary: None,
                                suggestions: vec![],
                            };
                        }
                        McpTestResult {
                            success: false, protocol_version: None,
                            server_name: None, server_version: None,
                            tool_count: None, tool_names: vec![],
                            response_time_ms: elapsed_ms,
                            stdout_summary: Some(json.to_string().chars().take(200).collect()),
                            stderr_summary: None,
                            suggestions: vec!["MCP 初始化响应格式不正确。".to_string()],
                        }
                    }
                    Err(e) => McpTestResult {
                        success: false, protocol_version: None,
                        server_name: None, server_version: None,
                        tool_count: None, tool_names: vec![],
                        response_time_ms: elapsed_ms,
                        stdout_summary: Some(format!("JSON 解析错误: {}", e)),
                        stderr_summary: None,
                        suggestions: vec!["服务器返回了非 JSON 响应。".to_string()],
                    }
                }
            } else if status.as_u16() == 401 || status.as_u16() == 403 {
                suggestions.push("可能需要 OAuth 或 API Token。".to_string());
                McpTestResult {
                    success: false, protocol_version: None,
                    server_name: None, server_version: None,
                    tool_count: None, tool_names: vec![],
                    response_time_ms: elapsed_ms,
                    stdout_summary: Some(format!("HTTP {}", status)),
                    stderr_summary: None,
                    suggestions,
                }
            } else {
                suggestions.push(format!("服务器返回 HTTP {}，请检查 URL 和配置。", status.as_u16()));
                McpTestResult {
                    success: false, protocol_version: None,
                    server_name: None, server_version: None,
                    tool_count: None, tool_names: vec![],
                    response_time_ms: elapsed_ms,
                    stdout_summary: Some(format!("HTTP {}", status)),
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
                success: false, protocol_version: None,
                server_name: None, server_version: None,
                tool_count: None, tool_names: vec![],
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
