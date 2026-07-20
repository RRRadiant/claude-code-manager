use crate::mcp::{self, McpServerDef, McpTestResult, McpScope, McpTransportType};

#[tauri::command]
pub async fn list_mcp_servers() -> Result<Vec<McpServerDef>, String> {
    mcp::list_servers().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_mcp_server(name: String, scope: String) -> Result<McpTestResult, String> {
    let servers = mcp::list_servers().map_err(|e| e.to_string())?;
    let server = servers.into_iter()
        .find(|s| s.name == name)
        .ok_or_else(|| format!("MCP server '{}' not found", name))?;
    Ok(mcp::test_server(&server).await)
}

#[tauri::command]
pub async fn test_raw_mcp_stdio(
    command: String, args: Vec<String>,
) -> Result<McpTestResult, String> {
    let def = McpServerDef {
        name: "test".to_string(), type_: McpTransportType::Stdio,
        command: Some(command), args: Some(args), url: None,
        headers: None, env: None, cwd: None,
        timeout_ms: Some(10000), tool_timeout_ms: None,
        scope: McpScope::Local, enabled: true,
    };
    Ok(mcp::test_server(&def).await)
}
