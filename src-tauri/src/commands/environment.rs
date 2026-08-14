use crate::environment;

#[tauri::command]
pub async fn detect_environment(
) -> Result<environment::EnvironmentStatus, String> {
    log::info!("Environment detection requested");
    let result = environment::detect_environment();
    Ok(result)
}

#[tauri::command]
pub async fn check_path(
) -> Result<environment::PathCheck, String> {
    log::info!("PATH check requested");
    Ok(environment::check_path())
}

/// Refresh Windows environment from registry and return the result.
/// Call this after any install to pick up new PATH entries without restarting.
#[tauri::command]
pub async fn refresh_environment(
) -> Result<crate::env_refresh::RefreshedPath, String> {
    log::info!("Environment refresh requested (registry PATH reload)");
    let result = crate::installer::refresh_env();
    Ok(result)
}

/// Detect node with comprehensive classification (using refreshed PATH)
#[tauri::command]
pub async fn detect_node_detailed(
) -> Result<environment::NodeDetectionResult, String> {
    log::info!("Detailed Node.js detection requested");
    Ok(environment::detect_node_classified())
}
