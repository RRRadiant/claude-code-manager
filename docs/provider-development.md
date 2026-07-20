# Provider Development Guide

## Overview

Claude Code Manager supports multiple API providers through a unified adapter interface. This document explains how to add a new provider.

## Provider Adapter Interface

All providers implement the `ProviderAdapter` trait:

```rust
#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    async fn validate_config(&self, config: &ProviderConfig) -> Result<ValidationResult>;
    async fn test_connection(&self, config: &ProviderConfig) -> Result<ConnectionResult>;
    async fn detect_models(&self, config: &ProviderConfig) -> Result<Vec<ModelInfo>>;
    async fn apply_config(&self, config: &ProviderConfig) -> Result<()>;
    async fn remove_config(&self) -> Result<()>;
}
```

## Adding a New Provider

1. Create `src-tauri/src/providers/<name>.rs`
2. Implement `ProviderAdapter` for your provider struct
3. Register in `src-tauri/src/providers/mod.rs`
4. Add frontend form in `src/features/providers/`

## Provider Configuration

```rust
pub struct ProviderConfig {
    pub provider_type: String,    // Unique identifier
    pub name: String,             // Display name
    pub base_url: String,         // API base URL
    pub default_model: Option<String>,
    pub fast_model: Option<String>,
    pub high_capability_model: Option<String>,
    pub timeout_secs: u64,
    pub credential_id: Option<String>,  // Reference to stored credential
    pub custom_headers: Option<Vec<(String, String)>>,
}
```

## API Key Storage

API keys are stored in Windows Credential Manager, not in config files. Use the credential ID pattern:

```rust
let cred_id = credential_id("my_provider", "default");
// Store: credentials::store_credential(&cred_id, "api_key", &secret)?;
// Retrieve: credentials::get_credential(&cred_id, "api_key")?;
```
