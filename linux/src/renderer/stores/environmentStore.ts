import { create } from 'zustand'

/**
 * Environment install store.
 *
 * Two event streams are kept separately, mirroring the backend's split:
 *
 *   - `progress` is the throttled byte-level stream, owner-tagged per component.
 *     Only the event whose `primary` flag is set drives the main bar, so the bar
 *     stays monotonic while Node.js and Git download in parallel.
 *   - `task` is the coarse state machine: running / success / failed / cancelled,
 *     plus the current step line and any error.
 *
 * Nothing here polls. The Windows build states the rule and this follows it:
 * progress is push-based, so there is no `setInterval` anywhere in this feature.
 */

interface ProgressEntry {
  component: InstallComponent
  componentLabel: string
  primary: boolean
  stage: DownloadStage
  percent: number
  speedBytesPerSec: number
  downloadedBytes: number
  totalBytes: number
  source: string
  sourceId: string
}

export interface DepItem {
  name: string
  description: string
  installed: boolean
  installCmd: string | null
}

/** Where the dependency install was handed off to, if anywhere. */
export interface DepsInstallOutcome {
  mode: 'terminal' | 'nothing-to-do' | 'manual'
  command: string | null
  terminal: string | null
  error?: string
}

interface EnvironmentState {
  detected: InstallerDetect | null
  plan: InstallStepResult[] | null
  /** Latest progress per component, keyed by component id. */
  progress: Partial<Record<InstallComponent, ProgressEntry>>
  task: TaskState | null
  /** Append-only log surface, newest last. */
  log: string[]
  detecting: boolean
  planning: boolean
  error: InstallErrorShape | null
  /** Set when the run finished and a new shell is needed to see `claude`. */
  needsNewShell: boolean
  rcFiles: string[]
  /** Desktop shortcut state, so the UI can offer to create one. */
  desktopShortcut: { available: boolean; path: string | null; exists: boolean } | null

  /** System packages Claude Code and the app itself depend on. */
  deps: DepItem[] | null
  depsChecking: boolean
  /** True while the install hand-off is in flight, so the button cannot be double-fired. */
  depsInstalling: boolean
  depsOutcome: DepsInstallOutcome | null

  detect: () => Promise<void>
  loadPlan: () => Promise<void>
  installFull: () => Promise<void>
  installComponent: (component: InstallComponent) => Promise<void>
  cancel: () => Promise<void>
  clearCache: () => Promise<void>
  /** Open a terminal window running claude. */
  openClaude: () => Promise<void>
  /** Put a launcher on the user's desktop. */
  createDesktopShortcut: () => Promise<void>
  /** Re-read whether the shortcut exists. */
  refreshShortcutStatus: () => Promise<void>
  /** Re-read the system dependency list. */
  checkDeps: () => Promise<void>
  /** Hand the missing packages to a terminal, where sudo can prompt. */
  installMissingDeps: () => Promise<void>
  reset: () => void

  /** Wire the backend event streams. Returns an unsubscribe function. */
  subscribe: () => () => void
}

const MAX_LOG_LINES = 300

/**
 * Format a byte count as a human-readable size.
 *
 * A local copy rather than an import: the renderer must not pull in the main
 * process's installer modules, and this is eight lines.
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** "正在下载 Node.js · 42% · 3.2 MB/s (11.0/34.9 MB)" */
export function formatDownloadLine(p: ProgressEntry): string {
  const parts = [`正在下载 ${p.componentLabel}`, `${p.percent.toFixed(0)}%`]
  if (p.speedBytesPerSec > 0) parts.push(`${formatBytes(p.speedBytesPerSec)}/s`)
  if (p.totalBytes > 0) {
    parts.push(`(${formatBytes(p.downloadedBytes)}/${formatBytes(p.totalBytes)})`)
  }
  return parts.join(' · ')
}

