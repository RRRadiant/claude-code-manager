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

/** Fine-grained progress for a file download in flight. */
export interface DownloadState {
  component: string
  percent: number
  speedBytesPerSec: number
  downloadedBytes: number
  totalBytes: number
}

interface ConsoleState {
  entries: ConsoleEntry[]
  expanded: boolean
  activeTask: ActiveTask | null
  /**
   * Live download progress, or null when nothing is downloading.
   *
   * Only the *primary* download is tracked. Node.js and Git install in parallel,
   * so accepting both streams would make the percentage jump back and forth.
   */
  download: DownloadState | null
  add: (text: string, kind?: ConsoleEntry['kind']) => void
  clear: () => void
  toggle: () => void
  setExpanded: (v: boolean) => void
  setActiveTask: (task: ActiveTask | null) => void
  setDownload: (d: DownloadState | null) => void
}

let id = 0

export const useConsoleStore = create<ConsoleState>((set) => ({
  entries: [],
  expanded: false,
  activeTask: null,
  download: null,

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
  setDownload: d => set({ download: d }),
}))
