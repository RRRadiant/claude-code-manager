// Claude Code Manager - Environment detection state
import { create } from 'zustand';
import type { EnvironmentStatus } from '../types';
import * as api from '../services/tauri';

interface EnvironmentState {
  status: EnvironmentStatus | null;
  loading: boolean;
  error: string | null;
  lastDetected: string | null;

  detect: () => Promise<void>;
  /** Refresh PATH from registry, then re-detect environment */
  refreshAndDetect: () => Promise<void>;
  clear: () => void;
}

export const useEnvironmentStore = create<EnvironmentState>((set) => ({
  status: null,
  loading: false,
  error: null,
  lastDetected: null,

  detect: async () => {
    set({ loading: true, error: null });
    try {
      const status = await api.detectEnvironment();
      set({
        status,
        loading: false,
        lastDetected: new Date().toISOString(),
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : '检测失败',
      });
    }
  },

  refreshAndDetect: async () => {
    set({ loading: true, error: null });
    try {
      // First refresh the Windows environment from registry
      await api.refreshEnvironment();
      // Then re-detect everything
      const status = await api.detectEnvironment();
      set({
        status,
        loading: false,
        lastDetected: new Date().toISOString(),
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : '刷新后检测失败',
      });
    }
  },

  clear: () => {
    set({ status: null, lastDetected: null, error: null });
  },
}));
