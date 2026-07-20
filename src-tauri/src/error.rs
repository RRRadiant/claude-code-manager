// Claude Code Manager - Unified error system
use serde::Serialize;

/// Application-wide error type with user-friendly messages
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    /// Machine-readable error code (e.g., "INSTALL_NETWORK_ERROR")
    pub code: String,
    /// User-facing short title
    pub title: String,
    /// User-facing description of what went wrong
    pub message: String,
    /// Expandable technical details (for developers)
    pub technical_details: Option<String>,
    /// Actionable suggestions for the user
    pub suggestions: Vec<String>,
    /// Whether retrying the operation makes sense
    pub retryable: bool,
}

impl AppError {
    pub fn new(
        code: impl Into<String>,
        title: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            title: title.into(),
            message: message.into(),
            technical_details: None,
            suggestions: Vec::new(),
            retryable: false,
        }
    }

    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.technical_details = Some(details.into());
        self
    }

    pub fn with_suggestion(mut self, suggestion: impl Into<String>) -> Self {
        self.suggestions.push(suggestion.into());
        self
    }

    pub fn with_suggestions(mut self, suggestions: Vec<String>) -> Self {
        self.suggestions.extend(suggestions);
        self
    }

    pub fn retryable(mut self) -> Self {
        self.retryable = true;
        self
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}: {}", self.code, self.title, self.message)
    }
}

impl std::error::Error for AppError {}

/// Convert common errors into AppError
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::new(
            "IO_ERROR",
            "文件操作失败",
            format!("系统 I/O 错误: {}", e.kind()),
        )
        .with_details(e.to_string())
        .retryable()
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::new(
            "CONFIG_PARSE_ERROR",
            "配置文件格式错误",
            "JSON 格式无效，请检查配置文件语法。",
        )
        .with_details(e.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        let code = match &e {
            keyring::Error::NoEntry => "CREDENTIALS_NOT_FOUND",
            keyring::Error::NoStorageAccess(_) => "CREDENTIALS_ACCESS_DENIED",
            _ => "CREDENTIALS_ERROR",
        };
        AppError::new(
            code,
            "凭据操作失败",
            "无法存取 Windows 凭据管理器。",
        )
        .with_details(e.to_string())
    }
}

/// Result type alias using AppError
pub type AppResult<T> = Result<T, AppError>;

/// Error code constants
pub mod codes {
    // Environment errors
    pub const ENV_DETECTION_FAILED: &str = "ENV_DETECTION_FAILED";
    pub const ENV_PATH_NOT_FOUND: &str = "ENV_PATH_NOT_FOUND";
    pub const ENV_PERMISSION_DENIED: &str = "ENV_PERMISSION_DENIED";

    // Installation errors
    pub const INSTALL_NETWORK_ERROR: &str = "INSTALL_NETWORK_ERROR";
    pub const INSTALL_DOWNLOAD_FAILED: &str = "INSTALL_DOWNLOAD_FAILED";
    pub const INSTALL_VERIFICATION_FAILED: &str = "INSTALL_VERIFICATION_FAILED";
    pub const INSTALL_CANCELLED: &str = "INSTALL_CANCELLED";
    pub const INSTALL_TIMEOUT: &str = "INSTALL_TIMEOUT";

    // Config errors
    pub const CONFIG_PARSE_ERROR: &str = "CONFIG_PARSE_ERROR";
    pub const CONFIG_WRITE_ERROR: &str = "CONFIG_WRITE_ERROR";
    pub const CONFIG_BACKUP_ERROR: &str = "CONFIG_BACKUP_ERROR";
    pub const CONFIG_INVALID: &str = "CONFIG_INVALID";

    // Provider errors
    pub const PROVIDER_AUTH_ERROR: &str = "PROVIDER_AUTH_ERROR";
    pub const PROVIDER_NETWORK_ERROR: &str = "PROVIDER_NETWORK_ERROR";
    pub const PROVIDER_TIMEOUT: &str = "PROVIDER_TIMEOUT";
    pub const PROVIDER_MODEL_NOT_FOUND: &str = "PROVIDER_MODEL_NOT_FOUND";

    // Model errors
    pub const MODEL_DETECTION_FAILED: &str = "MODEL_DETECTION_FAILED";
    pub const MODEL_LIST_UNAVAILABLE: &str = "MODEL_LIST_UNAVAILABLE";

    // MCP errors
    pub const MCP_STARTUP_FAILED: &str = "MCP_STARTUP_FAILED";
    pub const MCP_HANDSHAKE_FAILED: &str = "MCP_HANDSHAKE_FAILED";
    pub const MCP_TIMEOUT: &str = "MCP_TIMEOUT";
    pub const MCP_INVALID_CONFIG: &str = "MCP_INVALID_CONFIG";

    // Update errors
    pub const UPDATE_CHECK_FAILED: &str = "UPDATE_CHECK_FAILED";
    pub const UPDATE_DOWNLOAD_FAILED: &str = "UPDATE_DOWNLOAD_FAILED";
    pub const UPDATE_VERIFICATION_FAILED: &str = "UPDATE_VERIFICATION_FAILED";
    pub const UPDATE_SIGNATURE_INVALID: &str = "UPDATE_SIGNATURE_INVALID";

    // Security errors
    pub const SECURITY_PATH_TRAVERSAL: &str = "SECURITY_PATH_TRAVERSAL";
    pub const SECURITY_INVALID_INPUT: &str = "SECURITY_INVALID_INPUT";
    pub const SECURITY_PERMISSION_DENIED: &str = "SECURITY_PERMISSION_DENIED";

    // Network errors
    pub const NETWORK_DNS_FAILURE: &str = "NETWORK_DNS_FAILURE";
    pub const NETWORK_TLS_FAILURE: &str = "NETWORK_TLS_FAILURE";
    pub const NETWORK_TIMEOUT: &str = "NETWORK_TIMEOUT";
    pub const NETWORK_PROXY_ERROR: &str = "NETWORK_PROXY_ERROR";
}
