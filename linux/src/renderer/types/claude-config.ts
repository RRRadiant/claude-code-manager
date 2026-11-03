// ============================================================
// TypeScript type definitions for Claude Code configuration
// Based on ~/.claude/settings.json schema analysis (June 2026)
// ============================================================

// --- Top-level settings.json structure ---

export interface ClaudeSettings {
  /** Environment variables injected into Claude Code runtime */
  env?: Record<string, string>

  /** Model tier alias: 'haiku' | 'sonnet' | 'opus' or custom string */
  model?: string

  /** Enabled plugins map: "plugin-name@marketplace": true */
  enabledPlugins?: Record<string, boolean>

  /** Custom marketplace registries */
  extraKnownMarketplaces?: Record<string, MarketplaceSource>

  /** UI theme preference */
  theme?: 'light' | 'dark'

  /** Hook definitions grouped by lifecycle event */
  hooks?: Partial<Record<HookEvent, HookGroup[]>>

  /** Permission rules (typically in settings.local.json) */
  permissions?: PermissionRules

  /** Custom status line */
  statusLine?: StatusLineConfig

  /** Suppress workflow usage warnings */
  skipWorkflowUsageWarning?: boolean
}

// --- Marketplace ---

export interface MarketplaceSource {
  source: {
    source: 'github'
    repo: string
  }
}

/** 13 lifecycle hook events */
export type HookEvent =
  | 'Setup'
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PreCompact'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PermissionRequest'
  | 'Notification'

export interface HookGroup {
  matcher?: string
  hooks: HookDefinition[]
}

export interface HookDefinition {
  type: 'command'
  command: string
  timeout?: number
}

// --- Permissions ---

export interface PermissionRules {
  allow?: string[]
  deny?: string[]
}

// --- Status Line ---

export type StatusLineConfig =
  | { type: 'static'; text: string }
  | { type: 'command'; command: string }

// --- Agents (YAML frontmatter) ---

export interface AgentDefinition {
  name: string
  description: string
  tools?: string[]
  model?: 'haiku' | 'sonnet' | 'opus'
  /** Raw markdown body after frontmatter */
  body: string
}

// --- Commands / Skills ---

/** JSON format skill */
export interface JsonSkill {
  name: string
  description: string
  prompt: string
}

/** Markdown format skill (YAML frontmatter) */
export interface MarkdownSkill {
  description: string
  'argument-hint'?: string
  body: string
}

export type Skill = JsonSkill | MarkdownSkill

// --- Plugins ---

export interface InstalledPlugins {
  version: number
  plugins: Record<string, InstalledPluginEntry[]>
}

export interface InstalledPluginEntry {
  scope: 'user' | 'project'
  installPath: string
  version: string
  installedAt: string
  lastUpdated: string
  gitCommitSha?: string
}

export interface KnownMarketplaces {
  [key: string]: {
    source: MarketplaceSource['source']
    installLocation?: string
    lastUpdated?: string
  }
}

export interface PluginMetadata {
  name: string
  version: string
  description: string
  author?: { name: string; email?: string; url?: string }
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
}

export interface MarketplaceManifest {
  name: string
  version?: string
  description?: string
  owner: { name: string; email?: string }
  plugins: MarketplacePluginEntry[]
}

export interface MarketplacePluginEntry {
  name: string
  source: string | MarketplaceSource['source']
  description?: string
  version?: string
  author?: { name: string; email?: string }
  category?: string
  tags?: string[]
  license?: string
  homepage?: string
  repository?: string
}

// --- MCP ---

export interface McpConfig {
  mcpServers: Record<string, McpServerDefinition>
}

export interface McpServerDefinition {
  type: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

// --- Session (for info only, not editable) ---

export interface SessionInfo {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  version: string
  kind: 'interactive' | 'bg'
  status: 'busy' | 'idle'
}
