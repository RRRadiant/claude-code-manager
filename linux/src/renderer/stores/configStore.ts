import { create } from 'zustand'
import type { ClaudeSettings } from '../types/claude-config'

interface ConfigState {
  settings: ClaudeSettings | null
  localSettings: ClaudeSettings | null
  loading: boolean
  error: string | null

  loadConfig: () => Promise<void>
  saveConfig: (partial: Partial<ClaudeSettings>) => Promise<void>
  loadLocalConfig: () => Promise<void>
  saveLocalConfig: (partial: Partial<ClaudeSettings>) => Promise<void>
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  settings: null,
  localSettings: null,
  loading: false,
  error: null,

  loadConfig: async () => {
    set({ loading: true, error: null })
    try {
      const result = await window.electronAPI.configRead()
      if (result.success) {
        set({ settings: result.data as ClaudeSettings, loading: false })
      } else {
        set({ error: result.error || 'Failed to read config', loading: false })
      }
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  },

  saveConfig: async (partial: Partial<ClaudeSettings>) => {
    set({ loading: true, error: null })
    try {
      await window.electronAPI.configWrite(partial)
      // Reload from disk after write so state reflects the persisted file
      await get().loadConfig()
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  },

  loadLocalConfig: async () => {
    set({ error: null })
    try {
      const result = await window.electronAPI.configReadLocal()
      if (result.success) {
        set({ localSettings: result.data as ClaudeSettings })
      } else {
        set({ error: result.error || 'Failed to read local config' })
      }
    } catch (err) {
      set({ error: String(err) })
    }
  },

  saveLocalConfig: async (partial: Partial<ClaudeSettings>) => {
    set({ error: null })
    try {
      await window.electronAPI.configWriteLocal(partial)
      // Reload from disk after write so state reflects the persisted file
      await get().loadLocalConfig()
    } catch (err) {
      set({ error: String(err) })
    }
  },
}))
