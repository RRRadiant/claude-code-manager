import { app, ipcMain } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { registerConfigIpcHandlers } from './config'
import { registerSafeStorageHandlers } from './safe-storage'
import { registerCliIpcHandlers } from './cli'
import { registerCommandsIpcHandlers } from './commands'
import { registerAgentsIpcHandlers } from './agents'
import { registerPluginsIpcHandlers } from './plugins'
import { registerHooksIpcHandlers } from './hooks'
import { registerMcpIpcHandlers } from './mcp'
import { registerApiDetectorIpc } from './api-detector'
import { registerInstallerIpcHandlers } from './installer'
import { APP_CONFIG_PATH } from '../utils/paths'

function readAppState(): Record<string, unknown> {
  try {
    if (!existsSync(APP_CONFIG_PATH)) return {}
    return JSON.parse(readFileSync(APP_CONFIG_PATH, 'utf-8'))
  } catch { return {} }
}

function writeAppState(state: Record<string, unknown>): void {
  writeFileSync(APP_CONFIG_PATH, JSON.stringify(state, null, 2), 'utf-8')
}

export function registerIpcHandlers(): void {
  registerConfigIpcHandlers()
  registerSafeStorageHandlers()
  registerCliIpcHandlers()
  registerCommandsIpcHandlers()
  registerAgentsIpcHandlers()
  registerPluginsIpcHandlers()
  registerHooksIpcHandlers()
  registerMcpIpcHandlers()
  registerApiDetectorIpc()
  registerInstallerIpcHandlers()

  ipcMain.handle('app:ping', async () => {
    return { pong: true, timestamp: Date.now() }
  })

  // App state persistence (wizard completion, etc.)
  ipcMain.handle('app:get-state', async () => {
    return readAppState()
  })

  ipcMain.handle('app:set-state', async (_event, partial: Record<string, unknown>) => {
    const current = readAppState()
    const merged = { ...current, ...partial }
    writeAppState(merged)
    return merged
  })

  // Restart the app.
  //
  // Not strictly needed to *find* a freshly installed Claude Code — the installer
  // refreshes this process's PATH in place — but a new process is what makes the
  // panels, the shell rc and any terminal opened afterwards agree on the same
  // environment, and it is what a user expects after an install finishes.
  //
  // `app.quit()` rather than `app.exit()`: exit() tears the process down without
  // running the normal shutdown, and on Electron 42 that trips
  // "FATAL: Failed to shutdown" (a SIGTRAP, so the app looks like it crashed and
  // never comes back). quit() closes the windows and unwinds properly; the timer
  // is the escape hatch for the case where something refuses to let go, since by
  // then the relaunch has already been requested.
  //
  // Under an AppImage `process.execPath` points inside the mounted squashfs,
  // which is gone by the time the new process starts; the AppImage runtime is
  // what has to be re-executed.
  //
  // The reply goes out before the quit, so the renderer is not left with a
  // promise that never settles.
  ipcMain.handle('app:relaunch', async () => {
    setImmediate(() => {
      const appImage = process.env.APPIMAGE
      if (appImage) app.relaunch({ execPath: appImage })
      else app.relaunch()

      app.quit()
      setTimeout(() => app.exit(0), 4000).unref()
    })
    return { success: true }
  })
}
