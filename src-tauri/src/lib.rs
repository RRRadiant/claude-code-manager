// Claude Code Manager - Main application entry point
// Enforce the core clippy set (`all`); `pedantic` was dropped because its
// noise (unreadable_literal, too_many_lines/arguments, ...) outweighs value
// for this project. CI runs `cargo clippy -- -D warnings`.
#![warn(clippy::all, rust_2018_idioms)]
#![allow(
    clippy::module_name_repetitions,
    clippy::must_use_candidate,
    // AppError is a rich, structured error type that crosses the IPC boundary;
    // boxing it just for the lint would churn every command signature.
    clippy::result_large_err
)]

mod commands;
mod config;
mod credentials;
mod diagnostics;
mod env_refresh;
pub mod environment;
mod error;
mod impl_providers;
mod installer;
mod logging;
mod mcp;
mod process;
mod providers;
mod security;
mod task;

use logging::LogSanitizer;

/// Application state shared across commands
pub struct AppState {
    pub log_sanitizer: LogSanitizer,
    pub task_manager: task::TaskManager,
    /// Serializes read-modify-write cycles on `HKCU\Environment\PATH`.
    ///
    /// Node.js and Git install concurrently, and both append their bin directory
    /// to the user PATH. Without this lock the two writes could interleave and
    /// one entry would be lost.
    pub path_lock: std::sync::Mutex<()>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_sanitizer = LogSanitizer::new();

    tauri::Builder::default()
        .manage(AppState {
            log_sanitizer,
            task_manager: task::TaskManager::new(),
            path_lock: std::sync::Mutex::new(()),
        })
        .setup(|app| {
            // Always initialize logging. Debug builds are verbose; release builds
            // log at Info level so production issues remain diagnosable.
            let level = if cfg!(debug_assertions) {
                log::LevelFilter::Debug
            } else {
                log::LevelFilter::Info
            };
            app.handle()
                .plugin(tauri_plugin_log::Builder::default().level(level).build())?;

            log::info!("Claude Code Manager started");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Environment commands
            commands::environment::detect_environment,
            commands::environment::check_path,
            commands::environment::refresh_environment,
            commands::environment::detect_node_detailed,
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
            commands::providers::save_provider_credential,
            commands::providers::get_provider_credential,
            commands::providers::delete_provider_credential,
            commands::providers::save_provider_config,
            commands::providers::load_provider_config,
            commands::providers::detect_existing_claude_config,
            commands::providers::import_existing_claude_config,
            // MCP commands
            commands::mcp::list_mcp_servers,
            commands::mcp::test_mcp_server,
            commands::mcp::update_mcp_server,
            commands::mcp::delete_mcp_server,
            commands::mcp::test_raw_mcp_stdio,
            // Installer commands
            commands::installer::generate_install_plan,
            commands::installer::detect_node_js,
            commands::installer::run_claude,
            commands::installer::install_claude_code,
            commands::installer::install_full_environment,
            commands::installer::uninstall_claude_code,
            commands::installer::restart_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Claude Code Manager");
}
