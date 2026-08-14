// Claude Code Manager - Provider adapter implementations
use crate::error::{AppError, codes, AppResult};
use crate::credentials;
use serde::Deserialize;
use std::time::Instant;

// ===== Re-export trait and types =====
pub use crate::providers::{
    ProviderAdapter, ProviderConfig, ModelInfo, CapabilityFlags,
    ValidationResult, ConnectionResult,
};

// ===== Anthropic Provider =====
pub struct AnthropicProvider;

impl AnthropicProvider {
    pub fn new() -> Self { Self }

    pub(crate) fn build_client(config: &ProviderConfig, api_key: &str) -> reqwest::Client {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "x-api-key",
            reqwest::header::HeaderValue::from_str(api_key).unwrap(),
        );
        headers.insert(
            "anthropic-version",
            reqwest::header::HeaderValue::from_static("2023-06-01"),
        );
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            reqwest::header::HeaderValue::from_static("application/json"),
        );

        reqwest::Client::builder()
            .default_headers(headers)
            .timeout(std::time::Duration::from_secs(config.timeout_secs))
            .build()
            .unwrap()
    }
}

#[async_trait::async_trait]
impl ProviderAdapter for AnthropicProvider {
    async fn validate_config(&self, config: &ProviderConfig) -> AppResult<ValidationResult> {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        if config.base_url.is_empty() {
            errors.push("Base URL 不能为空".to_string());
        }
        if config.credential_id.is_none() {
            errors.push("需要配置 API Key".to_string());
        }
        if config.timeout_secs < 1 || config.timeout_secs > 300 {
            warnings.push("超时时间建议在 1-300 秒之间".to_string());
        }

        Ok(ValidationResult { valid: errors.is_empty(), errors, warnings })
    }