export function formatError(error: InstallErrorShape): string {
  const lines = [error.message]
  if (error.suggestions && error.suggestions.length > 0) {
    lines.push(...error.suggestions.map((s) => `· ${s}`))
  }
  return lines.join('\n')
}

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  detected: null,
  plan: null,
  progress: {},
  task: null,
  log: [],
  detecting: false,
  planning: false,
  error: null,
  needsNewShell: false,
  rcFiles: [],
  desktopShortcut: null,
  deps: null,
  depsChecking: false,
  depsInstalling: false,
  depsOutcome: null,

  detect: async () => {
    set({ detecting: true, error: null })
    try {
      const result = await window.electronAPI.installerDetect()
      if (result.success && result.data) {
        set({ detected: result.data, detecting: false })
      } else {
        set({ error: result.error ?? null, detecting: false })
      }
    } catch (e) {
      set({ error: { code: 'DETECT_FAILED', title: '检测失败', message: String(e) }, detecting: false })
    }
  },

  loadPlan: async () => {
    set({ planning: true, error: null })
    try {
      const result = await window.electronAPI.installerPlan()
      if (result.success && result.data) {
        set({ plan: result.data, planning: false })
      } else {
        set({ error: result.error ?? null, planning: false })
      }
    } catch (e) {
      set({ error: { code: 'PLAN_FAILED', title: '获取安装计划失败', message: String(e) }, planning: false })
    }
  },

  installFull: async () => {
    const next = appendLog(get().log, '开始安装完整环境...')
    set({ error: null, progress: {}, needsNewShell: false, rcFiles: [], log: next })
    try {
      const result = await window.electronAPI.installerInstallFull()
      if (!result.success) {
        set({ error: result.error ?? null })
        return
      }

      // The install task is asynchronous — `installerInstallFull` returns a task
      // id immediately. Wait for it to settle, then finish the job for the user:
      // put an icon on the desktop and open Claude Code, so a fresh install ends
      // with a working terminal rather than with instructions to go and find one.
      await waitForTask(get, set)
    } catch (e) {
      set({ error: { code: 'INSTALL_FAILED', title: '启动失败', message: String(e) } })
    }
  },

  installComponent: async (component) => {
    const next = appendLog(get().log, `开始安装 ${component}...`)
    set({ error: null, log: next })
    try {
      const result = await window.electronAPI.installerInstallComponent({ component })
      if (!result.success) {
        set({ error: result.error ?? null })
      }
    } catch (e) {
      set({ error: { code: 'INSTALL_FAILED', title: '启动失败', message: String(e) } })
    }
  },

  cancel: async () => {
    const task = get().task
    if (!task) return
    await window.electronAPI.installerCancel({ taskId: task.id })
    set({ log: appendLog(get().log, '已请求取消...') })
  },

  clearCache: async () => {
    try {
      const result = await window.electronAPI.installerClearCache()
      const removed = result.success ? result.data?.removed ?? 0 : 0
      set({ log: appendLog(get().log, `已清除 ${removed} 个缓存文件`) })
    } catch (e) {
      set({ error: { code: 'CACHE_FAILED', title: '清除缓存失败', message: String(e) } })
    }
  },

  openClaude: async () => {
    try {
      const result = await window.electronAPI.installerOpenTerminal()
      if (result.success) {
        set({ log: appendLog(get().log, `已在 ${result.data?.terminal ?? '终端'} 中启动 Claude Code`) })
      } else {
        set({ error: result.error ?? null })
      }
    } catch (e) {
      set({ error: { code: 'LAUNCH_FAILED', title: '启动失败', message: String(e) } })
    }
  },

  createDesktopShortcut: async () => {
    try {
      const result = await window.electronAPI.installerCreateDesktopShortcut()
      if (result.success && result.data) {
        const { path, needsTrust } = result.data
        set({
          desktopShortcut: { available: true, path, exists: true },
          log: appendLog(get().log, `桌面快捷方式已创建：${path}`),
        })
        // `needsTrust` is the one case where the icon appears but a double-click
        // does nothing, so it has to reach the user rather than the log only.
        if (needsTrust) {
          set({
            error: {
              code: 'DESKTOP_TRUST',
              title: '桌面图标已创建，但需要手动授权',
              message:
                '图标已放在桌面，但当前桌面环境要求先标记为「可信」才能双击运行。\n' +
                '在图标上点右键，选择「允许启动」或「标记为可信」即可。',
            },
          })
        }
      } else {
        set({ error: result.error ?? null })
      }
    } catch (e) {
      set({ error: { code: 'DESKTOP_FAILED', title: '创建桌面图标失败', message: String(e) } })
    }
  },

  refreshShortcutStatus: async () => {
    try {
      const result = await window.electronAPI.installerDesktopShortcutStatus()
      if (result.success && result.data) set({ desktopShortcut: result.data })
    } catch {
      // Non-critical: the button stays hidden rather than showing a wrong state.
    }
  },

  checkDeps: async () => {
    set({ depsChecking: true })
    try {
      const result = await window.electronAPI.depsCheck()
      set({ deps: result.checks, depsChecking: false })
    } catch {
      set({ deps: [], depsChecking: false })
    }
  },

  installMissingDeps: async () => {
    if (get().depsInstalling) return
    set({ depsOutcome: null, depsInstalling: true })
    try {
      const result = await window.electronAPI.depsInstallMissing()
      if (result.mode === 'nothing-to-do') {
        await get().checkDeps()
        set({ depsOutcome: null })
        return
      }
      set({
        depsOutcome: {
          mode: result.mode,
          command: result.command,
          terminal: result.terminal,
          error: result.error,
        },
      })
    } catch (e) {
      set({ depsOutcome: { mode: 'manual', command: null, terminal: null, error: String(e) } })
    } finally {
      set({ depsInstalling: false })
    }
  },

  reset: () =>
    set({
      progress: {},
      task: null,
      log: [],
      error: null,
      needsNewShell: false,
      rcFiles: [],
    }),

  subscribe: () => {
    const offProgress = window.electronAPI.onInstallProgress((p) => {
      set((state) => ({ progress: { ...state.progress, [p.component]: p } }))
    })

    const offTask = window.electronAPI.onInstallTask((task) => {
      set((state) => {
        const lines: string[] = []
        if (task.step && task.step !== state.task?.step) lines.push(task.step)
        if (task.status === 'success') lines.push(`✓ ${task.title} 完成`)
        if (task.status === 'failed') lines.push(`✗ ${task.title} 失败：${task.error ?? '未知错误'}`)
        if (task.status === 'cancelled') lines.push('已取消')

        return {
          task,
          log: lines.length > 0 ? [...state.log, ...lines].slice(-MAX_LOG_LINES) : state.log,
          // A finished successful run means PATH changed, so any terminal opened
          // before it will not see the new tools. The UI says "open a new
          // terminal" rather than "restart the app" — nothing is broken.
          needsNewShell: task.status === 'success' ? true : state.needsNewShell,
        }
      })

      // Refresh detection and the plan once a run settles, so the panel reflects
      // reality rather than the pre-run snapshot.
      if (task.status === 'success' || task.status === 'failed') {
        void get().detect()
        void get().loadPlan()
        void get().refreshShortcutStatus()
      }
    })

    return () => {
      offProgress()
      offTask()
    }
  },
}))

