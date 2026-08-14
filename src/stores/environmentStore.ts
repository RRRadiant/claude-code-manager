// Claude Code Manager - Environment detection state
import { create } from 'zustand';
import type { EnvironmentStatus } from '../types';
import * as api from '../services/tauri';

interface EnvironmentState {
  status: EnvironmentStatus | null;
  loading: boolean;
  error: string | null;

  detect: () => Promise<void>;
}

// In-flight guard: App.tsx and EnvironmentPage both call detect() on mount.
let detectInFlight: Promise<void> | null = null;

export const useEnvironmentStore = create<EnvironmentState>((set) => ({
  status: null,
  loading: false,
  error: null,

  detect: async () => {
    if (detectInFlight) return detectInFlight;
    detectInFlight = (async () => {
      set({ loading: true, error: null });
      try {
        const status = await api.detectEnvironment();
        set({ status, loading: false });
      } catch (err) {
        set({ loading: false, error: api.errorMessage(err) });
      } finally {
        detectInFlight = null;
      }
    })();
    return detectInFlight;
  },
}));
