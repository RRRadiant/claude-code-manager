// Claude Code Manager - Global application state
import { create } from 'zustand';

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
  tweaksPanelOpen: boolean;
  reducedMotion: boolean;
  reducedGlass: boolean;

  // Actions
  setTheme: (theme: ThemeMode) => void;
  setOnboardingCompleted: (completed: boolean) => void;
  setOnboardingStep: (step: number) => void;
  toggleSidebar: () => void;
  toggleTweaks: () => void;
  setReducedMotion: (value: boolean) => void;
  setReducedGlass: (value: boolean) => void;
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'system',
  effectiveTheme: getSystemTheme(),

  onboardingCompleted: false,
  onboardingStep: 0,

  sidebarCollapsed: false,
  tweaksPanelOpen: false,
  reducedMotion: false,
  reducedGlass: false,

  setTheme: (theme) => {
    const effectiveTheme = theme === 'system' ? getSystemTheme() : theme;
    set({ theme, effectiveTheme });
    document.documentElement.setAttribute('data-theme', effectiveTheme);
  },

  setOnboardingCompleted: (completed) => set({ onboardingCompleted: completed }),
  setOnboardingStep: (step) => set({ onboardingStep: step }),

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleTweaks: () => set((s) => ({ tweaksPanelOpen: !s.tweaksPanelOpen })),

  setReducedMotion: (value) => set({ reducedMotion: value }),
  setReducedGlass: (value) => set({ reducedGlass: value }),
}));