    async fn test_connection(&self, config: &ProviderConfig) -> AppResult<ConnectionResult> {
        let api_key = resolve_api_key(config).await?;
        let client = Self::build_client(config, &api_key);
        let start = Instant::now();

        let base_url = config.base_url.trim_end_matches('/');
        let url = format!("{}/v1/messages", base_url);

        let body = serde_json::json!({
            "model": config.default_model.as_deref().unwrap_or("claude-sonnet-4-20250514"),
            "max_tokens": 10,
            "messages": [{"role": "user", "content": "ping"}]
        });

        let response = client.post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                let elapsed = start.elapsed().as_millis() as u64;
                let (code, msg) = if e.is_timeout() {
                    (codes::PROVIDER_TIMEOUT, format!("连接超时 ({}ms)", elapsed))
                } else if e.is_connect() {
                    (codes::PROVIDER_NETWORK_ERROR, "无法连接到服务器，请检查网络或 Base URL。".to_string())
                } else {
                    (codes::PROVIDER_NETWORK_ERROR, format!("网络错误: {}", e))
                };
                AppError::new(code, "连接测试失败", msg)
                    .with_details(e.to_string())
                    .retryable()
            })?;

        let elapsed_ms = start.elapsed().as_millis() as u64;

        if response.status().is_success() {
            Ok(ConnectionResult {
                success: true,
                message: format!("连接成功 ({}ms)", elapsed_ms),
                response_time_ms: Some(elapsed_ms),
                error_code: None,
            })
        } else {
            let status = response.status();
            let error_code = match status.as_u16() {
                401 | 403 => Some(codes::PROVIDER_AUTH_ERROR.to_string()),
                429 => Some("RATE_LIMITED".to_string()),
                500..=599 => Some("SERVER_ERROR".to_string()),
                _ => Some(format!("HTTP_{}", status.as_u16())),
            };
            let msg = match status.as_u16() {
                401 => "API Key 无效，请检查凭据。",
                403 => "API Key 无权限访问此资源。",
                429 => "请求过于频繁，请稍后重试。",
                _ => "服务器返回错误。",
            };
            Ok(ConnectionResult {
                success: false,
                message: format!("{} (HTTP {})", msg, status.as_u16()),
                response_time_ms: Some(elapsed_ms),
                error_code,
            })
        }
    }

    async fn detect_models(&self, config: &ProviderConfig) -> AppResult<Vec<ModelInfo>> {
        let api_key = resolve_api_key(config).await?;
        let client = Self::build_client(config, &api_key);
        let start = Instant::now();

        let base_url = config.base_url.trim_end_matches('/');
        let url = format!("{}/v1/models", base_url);

        let response = client.get(&url)
            .send()
            .await
            .map_err(|e| {
                AppError::new(
                    codes::MODEL_DETECTION_FAILED,
                    "模型检测失败",
                    "无法获取模型列表。",
                ).with_details(e.to_string())
            })?;

        let elapsed_ms = start.elapsed().as_millis() as u64;

        if !response.status().is_success() {
            return Err(AppError::new(
                codes::MODEL_LIST_UNAVAILABLE,
                "模型列表不可用",
                format!("API 返回了 HTTP {}", response.status().as_u16()),
            ));
        }

        #[derive(Deserialize)]
        struct ApiModel {
            id: String,
            #[serde(default)]
            display_name: Option<String>,
            #[serde(default)]
            capabilities: Option<serde_json::Value>,
        }

        #[derive(Deserialize)]
        struct ModelsResponse {
            data: Vec<ApiModel>,
        }

        let models_resp: ModelsResponse = response.json().await.map_err(|e| {
            AppError::new(codes::MODEL_DETECTION_FAILED, "解析失败", "无法解析模型列表响应。")
                .with_details(e.to_string())
        })?;

        let models: Vec<ModelInfo> = models_resp.data.into_iter().map(|m| {
            let supports_thinking = m.capabilities.as_ref()
                .and_then(|c| c.get("thinking"))
                .and_then(|v| v.as_str())
                .map(|s| !s.is_empty())
                .or(Some(false));

            ModelInfo {
                id: m.id,
                display_name: m.display_name,
                provider: "anthropic".to_string(),
                available: true,
                response_time_ms: Some(elapsed_ms),
                capabilities: CapabilityFlags {
                    supports_thinking,
                    supports_tool_use: Some(true),
                    supports_image_input: Some(true),
                    supports_streaming: Some(true),
                },
                detected_at: chrono::Utc::now().to_rfc3339(),
            }
        }).collect();

        Ok(models)
    }

    async fn apply_config(&self, config: &ProviderConfig) -> AppResult<()> {
        let config_dir = crate::environment::get_user_config_dir();
        let settings_path = config_dir.join("settings.json");

        // Read existing config or create empty
        let mut current: serde_json::Value = if settings_path.exists() {
            let content = std::fs::read_to_string(&settings_path)?;
            serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        // Apply provider settings
        if let Some(obj) = current.as_object_mut() {
            obj.insert("model".to_string(), serde_json::json!(
                config.default_model.as_deref().unwrap_or("claude-sonnet-4-20250514")
            ));

            let env = obj.entry("env").or_insert_with(|| serde_json::json!({}));
            if let Some(env_obj) = env.as_object_mut() {
                env_obj.insert("ANTHROPIC_BASE_URL".to_string(), serde_json::json!(config.base_url));
                env_obj.insert("ANTHROPIC_AUTH_TOKEN".to_string(), serde_json::json!(
                    format!("$CREDENTIALS:{}", config.credential_id.as_deref().unwrap_or("ccm/anthropic/default"))
                ));
                if let Some(ref model) = config.default_model {
                    env_obj.insert("ANTHROPIC_MODEL".to_string(), serde_json::json!(model));
                }
            }
        }

        // Write back
        let content = serde_json::to_string_pretty(&current)?;
        crate::config::write_config_inner(&settings_path, &content)?;

        log::info!("Anthropic provider config applied");
        Ok(())
    }

    async fn remove_config(&self) -> AppResult<()> {
        let config_dir = crate::environment::get_user_config_dir();
        let settings_path = config_dir.join("settings.json");

        if !settings_path.exists() {
            return Ok(());
        }

        let content = std::fs::read_to_string(&settings_path)?;
        let mut current: serde_json::Value = serde_json::from_str(&content)?;

        if let Some(obj) = current.as_object_mut() {
            obj.remove("model");
            if let Some(env) = obj.get_mut("env").and_then(|e| e.as_object_mut()) {
                env.remove("ANTHROPIC_BASE_URL");
                env.remove("ANTHROPIC_AUTH_TOKEN");
                env.remove("ANTHROPIC_MODEL");
            }
        }

        let content = serde_json::to_string_pretty(&current)?;
        crate::config::write_config_inner(&settings_path, &content)?;

        log::info!("Anthropic provider config removed");
        Ok(())
    }
}

