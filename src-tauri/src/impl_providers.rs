// Claude Code Manager - Provider adapter implementations
use crate::credentials;
use crate::error::{codes, AppError, AppResult};
use serde::Deserialize;
use std::time::Instant;

// ===== Re-export trait and types =====
pub use crate::providers::{
    CapabilityFlags, ConnectionResult, DetectedClaudeConfig, ImportResult, ModelInfo,
    ProviderAdapter, ProviderConfig,
};

// ===== Anthropic Provider =====
pub struct AnthropicProvider;

impl AnthropicProvider {
    pub fn new() -> Self {
        Self
    }

    pub(crate) fn build_client(
        config: &ProviderConfig,
        api_key: &str,
    ) -> AppResult<reqwest::Client> {
        let mut headers = reqwest::header::HeaderMap::new();
        let api_key_header = reqwest::header::HeaderValue::from_str(api_key).map_err(|_| {
            AppError::new(
                codes::PROVIDER_AUTH_ERROR,
                "API Key 无效",
                "API Key 包含无法作为 HTTP 请求头使用的字符。",
            )
        })?;
        headers.insert("x-api-key", api_key_header);
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
            .map_err(|e| {
                AppError::new(
                    codes::PROVIDER_NETWORK_ERROR,
                    "HTTP 客户端初始化失败",
                    "无法构建 HTTP 客户端。",
                )
                .with_details(e.to_string())
            })
    }
}

