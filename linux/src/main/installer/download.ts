/**
 * Resumable, cancellable, retrying downloader.
 *
 * Ported from `download_to_part` / `download_file` in `installer.rs`. The design
 * constraint carried over verbatim: this module knows nothing about Electron, so
 * the retry/resume logic is unit-testable. Progress is reported through a
 * callback that the caller adapts to IPC events.
 */

import { createWriteStream, existsSync, statSync, unlinkSync } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

import { AppError, codes } from './errors'
import { backoffMs, isResumableStatus, percentOf, shouldEmitProgress, shouldRetryStatus } from './pure'
import { PRIMARY_COMPONENT, type ComponentId, type DownloadStage } from './types'

/** How many times a single URL is attempted before giving up. */
export const DOWNLOAD_ATTEMPTS = 3

/** Per-request budget. Generous: a 30 MB archive on a slow link still fits. */
const REQUEST_TIMEOUT_MS = 300_000

/** Minimum gap between progress callbacks. */
export const PROGRESS_THROTTLE_MS = 150

export interface ProgressUpdate {
  component: ComponentId
  stage: DownloadStage
  percent: number
  speedBytesPerSec: number
  downloadedBytes: number
  totalBytes: number
  source: string
}

/** Cancellation token. `undefined` means "not cancellable". */
export type CancelFlag = { readonly cancelled: boolean }

