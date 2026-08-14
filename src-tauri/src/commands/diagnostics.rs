use crate::error::AppError;

#[tauri::command]
pub async fn run_diagnostics() -> Result<crate::diagnostics::DiagnosticReport, AppError> {
    log::info!("Running full diagnostics");
    tauri::async_runtime::spawn_blocking(crate::diagnostics::run_all_checks)
        .await
        .map_err(|e| {
            AppError::new(
                crate::error::codes::MODEL_DETECTION_FAILED,
                "诊断执行失败",
                format!("诊断任务失败: {e}"),
            )
        })
}