// ===== DeepSeek Provider =====
pub struct DeepSeekProvider;

impl DeepSeekProvider {
    pub fn new() -> Self { Self }
}

#[async_trait::async_trait]
impl ProviderAdapter for DeepSeekProvider {
    async fn validate_config(&self, config: &ProviderConfig) -> AppResult<ValidationResult> {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        if config.base_url.is_empty() {
            errors.push("Base URL 不能为空".to_string());
        }
        if config.credential_id.is_none() {
            errors.push("需要配置 API Key".to_string());
        }

        // DeepSeek doesn't support image or document input
        warnings.push("DeepSeek 不支持图片输入。".to_string());

        Ok(ValidationResult { valid: errors.is_empty(), errors, warnings })
    }

    async fn test_connection(&self, config: &ProviderConfig) -> AppResult<ConnectionResult> {
        // DeepSeek uses the same Anthropic-compatible endpoint
        let anthropic = AnthropicProvider;
        anthropic.test_connection(config).await
    }

    async fn detect_models(&self, config: &ProviderConfig) -> AppResult<Vec<ModelInfo>> {
        // DeepSeek doesn't have a models list endpoint.
        // Return the known current models with detection info.
        let now = chrono::Utc::now().to_rfc3339();

        // First verify connectivity via lightweight request
        let test_result = self.test_connection(config).await?;
        let response_time = test_result.response_time_ms;

        if !test_result.success {
            return Err(AppError::new(
                codes::MODEL_DETECTION_FAILED,
                "模型检测失败",
                "无法连接到 DeepSeek API，请检查配置和网络。",
            ).with_details(format!("连接测试: {}", test_result.message)));
        }

        // Known DeepSeek models (last updated 2026-07-20)
        // These should be periodically updated from official docs
        Ok(vec![
            ModelInfo {
                id: "deepseek-v4-pro".to_string(),
                display_name: Some("DeepSeek V4 Pro".to_string()),
                provider: "deepseek".to_string(),
                available: true,
                response_time_ms: response_time,
                capabilities: CapabilityFlags {
                    supports_thinking: Some(true),
                    supports_tool_use: Some(true),
                    supports_image_input: Some(false),
                    supports_streaming: Some(true),
                },
                detected_at: now.clone(),
            },
            ModelInfo {
                id: "deepseek-v4-flash".to_string(),
                display_name: Some("DeepSeek V4 Flash".to_string()),
                provider: "deepseek".to_string(),
                available: true,
                response_time_ms: response_time,
                capabilities: CapabilityFlags {
                    supports_thinking: Some(true),
                    supports_tool_use: Some(true),
                    supports_image_input: Some(false),
                    supports_streaming: Some(true),
                },
                detected_at: now,
            },
        ])
    }

