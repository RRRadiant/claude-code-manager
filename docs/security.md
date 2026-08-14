# Claude Code Manager — Security Design

> Last updated: 2026-07-20

---

## 1. Security Principles

1. **Minimum privilege** — The application runs at user level by default. Admin rights are requested only for system-wide operations (if any), with a clear explanation.
2. **Defense in depth** — Multiple layers: IPC whitelist, input validation, credential isolation, output sanitization.
3. **No generic shell** — No frontend command that accepts arbitrary shell strings.
4. **Fail secure** — Errors default to denying access, not leaking information.
5. **Auditable** — All sensitive operations logged (sanitized).

---

## 2. Credential Security

### API Key Storage
```
User Input (masked in UI)
  → IPC invoke to Rust backend
    → keyring crate → Windows Credential Manager
      → Config file stores: { "credentialId": "ccm/anthropic/default" }
```

### Key Protection Rules
| Storage Location | Allowed? | Notes |
|-----------------|----------|-------|
| Windows Credential Manager | ✅ Primary | Encrypted at rest by OS |
| Config JSON (as `credentialId`) | ✅ Allowed | Only a reference, not the key |
| Config JSON (as plaintext key) | ❌ Never | Even in local files |
| Frontend localStorage | ❌ Never | Plaintext in browser storage |
| Log files | ❌ Never | Sanitized to `[REDACTED]` |
| Error messages | ❌ Never | Replaced with `[key omitted]` |
| Clipboard | ⚠️ Allowed | Only on explicit user action, with timeout |
| Diagnostic reports | ❌ Never | Stripped before export |

### Credential Manager Operations
- **Read**: Resolve credential ID → actual key (in memory only, drop after use)
- **Write**: Store new credential, return credential ID
- **Delete**: Remove from Credential Manager
- **Update**: Overwrite existing credential entry

---

## 3. IPC Security Model

### Capability-Based Access Control
Tauri capabilities are defined in `src-tauri/capabilities/`. Each command must be explicitly allowed.

当前真实内容（`src-tauri/capabilities/default.json`）：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "enables the default permissions",
  "windows": ["main"],
  "permissions": [
    "core:default"
  ]
}
```

> 当前仅授予 `core:default`，未启用 `plugin:updater`、`plugin:shell` 等额外权限，
> 也不存在任意命令执行的通配权限。

### Command Input Validation
Every IPC command validates:
- Types (Rust's type system at serde boundary)
- String lengths (max lengths enforced)
- Path safety (path normalization, no `..` traversal)
- Command/args (no shell metacharacters in MCP commands)

---

## 4. Safe Command Execution

### Architecture
```rust
pub struct CommandSpec {
    pub program: PathBuf,      // Validated, absolute path
    pub args: Vec<String>,     // Separate from program
    pub cwd: Option<PathBuf>,  // Optional working directory
    pub env: Vec<(String, String)>, // Key-value pairs
    pub timeout: Duration,
}

pub fn execute(spec: CommandSpec) -> Result<ProcessOutput> {
    // 1. Validate program path (no relative, no symlink to unexpected)
    // 2. Spawn with args as separate array
    // 3. Set timeout
    // 4. Capture stdout/stderr separately
    // 5. Sanitize output before returning
}
```

### Prohibited Patterns
```rust
// ❌ NEVER do this:
let output = Command::new("powershell")
    .args(["-Command", &user_input])  // Arbitrary PowerShell from UI

// ✅ ALWAYS do this:
let output = Command::new(&detected_node_path)
    .args(["npm", "install", "-g", "@anthropic-ai/claude-code"])
    .timeout(Duration::from_secs(120))
    .output()
