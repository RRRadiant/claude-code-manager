// Claude Code Manager - Credential management (Windows Credential Manager)
use crate::error::AppResult;

/// Store an API key in the Windows Credential Manager
pub fn store_credential(service: &str, account: &str, secret: &str) -> AppResult<()> {
    #[cfg(windows)]
    {
        let entry = keyring::Entry::new(service, account)?;
        entry.set_password(secret)?;
        log::info!("Credential stored: service={service}, account={account}");
        Ok(())
    }

    #[cfg(not(windows))]
    {
        // Fallback for non-Windows (development)
        log::warn!("Credential Manager not available on this platform");
        Err(AppError::new(
            codes::SECURITY_PERMISSION_DENIED,
            "凭据管理不可用",
            "凭据管理器仅支持 Windows 平台。",
        ))
    }
}

/// Retrieve an API key from the Windows Credential Manager
pub fn get_credential(service: &str, account: &str) -> AppResult<String> {
    #[cfg(windows)]
    {
        let entry = keyring::Entry::new(service, account)?;
        let password = entry.get_password()?;
        Ok(password)
    }

    #[cfg(not(windows))]
    {
        Err(AppError::new(
            codes::SECURITY_PERMISSION_DENIED,
            "凭据管理不可用",
            "凭据管理器仅支持 Windows 平台。",
        ))
    }
}

/// Delete a credential from the Windows Credential Manager
pub fn delete_credential(service: &str, account: &str) -> AppResult<()> {
    #[cfg(windows)]
    {
        let entry = keyring::Entry::new(service, account)?;
        entry.delete_credential()?;
        log::info!("Credential deleted: service={service}, account={account}");
        Ok(())
    }

    #[cfg(not(windows))]
    {
        Err(AppError::new(
            codes::SECURITY_PERMISSION_DENIED,
            "凭据管理不可用",
            "凭据管理器仅支持 Windows 平台。",
        ))
    }
}

/// Build a credential service name for a provider
pub fn credential_id(provider_type: &str, name: &str) -> String {
    format!("ccm/{provider_type}/{name}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_credential_id_format() {
        let id = credential_id("anthropic", "default");
        assert_eq!(id, "ccm/anthropic/default");
    }
}
