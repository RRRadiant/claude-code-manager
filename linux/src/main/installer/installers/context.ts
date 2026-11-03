/**
 * Shared context handed to every component installer.
 *
 * Mirrors the role of `AppHandle` + `AppState` in the Rust build, narrowed to
 * exactly what an installer needs: somewhere to report progress, a cancellation
 * token, and a way to write a step message.
 */

import { cancelledError } from '../errors'
import type { CancelFlag, ProgressUpdate } from '../download'
import type { ProgressReporter } from '../progress'
import type { ComponentId, DownloadStage } from '../types'

export interface InstallContext {
  reporter: ProgressReporter
  cancel?: CancelFlag
  /** Update the task's current step line. */
  step: (text: string) => void
  /** Structured log line. Kept separate so tests can capture it. */
  log: (level: 'info' | 'warn' | 'error', message: string) => void
  /**
   * npm registry to use instead of the default mirror.
   *
   * Set by the Claude Code installer after reading the user's configured value,
   * so a user who already points npm at a mirror keeps it. Passed as an
   * environment variable to the npm child process, never written to global config.
   */
  registryOverride?: string
}

export function report(ctx: InstallContext, update: ProgressUpdate): void {
  ctx.reporter.report(update)
}

export function stage(
  ctx: InstallContext,
  component: ComponentId,
  stageName: DownloadStage,
  label: string,
): void {
  ctx.reporter.stage(component, stageName, label)
  ctx.step(label)
}

export function throwIfCancelled(ctx: InstallContext): void {
  if (ctx.cancel?.cancelled) throw cancelledError()
}

/**
 * The pipeline's stage names, in the order the Rust build's header lists them.
 *
 * Exported so the UI can render a stable checklist rather than inferring stages
 * from whatever text the current step happens to carry.
 */
export const INSTALL_STAGES = [
  'detect',
  'select-source',
  'cache',
  'download',
  'verify',
  'extract',
  'verify-binary',
  'path',
] as const

export type InstallStage = (typeof INSTALL_STAGES)[number]
