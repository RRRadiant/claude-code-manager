// Claude Code Manager - Main application entry point
#![warn(clippy::all, clippy::pedantic, rust_2018_idioms)]
#![allow(clippy::module_name_repetitions, clippy::must_use_candidate)]

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
