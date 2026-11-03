import { ipcMain } from 'electron'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

import { SETTINGS_PATH, SETTINGS_LOCAL_PATH, CLAUDE_DIR } from '../utils/paths'
import { adoptShellEnv, scanExistingConfig } from '../services/config-scan'
import type { ConfigScan } from '../services/config-scan'
import { mergeLocalSettings, mergeSettings, writeTierModels } from '../services/settings-write'
import { computeRefreshedPath, resolveOnPath } from '../installer/env'
import { npmBinDir } from '../installer/components'

/** The shape of a Claude Code settings.json document */
export interface ClaudeSettings {
  [key: string]: unknown
}

function readJson(path: string): ClaudeSettings {
  const raw = readFileSync(path, 'utf-8')
  return JSON.parse(raw) as ClaudeSettings
}

function readJsonOrEmpty(path: string): ClaudeSettings {
  if (!existsSync(path)) return {}
  return readJson(path)
}

/** Register all config-related IPC handlers */
export function registerConfigIpcHandlers(): void {
  ipcMain.handle('config:read', async (): Promise<{
    success: boolean
    data?: ClaudeSettings
    error?: string
  }> => {
    try {
      const data = readJsonOrEmpty(SETTINGS_PATH)
      return { success: true, data }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('config:read-local', async (): Promise<{
    success: boolean
    data?: ClaudeSettings
    error?: string
  }> => {
    try {
      const data = readJsonOrEmpty(SETTINGS_LOCAL_PATH)
      return { success: true, data }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle(
    'config:write',
    async (
      _event,
      partial: ClaudeSettings,
    ): Promise<{ success: boolean; data?: ClaudeSettings; error?: string }> => {
      try {
        return { success: true, data: mergeSettings(partial) }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  ipcMain.handle(
    'config:write-tier-models',
    async (
      _event,
      args: { tiers?: Record<string, string>; defaultTier?: string },
    ): Promise<{ success: boolean; data?: ClaudeSettings; error?: string }> => {
      try {
        return { success: true, data: writeTierModels(args ?? {}) }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  ipcMain.handle(
    'config:scan',
    async (): Promise<{ success: boolean; data?: ConfigScan; error?: string }> => {
      try {
        return { success: true, data: await scanExistingConfig() }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  ipcMain.handle(
    'config:adopt-shell-env',
    async (
      _event,
      args: { names?: string[] },
    ): Promise<{ success: boolean; data?: { adopted: string[]; skipped: string[] }; error?: string }> => {
      try {
        return { success: true, data: adoptShellEnv(args?.names ?? []) }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  ipcMain.handle(
    'config:write-local',
    async (
      _event,
      partial: ClaudeSettings,
    ): Promise<{ success: boolean; data?: ClaudeSettings; error?: string }> => {
      try {
        return { success: true, data: mergeLocalSettings(partial) }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  // --- Config file browsing: list files in ~/.claude/ ---
  ipcMain.handle(
    'config:list-files',
    async (): Promise<{
      success: boolean
      data?: Array<{ name: string; path: string; size: number }>
      error?: string
    }> => {
      try {
        const files: Array<{ name: string; path: string; size: number }> = []
        if (existsSync(CLAUDE_DIR)) {
          const entries = readdirSync(CLAUDE_DIR)
          for (const entry of entries) {
            // Skip directories for now; only list files at the top level
            const fullPath = join(CLAUDE_DIR, entry)
            try {
              const stat = statSync(fullPath)
              if (stat.isFile()) {
                files.push({ name: entry, path: fullPath, size: stat.size })
              }
            } catch {
              // skip unreadable entries
            }
          }
        }
        return { success: true, data: files }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  // --- Config file browsing: read a single file ---
  ipcMain.handle(
    'config:read-file',
    async (
      _event,
      { filepath }: { filepath: string },
    ): Promise<{ success: boolean; data?: string; error?: string }> => {
      try {
        // Safety: only allow files inside CLAUDE_DIR
        const resolved = filepath
        if (!resolved.startsWith(CLAUDE_DIR)) {
          return { success: false, error: 'Access denied: file must be inside ~/.claude/' }
        }
        if (!existsSync(resolved)) {
          return { success: false, error: 'File not found' }
        }
        const content = readFileSync(resolved, 'utf-8')
        return { success: true, data: content }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  // --- Config file browsing: write a single file ---
  ipcMain.handle(
    'config:write-file',
    async (
      _event,
      { filepath, content }: { filepath: string; content: string },
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        // Safety: only allow files inside CLAUDE_DIR
        const resolved = filepath
        if (!resolved.startsWith(CLAUDE_DIR)) {
          return { success: false, error: 'Access denied: file must be inside ~/.claude/' }
        }
        writeFileSync(resolved, content, 'utf-8')
        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  // --- CLI path discovery ---
  ipcMain.handle(
    'config:cli-path',
    async (): Promise<{
      success: boolean
      data?: { paths: Array<{ location: string; exists: boolean }> }
      error?: string
    }> => {
      try {
        // The app's own npm prefix first: that is where this app installs claude,
        // and it must be found whether or not the process PATH happens to contain
        // it. Then the user-level and system locations, then whatever the managed
        // PATH resolves -- replacing an `execSync('which claude')` that answered
        // about the launch environment rather than about the machine.
        const candidates = [
          join(npmBinDir(), 'claude'),
          join(process.env.HOME || '~', '.npm-global', 'bin', 'claude'),
          join(process.env.HOME || '~', '.local', 'bin', 'claude'),
          '/usr/local/bin/claude',
          '/usr/bin/claude',
        ]
        const onPath = resolveOnPath('claude', computeRefreshedPath().merged)
        if (onPath && !candidates.includes(onPath)) {
          candidates.unshift(onPath)
        }
        const paths = candidates.map((location) => ({
          location,
          exists: existsSync(location),
        }))
        return { success: true, data: { paths } }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )
}
