/**
 * Task manager for long-running operations.
 *
 * Ported from `task.rs`. Same shape, same contract: a task is created, started,
 * then driven to success / failure / cancellation, and every state change is
 * pushed to the renderer rather than polled.
 *
 * Two behaviours are carried over because they were fixes, not features:
 *
 *   - `updateStep` and `fail` sanitize their text before it is stored or emitted.
 *     Step messages embed command output and registry URLs, and npm is happy to
 *     echo a URL carrying a token.
 *   - Cancellation uses a flag object shared with the running work, not a
 *     polling bridge. The Rust version's comment records that the old design
 *     needed a 120-second polling bridge thread to notice a cancel.
 */

import { logSanitizer } from './logging'
import { AppError, cancelledError, toAppError } from './errors'
import type { ComponentId, TaskState, TaskStatus } from './types'

export type TaskEventSink = (state: TaskState) => void

interface TaskHandle {
  state: TaskState
  cancel: { cancel(): void; flag: { readonly cancelled: boolean } }
}

let counter = 0
const nextId = (): string => `task-${Date.now().toString(36)}-${(counter += 1).toString(36)}`

export class TaskManager {
  private readonly tasks = new Map<string, TaskHandle>()
  private readonly sink: TaskEventSink

  constructor(sink: TaskEventSink = () => undefined) {
    this.sink = sink
  }

  create(type: string, title: string, cancellable = true): string {
    const id = nextId()
    this.tasks.set(id, {
      state: {
        id,
        type,
        status: 'queued',
        title: logSanitizer.sanitize(title),
        step: null,
        progress: 0,
        cancellable,
        error: null,
        startedAt: null,
        finishedAt: null,
      },
      cancel: makeCanceller(),
    })
    return id
  }

  get(id: string): TaskState | null {
    return this.tasks.get(id)?.state ?? null
  }

  all(): TaskState[] {
    return [...this.tasks.values()].map((handle) => handle.state)
  }

  /** The cancellation token to hand to the running work. */
  cancelFlag(id: string): { readonly cancelled: boolean } | undefined {
    return this.tasks.get(id)?.cancel.flag
  }

  start(id: string): void {
    this.mutate(id, (state) => {
      state.status = 'running'
      state.startedAt = Date.now()
    })
  }

  updateProgress(id: string, progress: number, step?: string): void {
    this.mutate(id, (state) => {
      state.progress = clampPercent(progress)
      if (step !== undefined) state.step = logSanitizer.sanitize(step)
    })
  }

  succeed(id: string, step?: string): void {
    this.mutate(id, (state) => {
      state.status = 'success'
      state.progress = 100
      state.finishedAt = Date.now()
      if (step !== undefined) state.step = logSanitizer.sanitize(step)
    })
    this.emitCompleted(id)
  }

  fail(id: string, error: unknown): void {
    const appError = toAppError(error ?? new AppError({ code: 'INSTALL_FAILED', title: '失败', message: '未知错误' }))
    this.mutate(id, (state) => {
      state.status = 'failed'
      state.error = logSanitizer.sanitize(appError.toText())
      state.finishedAt = Date.now()
    })
    this.emitCompleted(id)
  }

  /**
   * Mark a task cancelled.
   *
   * Cancellation is observable through the token, so by the time this runs the
   * work has already stopped; this only records the outcome.
   */
  markCancelled(id: string): void {
    this.mutate(id, (state) => {
      state.status = 'cancelled'
      state.error = cancelledError().message
      state.finishedAt = Date.now()
    })
    this.emitCompleted(id)
  }

  requestCancel(id: string): boolean {
    const handle = this.tasks.get(id)
    if (!handle || !handle.state.cancellable) return false
    if (handle.state.status !== 'running' && handle.state.status !== 'queued') return false
    handle.cancel.cancel()
    return true
  }

  /** Drop finished tasks, keeping anything still running. */
  clearCompleted(): void {
    for (const [id, handle] of this.tasks) {
      const status = handle.state.status
      if (status !== 'queued' && status !== 'running') this.tasks.delete(id)
    }
  }

  private mutate(id: string, fn: (state: TaskState) => void): void {
    const handle = this.tasks.get(id)
    if (!handle) return
    fn(handle.state)
    this.sink({ ...handle.state })
  }

  private emitCompleted(id: string): void {
    const handle = this.tasks.get(id)
    if (!handle) return
    this.sink({ ...handle.state })
  }
}

function makeCanceller(): { cancel(): void; flag: { readonly cancelled: boolean } } {
  let cancelled = false
  return {
    cancel(): void {
      cancelled = true
    },
    flag: {
      get cancelled(): boolean {
        return cancelled
      },
    },
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

/** Convenience for the orchestrator: run work under a task, resolving its fate. */
export async function runTask<T>(
  manager: TaskManager,
  id: string,
  work: (flag: { readonly cancelled: boolean }) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: AppError }> {
  const flag = manager.cancelFlag(id)
  if (!flag) {
    return { ok: false, error: new AppError({ code: 'INSTALL_FAILED', title: '内部错误', message: '任务不存在。' }) }
  }

  manager.start(id)
  try {
    const value = await work(flag)
    return { ok: true, value }
  } catch (e) {
    if (flag.cancelled) {
      manager.markCancelled(id)
      return { ok: false, error: cancelledError() }
    }
    const appError = toAppError(e)
    manager.fail(id, appError)
    return { ok: false, error: appError }
  }
}

/** Component ids currently supported by the pipeline, for validation. */
export const SUPPORTED_COMPONENTS: ComponentId[] = ['node', 'git', 'claude-code']

export const isTerminal = (status: TaskStatus): boolean =>
  status === 'success' || status === 'failed' || status === 'cancelled'
