/**
 * Install pipeline IPC.
 *
 * The command surface mirrors the Rust build's `commands/installer.rs`: start a
 * long-running operation, get a task id back immediately, and receive progress
 * through events rather than polls. Two channels are used, matching the Rust
 * build's split between `task-updated` (coarse, one per step) and
 * `download-progress` (fine, throttled to 150ms):
 *
 *   installer:progress  -> DownloadProgress   (bytes, speed, mirror in use)
 *   installer:task      -> TaskState          (status, step, percent, error)
 */

import { ipcMain, BrowserWindow, type WebContents } from 'electron'
import { readdirSync } from 'fs'
import { join } from 'path'

import {
  InstallPipeline,
  addToShellRc,
  computeRefreshedPath,
  detectSystem,
  refreshProcessPath,
  removeFromShellRc,
} from '../installer'
import {
  APP_DATA_DIR,
  CACHE_DIR,
  managedBinDirs,
  npmBinDir,
  npmPrefixDir,
} from '../installer/components'
import { archiveStamp, invalidateCache, readMarker } from '../installer/cache'
import { toAppError } from '../installer/errors'
import { detectTool } from '../installer/env'
import { createShortcut, shortcutStatus } from '../services/desktop-shortcut'
import { launchScriptInTerminal, writeTempScript } from '../utils/terminal'
import type { ComponentId, DownloadProgress, TaskState } from '../installer/types'

/** Broadcast to every live renderer, so a second window stays in sync. */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Per-WebContents pipeline so tests and multiple windows do not share tasks. */
const pipelines = new WeakMap<WebContents, InstallPipeline>()

function pipelineFor(sender: WebContents): InstallPipeline {
  const existing = pipelines.get(sender)
  if (existing) return existing

  const pipeline = new InstallPipeline({
    onProgress: (event: DownloadProgress) => {
      if (!sender.isDestroyed()) sender.send('installer:progress', event)
    },
    onTask: (state: TaskState) => {
      if (!sender.isDestroyed()) sender.send('installer:task', state)
    },
  })

  pipelines.set(sender, pipeline)
  return pipeline
}