export function makeCancelFlag(): { cancel(): void; flag: CancelFlag } {
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

const isCancelled = (flag?: CancelFlag): boolean => flag?.cancelled === true

const cancelledError = (): AppError =>
  new AppError({
    code: codes.CANCELLED,
    title: '操作已取消',
    message: '用户取消了下载。',
  })

export interface DownloadOptions {
  url: string
  /** Final destination. The transfer goes to `<dest>.part`. */
  dest: string
  component: ComponentId
  onProgress?: (update: ProgressUpdate) => void
  cancel?: CancelFlag
}

export interface DownloadResult {
  /** Path of the `.part` file holding the bytes. Caller verifies then promotes. */
  partPath: string
  bytes: number
}

/**
 * Stream `url` into `<dest>.part`, resuming and retrying as needed.
 *
 * The caller owns verification and promotion, so a bad payload never reaches
 * `dest` — same contract as the Rust version.
 */
export async function downloadToPart(opts: DownloadOptions): Promise<DownloadResult> {
  const { url, dest, component, onProgress, cancel } = opts
  const partPath = `${dest}.part`

  let lastError: AppError | null = null

  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    if (isCancelled(cancel)) {
      safeUnlink(partPath)
      throw cancelledError()
    }

    // Resume from whatever a previous attempt already wrote.
    const existing = fileSize(partPath)
    const startedAt = Date.now()
    let lastEmitAt = 0

    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          ...(existing > 0 ? { Range: `bytes=${existing}-` } : {}),
          'User-Agent': 'claude-code-manager',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'follow',
      })
    } catch (e) {
      lastError = new AppError({
        code: codes.NETWORK,
        title: '网络错误',
        message: '无法连接到下载服务器。',
        details: e instanceof Error ? e.message : String(e),
        retryable: true,
      })
      if (attempt < DOWNLOAD_ATTEMPTS && !isCancelled(cancel)) await delay(backoffMs(attempt))
      continue
    }

    // 206 means the server honoured the Range request; 200 means it ignored it
    // and is resending from zero, so the old partial bytes must go.
    const resuming = isResumableStatus(response.status)

    if (!response.ok) {
      lastError = new AppError({
        code: codes.DOWNLOAD_FAILED,
        title: '下载失败',
        message: `服务器返回 HTTP ${response.status}`,
        details: url,
        retryable: shouldRetryStatus(response.status),
      })
      // A 4xx other than 416 will not improve on retry.
      if (!shouldRetryStatus(response.status)) {
        safeUnlink(partPath)
        throw lastError
      }
      if (attempt < DOWNLOAD_ATTEMPTS && !isCancelled(cancel)) await delay(backoffMs(attempt))
      continue
    }

    if (response.body === null) {
      lastError = new AppError({
        code: codes.DOWNLOAD_FAILED,
        title: '下载失败',
        message: '服务器返回了空响应体。',
        details: url,
        retryable: true,
      })
      continue
    }

    // Fresh start: drop anything a previous attempt left behind.
    if (!resuming && existing > 0) safeUnlink(partPath)
    const startOffset = resuming && existing > 0 ? existing : 0

    const contentLength = Number(response.headers.get('content-length') ?? '0')
    const totalBytes = contentLength > 0 ? contentLength + startOffset : 0

    let downloaded = startOffset
    let interrupted: AppError | null = null

    // Wrap the body so cancellation is honoured mid-transfer: a 30 MB download
    // should not keep running after the user pressed 取消.
    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    const sink = createWriteStream(partPath, { flags: startOffset > 0 ? 'a' : 'w' })

    source.on('data', (chunk: Buffer) => {
      if (isCancelled(cancel)) {
        source.destroy(cancelledError())
        return
      }
      downloaded += chunk.length
      const now = Date.now()
      if (
        onProgress &&
        shouldEmitProgress(downloaded, totalBytes, now - lastEmitAt, PROGRESS_THROTTLE_MS)
      ) {
        lastEmitAt = now
        const elapsedSecs = (now - startedAt) / 1000
        onProgress({
          component,
          stage: 'downloading',
          percent: percentOf(downloaded, totalBytes),
          speedBytesPerSec: elapsedSecs > 0 ? downloaded / elapsedSecs : 0,
          downloadedBytes: downloaded,
          totalBytes,
          source: url,
        })
      }
    })

    try {
      await pipeline(source, sink)
    } catch (e) {
      if (e instanceof AppError && e.code === codes.CANCELLED) {
        safeUnlink(partPath)
        throw e
      }
      interrupted = new AppError({
        code: codes.DOWNLOAD_FAILED,
        title: '下载中断',
        message: '传输过程中连接中断。',
        details: e instanceof Error ? e.message : String(e),
        retryable: true,
      })
    }

    if (isCancelled(cancel)) {
      safeUnlink(partPath)
      throw cancelledError()
    }

    if (interrupted) {
      lastError = interrupted
      // Next attempt resumes from whatever landed on disk.
      if (attempt < DOWNLOAD_ATTEMPTS) await delay(backoffMs(attempt))
      continue
    }

    // A server that closed early without an error still leaves a short file.
    if (totalBytes > 0 && downloaded < totalBytes) {
      lastError = new AppError({
        code: codes.DOWNLOAD_FAILED,
        title: '下载不完整',
        message: `只收到 ${downloaded} / ${totalBytes} 字节。`,
        details: url,
        retryable: true,
      })
      if (attempt < DOWNLOAD_ATTEMPTS) await delay(backoffMs(attempt))
      continue
    }

    // Final callback so the bar reaches 100% even if throttling suppressed it.
    onProgress?.({
      component,
      stage: 'downloading',
      percent: percentOf(downloaded, totalBytes || downloaded),
      speedBytesPerSec: 0,
      downloadedBytes: downloaded,
      totalBytes: totalBytes || downloaded,
      source: url,
    })

    return { partPath, bytes: downloaded }
  }

  safeUnlink(partPath)
  throw (
    lastError ??
    new AppError({
      code: codes.DOWNLOAD_FAILED,
      title: '下载失败',
      message: '重试多次后仍未完成下载。',
      retryable: true,
    })
  )
}

function fileSize(path: string): number {
  try {
    return existsSync(path) ? statSync(path).size : 0
  } catch {
    return 0
  }
}

function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // Nothing useful to do; the next attempt overwrites it anyway.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Whether the downloader's own component tag marks this as the bar owner. */
export const isPrimaryComponent = (component: ComponentId): boolean =>
  component === PRIMARY_COMPONENT
