/**
 * Archive cache with sidecar verification markers.
 *
 * Ported from the `CacheState` / `CacheMarker` block in `installer.rs`.
 *
 * Cache policy, cheapest check first:
 *   1. `.verified.json` marker matches size+mtime -> bytes are known-good, skip
 *      both the download AND the re-hash.
 *   2. Otherwise re-hash the archive; if it fails, drop it and re-download.
 *
 * The marker records the digest the archive was verified against. It is a
 * performance cache, not a trust anchor: the digest was checked against a pinned
 * value when the marker was written, and any change to size or mtime
 * invalidates it.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'

import { CACHE_DIR, cacheMarkerPath } from './components'
import { AppError, codes } from './errors'
import { type CacheMarker, isCacheMarker, markerMatches } from './pure'

export type CacheState = 'missing' | 'verified-by-marker' | 'verified-by-hash'

export interface ArchiveStamp {
  size: number
  mtimeMs: number
}

export function ensureCacheDir(): void {
  mkdirSync(CACHE_DIR, { recursive: true })
}

/** Size and mtime of a file, or null when it is absent or unreadable. */
export function archiveStamp(path: string): ArchiveStamp | null {
  try {
    const st = statSync(path)
    return { size: st.size, mtimeMs: Math.floor(st.mtimeMs) }
  } catch {
    return null
  }
}

export function writeMarker(archivePath: string, sha256: string): void {
  const stamp = archiveStamp(archivePath)
  if (!stamp) return
  const marker: CacheMarker = { sha256, size: stamp.size, mtimeMs: stamp.mtimeMs }
  try {
    mkdirSync(dirname(cacheMarkerPath(archivePath)), { recursive: true })
    writeFileSync(cacheMarkerPath(archivePath), JSON.stringify(marker, null, 2), 'utf-8')
  } catch {
    // A missing marker only costs a re-hash next time.
  }
}

export function readMarker(archivePath: string): CacheMarker | null {
  const path = cacheMarkerPath(archivePath)
  try {
    if (!existsSync(path)) return null
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    return isCacheMarker(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Whether the cached archive is already known-good.
 *
 * Size and mtime must both still match what the marker recorded. A truncated or
 * hand-edited marker fails `isCacheMarker` and falls through to a re-hash.
 */
export function cacheMarkerValid(archivePath: string): boolean {
  return markerMatches(readMarker(archivePath), archiveStamp(archivePath))
}

/**
 * Drop the archive and its marker together so they can never disagree.
 *
 * Removing only one of the two is how a stale digest gets paired with fresh
 * bytes, which is worse than no cache at all.
 */
export function invalidateCache(archivePath: string): void {
  for (const path of [archivePath, cacheMarkerPath(archivePath)]) {
    try {
      if (existsSync(path)) unlinkSync(path)
    } catch {
      // Best effort.
    }
  }
}

/**
 * Atomically move a verified `.part` file into its final cache path.
 *
 * `rename` within one filesystem is atomic, so a reader never observes a
 * half-written archive at the destination. On failure the partial file is
 * removed rather than left behind to be mistaken for a cache hit.
 */
export function promotePart(partPath: string, destPath: string): void {
  try {
    mkdirSync(dirname(destPath), { recursive: true })
    renameSync(partPath, destPath)
  } catch (e) {
    try {
      if (existsSync(partPath)) unlinkSync(partPath)
    } catch {
      // Best effort.
    }
    throw new AppError({
      code: codes.DOWNLOAD_FAILED,
      title: '缓存写入失败',
      message: '无法把下载文件移动到缓存目录。',
      details: e instanceof Error ? e.message : String(e),
    })
  }
}

export interface CacheDecision {
  state: CacheState
  archivePath: string
}

/**
 * Decide whether the cached archive can be reused.
 *
 * `verify` is injected so this function stays testable and so the caller owns the
 * digest source (pinned constant, or pinned cross-checked against a mirror).
 */
export function inspectCache(
  archivePath: string,
  verify: (path: string) => { ok: boolean; actual: string },
): CacheDecision {
  if (!existsSync(archivePath)) return { state: 'missing', archivePath }

  if (cacheMarkerValid(archivePath)) {
    return { state: 'verified-by-marker', archivePath }
  }

  const result = verify(archivePath)
  if (result.ok) {
    writeMarker(archivePath, result.actual)
    return { state: 'verified-by-hash', archivePath }
  }

  invalidateCache(archivePath)
  return { state: 'missing', archivePath }
}
