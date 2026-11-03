/**
 * Archive extraction.
 *
 * The Windows build's `extract_zip` ranks three methods by measured throughput
 * and documents why: `Expand-Archive` was the single slowest step of a Node.js
 * install (7.7 s for 2,447 files) purely because it is a PowerShell module
 * cmdlet paying shell startup and streaming through the .NET archive API, while
 * `tar.exe` did the same work in 1.6 s.
 *
 * On Linux the ranking collapses to one obvious winner: `tar` is present on
 * every distribution, handles `.tar.xz` natively, validates the archive while
 * extracting, and preserves the Unix permission bits that a Windows port has to
 * synthesize. There is no second method worth maintaining, so this module has a
 * single path plus an explicit, diagnosable failure when `tar` or its xz support
 * is missing.
 */

import { accessSync, constants, existsSync, mkdirSync, readdirSync, rmdirSync, statSync } from 'fs'
import { join } from 'path'

import { AppError, codes } from './errors'
import { runCapture } from './env'

/** Extraction budget. 2,447 files from a 30 MB archive is seconds, not minutes. */
const EXTRACT_TIMEOUT_MS = 300_000

export interface ExtractResult {
  /** Directory that received the contents. */
  destination: string
  /** Top-level entries produced, for diagnostics when a probe later fails. */
  entries: string[]
}

/**
 * Extract a `.tar.xz` (or `.tar.gz`) archive, stripping the single top-level
 * directory that Node.js archives always carry.
 *
 * `--strip-components=1` is what lets the caller pick the destination name
 * instead of inheriting `node-v22.14.0-linux-x64`, so a version bump cannot leave
 * a stale sibling directory behind.
 */
export async function extractTarXz(archivePath: string, destination: string): Promise<ExtractResult> {
  if (!existsSync(archivePath)) {
    throw new AppError({
      code: codes.EXTRACT_FAILED,
      title: '解压失败',
      message: '待解压的归档文件不存在。',
      details: archivePath,
    })
  }

  try {
    mkdirSync(destination, { recursive: true })
  } catch (e) {
    throw new AppError({
      code: codes.EXTRACT_FAILED,
      title: '解压失败',
      message: `无法创建目标目录 ${destination}`,
      details: e instanceof Error ? e.message : String(e),
      suggestions: ['确认该目录可写，或检查磁盘剩余空间'],
    })
  }

  const result = await runCapture(
    'tar',
    ['-xJf', archivePath, '-C', destination, '--strip-components=1'],
    { timeoutMs: EXTRACT_TIMEOUT_MS },
  )

  if (result.timedOut) {
    throw new AppError({
      code: codes.EXTRACT_FAILED,
      title: '解压超时',
      message: `解压超过 ${EXTRACT_TIMEOUT_MS / 1000} 秒未完成。`,
      details: archivePath,
      retryable: true,
    })
  }

  if (result.code !== 0) {
    const stderr = result.stderr.trim()
    // `tar` reports a missing xz filter as a codec error, which is a very
    // different fix from a corrupt archive. Say which one it is.
    const xzMissing = /xz|lzma|compression|codec/i.test(stderr)
    throw new AppError({
      code: codes.EXTRACT_FAILED,
      title: '解压失败',
      message: xzMissing
        ? '系统 tar 不支持 xz 解压（缺少 xz-utils / liblzma）。'
        : '解压归档时出错。',
      details: stderr || `tar 退出码 ${result.code}`,
      suggestions: xzMissing
        ? ['安装 xz-utils：sudo apt install -y xz-utils', '然后重试安装']
        : ['删除缓存后重试：设置 → 清除下载缓存'],
    })
  }

  // GNU tar creates an empty directory for a top-level entry whose stripped name
  // is empty (the `node-v22.14.0-linux-x64/` member itself). It is harmless but
  // confusing — a stray look-alike directory next to the real `bin/` — so remove
  // it when it is genuinely empty.
  pruneEmptyDirs(destination)

  return { destination, entries: listEntries(destination) }
}

/**
 * Remove empty directories left behind by `--strip-components`.
 *
 * Only ever removes directories that are empty, and only at the top level of a
 * tree we just created, so there is nothing of the user's to lose.
 */
function pruneEmptyDirs(dir: string): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  for (const name of entries) {
    const full = join(dir, name)
    try {
      if (!statSync(full).isDirectory()) continue
      if (readdirSync(full).length === 0) rmdirSync(full)
    } catch {
      // Best effort; a leftover empty directory does not affect correctness.
    }
  }
}

/** First-level entries of a directory, for error messages that name what landed. */
export function listEntries(dir: string, limit = 10): string[] {
  try {
    return readdirSync(dir).slice(0, limit)
  } catch {
    return []
  }
}

/**
 * Whether a file inside an extracted tree is actually executable.
 *
 * Node.js tarballs ship `bin/node` with mode 0755 and `tar` preserves it, but a
 * cache written by a tool that lost the mode bits — or an extraction into a
 * filesystem mounted `noexec` — produces a tree that looks complete and cannot
 * run. Checking here turns "验证安装失败" into a named cause.
 */
export function isExecutable(path: string): boolean {
  try {
    const st = statSync(path)
    if (!st.isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Path of an extracted binary, plus whether it survived extraction intact. */
export function locateBinary(root: string, relative: string): { path: string; exists: boolean; executable: boolean } {
  const path = join(root, relative)
  return { path, exists: existsSync(path), executable: isExecutable(path) }
}
