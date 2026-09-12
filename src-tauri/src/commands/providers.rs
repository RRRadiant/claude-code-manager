use crate::credentials;
use crate::error::{codes, AppError};
use crate::impl_providers::{mask_secret, AnthropicProvider, CustomProvider, DeepSeekProvider};
use crate::providers::{ProviderAdapter, ProviderConfig};

#[tauri::command]
pub async fn test_provider_connection(
    provider_type: String,
    api_key: String,
    base_url: Option<String>,
    model: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<serde_json::Value, AppError> {
    let config = ProviderConfig {
        provider_type: provider_type.clone(),
        name: format!("{provider_type}-test"),
        base_url: base_url.unwrap_or_else(|| match provider_type.as_str() {
            "anthropic" => "https://api.anthropic.com".to_string(),
            "deepseek" => "https://api.deepseek.com/anthropic".to_string(),
            _ => "https://api.anthropic.com".to_string(),
        }),
        default_model: model.or(Some("claude-sonnet-4-20250514".to_string())),
        fast_model: None,
        high_capability_model: None,
        timeout_secs: timeout_secs.unwrap_or(30),
        credential_id: None,
        custom_headers: None,
        api_key_override: Some(api_key.clone()),
    };

    let adapter: Box<dyn ProviderAdapter> = match provider_type.as_str() {
        "anthropic" => Box::new(AnthropicProvider::new()),
        "deepseek" => Box::new(DeepSeekProvider::new()),
        _ => Box::new(CustomProvider::new()),
    };

    let result = adapter.test_connection(&config).await?;

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
) -> Result<serde_json::Value, AppError> {
    let config = ProviderConfig {
        provider_type: provider_type.clone(),
        name: format!("{provider_type}-models"),
        base_url: base_url.unwrap_or_else(|| match provider_type.as_str() {
            "anthropic" => "https://api.anthropic.com".to_string(),
            "deepseek" => "https://api.deepseek.com/anthropic".to_string(),
            _ => "https://api.anthropic.com".to_string(),
        }),
        default_model: None,
        fast_model: None,
        high_capability_model: None,
        timeout_secs: 30,
        credential_id: None,
        custom_headers: None,
        api_key_override: Some(api_key),
    };

    let adapter: Box<dyn ProviderAdapter> = match provider_type.as_str() {
        "anthropic" => Box::new(AnthropicProvider::new()),
        "deepseek" => Box::new(DeepSeekProvider::new()),
        _ => Box::new(CustomProvider::new()),
    };

    let models = adapter.detect_models(&config).await?;

    Ok(serde_json::json!({
        "models": models,
        "count": models.len(),
    }))
}

#[tauri::command]
pub async fn save_provider_credential(
    provider_type: String,
    api_key: String,
) -> Result<bool, AppError> {
    let cred_id = credentials::credential_id(&provider_type, "default");
    credentials::store_credential(&cred_id, "api_key", &api_key)?;
    Ok(true)
}

#[tauri::command]
pub async fn get_provider_credential(provider_type: String) -> Result<serde_json::Value, AppError> {
    let cred_id = credentials::credential_id(&provider_type, "default");
    match credentials::get_credential(&cred_id, "api_key") {
        Ok(key) => {
            // SECURITY: never return the full key to the frontend.
            // Return a masked preview only (prefix + last 4 chars).
            let masked = mask_secret(&key);
            Ok(serde_json::json!({ "exists": true, "masked": masked, "api_key": null }))
        }
        Err(_) => Ok(serde_json::json!({ "exists": false, "masked": null, "api_key": null })),
    }
}

#[tauri::command]
pub async fn delete_provider_credential(provider_type: String) -> Result<bool, AppError> {
    let cred_id = credentials::credential_id(&provider_type, "default");
    credentials::delete_credential(&cred_id, "api_key")?;
    Ok(true)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // IPC signature mirrors the frontend form fields 1:1
pub async fn save_provider_config(
    provider_type: String,
    name: String,
    base_url: Option<String>,
    default_model: Option<String>,
    fast_model: Option<String>,
    high_capability_model: Option<String>,
    timeout_secs: Option<u64>,
    custom_headers: Option<String>,
    api_key: Option<String>,
) -> Result<serde_json::Value, AppError> {
    // 1. Save API key to credential manager if provided
    if let Some(ref key) = api_key {
        let cred_id = credentials::credential_id(&provider_type, "default");
        credentials::store_credential(&cred_id, "api_key", key)?;
    }

    // 2. Save provider settings to app data (for app UI)
    let config_data = serde_json::json!({
        "provider_type": provider_type,
        "name": name,
        "base_url": base_url,
        "default_model": default_model,
        "fast_model": fast_model,
        "high_capability_model": high_capability_model,
        "timeout_secs": timeout_secs,
        "custom_headers": custom_headers,
    });

    let config_str = serde_json::to_string_pretty(&config_data).map_err(|e| {
        AppError::new(codes::CONFIG_PARSE_ERROR, "序列化配置失败", "").with_details(e.to_string())
    })?;

    crate::config::write_provider_config(&provider_type, &config_str)?;

    // 3. Apply config to Claude Code settings (~/.claude/settings.json)
    let cred_id = credentials::credential_id(&provider_type, "default");
    let provider_config = crate::providers::ProviderConfig {
        provider_type: provider_type.clone(),
        name: name.clone(),
        base_url: base_url
            .clone()
            .unwrap_or_else(|| match provider_type.as_str() {
                "anthropic" => "https://api.anthropic.com".to_string(),
                "deepseek" => "https://api.deepseek.com/anthropic".to_string(),
                _ => "https://api.anthropic.com".to_string(),
            }),
        default_model: default_model.clone(),
        fast_model: fast_model.clone(),
        high_capability_model: high_capability_model.clone(),
        timeout_secs: timeout_secs.unwrap_or(60),
        credential_id: Some(cred_id),
        custom_headers: None,
        api_key_override: api_key,
    };

    let adapter: Box<dyn crate::providers::ProviderAdapter> = match provider_type.as_str() {
        "anthropic" => Box::new(AnthropicProvider::new()),
        "deepseek" => Box::new(DeepSeekProvider::new()),
        _ => Box::new(CustomProvider::new()),
    };

    // Propagate the failure: silently ignoring it left the credential saved but
    // `settings.json` unwritten, so the UI reported success while Claude Code
    // had no usable configuration.
    let outcome = adapter.apply_config(&provider_config).await?;

    log::info!("Provider config saved and applied for {provider_type}");
    Ok(serde_json::json!({
        "success": true,
        "storage": outcome.storage,
        "message": outcome.message,
    }))
}

#[tauri::command]
pub async fn load_provider_config(provider_type: String) -> Result<serde_json::Value, AppError> {
    match crate::config::read_provider_config(&provider_type) {
        Ok(Some(content)) => match serde_json::from_str::<serde_json::Value>(&content) {
            Ok(val) => Ok(val),
            Err(_) => Ok(serde_json::json!({})),
        },
        Ok(None) => Ok(serde_json::json!({})),
        Err(_) => Ok(serde_json::json!({})),
    }
}

#[tauri::command]
pub fn detect_existing_claude_config() -> crate::providers::DetectedClaudeConfig {
    crate::impl_providers::detect_existing_claude_config()
}

#[tauri::command]
pub fn import_existing_claude_config(
    provider_type: String,
) -> Result<crate::providers::ImportResult, AppError> {
    crate::impl_providers::import_existing_claude_config(&provider_type)
}
