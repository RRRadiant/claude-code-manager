# Claude Code Manager — Architecture Document

> Version: 0.1.0 (draft)
> Last updated: 2026-07-20

---

## 1. Project Overview

**Claude Code Manager (CCM)** is a Windows desktop application that provides:
- One-click Claude Code installation and uninstall
- Visual Claude Code configuration management
- API provider configuration (Anthropic, DeepSeek, custom)
- Model detection and selection
- MCP server management
- Environment diagnostics and troubleshooting

**Target users:** Windows users new to Claude Code, AI agents, and MCP who prefer graphical interfaces over terminal commands.

---

## 2. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Desktop framework | **Tauri 2** | Native performance, small binary, Rust backend, webview UI |
| Backend language | **Rust** | Safety, performance, no GC, strong type system, Windows API access |
| Frontend framework | **React 18** | Component model, ecosystem, developer tooling |
| Frontend language | **TypeScript** | Type safety, better DX for complex state |
| Build tool | **Vite** | Fast HMR, TypeScript native, Tauri integration |
| UI effects | **@creativoma/liquid-glass** | Liquid glass for navigation/cards |
| State management | **Zustand** | Lightweight, TypeScript-first, simple API |
| Styling | **CSS Modules + CSS custom properties** | Theming via CSS variables, no runtime CSS-in-JS overhead |
| Credential storage | **keyring** crate (Rust) | Windows Credential Manager backend |
| CI/CD | **GitHub Actions** | Native Tauri support, Windows ARM64/x64 runners |
| Packaging | **Tauri bundler (NSIS)** | x64 and ARM64 support |
| Updates | **@tauri-apps/plugin-updater（规划中，暂缓）** | 自动更新尚未接入，见 `docs/adr/0001-auto-update-deferred.md` |

### Why Not...
| Alternative | Reason against |
|-------------|---------------|
| Electron | ~150MB+ binary size, significantly higher memory usage |
| .NET MAUI / WinUI 3 | Windows-only, no cross-platform future, larger team investment |
| React Native for Windows | Immature, fewer Tauri-like capabilities (system access, updater) |
| Plain Win32 / Qt | Higher development cost for modern UI, no web frontend ecosystem |

---

## 3. Architectural Principles

