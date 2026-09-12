use crate::error::AppError;
use crate::installer;
use tauri::{Emitter, Manager};

#[tauri::command]
pub async fn generate_install_plan() -> Result<Vec<installer::InstallStepResult>, String> {
    tauri::async_runtime::spawn_blocking(installer::generate_install_plan)
        .await
        .map_err(|e| e.to_string())
}

/// Relaunch the application so it starts with a freshly read environment.
///
/// `AppHandle::restart()` re-executes the binary with the **current process's
/// environment block**, so a PATH this process inherited before Node.js/npm
/// existed is handed straight to the new process — a restart in name only. That
/// is why a freshly installed `claude` stayed invisible until the user launched
/// the app by hand (Explorer passes a PATH read after the installer updated the
/// registry).
///
/// So we spawn the successor ourselves and overwrite `PATH` with the merged
/// registry value, which is exactly what a fresh logon would provide.
#[tauri::command]
pub async fn restart_app(app_handle: tauri::AppHandle) -> Result<(), AppError> {
    log::info!("Restarting app on user request");

    // Brief delay so the frontend can show a message.
    std::thread::sleep(std::time::Duration::from_millis(500));

    let exe = std::env::current_exe().map_err(|e| {
        AppError::new(
            crate::error::codes::INSTALL_DOWNLOAD_FAILED,
            "重启失败",
            "无法定位应用程序路径。",
        )
        .with_details(e.to_string())
    })?;

    // Read the registry directly rather than trusting this process's inherited PATH.
    let merged = crate::env_refresh::refresh_windows_path().merged_path;
    log::info!("Relaunching {} with refreshed PATH", exe.to_string_lossy());

    let mut cmd = std::process::Command::new(&exe);
    cmd.env("PATH", &merged);
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    match cmd.spawn() {
        Ok(child) => {
            log::info!("Successor process started (pid={})", child.id());
            // Exit only after the successor exists, so the app never disappears
            // without a replacement.
            app_handle.exit(0);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to relaunch with refreshed PATH: {e}");
            // Fall back to Tauri's own restart rather than leaving the user stuck.
            app_handle.restart()
        }
    }
}

#[tauri::command]
pub async fn run_claude() -> Result<String, AppError> {
    use std::os::windows::process::CommandExt;
    // Open a new terminal window running Claude Code
    let child = std::process::Command::new("cmd")
        .args(["/c", "start", "Claude Code", "cmd", "/k", "claude"])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW — outer cmd is just a launcher
        .spawn()
        .map_err(|e| {
            AppError::new(
                crate::error::codes::INSTALL_DOWNLOAD_FAILED,
                "启动 Claude Code 失败",
                "无法在新终端启动 Claude Code。",
            )
            .with_details(e.to_string())
        })?;
    log::info!("Claude Code launched in new terminal (pid={})", child.id());
    Ok("Claude Code 已在新的终端窗口中启动".to_string())
}

#[tauri::command]
pub async fn detect_node_js() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let node_ver = installer::detect_node();
        let npm_ver = installer::detect_npm();
        serde_json::json!({ "node": node_ver, "npm": npm_ver })
    })
    .await
    .map_err(|e| e.to_string())
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

                    // The `claude` shim was just created in a directory this
                    // process does not have on its PATH, so ask for a restart —
                    // otherwise the UI keeps reporting "not installed" and looks
                    // like the install failed.
                    if installer::is_claude_restart_needed(std::slice::from_ref(&r)) {
                        log::info!("Claude Code not visible yet; requesting restart");
                        let _ = app.emit(
                            "restart-required",
                            installer::RestartRequest {
                                stage: installer::RestartStage::ClaudeCode,
                            },
                        );
                    }
                    let _ = app.emit("environment-changed", true);
                } else {
                    state2.task_manager.fail_task(&tid, r.message, &app);
                }
            }
            Err(e) => {
                log::error!("Claude Code install failed: {e}");
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
                // The run intentionally stops after Node.js + Git to request a
                // restart, leaving Claude Code pending. That is a successful
                // milestone, not a failure — the dialog is the actionable output.
                let pending_restart = installer::is_pending_restart(&results);
                log::info!(
                    "Full install completed: {} steps, all_success={all_ok}, pending_restart={pending_restart}",
                    results.len()
                );
                if all_ok || pending_restart {
                    state2.task_manager.succeed_task(&tid, &app);
                } else {
                    // Partial failure — surface the first failing step's message.
                    let msg = results
                        .iter()
                        .find(|r| !r.success)
                        .map_or_else(|| "部分组件安装失败".to_string(), |r| r.message.clone());
                    state2.task_manager.fail_task(&tid, msg, &app);
                }
            }
            Err(e) => {
                log::error!("Full install failed: {e}");
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
                log::error!("Claude Code uninstall failed: {e}");
                state2.task_manager.fail_task(&tid, e.to_string(), &app);
            }
        }
    });
    Ok(task_id)
}
