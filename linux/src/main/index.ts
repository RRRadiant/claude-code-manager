import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { startWatching, stopWatching } from './ipc/file-watcher'
import { ensureShortcutOnce } from './services/desktop-shortcut'

let mainWindow: BrowserWindow | null = null
let fileWatcher: ReturnType<typeof startWatching> | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: 'Claude Code Manager',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, '../preload/index.cjs'),
    },
  })

  // Start file system watcher for ~/.claude/
  fileWatcher = startWatching(mainWindow)

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load renderer
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  // Registered once, not per window. `ipcMain.handle` throws on a duplicate
  // channel, so calling this from `createWindow` meant the macOS `activate`
  // path — which rebuilds the window — crashed on its second invocation.
  registerIpcHandlers()

  // Before the window, so the environment panel's first status read already sees
  // the icon. Bounded by its own timeouts and swallows its own errors: an icon
  // must never hold up the app.
  await ensureShortcutOnce()

  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', async () => {
  if (fileWatcher) {
    await stopWatching(fileWatcher)
    fileWatcher = null
  }
})
