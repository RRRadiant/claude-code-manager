// Claude Code Manager - Unified task system for long-running operations
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

/// Task status
#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum TaskStatus {
    Queued,
    Running,
    Success,
    Failed,
    Cancelled,
}

/// Task type classification
#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum TaskType {
    EnvironmentDetect,
    InstallClaudeCode,
    UninstallClaudeCode,
    UpdateClaudeCode,
    TestConnection,
    DetectModels,
    TestMcp,
    DownloadUpdate,
    InstallUpdate,
    RunDiagnostics,
    ConfigBackup,
    ConfigRestore,
    Unknown,
}

impl TaskType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::EnvironmentDetect => "environment_detect",
            Self::InstallClaudeCode => "install_claude_code",
            Self::UninstallClaudeCode => "uninstall_claude_code",
            Self::UpdateClaudeCode => "update_claude_code",
            Self::TestConnection => "test_connection",
            Self::DetectModels => "detect_models",
            Self::TestMcp => "test_mcp",
            Self::DownloadUpdate => "download_update",
            Self::InstallUpdate => "install_update",
            Self::RunDiagnostics => "run_diagnostics",
            Self::ConfigBackup => "config_backup",
            Self::ConfigRestore => "config_restore",
            Self::Unknown => "unknown",
        }
    }
}

/// Task state shared between backend and frontend
#[derive(Debug, Clone, Serialize)]
pub struct TaskState {
    pub id: String,
    pub type_: String,
    pub status: TaskStatus,
    pub title: String,
    pub current_step: Option<String>,
    pub progress: Option<f64>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub cancellable: bool,
    pub error: Option<String>,
}

/// Internal task handle with cancellation support
struct TaskHandle {
    state: TaskState,
    cancel_flag: Arc<Mutex<bool>>,
}

/// Task manager managing all active tasks
pub struct TaskManager {
    tasks: Arc<Mutex<HashMap<String, TaskHandle>>>,
}

impl TaskManager {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Create a new task and return its ID
    pub fn create_task(
        &self,
        type_: TaskType,
        title: String,
        cancellable: bool,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        let task = TaskHandle {
            state: TaskState {
                id: id.clone(),
                type_: type_.as_str().to_string(),
                status: TaskStatus::Queued,
                title,
                current_step: None,
                progress: None,
                started_at: None,
                finished_at: None,
                cancellable,
                error: None,
            },
            cancel_flag: Arc::new(Mutex::new(false)),
        };

        let mut tasks = self.tasks.lock().expect("task lock poisoned");
        tasks.insert(id.clone(), task);
        id
    }

    /// Start a task (mark as running)
    pub fn start_task(&self, id: &str, app: &AppHandle) {
        let mut tasks = self.tasks.lock().expect("task lock poisoned");
        if let Some(task) = tasks.get_mut(id) {
            task.state.status = TaskStatus::Running;
            task.state.started_at = Some(Utc::now());
            let _ = app.emit("task-updated", task.state.clone());
        }
    }

    /// Update task progress
    pub fn update_progress(
        &self,
        id: &str,
        progress: f64,
        step: Option<String>,
        app: &AppHandle,
    ) {
        let mut tasks = self.tasks.lock().expect("task lock poisoned");
        if let Some(task) = tasks.get_mut(id) {
            task.state.progress = Some(progress);
            task.state.current_step = step;
            let _ = app.emit("task-updated", task.state.clone());
        }
    }

    /// Mark task as succeeded
    pub fn succeed_task(&self, id: &str, app: &AppHandle) {
        let mut tasks = self.tasks.lock().expect("task lock poisoned");
        if let Some(task) = tasks.get_mut(id) {
            task.state.status = TaskStatus::Success;
            task.state.progress = Some(100.0);
            task.state.finished_at = Some(Utc::now());
            let _ = app.emit("task-updated", task.state.clone());
            let _ = app.emit("task-completed", task.state.clone());
        }
    }

    /// Mark task as failed
    pub fn fail_task(&self, id: &str, error: String, app: &AppHandle) {
        let mut tasks = self.tasks.lock().expect("task lock poisoned");
        if let Some(task) = tasks.get_mut(id) {
            task.state.status = TaskStatus::Failed;
            task.state.error = Some(error);
            task.state.finished_at = Some(Utc::now());
            let _ = app.emit("task-updated", task.state.clone());
            let _ = app.emit("task-completed", task.state.clone());
        }
    }

    /// Request cancellation of a task
    pub fn cancel_task(&self, id: &str) -> bool {
        let mut tasks = self.tasks.lock().expect("task lock poisoned");
        if let Some(task) = tasks.get(id) {
            if task.state.cancellable {
                *task.cancel_flag.lock().expect("cancel lock poisoned") = true;
                return true;
            }
        }
        false
    }

    /// Check if a task has been cancelled
    pub fn is_cancelled(&self, id: &str) -> bool {
        let tasks = self.tasks.lock().expect("task lock poisoned");
        tasks
            .get(id)
            .map(|t| *t.cancel_flag.lock().expect("cancel lock poisoned"))
            .unwrap_or(false)
    }

    /// Get a cancel flag for a task (to be cloned into spawned tasks)
    pub fn get_cancel_flag(&self, id: &str) -> Option<Arc<Mutex<bool>>> {
        let tasks = self.tasks.lock().expect("task lock poisoned");
        tasks.get(id).map(|t| Arc::clone(&t.cancel_flag))
    }

    /// Get all task states
    pub fn get_all_tasks(&self) -> Vec<TaskState> {
        let tasks = self.tasks.lock().expect("task lock poisoned");
        tasks.values().map(|t| t.state.clone()).collect()
    }

    /// Remove completed tasks (keep recent ones)
    pub fn clear_completed(&self) {
        let mut tasks = self.tasks.lock().expect("task lock poisoned");
        tasks.retain(|_, t| {
            matches!(
                t.state.status,
                TaskStatus::Queued | TaskStatus::Running
            )
        });
    }
}
