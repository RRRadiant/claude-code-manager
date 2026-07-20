// Claude Code Manager - Task management commands
use crate::task::TaskState;
use tauri::State;

#[tauri::command]
pub async fn get_tasks(
    state: State<'_, crate::AppState>,
) -> Result<Vec<TaskState>, String> {
    let tasks = state.task_manager.get_all_tasks();
    Ok(tasks)
}

#[tauri::command]
pub async fn cancel_task(
    id: String,
    state: State<'_, crate::AppState>,
) -> Result<bool, String> {
    Ok(state.task_manager.cancel_task(&id))
}

#[tauri::command]
pub async fn clear_tasks(
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    state.task_manager.clear_completed();
    Ok(())
}
