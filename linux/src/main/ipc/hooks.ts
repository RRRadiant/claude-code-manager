import { ipcMain } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { SETTINGS_PATH } from '../utils/paths'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HookCommand {
  type: 'command'
  command: string
  timeout?: number
}

export interface HookGroup {
  matcher: string
  hooks: HookCommand[]
}

export interface HooksConfig {
  [event: string]: HookGroup[]
}

export interface SettingsFile {
  [key: string]: unknown
  hooks?: HooksConfig
}

// ---------------------------------------------------------------------------
// Valid hook events
// ---------------------------------------------------------------------------

const VALID_HOOK_EVENTS = new Set([
  'Setup',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PreCompact',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PermissionRequest',
  'Notification',
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSettings(): SettingsFile {
  if (!existsSync(SETTINGS_PATH)) return {}
  const raw = readFileSync(SETTINGS_PATH, 'utf-8')
  return JSON.parse(raw) as SettingsFile
}

function writeSettings(settings: SettingsFile): void {
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
}

function readHooks(): HooksConfig {
  const settings = readSettings()
  return (settings.hooks ?? {}) as HooksConfig
}

function writeHooks(hooks: HooksConfig): void {
  const settings = readSettings()
  settings.hooks = hooks
  writeSettings(settings)
}

function validateEvent(event: string): string | null {
  if (!event || typeof event !== 'string') return 'Event name is required'
  if (!VALID_HOOK_EVENTS.has(event)) {
    return `Invalid event "${event}". Valid events: ${[...VALID_HOOK_EVENTS].join(', ')}`
  }
  return null
}

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

export function registerHooksIpcHandlers(): void {
  // -----------------------------------------------------------------------
  // hooks:list
  // -----------------------------------------------------------------------
  ipcMain.handle('hooks:list', async () => {
    try {
      const hooks = readHooks()
      return { success: true, data: { hooks } }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // -----------------------------------------------------------------------
  // hooks:add
  // -----------------------------------------------------------------------
  ipcMain.handle(
    'hooks:add',
    async (
      _event,
      args: { event: string; matcher?: string; command: string; timeout?: number },
    ) => {
      try {
        const eventErr = validateEvent(args.event)
        if (eventErr) return { success: false, error: eventErr }

        if (!args.command || typeof args.command !== 'string') {
          return { success: false, error: 'command is required' }
        }

        const hooks = readHooks()
        const eventArray = hooks[args.event] ?? []

        const newEntry: HookGroup = {
          matcher: args.matcher || '*',
          hooks: [{ type: 'command', command: args.command, timeout: args.timeout ?? 30000 }],
        }

        eventArray.push(newEntry)
        hooks[args.event] = eventArray

        writeHooks(hooks)
        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  // -----------------------------------------------------------------------
  // hooks:remove
  // -----------------------------------------------------------------------
  ipcMain.handle(
    'hooks:remove',
    async (_event, args: { event: string; index: number }) => {
      try {
        const eventErr = validateEvent(args.event)
        if (eventErr) return { success: false, error: eventErr }

        if (typeof args.index !== 'number' || args.index < 0) {
          return { success: false, error: 'index must be a non-negative number' }
        }

        const hooks = readHooks()
        const eventArray = hooks[args.event]

        if (!eventArray || eventArray.length === 0) {
          return { success: false, error: `No hooks found for event "${args.event}"` }
        }

        if (args.index >= eventArray.length) {
          return {
            success: false,
            error: `Index ${args.index} out of bounds (${eventArray.length} entries)`,
          }
        }

        eventArray.splice(args.index, 1)

        if (eventArray.length === 0) {
          delete hooks[args.event]
        }

        writeHooks(hooks)
        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  // -----------------------------------------------------------------------
  // hooks:update
  // -----------------------------------------------------------------------
  ipcMain.handle(
    'hooks:update',
    async (
      _event,
      args: {
        event: string
        index: number
        matcher?: string
        command: string
        timeout?: number
      },
    ) => {
      try {
        const eventErr = validateEvent(args.event)
        if (eventErr) return { success: false, error: eventErr }

        if (typeof args.index !== 'number' || args.index < 0) {
          return { success: false, error: 'index must be a non-negative number' }
        }

        if (!args.command || typeof args.command !== 'string') {
          return { success: false, error: 'command is required' }
        }

        const hooks = readHooks()
        const eventArray = hooks[args.event]

        if (!eventArray || eventArray.length === 0) {
          return { success: false, error: `No hooks found for event "${args.event}"` }
        }

        if (args.index >= eventArray.length) {
          return {
            success: false,
            error: `Index ${args.index} out of bounds (${eventArray.length} entries)`,
          }
        }

        eventArray[args.index] = {
          matcher: args.matcher || eventArray[args.index].matcher || '*',
          hooks: [
            {
              type: 'command',
              command: args.command,
              timeout: args.timeout ?? eventArray[args.index].hooks[0]?.timeout ?? 30000,
            },
          ],
        }

        writeHooks(hooks)
        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )
}
