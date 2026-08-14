import { create } from 'zustand'

export interface ConsoleEntry {
  id: string
  time: string
  text: string
  kind: 'info' | 'success' | 'error' | 'progress'
}

export interface ActiveTask {
  id: string
  title: string
  step: string
  progress: number
  status: 'queued' | 'running' | 'success' | 'failed'
}

interface ConsoleState {
  entries: ConsoleEntry[]
  expanded: boolean
  activeTask: ActiveTask | null
  add: (text: string, kind?: ConsoleEntry['kind']) => void
  clear: () => void
  toggle: () => void
  setExpanded: (v: boolean) => void
  setActiveTask: (task: ActiveTask | null) => void
  updateActiveTask: (partial: Partial<ActiveTask>) => void
}

let id = 0

export const useConsoleStore = create<ConsoleState>((set) => ({
  entries: [],
  expanded: false,
  activeTask: null,

  add: (text, kind = 'info') => {
    const entry: ConsoleEntry = {
      id: `c-${++id}`,
      time: new Date().toLocaleTimeString(),
      text,
      kind,
    }
    set(s => ({ entries: [...s.entries.slice(-499), entry] }))
  },

  clear: () => set({ entries: [] }),
  toggle: () => set(s => ({ expanded: !s.expanded })),
  setExpanded: v => set({ expanded: v }),

  setActiveTask: task => set({ activeTask: task }),
  updateActiveTask: partial =>
    set(s => ({
      activeTask: s.activeTask ? { ...s.activeTask, ...partial } : null,
    })),
}))
