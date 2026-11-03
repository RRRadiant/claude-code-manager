/**
 * Progress emission: stage events, throttled download events, owner tagging.
 *
 * Ported from `emit_download_progress` / `DownloadProgress` in `installer.rs`.
 *
 * Two decisions are carried over deliberately:
 *
 *   - The event carries a `component` tag. Node.js and Git download
 *     concurrently, so without an owner tag two progress streams would overwrite
 *     each other and the bar would jump backwards.
 *   - The backend computes `primary`, so the frontend does not have to hardcode
 *     which component gates completion. Node.js is primary because Claude Code's
 *     install blocks on npm, so Node.js is the step the user is actually waiting
 *     for; Git finishing first or last does not change that.
 */

import type { ProgressUpdate } from './download'
import { COMPONENT_LABEL, PRIMARY_COMPONENT, type ComponentId, type DownloadProgress, type DownloadStage } from './types'

export type ProgressSink = (event: DownloadProgress) => void

/**
 * The reporter an installer receives.
 *
 * `report` takes the raw updater from the downloader; `setSource` publishes which
 * mirror won the race; `stage` announces a named stage without inventing bytes.
 */
export interface ProgressReporter {
  report: (update: ProgressUpdate) => void
  setSource: (component: ComponentId, sourceId: string, url: string) => void
  stage: (component: ComponentId, stage: DownloadStage, label: string) => void
}

/** Build the renderer-facing payload from an internal update. */
export function toProgressEvent(update: ProgressUpdate, sourceId = ''): DownloadProgress {
  return {
    component: update.component,
    componentLabel: COMPONENT_LABEL[update.component],
    primary: update.component === PRIMARY_COMPONENT,
    stage: update.stage,
    percent: update.percent,
    speedBytesPerSec: update.speedBytesPerSec,
    downloadedBytes: update.downloadedBytes,
    totalBytes: update.totalBytes,
    source: update.source,
    sourceId,
  }
}

/**
 * Wrap a sink so a component can be told which mirror won the race.
 *
 * The selection happens after the sink is created, so the source id is threaded
 * through a mutable holder rather than requiring the sink to be rebuilt.
 */
export function createProgressReporter(sink: ProgressSink): ProgressReporter {
  const sourceIds = new Map<ComponentId, string>()

  return {
    report(update: ProgressUpdate): void {
      sink(toProgressEvent(update, sourceIds.get(update.component) ?? ''))
    },
    setSource(component: ComponentId, sourceId: string, url: string): void {
      sourceIds.set(component, sourceId)
      // A zero-progress event is the honest way to publish "we picked this
      // mirror" without inventing bytes.
      sink({
        component,
        componentLabel: COMPONENT_LABEL[component],
        primary: component === PRIMARY_COMPONENT,
        stage: 'benchmarking',
        percent: 0,
        speedBytesPerSec: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        source: url,
        sourceId,
      })
    },
    stage(component: ComponentId, stage: DownloadStage, label: string): void {
      sink({
        component,
        componentLabel: COMPONENT_LABEL[component],
        primary: component === PRIMARY_COMPONENT,
        stage,
        percent: 0,
        speedBytesPerSec: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        source: label,
        sourceId: sourceIds.get(component) ?? '',
      })
    },
  }
}

/** Human-readable byte size, e.g. "12.3 MB". Shared with the renderer's format. */
export function formatBytes(bytes: number): string {
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
export function formatDownloadLine(event: DownloadProgress): string {
  const parts = [
    `正在下载 ${event.componentLabel}`,
    `${event.percent.toFixed(0)}%`,
    `${formatBytes(event.speedBytesPerSec)}/s`,
  ]
  if (event.totalBytes > 0) {
    parts.push(`(${formatBytes(event.downloadedBytes)}/${formatBytes(event.totalBytes)})`)
  }
  return parts.join(' · ')
}
