// Claude Code Manager - Structured logging with sensitive data sanitization
use regex::Regex;

/// Sanitized string wrapper — logs show sanitized version only
pub struct Sanitized(String);

impl std::fmt::Display for Sanitized {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Log sanitizer that strips sensitive information from log entries
pub struct LogSanitizer {
    api_key_pattern: Regex,
    bearer_pattern: Regex,
    auth_header_pattern: Regex,
    cookie_pattern: Regex,
    token_pattern: Regex,
    password_pattern: Regex,
    email_pattern: Regex,
}

impl LogSanitizer {
    pub fn new() -> Self {
        Self {
            // Anthropic API keys: sk-ant-...
            api_key_pattern: Regex::new(r"sk-ant-[A-Za-z0-9_-]{10,}").unwrap(),
            // Authorization: Bearer ...
            bearer_pattern: Regex::new(r"(?i)(Authorization:\s*Bearer\s+)\S+").unwrap(),
            // x-api-key header values
            auth_header_pattern: Regex::new(r"(?i)(x-api-key:\s*)\S+").unwrap(),
            // Set-Cookie values
            cookie_pattern: Regex::new(r"(?i)(Cookie[^=]*=[^;]+)").unwrap(),
            // Generic token patterns
            token_pattern: Regex::new(r"(?i)(token[=:]\s*)\S+").unwrap(),
            // Password patterns
            password_pattern: Regex::new(r"(?i)(password[=:]\s*)\S+").unwrap(),
            // Email addresses
            email_pattern: Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}").unwrap(),
        }
    }

    /// Sanitize a raw string, replacing sensitive patterns
    pub fn sanitize(&self, raw: &str) -> Sanitized {
        let s = self.api_key_pattern.replace_all(raw, "sk-ant-[REDACTED]");
        let s = self.bearer_pattern.replace_all(&s, "$1[REDACTED]");
        let s = self.auth_header_pattern.replace_all(&s, "$1[REDACTED]");
        let s = self.cookie_pattern.replace_all(&s, "[COOKIE_REDACTED]");
        let s = self.token_pattern.replace_all(&s, "$1[REDACTED]");
        let s = self.password_pattern.replace_all(&s, "$1[REDACTED]");
        let s = self.email_pattern.replace_all(&s, "[EMAIL_REDACTED]");
        Sanitized(s.to_string())
    }

    /// Sanitize the user's home directory path to %USERPROFILE%
    pub fn sanitize_path(&self, path: &str) -> String {
        if let Some(home) = std::env::var("USERPROFILE").ok() {
            path.replace(&home, "%USERPROFILE%")
        } else {
            path.to_string()
        }
    }

    /// Sanitize a log message (path + secrets)
    pub fn sanitize_log(&self, message: &str) -> String {
        let s = self.sanitize(message);
        let s = self.sanitize_path(&s.to_string());
        s
    }
}

impl Default for LogSanitizer {
    fn default() -> Self {
        Self::new()
    }
}

/// Log a sanitized info message
#[macro_export]
macro_rules! log_sanitized {
    ($sanitizer:expr, $level:expr, $($arg:tt)+) => {{
        let msg = format!($($arg)+);
        let sanitized = $sanitizer.sanitize_log(&msg);
        match $level {
            log::Level::Error => log::error!("{}", sanitized),
            log::Level::Warn => log::warn!("{}", sanitized),
            log::Level::Info => log::info!("{}", sanitized),
            log::Level::Debug => log::debug!("{}", sanitized),
            log::Level::Trace => log::trace!("{}", sanitized),
        }
    }};
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_api_key() {
        let sanitizer = LogSanitizer::new();
        let result = sanitizer.sanitize("key=sk-ant-ABCDEF1234567890abcdef");
        assert!(!result.to_string().contains("ABCDEF1234567890abcdef"));
        assert!(result.to_string().contains("sk-ant-[REDACTED]"));
    }

    #[test]
    fn test_sanitize_bearer_token() {
        let sanitizer = LogSanitizer::new();
        let result = sanitizer.sanitize("Authorization: Bearer my-secret-token-12345");
        assert!(!result.to_string().contains("my-secret-token-12345"));
        assert!(result.to_string().contains("Authorization: Bearer [REDACTED]"));
    }

    #[test]
    fn test_sanitize_email() {
        let sanitizer = LogSanitizer::new();
        let result = sanitizer.sanitize("contact@example.com");
        assert!(!result.to_string().contains("contact@example.com"));
        assert!(result.to_string().contains("[EMAIL_REDACTED]"));
    }

    #[test]
    fn test_sanitize_path() {
        let sanitizer = LogSanitizer::new();
        if let Ok(home) = std::env::var("USERPROFILE") {
            let path = format!("{}\\AppData\\ClaudeCode", home);
            let result = sanitizer.sanitize_path(&path);
            assert_eq!(result, "%USERPROFILE%\\AppData\\ClaudeCode");
        }
    }

    #[test]
    fn test_empty_string() {
        let sanitizer = LogSanitizer::new();
        let result = sanitizer.sanitize("");
        assert_eq!(result.to_string(), "");
    }

    #[test]
    fn test_no_sensitive_data() {
        let sanitizer = LogSanitizer::new();
        let result = sanitizer.sanitize("Normal log message without secrets");
        assert_eq!(result.to_string(), "Normal log message without secrets");
    }
}
