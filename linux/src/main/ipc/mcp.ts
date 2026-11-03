import { ipcMain } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { SETTINGS_PATH } from '../utils/paths'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpServerEntry {
  name: string
  type: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

interface McpServerConfig {
  type: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

interface McpSettingsShape {
  mcpServers?: Record<string, McpServerConfig>
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSettings(): McpSettingsShape {
  if (!existsSync(SETTINGS_PATH)) {
    return {}
  }
  try {
    const raw = readFileSync(SETTINGS_PATH, 'utf-8')
    return JSON.parse(raw) as McpSettingsShape
  } catch {
    return {}
  }
}

function writeSettings(settings: McpSettingsShape): void {
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function registerMcpIpcHandlers(): void {
  // -------------------------------------------------------------------------
  // mcp:list
  // -------------------------------------------------------------------------
  ipcMain.handle('mcp:list', async () => {
    try {
      const settings = readSettings()
      const servers = settings.mcpServers ?? {}

      const data: McpServerEntry[] = Object.entries(servers).map(([name, config]) => ({
        name,
        type: config.type,
        command: config.command,
        args: config.args,
        url: config.url,
        // `env` must round-trip. The editor used to save an entry built from only
        // the fields this handler returned, so every save of an existing server
        // silently dropped its environment variables — the same whole-object
        // replacement bug that clobbered `env` in the API panel.
        env: config.env,
      }))

      return { success: true, data }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // -------------------------------------------------------------------------
  // mcp:add
  // -------------------------------------------------------------------------
  ipcMain.handle(
    'mcp:add',
    async (
      _event,
      args: {
        name: string
        type: 'stdio' | 'sse'
        command?: string
        args?: string[]
        url?: string
        env?: Record<string, string>
      },
    ) => {
      try {
        const settings = readSettings()
        const servers = settings.mcpServers ?? {}

        if (servers[args.name]) {
          return { success: false, error: `MCP server "${args.name}" already exists` }
        }

        const config: McpServerConfig = { type: args.type }
        if (args.command !== undefined) config.command = args.command
        if (args.args !== undefined) config.args = args.args
        if (args.url !== undefined) config.url = args.url
        if (args.env !== undefined) config.env = args.env

        servers[args.name] = config
        settings.mcpServers = servers

        writeSettings(settings)

        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  // -------------------------------------------------------------------------
  // mcp:remove
  // -------------------------------------------------------------------------
  ipcMain.handle('mcp:remove', async (_event, args: { name: string }) => {
    try {
      const settings = readSettings()
      const servers = settings.mcpServers ?? {}

      if (!servers[args.name]) {
        return { success: false, error: `MCP server "${args.name}" not found` }
      }

      delete servers[args.name]
      settings.mcpServers = servers

      writeSettings(settings)

      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // -------------------------------------------------------------------------
  // mcp:update
  // -------------------------------------------------------------------------
  ipcMain.handle(
    'mcp:update',
    async (
      _event,
      args: {
        name: string
        type: 'stdio' | 'sse'
        command?: string
        args?: string[]
        url?: string
        env?: Record<string, string>
      },
    ) => {
      try {
        const settings = readSettings()
        const servers = settings.mcpServers ?? {}

        if (!servers[args.name]) {
          return { success: false, error: `MCP server "${args.name}" not found` }
        }

        // Merge onto the stored entry rather than replacing it.
        //
        // An MCP server entry can carry fields this editor does not surface —
        // `env` being the important one, plus anything a future Claude Code
        // version adds. Replacing the whole object deleted them on every save.
        // Only keys the caller actually supplied are touched; switching transport
        // clears the fields that belong to the other transport, so a stdio→sse
        // change cannot leave a stale `command` behind.
        const existing = servers[args.name]
        const next: McpServerConfig = { ...existing, type: args.type }

        if (args.type === 'stdio') {
          if (args.command !== undefined) next.command = args.command
          if (args.args !== undefined) next.args = args.args
          delete next.url
        } else {
          if (args.url !== undefined) next.url = args.url
          delete next.command
          delete next.args
        }

        if (args.env !== undefined) next.env = args.env

        servers[args.name] = next
        settings.mcpServers = servers

        writeSettings(settings)

        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )
}