export function registerInstallerIpcHandlers(): void {
  // -------------------------------------------------------------------------
  // Environment detection
  // -------------------------------------------------------------------------
  ipcMain.handle('installer:detect', async () => {
    try {
      const system = await detectSystem()
      const path = computeRefreshedPath()
      return {
        success: true,
        data: {
          system,
          path: {
            managed: path.managed,
            added: path.added,
            changed: path.changed,
          },
          layout: {
            appDataDir: APP_DATA_DIR,
            cacheDir: CACHE_DIR,
            npmPrefixDir: npmPrefixDir(),
            npmBinDir: npmBinDir(),
            managedBinDirs: managedBinDirs(),
          },
        },
      }
    } catch (e) {
      return { success: false, error: toAppError(e).toShape() }
    }
  })

  // -------------------------------------------------------------------------
  // Install plan — read-only, no side effects
  // -------------------------------------------------------------------------
  ipcMain.handle('installer:plan', async (event) => {
    try {
      const plan = await pipelineFor(event.sender).plan()
      return { success: true, data: plan }
    } catch (e) {
      return { success: false, error: toAppError(e).toShape() }
    }
  })

  // -------------------------------------------------------------------------
  // Start the full install. Returns a task id immediately.
  // -------------------------------------------------------------------------
  ipcMain.handle('installer:install-full', async (event) => {
    try {
      const taskId = pipelineFor(event.sender).startFull()
      return { success: true, data: { taskId } }
    } catch (e) {
      return { success: false, error: toAppError(e).toShape() }
    }
  })

  // -------------------------------------------------------------------------
  // Start one component
  // -------------------------------------------------------------------------
  ipcMain.handle(
    'installer:install-component',
    async (event, args: { component: ComponentId }) => {
      try {
        const allowed: ComponentId[] = ['node', 'git', 'claude-code']
        if (!allowed.includes(args?.component)) {
          return {
            success: false,
            error: {
              code: 'INSTALL_FAILED',
              title: '参数错误',
              message: `未知组件: ${String(args?.component)}`,
            },
          }
        }
        const taskId = pipelineFor(event.sender).startComponent(args.component)
        return { success: true, data: { taskId } }
      } catch (e) {
        return { success: false, error: toAppError(e).toShape() }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Cancel a running task
  // -------------------------------------------------------------------------
  ipcMain.handle('installer:cancel', async (event, args: { taskId: string }) => {
    try {
      const accepted = pipelineFor(event.sender).cancel(args?.taskId ?? '')
      return { success: true, data: { accepted } }
    } catch (e) {
      return { success: false, error: toAppError(e).toShape() }
    }
  })

  // -------------------------------------------------------------------------
  // List tasks
  // -------------------------------------------------------------------------
  ipcMain.handle('installer:tasks', async (event) => {
    try {
      return { success: true, data: pipelineFor(event.sender).tasks.all() }
    } catch (e) {
      return { success: false, error: toAppError(e).toShape() }
    }
  })

  // -------------------------------------------------------------------------
  // PATH helpers
  // -------------------------------------------------------------------------
  ipcMain.handle('installer:path-status', async () => {
    try {
      const refreshed = refreshProcessPath()
      return {
        success: true,
        data: {
          merged: refreshed.merged,
          managed: refreshed.managed,
          added: refreshed.added,
          changed: refreshed.changed,
        },
      }
    } catch (e) {
      return { success: false, error: toAppError(e).toShape() }
    }
  })

  ipcMain.handle('installer:apply-shell-path', async () => {
    try {
      const rc = addToShellRc()
      return { success: true, data: rc }
    } catch (e) {
      return { success: false, error: toAppError(e).toShape() }
    }
  })

  ipcMain.handle('installer:remove-shell-path', async () => {
    try {
      const cleaned = removeFromShellRc()
      return { success: true, data: { cleaned } }
    } catch (e) {
      return { success: false, error: toAppError(e).toShape() }
    }
  })

  // -------------------------------------------------------------------------
  // Cache management
  // -------------------------------------------------------------------------
  ipcMain.handle('installer:cache-info', async () => {
    try {
      const entries: Array<{ name: string; size: number; verified: boolean }> = []
      let files: string[] = []
      try {
        files = readdirSync(CACHE_DIR)
      } catch {
        // Cache directory does not exist yet — an empty cache is not an error.
      }

      for (const name of files) {
        const full = join(CACHE_DIR, name)
        if (name.endsWith('.part')) {
          entries.push({ name, size: archiveStamp(full)?.size ?? 0, verified: false })
          continue
        }
        if (name.endsWith('.verified.json')) continue
        const fileStamp = archiveStamp(full)
        if (!fileStamp) continue
        entries.push({
          name,
          size: fileStamp.size,
          verified: readMarker(full)?.size === fileStamp.size,
        })
      }

      return { success: true, data: { dir: CACHE_DIR, entries } }
    } catch (e) {
      return { success: false, error: toAppError(e).toShape() }
    }
  })

  ipcMain.handle('installer:clear-cache', async () => {
    try {
      let removed = 0
      try {
        for (const name of readdirSync(CACHE_DIR)) {
          invalidateCache(join(CACHE_DIR, name))
          removed += 1
        }
      } catch {
        // Nothing to clear.
      }
      return { success: true, data: { removed } }
    } catch (e) {
      return { success: false, error: toAppError(e).toShape() }
    }
  })

  // -------------------------------------------------------------------------
  // Run claude in a terminal
  // -------------------------------------------------------------------------
  ipcMain.handle('installer:open-terminal', async () => {
    try {
      const claude = await detectTool('claude')
      if (!claude.installed) {
        return {
          success: false,
          error: {
            code: 'INSTALL_FAILED',
            title: '未安装',
            message: '未检测到 Claude Code，请先完成安装。',
          },
        }
      }

      const script = writeTempScript(
        'launch-claude',
        [
          '#!/bin/bash',
          '# Generated by Claude Code Manager. Safe to delete.',
          '#',
          '# The login shell is not decoration: the managed install is added to',
          '# PATH by the user\'s shell rc, so a non-login shell finds the older',
          '# system claude instead. `exec bash` at the end keeps the window open',
          '# after claude exits.',
          "exec bash -lc 'claude; exec bash'",
          '',
        ].join('\n'),
      )

      // The managed bin dirs must be on PATH or the terminal's shell cannot find
      // `claude`; it would start and immediately report "not found".
      const launch = await launchScriptInTerminal(script, {
        PATH: computeRefreshedPath().merged,
      })

      if (!launch.ok) {
        return {
          success: false,
          error: {
            code: 'INSTALL_FAILED',
            title: '未找到终端',
            message: `${launch.error ?? '未找到可用的终端模拟器'}。请手动打开终端并运行 claude。`,
          },
        }
      }

      return { success: true, data: { terminal: launch.terminal ?? 'unknown' } }
    } catch (e) {
      return { success: false, error: toAppError(e).toShape() }
    }
  })

  // -------------------------------------------------------------------------
  // Desktop shortcut
  // -------------------------------------------------------------------------
  ipcMain.handle('installer:desktop-shortcut-status', async () => {
    try {
      return { success: true, data: await shortcutStatus() }
    } catch (e) {
      return { success: false, error: toAppError(e).toShape() }
    }
  })

  ipcMain.handle('installer:create-desktop-shortcut', async () => {
    try {
      return { success: true, data: await createShortcut() }
    } catch (e) {
      return {
        success: false,
        error: {
          code: 'INSTALL_FAILED',
          title: '无法创建桌面图标',
          message: toAppError(e).message,
          suggestions: ['可以先手动创建 ~/Desktop 目录，或直接从应用菜单启动。'],
        },
      }
    }
  })
}

