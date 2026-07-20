// Claude Code Manager - Config file commands
use serde::Serialize;
use crate::config::ConfigFileInfo;

#[tauri::command]
pub async fn list_config_files(
) -> Result<Vec<ConfigFileInfo>, String> {
    crate::config::list_config_files().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_config_file(
    scope: String,
) -> Result<Option<crate::config::ConfigContent>, String> {
    let scope = crate::config::ConfigScope::from_str(&scope)
        .ok_or_else(|| format!("Unknown config scope: {}", scope))?;
    crate::config::read_config(&scope).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_config_file(
    scope: String,
    content: String,
) -> Result<(), String> {
    let scope = crate::config::ConfigScope::from_str(&scope)
        .ok_or_else(|| format!("Unknown config scope: {}", scope))?;
    crate::config::write_config(&scope, &content).map_err(|e| e.to_string())
}
