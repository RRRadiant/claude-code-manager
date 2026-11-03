import { safeStorage, ipcMain } from 'electron'

export function registerSafeStorageHandlers(): void {
  ipcMain.handle('safe-storage:encrypt', (_event, plaintext: string) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return {
          success: false,
          error: 'safeStorage 不可用 — 请安装 gnome-keyring 或 kwallet',
        }
      }
      const encrypted = safeStorage.encryptString(plaintext)
      return { success: true, data: encrypted.toString('hex') }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('safe-storage:decrypt', (_event, hexString: string) => {
    try {
      const buffer = Buffer.from(hexString, 'hex')
      const plaintext = safeStorage.decryptString(buffer)
      return { success: true, data: plaintext }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('safe-storage:is-available', () => {
    return safeStorage.isEncryptionAvailable()
  })
}
