use crate::config::ConfigFileInfo;
use crate::error::AppError;

#[tauri::command]
pub async fn list_config_files() -> Result<Vec<ConfigFileInfo>, AppError> {
    crate::config::list_config_files()
}

#[tauri::command]
pub async fn read_config_file(
    scope: String,
) -> Result<Option<crate::config::ConfigContent>, AppError> {
    let parsed_scope = crate::config::ConfigScope::from_str(&scope).ok_or_else(|| {
        AppError::new(
            crate::error::codes::CONFIG_PARSE_ERROR,
            "未知配置作用域",
            format!("Unknown config scope: {scope}"),
        )
    })?;
    crate::config::read_config(&parsed_scope)
}

#[tauri::command]
pub async fn write_config_file(scope: String, content: String) -> Result<(), AppError> {
    let parsed_scope = crate::config::ConfigScope::from_str(&scope).ok_or_else(|| {
        AppError::new(
            crate::error::codes::CONFIG_PARSE_ERROR,
            "未知配置作用域",
            format!("Unknown config scope: {scope}"),
        )
    })?;
    crate::config::write_config(&parsed_scope, &content)
}
