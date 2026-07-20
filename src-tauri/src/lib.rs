// Claude Code Manager - Main application entry point
#![warn(clippy::all, clippy::pedantic, rust_2018_idioms)]
#![allow(clippy::module_name_repetitions, clippy::must_use_candidate)]

mod commands;
mod config;
mod credentials;
mod diagnostics;
mod environment;
mod error;
mod impl_providers;
mod installer;
mod logging;
mod mcp;
mod model_detection;
mod process;
mod providers;
mod security;
mod task;
mod updater;

use error::AppError;
use logging::LogSanitizer;
use tauri::Manager;

/// Application state shared across commands
pub struct AppState {
    pub log_sanitizer: LogSanitizer,
    pub task_manager: task::TaskManager,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_sanitizer = LogSanitizer::new();

    tauri::Builder::default()
        .manage(AppState {
            log_sanitizer,
            task_manager: task::TaskManager::new(),
        })
        .setup(|app| {
            // Initialize logging plugin
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Debug)
                        .build(),
                )?;
            }

            // Initialize updater plugin
            #[cfg(not(debug_assertions))]
            app.handle().plugin(tauri_plugin_updater::Builder::default().build())?;

            log::info!("Claude Code Manager started");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Environment commands
            commands::environment::detect_environment,
            commands::environment::check_path,
            // Task commands
            commands::task::get_tasks,
            commands::task::cancel_task,
            commands::task::clear_tasks,
            // Diagnostics commands
            commands::diagnostics::run_diagnostics,
            // Config commands
            commands::config::list_config_files,
            commands::config::read_config_file,
            commands::config::write_config_file,
            // Provider commands
            commands::providers::test_provider_connection,
            commands::providers::detect_provider_models,
            // MCP commands
            commands::mcp::list_mcp_servers,
            commands::mcp::test_mcp_server,
            commands::mcp::test_raw_mcp_stdio,
            // Installer commands
            commands::installer::install_claude_code,
            commands::installer::uninstall_claude_code,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Claude Code Manager");
}
