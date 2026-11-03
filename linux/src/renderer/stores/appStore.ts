import { create } from 'zustand'

export interface CliStatus {
  installed: boolean
  version: string | null
  path: string | null
  installMethod: string | null
}

interface AppState {
  /** Whether the first-run guide has been finished or dismissed. Persisted. */
  onboardingCompleted: boolean
  /** Whether the guide is on screen right now. Not persisted. */
  onboardingOpen: boolean
  cliStatus: CliStatus | null

  setOnboardingCompleted: (v: boolean) => void
  openOnboarding: () => void
  closeOnboarding: () => void
  setCliStatus: (s: CliStatus) => void
  checkCliStatus: () => Promise<void>
}

export const useAppStore = create<AppState>((set) => ({
  onboardingCompleted: false,
  onboardingOpen: false,
  cliStatus: null,

  setOnboardingCompleted: (v: boolean) => set({ onboardingCompleted: v }),

  // Kept as one action so "show the guide again" from a settings panel is a
  // one-liner. It deliberately does not touch the completed flag: closing the
  // guide without finishing it already counts as done.
  openOnboarding: () => set({ onboardingOpen: true }),
  closeOnboarding: () => set({ onboardingOpen: false }),

  setCliStatus: (s: CliStatus) => set({ cliStatus: s }),

  checkCliStatus: async () => {
    try {
      const status = await window.electronAPI.cliStatus()
      set({ cliStatus: status })
    } catch {
      set({
        cliStatus: { installed: false, version: null, path: null, installMethod: null },
      })
    }
  },
}))