    async fn apply_config(&self, config: &ProviderConfig) -> AppResult<()> {
        let config_dir = crate::environment::get_user_config_dir();
        let settings_path = config_dir.join("settings.json");

        let mut current: serde_json::Value = if settings_path.exists() {
            let content = std::fs::read_to_string(&settings_path)?;
            serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        // DeepSeek uses ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN env vars
        if let Some(obj) = current.as_object_mut() {
            let env = obj.entry("env").or_insert_with(|| serde_json::json!({}));
            if let Some(env_obj) = env.as_object_mut() {
                env_obj.insert("ANTHROPIC_BASE_URL".to_string(), serde_json::json!(config.base_url));
                env_obj.insert("ANTHROPIC_AUTH_TOKEN".to_string(), serde_json::json!(
                    format!("$CREDENTIALS:{}", config.credential_id.as_deref().unwrap_or("ccm/deepseek/default"))
                ));
                if let Some(ref model) = config.default_model {
                    env_obj.insert("ANTHROPIC_MODEL".to_string(), serde_json::json!(model));
                }
                // Enable tool search for third-party models
                env_obj.insert("ENABLE_TOOL_SEARCH".to_string(), serde_json::json!("true"));
            }
        }

        let content = serde_json::to_string_pretty(&current)?;
        crate::config::write_config_inner(&settings_path, &content)?;

        log::info!("DeepSeek provider config applied");
        Ok(())
    }

    async fn remove_config(&self) -> AppResult<()> {
        // Same as Anthropic removal since both use ANTHROPIC_* env vars
        let anthropic = AnthropicProvider;
        anthropic.remove_config().await
    }
}

// ===== Custom Provider =====
pub struct CustomProvider;

impl CustomProvider {
    pub fn new() -> Self { Self }
}

#[async_trait::async_trait]
impl ProviderAdapter for CustomProvider {
    async fn validate_config(&self, config: &ProviderConfig) -> AppResult<ValidationResult> {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        if config.base_url.is_empty() {
            errors.push("Base URL 不能为空".to_string());
        }
        if config.credential_id.is_none() {
            errors.push("需要配置 API Key".to_string());
        }

        Ok(ValidationResult { valid: errors.is_empty(), errors, warnings })
    }

    async fn test_connection(&self, config: &ProviderConfig) -> AppResult<ConnectionResult> {
        let api_key = resolve_api_key(config).await?;

        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "x-api-key",
            reqwest::header::HeaderValue::from_str(&api_key).unwrap(),
        );
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            reqwest::header::HeaderValue::from_static("application/json"),
        );

        // Add custom headers
        if let Some(ref custom_hdrs) = config.custom_headers {
            for (key, value) in custom_hdrs {
                if let (Ok(k), Ok(v)) = (
                    reqwest::header::HeaderName::from_bytes(key.as_bytes()),
                    reqwest::header::HeaderValue::from_str(value),
                ) {
                    headers.insert(k, v);
                }
            }
        }

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(std::time::Duration::from_secs(config.timeout_secs))
            .build()
            .unwrap();

        let start = Instant::now();
        let base_url = config.base_url.trim_end_matches('/');

        // Try models endpoint first
        let models_url = format!("{}/v1/models", base_url);
        let response = client.get(&models_url)
            .send()
            .await;

