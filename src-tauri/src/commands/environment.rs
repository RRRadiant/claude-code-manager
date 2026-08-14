use crate::environment;

#[tauri::command]
pub async fn detect_environment(
) -> Result<environment::EnvironmentStatus, String> {
    log::info!("Environment detection requested");
    tauri::async_runtime::spawn_blocking(environment::detect_environment)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_path(
) -> Result<environment::PathCheck, String> {
    log::info!("PATH check requested");
    tauri::async_runtime::spawn_blocking(environment::check_path)
        .await
        .map_err(|e| e.to_string())
}

/// Refresh Windows environment from registry and return the result.
/// Call this after any install to pick up new PATH entries without restarting.
#[tauri::command]
pub async fn refresh_environment(
) -> Result<crate::env_refresh::RefreshedPath, String> {
    log::info!("Environment refresh requested (registry PATH reload)");
    tauri::async_runtime::spawn_blocking(crate::installer::refresh_env)
        .await
        .map_err(|e| e.to_string())
}

/// Detect node with comprehensive classification (using refreshed PATH)
#[tauri::command]
pub async fn detect_node_detailed(
) -> Result<environment::NodeDetectionResult, String> {
    log::info!("Detailed Node.js detection requested");
    tauri::async_runtime::spawn_blocking(environment::detect_node_classified)
        .await
        .map_err(|e| e.to_string())
}
