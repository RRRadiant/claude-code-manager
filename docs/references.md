# References & Research Notes

> Last updated: 2026-07-20
> Purpose: Record official documentation sources and key findings for Claude Code Manager development.
> Do not hardcode version numbers, download URLs, or model names found here — use the metadata/Provider system instead.

---

## 1. Claude Code Official Installation

| Item | Detail |
|------|--------|
| Source | [code.claude.com/docs/en/getting-started](https://code.claude.com/docs/en/getting-started) |
| Date accessed | 2026-07-20 |
| Native Windows installer | PowerShell: `irm https://claude.ai/install.ps1 \| iex` |
| | CMD: `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` |
| | WinGet: `winget install Anthropic.ClaudeCode` |
| Binary path | `%USERPROFILE%\.local\bin\claude.exe` |
| PATH required | `%USERPROFILE%\.local\bin` |
| Admin rights | Not required |
| System req | Windows 10 1809+ / Server 2019+, 4GB RAM, x64 or ARM64 |
| npm installation | Deprecated — `npm install -g @anthropic-ai/claude-code` no longer recommended |
| Verify | `claude --version` |

**Key risks:**
- `HOME` env var override bug — installer may install to `$HOME\.local\bin` but report `%USERPROFILE%\.local\bin`
- Network access required for `claude.ai` — may fail behind proxies or in restricted networks

---

## 2. Claude Code Configuration Files

| Scope | Windows Path | Git? | Purpose |
|-------|--------------|------|---------|
| User (global) | `%USERPROFILE%\.claude\settings.json` | No | Personal defaults for all projects |
| Project (shared) | `<project>\.claude\settings.json` | Yes | Team-shared settings |
| Local (untracked) | `<project>\.claude\settings.local.json` | No | Personal project overrides |
| Enterprise (managed) | `C:\ProgramData\ClaudeCode\managed-settings.json` | IT-deployed | Organization-wide policies |
| CLI arguments | — | N/A | Session-only overrides |
| MCP (project) | `<project>\.mcp.json` | Yes | Project-wide MCP servers |
| CLAUDE.md (user) | `%USERPROFILE%\.claude\CLAUDE.md` | No | Personal behavior instructions |
| CLAUDE.md (project) | `<project>\CLAUDE.md` or `<project>\.claude\CLAUDE.md` | Yes | Project behavior instructions |

**Sources:**
- [code.claude.com/docs/en/model-config](https://code.claude.com/docs/en/model-config)
- [morphllm.com/claude-code-settings-json](https://www.morphllm.com/claude-code-settings-json)

**Priority order (highest to lowest):**
1. Enterprise managed
2. CLI arguments
3. Local project (`.claude/settings.local.json`)
4. Shared project (`.claude/settings.json`)
5. User global (`~/.claude/settings.json`)

**Key notes:**
- Permission rules (`allow`/`deny`) are **merged** across scopes, not overridden
- `deny` always beats `allow`
- Model changes require session restart
- Permissions/hooks hot-reload

---

## 3. MCP Configuration Format

**Source:** [code.claude.com/docs/en/mcp-quickstart](https://code.claude.com/docs/en/mcp-quickstart)

### Stdio (local process)
```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      "env": { "KEY": "value" },
      "alwaysLoad": false
    }
  }
}
```

### HTTP (remote)
```json
{
  "mcpServers": {
    "server-name": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${TOKEN}" },
      "timeoutMs": 30000
    }
  }
}
```

### Scopes
| Scope | File | Managed |
|-------|------|---------|
| Local (project-specific, personal) | `mcpServers` in `.claude/settings.json` | No |
| Project | `.mcp.json` | Yes (git) |
| User (global) | `mcpServers` in `~/.claude/settings.json` or `~/.claude.json` | No |
| Enterprise | `managed-mcp.json` | IT-deployed |

---

## 4. Anthropic API

**Source:** [docs.anthropic.com/en/api](https://docs.anthropic.com/en/api)

- **Base URL:** `https://api.anthropic.com/v1`
- **API version header:** `anthropic-version: 2023-06-01`
- **Auth:** `x-api-key` header

### Key Endpoints
| Endpoint | Purpose |
|----------|---------|
| `POST /v1/messages` | Send messages |
| `GET /v1/models` | List available models |
| `GET /v1/models/{id}` | Get model details |

### Models API Response
Returns: `id`, `display_name`, `type`, `created_at`, `max_input_tokens`, `max_tokens`, `capabilities`

Capabilities include: `batch`, `citations`, `code_execution`, `context_management`, `effort`, `image_input`, `pdf_input`, `structured_outputs`, `thinking`

---

## 5. DeepSeek API (Anthropic-Compatible)

**Source:** [api-docs.deepseek.com/guides/anthropic_api](https://api-docs.deepseek.com/guides/anthropic_api/)
**Date accessed:** 2026-07-20

### Configuration
| Parameter | Value |
|-----------|-------|
| Base URL | `https://api.deepseek.com/anthropic` |
| Auth | `x-api-key` header with DeepSeek API key |
| Supported env vars | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL` |

### Current Models (as of 2026-07-20)
| Model Name | Type | Status |
|------------|------|--------|
| `deepseek-v4-pro` | High capability | Active |
| `deepseek-v4-flash` | Fast/standard | Active |
| `deepseek-chat` | Legacy (maps to V4 Flash) | Deprecated — removed after 2026-07-24 |
| `deepseek-reasoner` | Legacy thinking mode | Deprecated — removed after 2026-07-24 |

### Limitations vs Anthropic API
- `image` content blocks: **not supported**
- `document` content blocks: **not supported**
- `cache_control`: **ignored**
- `anthropic-beta` headers: **ignored**
- Parallel tool use: **not supported**
- thinking `budget_tokens`: **ignored**

---

## 6. Tauri 2 Windows Packaging

**Sources:**
- [v2.tauri.app/distribute/windows-installer](https://v2.tauri.app/distribute/windows-installer)
- [v2.tauri.app/zh-cn/distribute/windows-installer](https://v2.tauri.app/zh-cn/distribute/windows-installer)

### Build Targets
| Architecture | Rust Target | Bundle Support |
|-------------|-------------|----------------|
| x64 | `x86_64-pc-windows-msvc` | MSI + NSIS |
| ARM64 | `aarch64-pc-windows-msvc` | NSIS (MSI support limited) |

### ARM64 Build Requirements
1. Visual Studio ARM64 build tools (`MSVC v143 - VS 2022 C++ ARM64 build tools`)
2. `rustup target add aarch64-pc-windows-msvc`
3. Build: `tauri build --target aarch64-pc-windows-msvc --bundles nsis`

### Updater Plugin (`@tauri-apps/plugin-updater`)
- Generate key pair: `npx tauri signer generate -w ~/.tauri/myapp.key`
- Config: `createUpdaterArtifacts: true` in `tauri.conf.json`
- Update manifest JSON per platform:
  ```json
  {
    "version": "1.0.1",
    "notes": "...",
    "pub_date": "2026-02-24T10:00:00Z",
    "platforms": {
      "windows-x86_64": { "signature": "...", "url": "..." },
      "windows-aarch64": { "signature": "...", "url": "..." }
    }
  }
  ```
- Signing: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` env vars
- Signature verification is distinct from OS code signing

---

## 7. WebView2 Runtime

**Sources:** Tauri docs, Microsoft WebView2 docs

| OS | WebView2 Status |
|----|----------------|
| Windows 11 | Pre-installed by default |
| Windows 10 (1803+) | Pre-installed since January 2023 update |
| Windows 10 (older) | May require separate install |
| Windows Server 2019+ | Not pre-installed |

**Strategy for CCM:**
1. Detect WebView2 via registry or `Get-AvailableWebView2` approach
2. If missing, provide guided download to [Microsoft WebView2 Bootstrapper](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
3. Consider Evergreen Fixed Version for offline scenarios

---

## 8. Liquid Glass React Libraries

**Sources:** npm registry, GitHub

| Package | Version | Notes |
|---------|---------|-------|
| `@developer-hub/liquid-glass` | 1.2.3 | Apple WWDC-inspired, `GlassCard` component, SVG filters |
| `@creativoma/liquid-glass` | 1.2.0 | TailwindCSS compatible, polymorphic, SVG + CSS |
| `quidlass` | 1.2.2 | Zero deps (React 18+), 30+ props, canvas + SVG |
| `@liquid-ui/react` | latest | Full component suite (Card/Button/Input/Modal), physics-based |
| `react-glass-rim` | 0.1.0 | Pure CSS rim light only, ~1.5 kB, edge highlight |

**Recommendation:** `@creativoma/liquid-glass` for component-level glass effects + `react-glass-rim` for lightweight edge highlights, or `quidlass` for zero-dependency approach.

---

## 9. Windows Credential Manager

- Win32 API: `CredWriteW` / `CredReadW` / `CredDeleteW`
- Target type: `CRED_TYPE_GENERIC`
- Rust crates: `keyring` (cross-platform), `wincred` (Windows-specific)
- Recommendation: Use `keyring` crate for cross-platform compat with Windows Credential Manager backend

---

## 10. Key Technical Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Claude Code installer URL or behavior changes | Medium | Fetch installer info from metadata; test in CI regularly |
| DeepSeek model deprecation after 2026-07-24 | High | Use model detection API; don't hardcode legacy models |
| Tauri ARM64 MSI limitation | Medium | Use NSIS for ARM64 bundles |
| WebView2 missing on older Win10 | Low | Detect and guide installation |
| `HOME` env var interference with Claude Code install | Medium | Check both `%USERPROFILE%` and `$HOME` paths |
| CCM self-update on portable (no admin) | Medium | Separate update helper process |
