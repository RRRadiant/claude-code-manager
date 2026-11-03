import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ping: (): Promise<{ pong: boolean; timestamp: number }> =>
    ipcRenderer.invoke('app:ping'),
  getAppState: () => ipcRenderer.invoke('app:get-state'),
  setAppState: (partial: Record<string, unknown>) => ipcRenderer.invoke('app:set-state', partial),
  appRelaunch: () => ipcRenderer.invoke('app:relaunch'),

  // Config
  configRead: () => ipcRenderer.invoke('config:read'),
  configWrite: (data: unknown) => ipcRenderer.invoke('config:write', data),
  configWriteTierModels: (args: { tiers: Record<string, string>; defaultTier?: string }) =>
    ipcRenderer.invoke('config:write-tier-models', args),
  configReadLocal: () => ipcRenderer.invoke('config:read-local'),
  configWriteLocal: (data: unknown) => ipcRenderer.invoke('config:write-local', data),

  // Config file editor
  configListFiles: () => ipcRenderer.invoke('config:list-files'),
  configReadFile: (opts: { filepath: string }) => ipcRenderer.invoke('config:read-file', opts),
  configWriteFile: (opts: { filepath: string; content: string }) =>
    ipcRenderer.invoke('config:write-file', opts),
  configCliPath: () => ipcRenderer.invoke('config:cli-path'),
  configScan: () => ipcRenderer.invoke('config:scan'),
  configAdoptShellEnv: (args: { names: string[] }) =>
    ipcRenderer.invoke('config:adopt-shell-env', args),

  // safeStorage
  safeStorageEncrypt: (text: string) => ipcRenderer.invoke('safe-storage:encrypt', text),
  safeStorageDecrypt: (encrypted: string) => ipcRenderer.invoke('safe-storage:decrypt', encrypted),
  safeStorageIsAvailable: () => ipcRenderer.invoke('safe-storage:is-available'),

  // CLI
  cliStatus: () => ipcRenderer.invoke('cli:status'),
  cliInstall: (opts?: { method?: 'curl' | 'npm' | 'github-release' }) =>
    ipcRenderer.invoke('cli:install', opts),
  depsCheck: () => ipcRenderer.invoke('deps:check'),
  depsInstallMissing: () => ipcRenderer.invoke('deps:install-missing'),

  // Commands (Skills)
  commandsList: () => ipcRenderer.invoke('commands:list'),
  commandsRead: (opts: { filename: string }) => ipcRenderer.invoke('commands:read', opts),
  commandsWrite: (opts: { filename: string; content: string; format: string }) =>
    ipcRenderer.invoke('commands:write', opts),
  commandsDelete: (opts: { filename: string }) => ipcRenderer.invoke('commands:delete', opts),

  // Agents
  agentsList: () => ipcRenderer.invoke('agents:list'),
  agentsRead: (opts: { filename: string }) => ipcRenderer.invoke('agents:read', opts),
  agentsWrite: (opts: { filename: string; frontmatter: Record<string, unknown>; body: string }) =>
    ipcRenderer.invoke('agents:write', opts),
  agentsDelete: (opts: { filename: string }) => ipcRenderer.invoke('agents:delete', opts),

  // Plugins
  pluginsList: () => ipcRenderer.invoke('plugins:list'),
  pluginsToggle: (opts: { pluginId: string; enabled: boolean }) =>
    ipcRenderer.invoke('plugins:toggle', opts),
  pluginsUninstall: (opts: { pluginId: string }) =>
    ipcRenderer.invoke('plugins:uninstall', opts),

  // Marketplace
  marketplaceList: () => ipcRenderer.invoke('marketplace:list'),
  marketplaceAddSource: (opts: { name: string; repo: string }) =>
    ipcRenderer.invoke('marketplace:add-source', opts),
  marketplaceRemoveSource: (opts: { name: string }) =>
    ipcRenderer.invoke('marketplace:remove-source', opts),

  // Hooks
  hooksList: () => ipcRenderer.invoke('hooks:list'),
  hooksAdd: (opts: { event: string; matcher?: string; command: string; timeout?: number }) =>
    ipcRenderer.invoke('hooks:add', opts),
  hooksRemove: (opts: { event: string; index: number }) =>
    ipcRenderer.invoke('hooks:remove', opts),
  hooksUpdate: (opts: {
    event: string; index: number; matcher?: string; command: string; timeout?: number
  }) => ipcRenderer.invoke('hooks:update', opts),

  // API detector
  apiDetectModels: (o: { provider: string; apiKey: string; baseUrl?: string }) =>
    ipcRenderer.invoke('api:detect-models', o),

  // MCP
  mcpList: () => ipcRenderer.invoke('mcp:list'),
  mcpAdd: (opts: {
    name: string; type: 'stdio' | 'sse'; command?: string; args?: string[]; url?: string
  }) => ipcRenderer.invoke('mcp:add', opts),
  mcpRemove: (opts: { name: string }) => ipcRenderer.invoke('mcp:remove', opts),
  mcpUpdate: (opts: {
    name: string; type: 'stdio' | 'sse'; command?: string; args?: string[]; url?: string
  }) => ipcRenderer.invoke('mcp:update', opts),

  // File watcher
  onFileChanged: (cb: (data: { paths: string[] }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { paths: string[] }) => cb(data)
    ipcRenderer.on('file:changed', handler)
    return () => { ipcRenderer.removeListener('file:changed', handler) }
  },

  // ── Environment install pipeline ────────────────────────────────────────
  // Modelled on the Windows/Tauri build's installer commands: start an
  // operation, get a task id back immediately, then receive progress through
  // events instead of polling.
  installerDetect: () => ipcRenderer.invoke('installer:detect'),
  installerPlan: () => ipcRenderer.invoke('installer:plan'),
  installerInstallFull: () => ipcRenderer.invoke('installer:install-full'),
  installerInstallComponent: (opts: { component: 'node' | 'git' | 'claude-code' }) =>
    ipcRenderer.invoke('installer:install-component', opts),
  installerCancel: (opts: { taskId: string }) => ipcRenderer.invoke('installer:cancel', opts),
  installerTasks: () => ipcRenderer.invoke('installer:tasks'),
  installerPathStatus: () => ipcRenderer.invoke('installer:path-status'),
  installerApplyShellPath: () => ipcRenderer.invoke('installer:apply-shell-path'),
  installerRemoveShellPath: () => ipcRenderer.invoke('installer:remove-shell-path'),
  installerCacheInfo: () => ipcRenderer.invoke('installer:cache-info'),
  installerClearCache: () => ipcRenderer.invoke('installer:clear-cache'),
  installerOpenTerminal: () => ipcRenderer.invoke('installer:open-terminal'),
  installerDesktopShortcutStatus: () => ipcRenderer.invoke('installer:desktop-shortcut-status'),
  installerCreateDesktopShortcut: () => ipcRenderer.invoke('installer:create-desktop-shortcut'),

  /** Throttled byte-level download progress, owner-tagged per component. */
  onInstallProgress: (cb: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('installer:progress', handler)
    return () => { ipcRenderer.removeListener('installer:progress', handler) }
  },

  /** Coarse task state changes: status, step line, percent, error. */
  onInstallTask: (cb: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('installer:task', handler)
    return () => { ipcRenderer.removeListener('installer:task', handler) }
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)
export type ElectronAPI = typeof api
