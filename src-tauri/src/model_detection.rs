// Claude Code Manager - Model detection via API
// TODO: Implement full model detection logic

/// Anthropic models endpoint: GET /v1/models
/// DeepSeek: No native model list endpoint — verify specified models via lightweight request
pub mod anthropic {
    use crate::providers::ModelInfo;

    /// Detect models from Anthropic API
    pub async fn detect_models(api_key: &str, base_url: &str) -> Result<Vec<ModelInfo>, String> {
        // TODO: Implement Anthropic Models API call
        // GET {base_url}/v1/models
        // Headers: x-api-key, anthropic-version: 2023-06-01
        Err("Not yet implemented".to_string())
    }
}

pub mod deepseek {
    use crate::providers::ModelInfo;

    /// DeepSeek doesn't have a models list endpoint.
    /// Verify models via Anthropic-compatible lightweight request.
    pub async fn verify_model(
        api_key: &str,
        base_url: &str,
        model: &str,
    ) -> Result<ModelInfo, String> {
        // TODO: Implement model verification via lightweight API call
        Err("Not yet implemented".to_string())
    }
}