```
┌─────────────────────────────────────────────────────────┐
│                     React Frontend                       │
│  (UI only — no commands, no FS, no credentials)          │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────────┐  │
│  │Pages │ │Comp. │ │Stores│ │Hooks │ │ Zustand State │  │
│  └──┬───┘ └──────┘ └──┬───┘ └──┬──┘ └──────┬───────┘  │
│     └──────┬───────────┘        │           │           │
│            ▼                    ▼           ▼           │
│     ┌─────────────────────────────────────────┐         │
│     │         Tauri IPC (invoke)               │         │
│     │   (typed commands, event system)         │         │
│     └────────────────┬────────────────────────┘         │
└──────────────────────┼──────────────────────────────────┘
                       │
┌──────────────────────┼──────────────────────────────────┐
│     Rust Backend     ▼                                   │
│  ┌──────────────────────────────────────────────┐       │
│  │  Tauri Commands (thin dispatch layer)         │       │
│  │  ┌──────────┐ ┌────────┐ ┌──────────┐        │       │
│  │  │installer │ │config  │ │provider  │  ...   │       │
│  │  │commands  │ │commands│ │commands  │        │       │
│  │  └────┬─────┘ └───┬────┘ └────┬─────┘        │       │
│  └───────┼────────────┼───────────┼──────────────┘       │
│          ▼            ▼           ▼                       │
│  ┌──────────────────────────────────────────────┐       │
│  │  Service Layer                                │       │
│  │  ┌──────────┐ ┌───────┐ ┌──────────┐ ┌────┐ │       │
│  │  │Detector  │ │Runner │ │Credential│ │Log │ │       │
│  │  │Env/System│ │Command│ │ Manager  │ │Safe│ │       │
│  │  └──────────┘ └───────┘ └──────────┘ └────┘ │       │
│  │  ┌──────────┐ ┌───────┐ ┌──────────┐ ┌────┐ │       │
│  │  │Updater   │ │MCP    │ │Security  │ │Task│ │       │
│  │  │Service   │ │Tester │ │Validator │ │Mgr │ │       │
│  │  └──────────┘ └───────┘ └──────────┘ └────┘ │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

### Key Rules
1. **Frontend is pure UI** — no direct system commands, no file I/O, no credential processing
2. **All side effects go through Tauri IPC** — typed invoke calls
3. **Commands are thin** — they validate, delegate to services, return results
4. **Services are testable** — pure Rust, no Tauri dependency
5. **Progress/events are push-based** — Tauri events from backend, not frontend polling
6. **No generic shell execution** — every command is a typed Rust function

---

## 4. Module Map

### Rust Backend (`src-tauri/src/`)

| Module | Responsibility | Key Types |
|--------|---------------|-----------|
| `commands/` | Thin Tauri command handlers | `mod.rs` (router) |
| `environment/` | Windows version, arch, PATH, PS/Git detection | `WindowsInfo`, `PathCheck` |
| `installer/` | Claude Code install/fix/uninstall | `InstallMethod`, `InstallStep` |
| `providers/` | Provider adapters (Anthropic, DeepSeek, Custom) | `ProviderAdapter` trait |
| `model_detection/` | API-based model list detection | `ModelInfo`, `CapabilityFlags` |
| `config/` | Read/write/backup settings files | `ConfigFile`, `ConfigScope` |
| `mcp/` | MCP server management & testing | `McpServer`, `McpTestResult` |
| `credentials/` | Windows Credential Manager wrapper | `CredentialEntry` |
| `process/` | Safe command execution | `CommandSpec`, `ProcessOutput` |
| `security/` | Path sanitization, validation, audit | — |
| `diagnostics/` | System health checks | `DiagCheck`, `DiagReport` |
| `logging/` | Structured, sanitized logging | `LogEntry`, `Sanitized` |

### Frontend (`src/`)

| Module | Responsibility |
|--------|---------------|
| `components/` | Shared UI components (GlassNav, StatusCard, etc.) |
| `pages/` | Top-level route pages (Home, Install, Config, ...) |
| `features/` | Feature-specific components and logic |
| `stores/` | Zustand stores matching backend state |
| `hooks/` | React hooks wrapping Tauri invoke calls |
| `services/` | Frontend-side API helpers (no system access) |
| `types/` | TypeScript type definitions matching Rust types |

---

## 5. Data Models (Core)

### Provider Adapter Interface (Rust)
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

### Task System
```rust
pub struct TaskState {
    pub id: String,
    pub type_: TaskType,
    pub status: TaskStatus,
    pub title: String,
    pub current_step: Option<String>,
    pub progress: Option<f64>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub cancellable: bool,
    pub error: Option<AppError>,
}
```

### Error System
```rust
pub struct AppError {
    pub code: String,             // e.g., "INSTALL_NETWORK_ERROR"
    pub title: String,            // User-facing title
    pub message: String,          // User-facing description
    pub technical_details: Option<String>, // Expandable technical info
    pub suggestions: Vec<String>, // Actionable suggestions
    pub retryable: bool,          // Whether retry makes sense
}
```

### MCP Server Config
```rust
pub struct McpServerDef {
    pub name: String,
    pub type_: McpTransportType,  // Stdio | Http
    pub command: Option<String>,  // for stdio
    pub args: Option<Vec<String>>,
    pub url: Option<String>,      // for http
    pub headers: Option<Vec<HttpHeader>>,
    pub env: Option<Vec<EnvVar>>,
    pub cwd: Option<String>,
    pub timeout_ms: Option<u64>,
    pub tool_timeout_ms: Option<u64>,
    pub scope: McpScope,          // Local | Project | User
    pub enabled: bool,
}
```

---

## 6. Security Design

### Threat Model
| Threat | Mitigation |
|--------|-----------|
| Command injection | Parameter arrays, no string concatenation, typed CommandSpec |
| Path traversal | Path normalization, allowlist-based directory access |
| API Key leakage | Windows Credential Manager, log sanitization, no frontend storage |
| Update hijack | Signature verification + SHA-256, TLS, pinned public key |
| DLL hijacking | Tauri's bundled WebView2, explicit dependency paths |
| Unsafe temp files | Random names, secure permissions, cleanup on drop |
| TOCTOU races | Atomic file replace (write-temp → rename) |
| Unnecessary admin | Elevate only for specific operations with clear user consent |
| Malicious MCP config | Validate command/args before execution, user confirmation |

### API Key Flow
```
User Input (masked) → Rust Frontend → IPC → Rust Backend
                                              ↓
                                    Windows Credential Manager   (CCM copy)
                                              ↓
                          ~/.claude/settings.json env.ANTHROPIC_AUTH_TOKEN
                                              ↓
                              Log entry: [CREDENTIAL ref: provider/deepseek]
