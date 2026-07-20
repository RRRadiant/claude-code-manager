use crate::impl_providers::*;
use crate::credentials;
use crate::providers::{ProviderConfig, ProviderAdapter};

#[tauri::command]
pub async fn test_provider_connection(
    provider_type: String,
    api_key: String,
    base_url: Option<String>,
    model: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<serde_json::Value, String> {
    let config = ProviderConfig {
        provider_type: provider_type.clone(),
        name: format!("{}-test", provider_type),
        base_url: base_url.unwrap_or_else(|| match provider_type.as_str() {
            "anthropic" => "https://api.anthropic.com".to_string(),
            "deepseek" => "https://api.deepseek.com/anthropic".to_string(),
            _ => "https://api.anthropic.com".to_string(),
        }),
        default_model: model.or(Some("claude-sonnet-4-20250514".to_string())),
        fast_model: None,
        high_capability_model: None,
        timeout_secs: timeout_secs.unwrap_or(30),
        credential_id: Some(credentials::credential_id(&provider_type, "test")),
        custom_headers: None,
    };

    // Temporarily store the key for testing
    let cred_id = credentials::credential_id(&provider_type, "test");
    let _ = credentials::store_credential(&cred_id, "api_key", &api_key);

    let adapter: Box<dyn ProviderAdapter> = match provider_type.as_str() {
        "anthropic" => Box::new(AnthropicProvider::new()),
        "deepseek" => Box::new(DeepSeekProvider::new()),
        _ => Box::new(CustomProvider::new()),
    };

    let result = adapter.test_connection(&config).await.map_err(|e| e.to_string())?;

    // Clean up temporary credential
    let _ = credentials::delete_credential(&cred_id, "api_key");

    Ok(serde_json::json!({
        "success": result.success,
        "message": result.message,
        "response_time_ms": result.response_time_ms,
        "error_code": result.error_code,
    }))
}

#[tauri::command]
pub async fn detect_provider_models(
    provider_type: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<serde_json::Value, String> {
    let config = ProviderConfig {
        provider_type: provider_type.clone(),
        name: format!("{}-models", provider_type),
        base_url: base_url.unwrap_or_else(|| match provider_type.as_str() {
            "anthropic" => "https://api.anthropic.com".to_string(),
            "deepseek" => "https://api.deepseek.com/anthropic".to_string(),
            _ => "https://api.anthropic.com".to_string(),
        }),
        default_model: None,
        fast_model: None,
        high_capability_model: None,
        timeout_secs: 30,
        credential_id: Some(credentials::credential_id(&provider_type, "models")),
        custom_headers: None,
    };

    let cred_id = credentials::credential_id(&provider_type, "models");
    let _ = credentials::store_credential(&cred_id, "api_key", &api_key);

    let adapter: Box<dyn ProviderAdapter> = match provider_type.as_str() {
        "anthropic" => Box::new(AnthropicProvider::new()),
        "deepseek" => Box::new(DeepSeekProvider::new()),
        _ => Box::new(CustomProvider::new()),
    };

    let models = adapter.detect_models(&config).await.map_err(|e| e.to_string())?;

    let _ = credentials::delete_credential(&cred_id, "api_key");

    Ok(serde_json::json!({
        "models": models,
        "count": models.len(),
    }))
}