function appendLog(log: string[], line: string): string[] {
  return [...log, ...(line ? [line] : [])].slice(-MAX_LOG_LINES)
}

/**
 * Resolve once the running task reaches a terminal state.
 *
 * `installerInstallFull` returns a task id immediately and reports progress
 * through events, so finishing steps that need the *result* has to wait. Polling
 * is acceptable here, unlike for the progress bar: this runs once per install and
 * the state it reads is already in memory.
 */
async function waitForTask(
  get: () => EnvironmentState,
  set: (partial: Partial<EnvironmentState>) => void,
): Promise<void> {
  const settleDeadline = Date.now() + 30 * 60 * 1000

  while (Date.now() < settleDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const status = get().task?.status
    if (status === 'success' || status === 'failed' || status === 'cancelled') break
  }

  if (get().task?.status !== 'success') return

  // A shortcut on the desktop, so the user has something to click next time.
  await get().createDesktopShortcut()

  // Then open Claude Code itself. This is the point of the whole install, and
  // leaving the user at a window that says "done" makes them go and work out how
  // to start it. A terminal is spawned with the managed PATH, so `claude`
  // resolves even though this process is still running on its old PATH.
  if (get().detected?.system.claude.installed) {
    await get().openClaude()
  } else {
    set({
      log: appendLog(get().log, 'Claude Code 未检测到，已跳过自动启动。可用「重新检测」刷新。'),
    })
  }
}

/** The progress entry that owns the single main bar. */
export function selectPrimaryProgress(
  progress: Partial<Record<InstallComponent, ProgressEntry>>,
): ProgressEntry | null {
  for (const entry of Object.values(progress)) {
    if (entry?.primary) return entry
  }
  return null
}
