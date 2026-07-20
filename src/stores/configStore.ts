// Claude Code Manager - Configuration state
import { create } from 'zustand';
import type { ConfigFileInfo, ConfigContent } from '../types';
import * as api from '../services/tauri';

interface ConfigState {
  files: ConfigFileInfo[];
  currentFile: { scope: string; content: ConfigContent | null } | null;
  loading: boolean;
  error: string | null;

  listFiles: () => Promise<void>;
  readFile: (scope: string) => Promise<void>;
  writeFile: (scope: string, content: string) => Promise<void>;
  clear: () => void;
}

export const useConfigStore = create<ConfigState>((set) => ({
  files: [],
  currentFile: null,
  loading: false,
  error: null,

  listFiles: async () => {
    set({ loading: true, error: null });
    try {
      const files = await api.listConfigFiles();
      set({ files, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : '获取配置列表失败',
      });
    }
  },

  readFile: async (scope: string) => {
    set({ loading: true, error: null });
    try {
      const content = await api.readConfigFile(scope);
      set({
        currentFile: { scope, content },
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : '读取配置失败',
      });
    }
  },

  writeFile: async (scope: string, content: string) => {
    set({ loading: true, error: null });
    try {
      await api.writeConfigFile(scope, content);
      // Refresh the file list after write
      const files = await api.listConfigFiles();
      set({ files, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : '保存配置失败',
      });
    }
  },

  clear: () => {
    set({ currentFile: null, error: null });
  },
}));
