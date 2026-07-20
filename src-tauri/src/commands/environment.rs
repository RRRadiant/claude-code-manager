// Claude Code Manager - Environment detection commands
use crate::environment;
use tauri::State;

#[tauri::command]
pub async fn detect_environment(
    app_handle: tauri::AppHandle,
    state: State<'_, crate::AppState>,
) -> Result<environment::EnvironmentStatus, String> {
    log::info!("Environment detection requested");
    let result = environment::detect_environment();
    Ok(result)
}

#[tauri::command]
pub async fn check_path(
    state: State<'_, crate::AppState>,
) -> Result<environment::PathCheck, String> {
    log::info!("PATH check requested");
    Ok(environment::check_path())
}
