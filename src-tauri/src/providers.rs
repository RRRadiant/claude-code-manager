// Claude Code Manager - Provider adapter trait and implementations
use crate::error::AppResult;
use serde::{Serialize, Deserialize};

/// Provider capability flags (inferred, not guaranteed by API)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityFlags {
    pub supports_thinking: Option<bool>,
    pub supports_tool_use: Option<bool>,
    pub supports_image_input: Option<bool>,
    pub supports_streaming: Option<bool>,
}

/// Provider configuration (without API key — key stored in Credential Manager)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub provider_type: String,
    pub name: String,
    pub base_url: String,
    pub default_model: Option<String>,
    pub fast_model: Option<String>,
    pub high_capability_model: Option<String>,
    pub timeout_secs: u64,
    pub credential_id: Option<String>,
    pub custom_headers: Option<Vec<(String, String)>>,
    /// API key passed directly (bypasses credential manager lookup)
    #[serde(default, skip_serializing)]
    pub api_key_override: Option<String>,
}

/// Model information from detection
#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub display_name: Option<String>,
    pub provider: String,
    pub available: bool,
    pub response_time_ms: Option<u64>,
    pub capabilities: CapabilityFlags,
    pub detected_at: String,
}

/// Provider adapter trait — every provider implements this
#[async_trait::async_trait]
pub trait ProviderAdapter: Send + Sync {
    /// Validate provider configuration format
    async fn validate_config(&self, config: &ProviderConfig) -> AppResult<ValidationResult>;

    /// Test network connectivity to the provider
    async fn test_connection(&self, config: &ProviderConfig) -> AppResult<ConnectionResult>;

    /// Detect available models from the provider
    async fn detect_models(&self, config: &ProviderConfig) -> AppResult<Vec<ModelInfo>>;

    /// Apply this provider's configuration to Claude Code settings
    async fn apply_config(&self, config: &ProviderConfig) -> AppResult<()>;

    /// Remove this provider's configuration from Claude Code settings
    async fn remove_config(&self) -> AppResult<()>;
}

/// Configuration validation result
#[derive(Debug, Clone, Serialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Connection test result
#[derive(Debug, Clone, Serialize)]
pub struct ConnectionResult {
    pub success: bool,
    pub message: String,
    pub response_time_ms: Option<u64>,
    pub error_code: Option<String>,
}
