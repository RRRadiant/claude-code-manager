use tauri::Manager;
use crate::installer;

#[tauri::command]
pub async fn install_claude_code(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    let task_id = state.task_manager.create_task(
        crate::task::TaskType::InstallClaudeCode,
        "安装 Claude Code".to_string(),
        true,
    );
    state.task_manager.start_task(&task_id, &app_handle);
    let handle = app_handle.clone();
    let tid = task_id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = installer::install_claude_code(&tid, &handle).await {
            eprintln!("Install failed: {}", e);
        }
    });
    Ok(task_id)
}

#[tauri::command]
pub async fn uninstall_claude_code(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    let task_id = state.task_manager.create_task(
        crate::task::TaskType::UninstallClaudeCode,
        "卸载 Claude Code".to_string(),
        true,
    );
    state.task_manager.start_task(&task_id, &app_handle);
    let handle = app_handle.clone();
    let tid = task_id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = installer::uninstall_claude_code(&tid, &handle).await {
            eprintln!("Uninstall failed: {}", e);
        }
    });
    Ok(task_id)
}