        let elapsed_ms = start.elapsed().as_millis() as u64;

        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    Ok(ConnectionResult {
                        success: true,
                        message: format!("连接成功 ({}ms)", elapsed_ms),
                        response_time_ms: Some(elapsed_ms),
                        error_code: None,
                    })
                } else {
                    Ok(ConnectionResult {
                        success: false,
                        message: format!("HTTP {}", resp.status()),
                        response_time_ms: Some(elapsed_ms),
                        error_code: Some(format!("HTTP_{}", resp.status().as_u16())),
                    })
                }
            }
            Err(e) => {
                let (code, msg) = if e.is_timeout() {
                    (codes::PROVIDER_TIMEOUT, format!("连接超时 ({}ms)", elapsed_ms))
                } else if e.is_connect() {
                    (codes::PROVIDER_NETWORK_ERROR, "无法连接到服务器，请检查 URL。".to_string())
                } else {
                    (codes::PROVIDER_NETWORK_ERROR, format!("网络错误: {}", e))
                };
                Ok(ConnectionResult {
                    success: false,
                    message: msg,
                    response_time_ms: Some(elapsed_ms),
                    error_code: Some(code.to_string()),
                })
            }
        }
    }

    async fn detect_models(&self, config: &ProviderConfig) -> AppResult<Vec<ModelInfo>> {
        // Try to use Anthropic-compatible models endpoint
        let api_key = resolve_api_key(config).await?;
        let anthropic = AnthropicProvider;
        let mut anon_config = config.clone();
        anon_config.provider_type = "custom".to_string();

        // Wrap in a new ProviderConfig that has the actual API key resolved
        match anthropic.detect_models(&anon_config).await {
            Ok(models) => Ok(models.into_iter().map(|m| ModelInfo {
                provider: "custom".to_string(),
                ..m
            }).collect()),
            Err(_) => {
                // Fallback: return configured models only
                let now = chrono::Utc::now().to_rfc3339();
                let mut models = Vec::new();
                if let Some(ref m) = config.default_model {
                    models.push(ModelInfo {
                        id: m.clone(),
                        display_name: Some(format!("{} (已配置)", m)),
                        provider: "custom".to_string(),
                        available: true,
                        response_time_ms: None,
                        capabilities: CapabilityFlags {
                            supports_thinking: None,
                            supports_tool_use: None,
                            supports_image_input: None,
                            supports_streaming: None,
                        },
                        detected_at: now.clone(),
                    });
                }
                Ok(models)
            }
        }
    }

    async fn apply_config(&self, config: &ProviderConfig) -> AppResult<()> {
        let config_dir = crate::environment::get_user_config_dir();
        let settings_path = config_dir.join("settings.json");

        let mut current: serde_json::Value = if settings_path.exists() {
            let content = std::fs::read_to_string(&settings_path)?;
            serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        if let Some(obj) = current.as_object_mut() {
            let env = obj.entry("env").or_insert_with(|| serde_json::json!({}));
            if let Some(env_obj) = env.as_object_mut() {
                env_obj.insert("ANTHROPIC_BASE_URL".to_string(), serde_json::json!(config.base_url));
                env_obj.insert("ANTHROPIC_AUTH_TOKEN".to_string(), serde_json::json!(
                    format!("$CREDENTIALS:{}", config.credential_id.as_deref().unwrap_or("ccm/custom/default"))
                ));
                if let Some(ref model) = config.default_model {
                    env_obj.insert("ANTHROPIC_MODEL".to_string(), serde_json::json!(model));
                }
            }
        }

        let content = serde_json::to_string_pretty(&current)?;
        crate::config::write_config_inner(&settings_path, &content)?;

        log::info!("Custom provider config applied");
        Ok(())
    }

    async fn remove_config(&self) -> AppResult<()> {
        let anthropic = AnthropicProvider;
        anthropic.remove_config().await
    }
}

// ===== Helper: Resolve API Key from Credential Manager =====
async fn resolve_api_key(config: &ProviderConfig) -> AppResult<String> {
    // If API key was passed directly via override, use it (bypasses credential manager)
    if let Some(ref key) = config.api_key_override {
        return Ok(key.clone());
    }

    if let Some(ref cred_id) = config.credential_id {
        // Try credential manager
        match credentials::get_credential(cred_id, "api_key") {
            Ok(key) => Ok(key),
            Err(_) => Err(AppError::new(
                codes::PROVIDER_AUTH_ERROR,
                "API Key 未找到",
                "无法从凭据管理器读取 API Key。",
            ).with_suggestion("请重新输入并保存 API Key。")),
        }
    } else {
        Err(AppError::new(
            codes::PROVIDER_AUTH_ERROR,
            "API Key 未配置",
            "Provider 未关联 API Key 凭据。",
        ).with_suggestion("请先配置 API Key。"))
    }
}
