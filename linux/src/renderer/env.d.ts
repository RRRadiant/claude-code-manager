/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    ping: () => Promise<{ pong: boolean; timestamp: number }>

    // App state (first-run guide completion, persisted to ~/.claude-code-manager.json)
    getAppState: () => Promise<Record<string, unknown>>
    setAppState: (partial: Record<string, unknown>) => Promise<Record<string, unknown>>
    /** Restart the app; the reply arrives before the process exits. */
    appRelaunch: () => Promise<{ success: boolean }>

    // Config
    configRead: () => Promise<{ success: boolean; data?: unknown; error?: string }>
    configWrite: (data: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>
    /**
     * Write the per-tier model mapping. Separate from `configWrite` because an
     * emptied tier has to delete its key rather than store an empty string.
     */
    configWriteTierModels: (args: {
      tiers: Record<string, string>
      defaultTier?: string
    }) => Promise<{ success: boolean; data?: unknown; error?: string }>
    configReadLocal: () => Promise<{ success: boolean; data?: unknown; error?: string }>
    configWriteLocal: (data: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>

    // Config file editor
    configListFiles: () => Promise<{ success: boolean; data?: ConfigFileEntry[]; error?: string }>
    configReadFile: (opts: { filepath: string }) => Promise<{ success: boolean; data?: string; error?: string }>
    configWriteFile: (opts: { filepath: string; content: string }) => Promise<{ success: boolean; error?: string }>
    configCliPath: () => Promise<{ success: boolean; data?: { paths: CliPathEntry[] }; error?: string }>
    /** Read-only survey of what Claude Code configuration already exists. */
    configScan: () => Promise<{ success: boolean; data?: ConfigScan; error?: string }>
    /** Copy shell-rc ANTHROPIC_* exports into settings.json. */
    configAdoptShellEnv: (args: {
      names: string[]
    }) => Promise<{ success: boolean; data?: { adopted: string[]; skipped: string[] }; error?: string }>

    // safeStorage
    safeStorageEncrypt: (text: string) => Promise<{ success: boolean; data?: string; error?: string }>
    safeStorageDecrypt: (encrypted: string) => Promise<{ success: boolean; data?: string; error?: string }>
    safeStorageIsAvailable: () => Promise<boolean>

    // CLI
    cliStatus: () => Promise<{ installed: boolean; version: string | null; path: string | null; installMethod: string | null }>
    cliInstall: (opts?: { method?: 'curl' | 'npm' | 'github-release' }) => Promise<{ success: boolean; error?: string }>
    depsCheck: () => Promise<{ allOk: boolean; checks: Array<{ name: string; description: string; installed: boolean; installCmd: string | null }> }>
    /**
     * Hands the install to a terminal window, because sudo needs one to ask for
     * a password. `mode` is 'manual' when no terminal emulator was available and
     * the caller should show `command` for the user to run themselves.
     */
    depsInstallMissing: () => Promise<{
      success: boolean
      mode: 'terminal' | 'nothing-to-do' | 'manual'
      command: string | null
      terminal: string | null
      error?: string
    }>

    // Commands (Skills)
    commandsList: () => Promise<{ success: boolean; data?: SkillEntry[]; error?: string }>
    commandsRead: (opts: { filename: string }) => Promise<{ success: boolean; data?: SkillContent; error?: string }>
    commandsWrite: (opts: { filename: string; content: string; format: string }) => Promise<{ success: boolean; error?: string }>
    commandsDelete: (opts: { filename: string }) => Promise<{ success: boolean; error?: string }>

    // Agents
    agentsList: () => Promise<{ success: boolean; data?: AgentEntry[]; error?: string }>
    agentsRead: (opts: { filename: string }) => Promise<{ success: boolean; data?: AgentContent; error?: string }>
    agentsWrite: (opts: { filename: string; frontmatter: Record<string, unknown>; body: string }) => Promise<{ success: boolean; data?: { filename: string }; error?: string }>
    agentsDelete: (opts: { filename: string }) => Promise<{ success: boolean; error?: string }>

    // Plugins
    pluginsList: () => Promise<{ success: boolean; data?: PluginInfo[]; error?: string }>
    pluginsToggle: (opts: { pluginId: string; enabled: boolean }) => Promise<{ success: boolean; error?: string }>
    pluginsUninstall: (opts: { pluginId: string }) => Promise<{ success: boolean; error?: string }>

    // Marketplace
    marketplaceList: () => Promise<{ success: boolean; data?: MarketplaceData; error?: string }>
    marketplaceAddSource: (opts: { name: string; repo: string }) => Promise<{ success: boolean; error?: string }>
    marketplaceRemoveSource: (opts: { name: string }) => Promise<{ success: boolean; error?: string }>

    // API detector
    apiDetectModels: (o: { provider: string; apiKey: string; baseUrl?: string }) =>
      Promise<{ success: boolean; data?: string[]; error?: string }>

    // Hooks
    hooksList: () => Promise<{ success: boolean; data?: { hooks: Record<string, unknown> }; error?: string }>
    hooksAdd: (opts: { event: string; matcher?: string; command: string; timeout?: number }) => Promise<{ success: boolean; error?: string }>
    hooksRemove: (opts: { event: string; index: number }) => Promise<{ success: boolean; error?: string }>
    hooksUpdate: (opts: { event: string; index: number; matcher?: string; command: string; timeout?: number }) => Promise<{ success: boolean; error?: string }>

    // MCP
    mcpList: () => Promise<{ success: boolean; data?: McpServerEntry[]; error?: string }>
    mcpAdd: (opts: { name: string; type: 'stdio' | 'sse'; command?: string; args?: string[]; url?: string }) => Promise<{ success: boolean; error?: string }>
    mcpRemove: (opts: { name: string }) => Promise<{ success: boolean; error?: string }>
    mcpUpdate: (opts: { name: string; type: 'stdio' | 'sse'; command?: string; args?: string[]; url?: string }) => Promise<{ success: boolean; error?: string }>

    // File watcher
    onFileChanged: (cb: (data: { paths: string[] }) => void) => () => void

    // ── Environment install pipeline ──────────────────────────────────────
    installerDetect: () => Promise<IpcResult<InstallerDetect>>
    installerPlan: () => Promise<IpcResult<InstallStepResult[]>>
    installerInstallFull: () => Promise<IpcResult<{ taskId: string }>>
    installerInstallComponent: (opts: {
      component: InstallComponent
    }) => Promise<IpcResult<{ taskId: string }>>
    installerCancel: (opts: { taskId: string }) => Promise<IpcResult<{ accepted: boolean }>>
    installerTasks: () => Promise<IpcResult<TaskState[]>>
    installerPathStatus: () => Promise<
      IpcResult<{ merged: string; managed: string[]; added: string[]; changed: boolean }>
    >
    installerApplyShellPath: () => Promise<IpcResult<RcUpdateResult>>
    installerRemoveShellPath: () => Promise<IpcResult<{ cleaned: string[] }>>
    installerCacheInfo: () => Promise<
      IpcResult<{ dir: string; entries: Array<{ name: string; size: number; verified: boolean }> }>
    >
    installerClearCache: () => Promise<IpcResult<{ removed: number }>>
    installerOpenTerminal: () => Promise<IpcResult<{ terminal: string }>>
    installerDesktopShortcutStatus: () => Promise<
      IpcResult<{ available: boolean; path: string | null; exists: boolean }>
    >
    installerCreateDesktopShortcut: () => Promise<
      IpcResult<{ path: string; trusted: boolean; needsTrust: boolean }>
    >
    onInstallProgress: (cb: (data: InstallProgress) => void) => () => void
    onInstallTask: (cb: (data: TaskState) => void) => () => void
  }
}