```

---

## 5. File System Security

### Atomic Write Pattern
```
1. Read original file (if exists)
2. Parse and validate new content
3. Create timestamped backup: {file}.bak.{timestamp}
4. Write to temporary file: {file}.tmp.{random}
5. Verify temporary file is valid
6. Rename temp → original (atomic on same filesystem)
7. On failure: restore from backup
```

### Path Safety
- All user-supplied paths are normalized with `std::fs::canonicalize`
- Path traversal attempts (`../`, `..\`, absolute paths outside allowed roots) are rejected
- Config file operations are restricted to known directories:
  - `%USERPROFILE%\.claude\`
  - `<project-root>\.claude\`
  - `<project-root>\.mcp.json`
  - `C:\ProgramData\ClaudeCode\` (read-only)

### Temp File Security
- Random file names (`{uuid}.tmp`)
- Created with restrictive permissions (user-only)
- Cleaned up on drop via RAII
- Not predictable (no `/tmp/app/sequential`)

---

## 6. Log Sanitization

> **状态：脱敏器已实现，但正在接线中。** `src-tauri/src/logging.rs` 中的 `LogSanitizer`
> 已用正则实现 API Key / Token / 密码 / 邮箱 / 路径脱敏，但尚未全面接入所有日志
> 输出路径（`log_sanitized!` 宏已定义、尚未在业务日志中统一调用）。

### Sanitization Rules
| Pattern | Replacement |
|---------|------------|
| `sk-ant-...` (full Anthropic key) | `[API_KEY_REDACTED]` |
| `sk-...` prefix + 3 chars | Retain prefix + 3 chars for debugging |
| `Authorization: Bearer *` | `Authorization: Bearer [REDACTED]` |
| `x-api-key: *` | `x-api-key: [REDACTED]` |
| Email addresses | `[EMAIL_REDACTED]` |
| User's home directory path | `%USERPROFILE%` (normalized) |
| `Password=*` | `Password=[REDACTED]` |
| `Token=*` | `Token=[REDACTED]` |
| HTTP `Set-Cookie` values | `[COOKIE_REDACTED]` |

### Sanitizer Implementation
```rust
pub struct Sanitized(String);

impl Sanitized {
    pub fn from_raw(raw: &str) -> Self {
        let s = raw
            .replace(&format!("sk-ant-"), "sk-ant-[REDACTED]")
            // ... more patterns
            ;
        Sanitized(s)
    }
}
```

---

## 7. Update Security

> **状态：自动更新尚未实现（计划中）。** 本节描述的是规划中的设计，当前版本
> **没有**已实现的 Ed25519 签名验证、公钥内嵌或密钥轮换。详见
> `docs/adr/0001-auto-update-deferred.md`。

### Verification Chain（规划中）
```
1. Download from GitHub Releases (HTTPS, TLS 1.3)
2. Verify TLS certificate chain
3. Download .sig file (Ed25519 signature)
4. Verify signature against embedded public key
5. Download SHA-256 checksum file
6. Verify hash matches downloaded binary
7. Only then proceed with installation
```

### Key Management（规划中）
- Signing private key stored in GitHub Secrets
- Public key embedded in application binary
- Key rotation supported via versioned public keys
- Update manifest signed independently from binary

---

## 8. Audit Logging

> **状态：审计日志子系统尚未实现（规划中）。** 下列清单为目标设计。

Every sensitive operation is logged (sanitized):
- API key create/update/delete (no key value)
- Provider config changes
- Config file modifications
- Claude Code install/uninstall
- MCP server add/remove
- Self-update attempts (success/failure)

Audit logs are:
- Stored in `%APPDATA%\ClaudeCodeManager\logs\audit*.log`（规划中）
- Rotated at 10MB（规划中）
- Retained for 30 days（规划中）
- Sanitized before writing（规划中）

---

## 9. Dependency Supply Chain

- npm 依赖使用 semver range（`package.json`），实际安装版本与完整性哈希由
  `package-lock.json` 锁定
- Rust dependencies pinned in `Cargo.lock`
- Automated Dependabot scanning (enabled in repo)
- `npm audit` and `cargo audit` run in CI
- SBOM generated for each release (CycloneDX format)

---

## 10. Security Checklist for Release

- [ ] Tauri capabilities minimized (no wildcard permissions)
- [ ] No `shell:allow-execute` in capabilities
- [ ] All IPC inputs validated server-side
- [ ] Credential Manager integration tested
- [ ] Log sanitization tested (no keys leaked in error paths)
- [ ] Path traversal tests pass
- [ ] Atomic write race condition tests pass
- [ ] Update signature verification tested (modified binary rejected)（规划中，自动更新尚未实现）
- [ ] Admin rights not requested for normal operations
- [ ] Frontend cannot read or write files directly
- [ ] Audit logging enabled and verified（规划中）
- [ ] Dependency audit clean (`npm audit`, `cargo audit`)
- [ ] SBOM generated
- [ ] Code signing certificate applied
