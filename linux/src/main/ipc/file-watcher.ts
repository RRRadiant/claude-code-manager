import { BrowserWindow } from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import {
  SETTINGS_PATH,
  SETTINGS_LOCAL_PATH,
  AGENTS_DIR,
  COMMANDS_DIR,
  INSTALLED_PLUGINS_PATH,
} from '../utils/paths'

/**
 * Start watching ~/.claude/ files for changes.
 * Pushes batched change events to the renderer via IPC.
 */
export function startWatching(mainWindow: BrowserWindow): FSWatcher {
  const watchPaths = [
    SETTINGS_PATH,
    SETTINGS_LOCAL_PATH,
    AGENTS_DIR,
    COMMANDS_DIR,
    INSTALLED_PLUGINS_PATH,
  ]

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    depth: 1, // Only watch one level deep under agents/commands dirs
  })

  // Debounce: collect changes within 1s window
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const changedPaths = new Set<string>()

  const flush = () => {
    if (changedPaths.size > 0 && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file:changed', {
        paths: Array.from(changedPaths),
      })
      changedPaths.clear()
    }
    debounceTimer = null
  }

  watcher.on('change', (path: string) => {
    changedPaths.add(path)
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(flush, 1000)
  })

  watcher.on('add', (path: string) => {
    changedPaths.add(path)
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(flush, 1000)
  })

  return watcher
}

/** Stop the file watcher cleanly */
export async function stopWatching(watcher: FSWatcher): Promise<void> {
  await watcher.close()
}