// ---- Install pipeline types (mirrors src/main/installer/types.ts) ----

type InstallComponent = 'node' | 'git' | 'claude-code'

type DownloadStage =
  | 'benchmarking'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'installing'

interface InstallProgress {
  component: InstallComponent
  componentLabel: string
  primary: boolean
  stage: DownloadStage
  percent: number
  speedBytesPerSec: number
  downloadedBytes: number
  totalBytes: number
  source: string
  sourceId: string
}

interface InstallStepResult {
  component: InstallComponent
  success: boolean
  version: string | null
  message: string
}

type TaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

interface TaskState {
  id: string
  type: string
  status: TaskStatus
  title: string
  step: string | null
  progress: number
  cancellable: boolean
  error: string | null
  startedAt: number | null
  finishedAt: number | null
}

/** Structured error returned by the installer IPC surface. */
interface InstallErrorShape {
  code: string
  title: string
  message: string
  details?: string
  suggestions?: string[]
  retryable?: boolean
}

/** Every installer IPC call answers in this shape. */
interface IpcResult<T> {
  success: boolean
  data?: T
  error?: InstallErrorShape
}

interface ToolInfo {
  installed: boolean
  version: string | null
  path: string | null
}

interface ClaudeDetection extends ToolInfo {
  packagePresentButBroken: boolean
  installSource: 'managed-npm' | 'system' | null
}

