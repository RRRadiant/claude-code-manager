/**
 * Pipeline orchestrator.
 *
 * The Windows build's `run_full_install` stops after Node.js + Git and asks the
 * user to restart before Claude Code can be installed. That boundary exists
 * because npm lands in a directory appended to the *registry* PATH, and the
 * running process keeps the PATH it inherited at launch — nothing in-process can
 * substitute for a restart there.
 *
 * Linux has no such boundary, and this orchestrator takes advantage of it:
 *
 *   - Writing `process.env.PATH` takes effect immediately for every child
 *     process, so the npm that was just extracted is the npm Claude Code's
 *     install resolves against, in the same run.
 *   - The user's *future terminals* do need a new shell to pick up the rc-file
 *     export, but that is a cosmetic follow-up, not a prerequisite. The app
 *     reports it instead of blocking on it.
 *
 * So the sequencing here is: run everything in dependency order, and only ask
 * the user for anything at the end.
 */

import { INSTALL_STAGES, type InstallContext } from './installers/context'
import { installClaudeCode, planClaudeCode } from './installers/claude'
import { installGit, planGit } from './installers/git'
import { installNode, planNode } from './installers/node'
import { createProgressReporter, type ProgressSink } from './progress'
import { TaskManager } from './task'
import { detectSystem, refreshProcessPath } from './env'
import { toAppError } from './errors'
import {
  stepFail,
  type ComponentId,
  type DownloadProgress,
  type InstallStepResult,
  type TaskState,
} from './types'

export interface PipelineOptions {
  onProgress: ProgressSink
  onTask: (state: TaskState) => void
  /** Components to act on. Defaults to everything, in dependency order. */
  components?: ComponentId[]
}

/**
 * What the UI should tell the user once a run finishes.
 *
 * `needsNewShell` replaces the Windows build's `restart-required` event. The
 * semantic is narrower: nothing is broken, but a terminal opened *before* this
 * run will not find `claude` until a new one is started.
 */
export interface InstallSummary {
  results: InstallStepResult[]
  allOk: boolean
  /** Directories newly added to PATH during this run. */
  addedPathDirs: string[]
  /** True when the shell rc files were updated, i.e. a new shell is needed. */
  needsNewShell: boolean
  /** Shell rc files that received the PATH export. */
  rcFiles: string[]
  /** Optional components that failed without failing the run. */
  warnings: string[]
}

export class InstallPipeline {
  readonly tasks: TaskManager

  constructor(options: PipelineOptions) {
    this.tasks = new TaskManager(options.onTask)
    this.progressSink = options.onProgress
    this.requested = options.components
  }

  private readonly progressSink: ProgressSink
  private readonly requested?: ComponentId[]

  /**
   * Report the current state of every component without changing anything.
   *
   * Mirrors `generate_install_plan`: the UI renders this so the user sees what
   * will happen before 30 MB starts moving.
   */
  async plan(): Promise<InstallStepResult[]> {
    const [node, git, claude] = await Promise.all([planNode(), planGit(), planClaudeCode()])
    return [node, git, claude]
  }

  /**
   * Run the full environment install.
   *
   * Returns a task id immediately, exactly like the Rust command layer: the UI
   * subscribes to events rather than awaiting the work. Headless callers that
   * need the summary should call `runFull` directly.
   */
  startFull(options: { title?: string } = {}): string {
    const taskId = this.tasks.create('install_full_environment', options.title ?? '安装完整环境', true)

    void this.runFull(taskId)
    return taskId
  }

  /**
   * Run the pipeline under an existing task and resolve with the summary.
   *
   * Exposed for headless drivers (the bundled verification CLI), which have no
   * event loop to subscribe to and just want the result.
   */
  async runFull(taskId: string): Promise<InstallSummary> {
    return this.executeFull(taskId)
  }

  /** Install a single component under its own task. */
  startComponent(component: ComponentId): string {
    const titles: Record<ComponentId, string> = {
      node: '安装 Node.js',
      git: '安装 Git',
      'claude-code': '安装 Claude Code',
    }
    const taskId = this.tasks.create(`install_${component}`, titles[component], true)

    void (async () => {
      const ctx = this.makeContext(taskId)
      this.tasks.start(taskId)
      try {
        const result =
          component === 'node'
            ? await installNode(ctx)
            : component === 'git'
              ? await installGit(ctx)
              : await installClaudeCode(ctx)

        if (result.success) {
          this.tasks.succeed(taskId, result.message)
        } else {
          this.tasks.fail(taskId, stepFail(component, result.message))
        }
      } catch (e) {
        const error = toAppError(e)
        if (ctx.cancel?.cancelled) this.tasks.markCancelled(taskId)
        else this.tasks.fail(taskId, error)
      }
    })()

    return taskId
  }

