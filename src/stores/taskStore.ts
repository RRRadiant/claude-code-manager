// Claude Code Manager - Task state management
import { create } from 'zustand';
import type { TaskState } from '../types';
import * as api from '../services/tauri';

interface TaskStateStore {
  tasks: TaskState[];
  loading: boolean;

  refresh: () => Promise<void>;
  cancel: (id: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
  upsertTask: (task: TaskState) => void;
  removeTask: (id: string) => void;
}

export const useTaskStore = create<TaskStateStore>((set, get) => ({
  tasks: [],
  loading: false,

  refresh: async () => {
    set({ loading: true });
    try {
      const tasks = await api.getTasks();
      set({ tasks, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  cancel: async (id: string) => {
    await api.cancelTask(id);
    await get().refresh();
  },

  clearCompleted: async () => {
    await api.clearTasks();
    await get().refresh();
  },

  upsertTask: (task: TaskState) => {
    set((state) => {
      const existing = state.tasks.findIndex((t) => t.id === task.id);
      if (existing >= 0) {
        const tasks = [...state.tasks];
        tasks[existing] = task;
        return { tasks };
      }
      return { tasks: [...state.tasks, task] };
    });
  },

  removeTask: (id: string) => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    }));
  },
}));
