use crate::error::AppError;

#[tauri::command]
pub async fn run_diagnostics(
) -> Result<crate::diagnostics::DiagnosticReport, AppError> {
    log::info!("Running full diagnostics");
    let report = crate::diagnostics::run_all_checks();
    Ok(report)
}