#[async_trait::async_trait]
impl ProviderAdapter for AnthropicProvider {
    async fn test_connection(&self, config: &ProviderConfig) -> AppResult<ConnectionResult> {
        let api_key = resolve_api_key(config).await?;
        let client = Self::build_client(config, &api_key)?;
        let start = Instant::now();

        let base_url = config.base_url.trim_end_matches('/');
        let url = format!("{base_url}/v1/messages");

        let body = serde_json::json!({
            "model": config.default_model.as_deref().unwrap_or("claude-sonnet-4-20250514"),
            "max_tokens": 10,
            "messages": [{"role": "user", "content": "ping"}]
        });

        let response = client.post(&url).json(&body).send().await.map_err(|e| {
            let elapsed = start.elapsed().as_millis() as u64;
            let (code, msg) = if e.is_timeout() {
                (codes::PROVIDER_TIMEOUT, format!("连接超时 ({elapsed}ms)"))
            } else if e.is_connect() {
                (
                    codes::PROVIDER_NETWORK_ERROR,
                    "无法连接到服务器，请检查网络或 Base URL。".to_string(),
                )
            } else {
                (codes::PROVIDER_NETWORK_ERROR, format!("网络错误: {e}"))
            };
            AppError::new(code, "连接测试失败", msg)
                .with_details(e.to_string())
                .retryable()
        })?;

        let elapsed_ms = start.elapsed().as_millis() as u64;

        if response.status().is_success() {
            Ok(ConnectionResult {
                success: true,
                message: format!("连接成功 ({elapsed_ms}ms)"),
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
        let client = Self::build_client(config, &api_key)?;
        let start = Instant::now();

        let base_url = config.base_url.trim_end_matches('/');
        let url = format!("{base_url}/v1/models");

        let response = client.get(&url).send().await.map_err(|e| {
            AppError::new(
                codes::MODEL_DETECTION_FAILED,
                "模型检测失败",
                "无法获取模型列表。",
            )
            .with_details(e.to_string())
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
            AppError::new(
                codes::MODEL_DETECTION_FAILED,
                "解析失败",
                "无法解析模型列表响应。",
            )
            .with_details(e.to_string())
        })?;

        let models: Vec<ModelInfo> = models_resp
            .data
            .into_iter()
            .map(|m| {
                let supports_thinking = m
                    .capabilities
                    .as_ref()
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
            })
            .collect();

        Ok(models)
    }

    async fn apply_config(&self, config: &ProviderConfig) -> AppResult<ApplyConfigOutcome> {
        update_claude_settings(config, |env_obj, key| {
            env_obj.insert(
                "ANTHROPIC_BASE_URL".to_string(),
                serde_json::json!(config.base_url),
            );
            set_auth_token(env_obj, key);
            if let Some(ref model) = config.default_model {
                env_obj.insert("ANTHROPIC_MODEL".to_string(), serde_json::json!(model));
            }
        })
        .await
    }
}

// ===== DeepSeek Provider =====
pub struct DeepSeekProvider;

impl DeepSeekProvider {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl ProviderAdapter for DeepSeekProvider {
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
            )
            .with_details(format!("连接测试: {}", test_result.message)));
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

    async fn apply_config(&self, config: &ProviderConfig) -> AppResult<ApplyConfigOutcome> {
        // DeepSeek uses ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN env vars
        update_claude_settings(config, |env_obj, key| {
            env_obj.insert(
                "ANTHROPIC_BASE_URL".to_string(),
                serde_json::json!(config.base_url),
            );
            set_auth_token(env_obj, key);
            if let Some(ref model) = config.default_model {
                env_obj.insert("ANTHROPIC_MODEL".to_string(), serde_json::json!(model));
            }
            // Enable tool search for third-party models
            env_obj.insert("ENABLE_TOOL_SEARCH".to_string(), serde_json::json!("true"));
        })
        .await
    }
}

// ===== Custom Provider =====
pub struct CustomProvider;

impl CustomProvider {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl ProviderAdapter for CustomProvider {
    async fn test_connection(&self, config: &ProviderConfig) -> AppResult<ConnectionResult> {
        let api_key = resolve_api_key(config).await?;

        let mut headers = reqwest::header::HeaderMap::new();
        let api_key_header = reqwest::header::HeaderValue::from_str(&api_key).map_err(|_| {
            AppError::new(
                codes::PROVIDER_AUTH_ERROR,
                "API Key 无效",
                "API Key 包含无法作为 HTTP 请求头使用的字符。",
            )
        })?;
        headers.insert("x-api-key", api_key_header);
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
            .map_err(|e| {
                AppError::new(
                    codes::PROVIDER_NETWORK_ERROR,
                    "HTTP 客户端初始化失败",
                    "无法构建 HTTP 客户端。",
                )
                .with_details(e.to_string())
            })?;

        let start = Instant::now();
        let base_url = config.base_url.trim_end_matches('/');

        // Try models endpoint first
        let models_url = format!("{base_url}/v1/models");
        let response = client.get(&models_url).send().await;

        let elapsed_ms = start.elapsed().as_millis() as u64;

        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    Ok(ConnectionResult {
                        success: true,
                        message: format!("连接成功 ({elapsed_ms}ms)"),
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
                    (
                        codes::PROVIDER_TIMEOUT,
                        format!("连接超时 ({elapsed_ms}ms)"),
                    )
                } else if e.is_connect() {
                    (
                        codes::PROVIDER_NETWORK_ERROR,
                        "无法连接到服务器，请检查 URL。".to_string(),
                    )
                } else {
                    (codes::PROVIDER_NETWORK_ERROR, format!("网络错误: {e}"))
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
        // Resolve early to validate the credential exists (key is resolved
        // again inside AnthropicProvider::detect_models for the actual call).
        let _api_key = resolve_api_key(config).await?;
        let anthropic = AnthropicProvider;
        let mut anon_config = config.clone();
        anon_config.provider_type = "custom".to_string();

        // Wrap in a new ProviderConfig that has the actual API key resolved
        if let Ok(models) = anthropic.detect_models(&anon_config).await {
            Ok(models
                .into_iter()
                .map(|m| ModelInfo {
                    provider: "custom".to_string(),
                    ..m
                })
                .collect())
        } else {
            // Fallback: return configured models only
            let now = chrono::Utc::now().to_rfc3339();
            let mut models = Vec::new();
            if let Some(ref m) = config.default_model {
                models.push(ModelInfo {
                    id: m.clone(),
                    display_name: Some(format!("{m} (已配置)")),
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

    async fn apply_config(&self, config: &ProviderConfig) -> AppResult<ApplyConfigOutcome> {
        update_claude_settings(config, |env_obj, key| {
            env_obj.insert(
                "ANTHROPIC_BASE_URL".to_string(),
                serde_json::json!(config.base_url),
            );
            set_auth_token(env_obj, key);
            if let Some(ref model) = config.default_model {
                env_obj.insert("ANTHROPIC_MODEL".to_string(), serde_json::json!(model));
            }
        })
        .await
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
            )
            .with_suggestion("请重新输入并保存 API Key。")),
        }
    } else {
        Err(AppError::new(
            codes::PROVIDER_AUTH_ERROR,
            "API Key 未配置",
            "Provider 未关联 API Key 凭据。",
        )
        .with_suggestion("请先配置 API Key。"))
    }
}

/// Resolve the plaintext API key for writing into Claude Code's `settings.json`.
///
/// Claude Code reads `ANTHROPIC_AUTH_TOKEN` from the settings `env` block as a
/// literal value — it has no notion of a credential reference. Writing a
/// placeholder such as `$CREDENTIALS:ccm/deepseek/default` therefore installs an
/// invalid token and every subsequent request fails with 401.
///
/// Returns `None` when no key can be resolved, in which case the caller must
/// leave any existing value untouched rather than overwrite it.
async fn resolve_key_for_settings(config: &ProviderConfig) -> Option<String> {
    match resolve_api_key(config).await {
        Ok(key) if !key.trim().is_empty() => Some(key),
        Ok(_) => None,
        Err(e) => {
            log::warn!(
                "No API key available for settings.json ({}); leaving stored credential untouched",
                e.code
            );
            None
        }
    }
}

/// Set `ANTHROPIC_AUTH_TOKEN` in a settings `env` object from the resolved key.
///
/// When `key` is `None` the existing entry is preserved: wiping the user's
/// working token would be worse than leaving a stale one.
fn set_auth_token(env_obj: &mut serde_json::Map<String, serde_json::Value>, key: Option<&str>) {
    match key {
        Some(k) => {
            env_obj.insert("ANTHROPIC_AUTH_TOKEN".to_string(), serde_json::json!(k));
        }
        None => {
            if env_obj.contains_key("ANTHROPIC_AUTH_TOKEN") {
                log::warn!("API Key unresolved — keeping the existing ANTHROPIC_AUTH_TOKEN in settings.json");
            }
        }
    }
}

/// Open Claude Code's `settings.json`, apply `mutate`, then write it back through
/// the atomic/backup path and double-check that the key actually landed.
///
/// Shared by all three provider adapters so the token handling cannot drift
/// between them again.
async fn update_claude_settings<F>(
    config: &ProviderConfig,
    mutate: F,
) -> AppResult<ApplyConfigOutcome>
where
    F: FnOnce(&mut serde_json::Map<String, serde_json::Value>, Option<&str>),
{
    let config_dir = crate::environment::get_user_config_dir();
    let settings_path = config_dir.join("settings.json");

    let key = resolve_key_for_settings(config).await;

    let mut current: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content).unwrap_or_else(|e| {
            log::warn!("settings.json is not valid JSON ({e}); starting from a fresh object");
            serde_json::json!({})
        })
    } else {
        serde_json::json!({})
    };

    if let Some(obj) = current.as_object_mut() {
        // Detach `env` into an owned object so the closure never has to thread
        // the entry-API borrow through.
        let mut env = obj
            .remove("env")
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();

        mutate(&mut env, key.as_deref());

        obj.insert("env".to_string(), serde_json::Value::Object(env));
    }

    let content = serde_json::to_string_pretty(&current)?;
    // `write_config_inner` backs the previous file up and rolls back on failure,
    // so a plaintext key can never be left half-written.
    crate::config::write_config_inner(&settings_path, &content)?;

    verify_key_written(&settings_path, key.as_deref());

    if key.is_some() {
        log::warn!(
            "Credential stored in plaintext at {} (backup written alongside)",
            settings_path.to_string_lossy()
        );
    }

    Ok(describe_storage(key.as_deref(), &settings_path))
}

/// Post-write check: confirm the token we intended to store is the one on disk.
///
/// Guards against a silent write failure or a later transformation reverting the
/// value — the exact class of bug that made a saved provider config unusable.
fn verify_key_written(settings_path: &std::path::Path, expected: Option<&str>) {
    let Some(expected) = expected else {
        return;
    };
    let Ok(content) = std::fs::read_to_string(settings_path) else {
        log::error!("settings.json unreadable immediately after write");
        return;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) else {
        log::error!("settings.json is not valid JSON immediately after write");
        return;
    };
    let actual = parsed
        .get("env")
        .and_then(|e| e.get("ANTHROPIC_AUTH_TOKEN"))
        .and_then(|v| v.as_str());

    if actual == Some(expected) {
        log::info!("Provider API key written to settings.json");
    } else {
        log::error!(
            "settings.json ANTHROPIC_AUTH_TOKEN does not match the stored credential after write"
        );
    }
}

/// How CCM surfaces the storage consequence of writing a live credential into
/// Claude Code's own settings file.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CredentialStorage {
    /// A plaintext key is now in `settings.json`.
    PlaintextInSettings,
    /// No key was written; any pre-existing value was preserved.
    PreservedExisting,
}

/// Result of applying a provider config, reported back to the UI.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ApplyConfigOutcome {
    pub storage: CredentialStorage,
    pub message: String,
}

/// Describe how (and where) the credential ended up, so the UI can be explicit
/// instead of implying the key only ever lives in the Credential Manager.
pub fn describe_storage(key: Option<&str>, settings_path: &std::path::Path) -> ApplyConfigOutcome {
    let path = settings_path.to_string_lossy();
    match key {
        Some(_) => ApplyConfigOutcome {
            storage: CredentialStorage::PlaintextInSettings,
            message: format!(
                "配置已保存。注意：API Key 以明文写入 {path}（Claude Code 只从该文件或环境变量读取 token），\
                 原文件已生成 .bak 备份。"
            ),
        },
        None => ApplyConfigOutcome {
            storage: CredentialStorage::PreservedExisting,
            message: "配置已保存，但未能解析到 API Key，已保留原有 token 不变。\
                      请在表单中重新输入 API Key 后再次保存。"
                .to_string(),
        },
    }
}

// ===== 已有 Claude Code 配置检测 / 导入 =====

/// 掩码一个密钥用于展示：保留短前缀 + 末尾 4 位，中间打码；
/// 短密钥（< 12 字符）整体打码。
pub fn mask_secret(secret: &str) -> String {
    let len = secret.chars().count();
    if len < 12 {
        return "••••".to_string();
    }
    let chars: Vec<char> = secret.chars().collect();
    let prefix: String = chars.iter().take(6).collect();
    let suffix: String = chars
        .iter()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{prefix}...{suffix}")
}

/// 读取 `~/.claude/settings.json` 的 `env` 对象（若存在且合法）
fn read_settings_env() -> Option<serde_json::Map<String, serde_json::Value>> {
    let settings_path = crate::environment::get_user_config_dir().join("settings.json");
    let content = std::fs::read_to_string(&settings_path).ok()?;
    let val: serde_json::Value = serde_json::from_str(&content).ok()?;
    val.get("env")?.as_object().cloned()
}

/// 从 env 对象读取非空字符串值
fn get_env_string(env: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<String> {
    env.get(key)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

/// 提取明文 API Key：优先 `ANTHROPIC_API_KEY`，其次明文 `ANTHROPIC_AUTH_TOKEN`。
/// `$CREDENTIALS:` 引用视为「CCM 已管理」，跳过。
fn extract_api_key(env: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    if let Some(key) = get_env_string(env, "ANTHROPIC_API_KEY") {
        return Some(key);
    }
    if let Some(token) = get_env_string(env, "ANTHROPIC_AUTH_TOKEN") {
        if !token.starts_with("$CREDENTIALS:") {
            return Some(token);
        }
    }
    None
}

/// 依据 base_url 推断 provider 类型
fn infer_provider_hint(base_url: Option<&str>) -> String {
    let url = base_url.unwrap_or("").to_ascii_lowercase();
    if url.contains("anthropic.com") {
        "anthropic".to_string()
    } else if url.contains("deepseek") {
        "deepseek".to_string()
    } else if url.is_empty() {
        "anthropic".to_string()
    } else {
        "custom".to_string()
    }
}

/// 检测用户已有的 Claude Code API 配置（settings.json 优先，环境变量兜底）。
/// 不返回明文 API Key。
pub fn detect_existing_claude_config() -> DetectedClaudeConfig {
    let mut source: Option<String> = None;
    let mut base_url: Option<String> = None;
    let mut model: Option<String> = None;
    let mut api_key: Option<String> = None;

    if let Some(env) = read_settings_env() {
        source = Some("settings.json".to_string());
        api_key = extract_api_key(&env);
        base_url = get_env_string(&env, "ANTHROPIC_BASE_URL");
        model = get_env_string(&env, "ANTHROPIC_MODEL");
    }

    // 环境变量兜底：仅补 settings.json 缺失的字段
    let mut from_env = false;
    if base_url.is_none() {
        if let Ok(v) = std::env::var("ANTHROPIC_BASE_URL") {
            if !v.is_empty() {
                base_url = Some(v);
                from_env = true;
            }
        }
    }
    if model.is_none() {
        if let Ok(v) = std::env::var("ANTHROPIC_MODEL") {
            if !v.is_empty() {
                model = Some(v);
                from_env = true;
            }
        }
    }
    if api_key.is_none() {
        if let Ok(v) = std::env::var("ANTHROPIC_API_KEY") {
            if !v.is_empty() {
                api_key = Some(v);
                from_env = true;
            }
        }
    }
    if source.is_none() && from_env {
        source = Some("environment".to_string());
    }

    let has_api_key = api_key.is_some();
    let found = has_api_key || base_url.is_some() || model.is_some();

    DetectedClaudeConfig {
        found,
        source,
        provider_hint: if found {
            Some(infer_provider_hint(base_url.as_deref()))
        } else {
            None
        },
        base_url,
        model,
        has_api_key,
        api_key_masked: api_key.as_deref().map(mask_secret),
    }
}

/// 导入用户已有的 Claude Code API 配置到 CCM：
/// 存 API Key 到凭据管理器 + 写 base_url/model 到 provider 配置；
/// 不改写用户的 settings.json。
pub fn import_existing_claude_config(provider_type: &str) -> AppResult<ImportResult> {
    let detected = detect_existing_claude_config();

    if !detected.found {
        return Ok(ImportResult {
            success: false,
            message: "未检测到可导入的 Claude Code 配置。".to_string(),
            provider_type: provider_type.to_string(),
        });
    }

    // 读取明文 key（复用检测读取逻辑，仅用于写入凭据管理器）
    let api_key: Option<String> = read_settings_env()
        .and_then(|env| extract_api_key(&env))
        .or_else(|| {
            std::env::var("ANTHROPIC_API_KEY")
                .ok()
                .filter(|s| !s.is_empty())
        });

    // 1. 存 API Key 到凭据管理器
    if let Some(key) = api_key {
        let cred_id = credentials::credential_id(provider_type, "default");
        credentials::store_credential(&cred_id, "api_key", &key)?;
    }

    // 2. 写 provider 配置到 app data
    let config_data = serde_json::json!({
        "provider_type": provider_type,
        "name": provider_type,
        "base_url": detected.base_url,
        "default_model": detected.model,
        "fast_model": null,
        "high_capability_model": null,
        "timeout_secs": 60,
        "custom_headers": null,
    });
    let config_str = serde_json::to_string_pretty(&config_data).map_err(|e| {
        AppError::new(codes::CONFIG_PARSE_ERROR, "序列化配置失败", "").with_details(e.to_string())
    })?;
    crate::config::write_provider_config(provider_type, &config_str)?;

    Ok(ImportResult {
        success: true,
        message: "已导入 Claude Code 配置。".to_string(),
        provider_type: provider_type.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_with_token(existing: &str) -> serde_json::Map<String, serde_json::Value> {
        let mut m = serde_json::Map::new();
        m.insert(
            "ANTHROPIC_AUTH_TOKEN".to_string(),
            serde_json::json!(existing),
        );
        m
    }

    fn test_config(api_key_override: Option<String>) -> ProviderConfig {
        ProviderConfig {
            provider_type: "deepseek".into(),
            name: "t".into(),
            base_url: "https://api.deepseek.com/anthropic".into(),
            default_model: None,
            fast_model: None,
            high_capability_model: None,
            timeout_secs: 30,
            credential_id: None,
            custom_headers: None,
            api_key_override,
        }
    }

    // ── Regression: a placeholder must never reach settings.json ──

    #[test]
    fn set_auth_token_writes_the_real_key() {
        let mut env = env_with_token("old-key");
        set_auth_token(&mut env, Some("sk-real-key-123"));
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").and_then(|v| v.as_str()),
            Some("sk-real-key-123")
        );
    }

    /// The exact bug: `apply_config` used to write `$CREDENTIALS:...`, which
    /// Claude Code sends verbatim as the auth token, so every request 401s.
    #[test]
    fn set_auth_token_never_emits_a_credential_reference() {
        let mut env = serde_json::Map::new();
        set_auth_token(&mut env, Some("sk-live-value"));

        let written = env
            .get("ANTHROPIC_AUTH_TOKEN")
            .and_then(|v| v.as_str())
            .unwrap();
        assert!(
            !written.starts_with("$CREDENTIALS:"),
            "a credential reference is not a usable token: {written}"
        );
    }

    #[test]
    fn set_auth_token_preserves_existing_value_when_key_unresolved() {
        // Wiping a working token is worse than leaving a stale one.
        let mut env = env_with_token("sk-still-working");
        set_auth_token(&mut env, None);
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").and_then(|v| v.as_str()),
            Some("sk-still-working")
        );
    }

    #[test]
    fn set_auth_token_no_op_when_unresolved_and_absent() {
        let mut env = serde_json::Map::new();
        set_auth_token(&mut env, None);
        assert!(!env.contains_key("ANTHROPIC_AUTH_TOKEN"));
    }

    // ── Key resolution ──

    #[tokio::test]
    async fn resolve_key_for_settings_prefers_api_key_override() {
        let config = test_config(Some("sk-from-form".into()));
        assert_eq!(
            resolve_key_for_settings(&config).await.as_deref(),
            Some("sk-from-form")
        );
    }

    #[tokio::test]
    async fn resolve_key_for_settings_returns_none_without_any_key() {
        let config = test_config(None); // no credential reference at all
        assert!(
            resolve_key_for_settings(&config).await.is_none(),
            "must not invent a key"
        );
    }

    #[tokio::test]
    async fn resolve_key_for_settings_rejects_blank_override() {
        let config = test_config(Some("   ".into()));
        assert!(resolve_key_for_settings(&config).await.is_none());
    }

    // ── User-facing storage description ──

    #[test]
    fn describe_storage_flags_plaintext_when_key_written() {
        let path = std::path::Path::new(r"C:\Users\x\.claude\settings.json");
        let outcome = describe_storage(Some("sk-x"), path);
        assert_eq!(outcome.storage, CredentialStorage::PlaintextInSettings);
        assert!(outcome.message.contains("明文"), "{}", outcome.message);
        assert!(
            outcome.message.contains("settings.json"),
            "{}",
            outcome.message
        );
    }

    #[test]
    fn describe_storage_reports_preservation_when_key_missing() {
        let path = std::path::Path::new(r"C:\Users\x\.claude\settings.json");
        let outcome = describe_storage(None, path);
        assert_eq!(outcome.storage, CredentialStorage::PreservedExisting);
        assert!(outcome.message.contains("保留"), "{}", outcome.message);
    }

    // ── Existing helper ──

    #[test]
    fn mask_secret_hides_short_and_partial_long_secrets() {
        assert_eq!(mask_secret("short"), "••••");
        let masked = mask_secret("sk-1234567890abcdef");
        assert!(masked.starts_with("sk-123"));
        assert!(masked.ends_with("cdef"));
        assert!(!masked.contains("4567890a"), "middle must be hidden");
    }
}
