use crate::error::AppError;
use crate::installer;
use tauri::Manager;

#[tauri::command]
pub async fn generate_install_plan() -> Result<Vec<installer::InstallStepResult>, String> {
    Ok(installer::generate_install_plan())
}

#[tauri::command]
pub async fn restart_app(app_handle: tauri::AppHandle) -> Result<(), AppError> {
    log::info!("Restarting app on user request");
    // Brief delay so the frontend can show a message
    std::thread::sleep(std::time::Duration::from_millis(500));
    app_handle.restart();
    Ok(())
}

#[tauri::command]
pub async fn run_claude() -> Result<String, AppError> {
    use std::os::windows::process::CommandExt;
    // Open a new terminal window running Claude Code
    let child = std::process::Command::new("cmd")
        .args(["/c", "start", "Claude Code", "cmd", "/k", "claude"])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW — outer cmd is just a launcher
        .spawn()
        .map_err(|e| AppError::new(
            crate::error::codes::INSTALL_DOWNLOAD_FAILED,
            "启动 Claude Code 失败",
            "无法在新终端启动 Claude Code。",
        ).with_details(e.to_string()))?;
    log::info!("Claude Code launched in new terminal (pid={})", child.id());
    Ok("Claude Code 已在新的终端窗口中启动".to_string())
}

#[tauri::command]
pub async fn detect_node_js() -> Result<serde_json::Value, String> {
    let node_ver = installer::detect_node();
    let npm_ver = installer::detect_npm();
    Ok(serde_json::json!({ "node": node_ver, "npm": npm_ver }))
}

#[tauri::command]
pub async fn install_claude_code(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, AppError> {
    let task_id = state.task_manager.create_task(
        crate::task::TaskType::InstallClaudeCode,
        "安装 Claude Code".into(),
        true,
    );
    state.task_manager.start_task(&task_id, &app_handle);
    let app = app_handle.clone();
    let tid = task_id.clone();
    tauri::async_runtime::spawn(async move {
        let state2 = app.state::<crate::AppState>();
        match installer::install_claude(&tid, &app).await {
            Ok(r) => {
                log::info!("Claude Code install: {}", r.message);
                if r.success {
                    state2.task_manager.succeed_task(&tid, &app);
                } else {
                    state2.task_manager.fail_task(&tid, r.message, &app);
                }
            }
            Err(e) => {
                log::error!("Claude Code install failed: {}", e);
                state2.task_manager.fail_task(&tid, e.to_string(), &app);
            }
        }
    });
    Ok(task_id)
}

#[tauri::command]
pub async fn install_full_environment(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, AppError> {
    let task_id = state.task_manager.create_task(
        crate::task::TaskType::InstallClaudeCode,
        "安装完整环境".into(),
        true,
    );
    state.task_manager.start_task(&task_id, &app_handle);
    let app = app_handle.clone();
    let tid = task_id.clone();
    tauri::async_runtime::spawn(async move {
        let state2 = app.state::<crate::AppState>();
        match installer::run_full_install(&tid, &app).await {
            Ok(results) => {
                let all_ok = results.iter().all(|r| r.success);
                log::info!("Full install completed: {} steps, all_success={}", results.len(), all_ok);
                if all_ok {
                    state2.task_manager.succeed_task(&tid, &app);
                } else {
                    // Partial failure — surface the first failing step's message.
                    let msg = results.iter()
                        .find(|r| !r.success)
                        .map(|r| r.message.clone())
                        .unwrap_or_else(|| "部分组件安装失败".to_string());
                    state2.task_manager.fail_task(&tid, msg, &app);
                }
            }
            Err(e) => {
                log::error!("Full install failed: {}", e);
                state2.task_manager.fail_task(&tid, e.to_string(), &app);
            }
        }
    });
    Ok(task_id)
}

#[tauri::command]
pub async fn uninstall_claude_code(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, AppError> {
    let task_id = state.task_manager.create_task(
        crate::task::TaskType::UninstallClaudeCode,
        "卸载 Claude Code".into(),
        true,
    );
    state.task_manager.start_task(&task_id, &app_handle);
    let app = app_handle.clone();
    let tid = task_id.clone();
    tauri::async_runtime::spawn(async move {
        let state2 = app.state::<crate::AppState>();
        match installer::uninstall_claude(&tid, &app).await {
            Ok(r) => {
                log::info!("Claude Code uninstall: {}", r.message);
                if r.success {
                    state2.task_manager.succeed_task(&tid, &app);
                } else {
                    state2.task_manager.fail_task(&tid, r.message, &app);
                }
            }
            Err(e) => {
                log::error!("Claude Code uninstall failed: {}", e);
                state2.task_manager.fail_task(&tid, e.to_string(), &app);
            }
        }
    });
    Ok(task_id)
}
