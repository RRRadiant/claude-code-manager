/**
 * Shared types for the environment install pipeline.
 *
 * Ported from the Windows/Tauri build's `installer.rs` / `error.rs` shape so the
 * two projects describe the same pipeline in the same vocabulary:
 * per-component step results, an owner-tagged progress event, and a structured
 * error carrying user-facing text plus actionable suggestions.
 */

/** Which component a download or step belongs to. */
export type ComponentId = 'node' | 'git' | 'claude-code'

/** Human-facing component names. Kept identical to the Windows build. */
export const COMPONENT_LABEL: Record<ComponentId, string> = {
  node: 'Node.js',
  git: 'Git',
  'claude-code': 'Claude Code',
}

/**
 * The only component allowed to own the single-download progress bar.
 *
 * Claude Code's install blocks on npm, and npm comes from Node.js, so Node.js is
 * the step that actually gates completion. Tagging every event and letting the UI
 * pick this one keeps the bar monotonic while Node.js and Git download in
 * parallel.
 */
export const PRIMARY_COMPONENT: ComponentId = 'node'

/** Outcome of one component install. Mirrors `InstallStepResult` in Rust. */
export interface InstallStepResult {
  component: ComponentId
  success: boolean
  version: string | null
  message: string
}

export function stepOk(
  component: ComponentId,
  version: string | null,
  message: string,
): InstallStepResult {
  return { component, success: true, version, message }
}

export function stepFail(component: ComponentId, message: string): InstallStepResult {
  return { component, success: false, version: null, message }
}

/** Stage names a download can be in. */
export type DownloadStage = 'benchmarking' | 'downloading' | 'verifying' | 'extracting' | 'installing'

/**
 * Progress payload pushed to the renderer.
 *
 * `component` is required: Node.js and Git download concurrently, so without an
 * owner tag two progress streams would overwrite each other. `primary` is
 * computed in the backend so the frontend does not have to hardcode which
 * component gates completion.
 */
export interface DownloadProgress {
  component: ComponentId
  componentLabel: string
  primary: boolean
  stage: DownloadStage
  percent: number
  speedBytesPerSec: number
  downloadedBytes: number
  totalBytes: number
  /** The URL actually in use, after source selection. */
  source: string
  /** Mirror id that won the race, e.g. "huawei". */
  sourceId: string
}

/** Task lifecycle, matching the Rust `TaskStatus`. */
export type TaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

export interface TaskState {
  id: string
  type: string
  status: TaskStatus
  title: string
  /** Current step description, already sanitized. */
  step: string | null
  progress: number
  cancellable: boolean
  error: string | null
  startedAt: number | null
  finishedAt: number | null
}

/**
 * Structured error.
 *
 * `code` is stable and machine-readable; `suggestions` are the actionable lines
 * the UI shows under the message — the Rust build's `AppError` carried the same
 * four user-facing fields.
 */
export interface AppErrorShape {
  code: string
  title: string
  message: string
  details?: string
  suggestions?: string[]
  retryable?: boolean
}
