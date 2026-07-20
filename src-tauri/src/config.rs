// Claude Code Manager - Configuration file management
use crate::error::{AppError, codes, AppResult};
use serde::{Serialize, Deserialize};
use std::path::PathBuf;

/// Configuration file scope
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConfigScope {
    User,
    Project,
    Local,
    Managed,
}

impl ConfigScope {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "user" => Some(Self::User),
            "project" => Some(Self::Project),
            "local" => Some(Self::Local),
            "managed" => Some(Self::Managed),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Project => "project",
            Self::Local => "local",
            Self::Managed => "managed",
        }
    }
}

/// Configuration file info
#[derive(Debug, Clone, Serialize)]
pub struct ConfigFileInfo {
    pub name: String,
    pub scope: String,
    pub path: String,
    pub exists: bool,
    pub last_modified: Option<String>,
    pub is_valid: Option<bool>,
    pub has_sensitive_fields: bool,
}

/// Configuration file content
#[derive(Debug, Clone, Serialize)]
pub struct ConfigContent {
    pub path: String,
    pub content: String,
    pub format: String,
}

/// Get the path for a config file by scope
fn get_config_path(scope: &ConfigScope) -> PathBuf {
    match scope {
        ConfigScope::User => {
            let home = std::env::var("USERPROFILE")
                .unwrap_or_else(|_| "C:\\Users\\Default".to_string());
            PathBuf::from(format!("{}\\.claude\\settings.json", home))
        }
        ConfigScope::Project => {
            // Note: This needs to be parameterized per-project
            PathBuf::from(".claude\\settings.json")
        }
        ConfigScope::Local => {
            PathBuf::from(".claude\\settings.local.json")
        }
        ConfigScope::Managed => {
            PathBuf::from("C:\\ProgramData\\ClaudeCode\\managed-settings.json")
        }
    }
}

/// List all available config files
pub fn list_config_files() -> AppResult<Vec<ConfigFileInfo>> {
    let scopes = vec![
        (ConfigScope::User, "用户全局配置"),
        (ConfigScope::Project, "项目共享配置"),
        (ConfigScope::Local, "项目本地配置"),
        (ConfigScope::Managed, "企业托管配置"),
    ];

    let mut files = Vec::new();
    for (scope, name) in scopes {
        let path = get_config_path(&scope);
        let exists = path.exists();
        let last_modified = if exists {
            path.metadata().ok().and_then(|m| {
                m.modified().ok().map(|t| {
                    let dt: chrono::DateTime<chrono::Local> = t.into();
                    dt.to_rfc3339()
                })
            })
        } else {
            None
        };

        files.push(ConfigFileInfo {
            name: name.to_string(),
            scope: scope.as_str().to_string(),
            path: path.to_string_lossy().to_string(),
            exists,
            last_modified,
            is_valid: None,
            has_sensitive_fields: scope == ConfigScope::User || scope == ConfigScope::Local,
        });
    }

    Ok(files)
}

/// Read the content of a config file
pub fn read_config(scope: &ConfigScope) -> AppResult<Option<ConfigContent>> {
    let path = get_config_path(scope);
    if !path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&path)?;
    Ok(Some(ConfigContent {
        path: path.to_string_lossy().to_string(),
        content,
        format: "json".to_string(),
    }))
}

/// Write content to a config file with backup and atomic replace
pub fn write_config(scope: &ConfigScope, content: &str) -> AppResult<()> {
    let path = get_config_path(scope);
    write_config_inner(&path, content)
}

/// Write content to a specific config path with backup and atomic replace
pub fn write_config_inner(path: &std::path::Path, content: &str) -> AppResult<()> {
    // Validate JSON before writing
    let _parsed: serde_json::Value = serde_json::from_str(content).map_err(|e| {
        AppError::new(
            codes::CONFIG_PARSE_ERROR,
            "JSON 格式无效",
            "配置文件内容不是有效的 JSON。",
        )
        .with_details(e.to_string())
    })?;

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Create backup if file exists
    if path.exists() {
        let backup_path = format!(
            "{}.bak.{}",
            path.to_string_lossy(),
            chrono::Utc::now().format("%Y%m%d%H%M%S")
        );
        std::fs::copy(path, &backup_path)?;
        log::info!("Config backup created: {}", backup_path);
    }

    // Write to temporary file then rename (atomic operation)
    let temp_path = {
        let mut p = path.to_path_buf().into_os_string();
        p.push(".tmp");
        std::path::PathBuf::from(p)
    };

    std::fs::write(&temp_path, content)?;

    // Verify the temp file
    let verify_content = std::fs::read_to_string(&temp_path)?;
    if verify_content != content {
        std::fs::remove_file(&temp_path)?;
        return Err(AppError::new(
            codes::CONFIG_WRITE_ERROR,
            "写入验证失败",
            "临时文件验证不一致，写入已终止。",
        ));
    }

    // Atomic rename (on same filesystem)
    std::fs::rename(&temp_path, path)?;

    log::info!("Config written: {}", path.to_string_lossy());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_scope_from_str() {
        assert_eq!(ConfigScope::from_str("user"), Some(ConfigScope::User));
        assert_eq!(ConfigScope::from_str("project"), Some(ConfigScope::Project));
        assert_eq!(ConfigScope::from_str("local"), Some(ConfigScope::Local));
        assert_eq!(ConfigScope::from_str("unknown"), None);
    }

    #[test]
    fn test_list_config_files_no_panic() {
        let files = list_config_files().unwrap();
        assert!(!files.is_empty());
    }

    #[test]
    fn test_write_config_invalid_json() {
        let result = write_config(&ConfigScope::User, "not valid json");
        assert!(result.is_err());
    }
}