interface SystemInfo {
  distro: string
  distroVersion: string
  kernel: string
  arch: string
  node: ToolInfo
  npm: ToolInfo
  git: ToolInfo
  claude: ClaudeDetection
  hasApt: boolean
  hasTarXz: boolean
}

interface InstallerDetect {
  system: SystemInfo
  path: { managed: string[]; added: string[]; changed: boolean }
  layout: {
    appDataDir: string
    cacheDir: string
    npmPrefixDir: string
    npmBinDir: string
    managedBinDirs: string[]
  }
}

interface RcUpdateResult {
  updated: string[]
  alreadyPresent: string[]
  skipped: string[]
  warning: string | null
}

// ---- MCP types ----
interface McpServerEntry {
  name: string
  type: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
}

// ---- Config file types ----
interface ConfigFileEntry {
  name: string
  path: string
  size: number
}

interface CliPathEntry {
  location: string
  exists: boolean
}

// ---- Existing-config scan (mirrors src/main/services/config-scan.ts) ----

interface ScannedFile {
  path: string
  role: string
  exists: boolean
  summary: string | null
  error: string | null
}

interface ConfigScan {
  files: ScannedFile[]
  settings: {
    apiKeyPresent: boolean
    apiKeyMasked: string | null
    baseUrl: string | null
    provider: string | null
    defaultModel: string | null
    tierModels: Record<string, string>
    mcpServers: number
    hooks: number
    selectedModels: string[]
  }
  shellEnv: Array<{ name: string; file: string; masked: string; dynamic: boolean }>
  cli: ClaudeDetection
  counts: { skills: number; agents: number; plugins: number }
  desktop: {
    available: boolean
    path: string | null
    exists: boolean
    locations: Array<{ path: string; exists: boolean }>
  }
}

// ---- Plugin types ----
interface PluginInfo {
  id: string
  name: string
  marketplace: string
  version: string
  scope: string
  enabled: boolean
  installPath: string
  installedAt: string
  /** Enriched fields from marketplace catalog (optional) */
  description?: string
  author?: { name: string; email?: string; url?: string }
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
  tags?: string[]
}

interface MarketplaceData {
  marketplaces: Array<{ name: string; source: { source: string; repo: string } }>
  plugins: Array<{
    name: string
    marketplace: string
    description: string
    version: string
    category?: string
    tags?: string[]
    author?: { name: string; email?: string; url?: string }
    homepage?: string
    repository?: string
    license?: string
  }>
}

// ---- Skill types ----
interface SkillEntry {
  filename: string; name: string; description: string; format: 'json' | 'markdown'
  content: string; frontmatter?: Record<string, string>
}
interface SkillContent {
  name: string; description: string; content: string; format: 'json' | 'markdown'
  frontmatter?: Record<string, string>
}

// ---- Agent types ----
interface AgentEntry {
  filename: string; name: string; description: string; tools?: string[]; model?: string; body: string
}
interface AgentContent {
  frontmatter: Record<string, unknown>; body: string; raw: string
}