```

> **Note:** the key is written into Claude Code's own `settings.json` in
> plaintext, because Claude Code reads that field as a literal token and cannot
> resolve a credential reference. An earlier design stored a `credentialId`
> reference there; Claude Code sent it verbatim and every request 401'd. See
> `docs/security.md` §2 for the trade-off and the safeguards.

### IPC Security
- Tauri capabilities limited to specific command names
- No `shell:allow-execute` or `shell:allow-open` for arbitrary commands
- Every IPC command validates input types
- Commands don't accept raw shell strings

---

## 7. Page Structure & User Flow

### Navigation
```
 ┌──────────┬──────────────────────────────────────┐
 │ 🏠 Home  │                                      │
 │ 🔧 Env   │        Content Area                  │
 │ 🔌 API   │                                      │
 │ 📝 Config│                                      │
 │ 🔗 MCP   │                                      │
 │ 🩺 Diag  │                                      │
 │ 📦 Update│                                      │
 │ ⚙️ Settings│                                    │
 │ 📖 About │                                      │
 └──────────┴──────────────────────────────────────┘
```

### New User Onboarding Flow
```
Welcome Screen
  → System Environment Check
  → Install Claude Code (if needed)
  → Choose API Provider
  → Test API Connection
  → Detect & Select Model
  → (Optional) Configure MCP
  → Complete → Dashboard
