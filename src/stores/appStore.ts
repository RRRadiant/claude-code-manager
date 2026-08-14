// Claude Code Manager - Global application state
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

interface AppState {
  // Theme
  theme: ThemeMode;
  effectiveTheme: 'light' | 'dark';

  // Onboarding
  onboardingCompleted: boolean;
  onboardingStep: number;

  // UI state
  sidebarCollapsed: boolean;
  reducedMotion: boolean;
  reducedGlass: boolean;

  // Actions
  setTheme: (theme: ThemeMode) => void;
  setOnboardingCompleted: (completed: boolean) => void;
  setOnboardingStep: (step: number) => void;
  toggleSidebar: () => void;
  setReducedMotion: (value: boolean) => void;
  setReducedGlass: (value: boolean) => void;
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'system',
      effectiveTheme: getSystemTheme(),

      onboardingCompleted: false,
      onboardingStep: 0,

      sidebarCollapsed: false,
      reducedMotion: false,
      reducedGlass: false,

      setTheme: (theme) => {
        const effectiveTheme = theme === 'system' ? getSystemTheme() : theme;
        set({ theme, effectiveTheme });
      },

      setOnboardingCompleted: (completed) => set({ onboardingCompleted: completed }),
      setOnboardingStep: (step) => set({ onboardingStep: step }),

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      setReducedMotion: (value) => set({ reducedMotion: value }),
      setReducedGlass: (value) => set({ reducedGlass: value }),
    }),
    {
      name: 'ccm-app',
      // Persist user preferences only; effectiveTheme is derived from `theme`
      // and the current system preference, so it is intentionally not persisted.
      partialize: (state) => ({
        theme: state.theme,
        onboardingCompleted: state.onboardingCompleted,
        onboardingStep: state.onboardingStep,
        sidebarCollapsed: state.sidebarCollapsed,
        reducedMotion: state.reducedMotion,
        reducedGlass: state.reducedGlass,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<AppState>;
        const theme = persisted.theme ?? currentState.theme;
        return {
          ...currentState,
          theme,
          onboardingCompleted: persisted.onboardingCompleted ?? currentState.onboardingCompleted,
          onboardingStep: persisted.onboardingStep ?? currentState.onboardingStep,
          sidebarCollapsed: persisted.sidebarCollapsed ?? currentState.sidebarCollapsed,
          reducedMotion: persisted.reducedMotion ?? currentState.reducedMotion,
          reducedGlass: persisted.reducedGlass ?? currentState.reducedGlass,
          effectiveTheme: theme === 'system' ? getSystemTheme() : theme,
        };
      },
    },
  ),
);

// Keep effectiveTheme in sync with the OS when the user chose "system".
if (typeof window !== 'undefined' && window.matchMedia) {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', () => {
    const { theme } = useAppStore.getState();
    if (theme === 'system') {
      useAppStore.setState({ effectiveTheme: getSystemTheme() });
    }
  });
}
