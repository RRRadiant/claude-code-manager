// Claude Code Manager - Diagnostics commands
use serde::Serialize;
use tauri::State;
use crate::diagnostics::DiagnosticReport;

#[tauri::command]
pub async fn run_diagnostics(
    state: State<'_, crate::AppState>,
) -> Result<crate::diagnostics::DiagnosticReport, String> {
    log::info!("Running full diagnostics");
    let report = crate::diagnostics::run_all_checks();
    Ok(report)
}
