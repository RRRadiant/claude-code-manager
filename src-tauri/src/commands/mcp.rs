use crate::error::AppError;
use crate::mcp::{self, McpScope, McpServerDef, McpTestResult, McpTransportType};

#[tauri::command]
pub async fn list_mcp_servers() -> Result<Vec<McpServerDef>, String> {
    mcp::list_servers().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_mcp_server(name: String) -> Result<McpTestResult, String> {
    let servers = mcp::list_servers().map_err(|e| e.to_string())?;
    let server = servers
        .into_iter()
        .find(|s| s.name == name)
        .ok_or_else(|| format!("MCP server '{name}' not found"))?;
    Ok(mcp::test_server(&server).await)
}

#[tauri::command]
pub async fn update_mcp_server(
    name: String,
    config_json: String,
    source_file: String,
    original_name: Option<String>,
) -> Result<(), AppError> {
    let config: serde_json::Value = serde_json::from_str(&config_json).map_err(|e| {
        crate::error::AppError::new(crate::error::codes::CONFIG_PARSE_ERROR, "JSON 错误", "")
            .with_details(e.to_string())
    })?;
    crate::mcp::update_server_config(&source_file, &name, &config, original_name.as_deref())
}

#[tauri::command]
pub async fn delete_mcp_server(name: String, source_file: String) -> Result<(), AppError> {
    crate::mcp::delete_server_config(&source_file, &name)
}

#[tauri::command]
pub async fn test_raw_mcp_stdio(
    command: String,
    args: Vec<String>,
) -> Result<McpTestResult, AppError> {
    // SECURITY: validate command + every arg before spawning anything.
    // This command accepts raw frontend input, so it is the highest-risk
    // path for command injection / arbitrary execution.
    crate::security::validate_mcp_command(&command)?;
    for arg in &args {
        crate::security::validate_shell_arg(arg)?;
    }

    let def = McpServerDef {
        name: "test".to_string(),
        type_: McpTransportType::Stdio,
        command: Some(command),
        args: Some(args),
        url: None,
        headers: None,
        env: None,
        cwd: None,
        timeout_ms: Some(10000),
        tool_timeout_ms: None,
        scope: McpScope::Local,
        enabled: true,
        source_file: None,
    };
    Ok(mcp::test_server(&def).await)
}