```

Each step allows "Skip" and "Do this later". User can return to onboarding from Help menu.

---

## 8. Update System Architecture

> **当前状态：未实现。** 应用自身的自动更新功能尚未接入。
> Claude Code 自身内置更新机制（终端 `claude update`），CCM 不重复实现。
> 如需升级 CCM，请手动关注项目 Release。

本节为后续规划保留，待自动更新功能落地后补充：
- 便携版：下载新版本 + 签名 + SHA-256 校验 → update-helper 替换 EXE
- 安装版：下载安装包 + 校验 → 静默升级

---

## 9. Windows x64 vs ARM64 Strategy

| Aspect | x64 | ARM64 |
|--------|-----|-------|
| Rust target | `x86_64-pc-windows-msvc` | `aarch64-pc-windows-msvc` |
| Bundle format | MSI + NSIS portable | NSIS portable (MSI ARM64 limited) |
| CI runner | `windows-latest` (x64) | `windows-2025-arm64` (if available) or cross-compile |
| WebView2 | System-provided | System-provided (ARM64 WebView2 available) |
| Prerequisites | VS Build Tools, rustup target | VS ARM64 tools + `aarch64-pc-windows-msvc` target |
| Testing | CI, dev machines | Native ARM64 Windows or emulation |

Both architectures share the same codebase — only the build target differs.

---

## 10. Phased Development Plan

### Phase 0: Research & Architecture (当前)
- ✅ Official documentation survey
- ✅ Architecture design
- ✅ Directory structure
- ⬜ `docs/references.md`
- ⬜ `docs/architecture.md`
- ⬜ `docs/security.md`

### Phase 1: Foundation & Scaffolding
- Initialize Tauri 2 + React + Vite project
- Configure TypeScript, ESLint, Rustfmt
- Set up GitHub Actions (lint, type-check, test)
- Implement core types (Rust + TypeScript)
- Implement error system
- Implement task system
- Implement logging module

### Phase 2: Backend Core Services
- Process/command executor with safety
- Windows environment detection
- File service with atomic operations
- Credential manager (keyring)
- Provider adapter interface
- Config file parser/validator/backup

### Phase 3: UI Shell & Mock Data
- Tauri window configuration (titlebar, size, min size)
- Navigation shell with liquid-glass effect
- Dark/light/system theme
- All page shells with Zustand stores
- Onboarding flow with mock data
- In-page controls (Tweaks panel)

### Phase 4: Claude Code Install & Environment
- Environment detection commands
- Claude Code installer (native + WinGet)
- Install progress via events
- Verification after install
- Repair/update/uninstall
- PATH detection and fix

### Phase 5: API Providers & Models
- Anthropic provider implementation
- DeepSeek provider implementation
- Custom provider implementation
- Model detection (API-based)
- API Key management via Credential Manager
- Connection testing

### Phase 6: Config & MCP Management
- Config file viewer/editor (form + source modes)
- JSON Schema validation
- Atomic save with backup/rollback
- MCP CRUD (all scopes)
- MCP stdio testing (real init handshake)
- MCP HTTP testing
- MCP import/export

### Phase 7: Diagnostics & Updates
- Full diagnostic scan
- Individual diagnostic checks
- Auto-fix for common issues
- Diagnostic report (sanitized)
- Claude Code update check
- CCM self-update (portable + installer) — *暂未实现，见第 8 节*
- Update manifest generation — *暂未实现*

### Phase 8: Polish & Release
- Accessibility audit
- Windows scaling/DPI testing
- ARM64 build verification
- String freeze + translation support
- Performance profiling
- Security review
- Package signing
- GitHub Release workflow

---

## 11. Key Design Decisions

### Decision 1: Provider Adapters Over Conditionals
Each API provider has a standalone Rust struct implementing `ProviderAdapter`. The UI only sees the trait — no provider-specific conditionals in components.

### Decision 2: Push-Based Progress Over Polling
Long-running operations (install, MCP test, update download) emit Tauri events. The frontend subscribes and updates UI reactively. No `setInterval` polling.

### Decision 3: Literal Token in settings.json Over Credential References
Claude Code reads `env.ANTHROPIC_AUTH_TOKEN` from its own `settings.json` as a
literal value and has no concept of a credential reference. CCM therefore keeps
its own copy in the Windows Credential Manager **and** writes the resolved token
into `settings.json`, reporting that fact (and the backup) back to the UI.
Writing a `credentialId` reference there was tried and rejected: Claude Code sent
the placeholder as the bearer token and every request failed with 401.

### Decision 4: NSIS Over MSI for ARM64
Due to WiX/MSI ARM64 limitations in Tauri, use NSIS for ARM64 builds. x64 builds can offer both MSI and NSIS.

### Decision 5: Separate Update Channels
Claude Code updates and CCM updates are entirely separate systems with different check intervals, UIs, and mechanisms.

### Decision 6: Liquid Glass as Accent, Not Default
Glass effects applied to navigation, status cards, modals, and primary buttons. Content areas (tables, editors, logs) use clean, readable surfaces. Performance fallback when effects degrade.

---

## 12. Open Questions & Risks

| Issue | Status | Action |
|-------|--------|--------|
| Claude Code native installer script URL changes | Monitor | Use configurable metadata |
| DeepSeek V4 model lineup after legacy deprecation | Watch | Model detection should handle |
| Tauri bundler ARM64 MSI stability | Verify | Test in Phase 8 |
| `@creativoma/liquid-glass` compatibility with Tauri WebView2 | Verify | Prototype in Phase 3 |
| Self-update helper binary signature | Design | Need code signing certificate |
| Windows ARM64 CI runner availability | Check | May need self-hosted runner |