  cancel(taskId: string): boolean {
    return this.tasks.requestCancel(taskId)
  }

  private async executeFull(taskId: string): Promise<InstallSummary> {
    const ctx = this.makeContext(taskId)
    this.tasks.start(taskId)

    const results: InstallStepResult[] = []
    const warnings: string[] = []
    let addedPathDirs: string[] = []
    let rcFiles: string[] = []

    const want = (component: ComponentId): boolean =>
      this.requested === undefined || this.requested.includes(component)

    try {
      // ---- Node.js: the critical path ---------------------------------
      this.tasks.updateProgress(taskId, 5, '准备安装环境...')

      if (want('node')) {
        const node = await installNode(ctx)
        results.push(node)
        addedPathDirs = [...new Set([...addedPathDirs, ...node.pathDirs])]
        rcFiles = node.rcFiles
        // Node.js is the gate: without npm, Claude Code cannot be installed at
        // all. Report that instead of attempting an install that is guaranteed
        // to fail for a second, less obvious reason.
        if (!node.success) throw new Error(node.message)
        this.tasks.updateProgress(taskId, 45, node.message)
      }

      // ---- Git: optional, never fatal ----------------------------------
      if (want('git')) {
        this.tasks.updateProgress(taskId, 50, '安装 Git...')
        const git = await installGit(ctx)
        results.push(git)
        if (!git.success) {
          // Git is optional for Claude Code. Record it, keep going, and say so.
          warnings.push(git.message)
          this.tasks.updateProgress(taskId, 60, `Git 跳过：${firstLine(git.message)}`)
        } else {
          this.tasks.updateProgress(taskId, 60, git.message)
        }
      }

      // ---- Claude Code --------------------------------------------------
      if (want('claude-code')) {
        this.tasks.updateProgress(taskId, 70, '安装 Claude Code...')
        const claude = await installClaudeCode(ctx)
        results.push(claude)
        if (!claude.success) {
          this.tasks.updateProgress(taskId, 95, `Claude Code 未完成：${firstLine(claude.message)}`)
        } else {
          this.tasks.updateProgress(taskId, 90, claude.message)
        }
      }

      // Re-read PATH one last time so the summary reflects reality.
      const refreshed = refreshProcessPath()
      addedPathDirs = [...new Set([...addedPathDirs, ...refreshed.added])]

      const summary: InstallSummary = {
        results,
        allOk: results.every((r) => r.success || r.component === 'git'),
        addedPathDirs,
        // A new shell is needed whenever we changed an rc file, regardless of
        // whether every component succeeded.
        needsNewShell: addedPathDirs.length > 0,
        rcFiles,
        warnings,
      }

      if (summary.allOk) {
        this.tasks.succeed(taskId, '环境安装完成')
      } else {
        const failing = results.find((r) => !r.success && r.component !== 'git')
        this.tasks.fail(taskId, failing?.message ?? '部分组件安装失败')
      }

      return summary
    } catch (e) {
      const error = toAppError(e)
      if (ctx.cancel?.cancelled) this.tasks.markCancelled(taskId)
      else this.tasks.fail(taskId, error)

      return {
        results,
        allOk: false,
        addedPathDirs,
        needsNewShell: addedPathDirs.length > 0,
        rcFiles,
        warnings,
      }
    }
  }

  private makeContext(taskId: string): InstallContext {
    const reporter = createProgressReporter(this.progressSink)
    const cancel = this.tasks.cancelFlag(taskId)

    return {
      reporter,
      cancel,
      step: (text: string) => this.tasks.updateProgress(taskId, this.tasks.get(taskId)?.progress ?? 0, text),
      log: (level, message) => {
        const line = `[installer] ${message}`
        if (level === 'error') console.error(line)
        else if (level === 'warn') console.warn(line)
        else console.log(line)
      },
    }
  }
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0)
  return line ? line.trim().slice(0, 120) : text.slice(0, 120)
}

/** Re-export the surface the IPC layer needs, so it imports one module. */
export { detectSystem, refreshProcessPath, addToShellRc, removeFromShellRc, computeRefreshedPath } from './env'
export type { DownloadProgress, InstallStepResult, TaskState, ComponentId }
export { INSTALL_STAGES }
