/**
 * Pure decision logic, deliberately free of IO.
 *
 * Ported from the unit-testable helpers in `installer.rs` and `env_refresh.rs`.
 * The Windows build makes the same split for the same reason it states in a
 * comment: timing a real HTTP race in a unit test is inherently flaky (CI runners
 * have been observed to time out on a mirror that answers instantly elsewhere),
 * so the *timing* lives in the network layer and the *decision* lives here.
 *
 * Nothing in this file may import `electron`, `fs`, or `http`.
 */

// ---------------------------------------------------------------------------
// Mirror selection
// ---------------------------------------------------------------------------

/** A mirror candidate: an id to report and the URL to fetch. */
export interface Candidate {
  id: string
  url: string
}

/** One probe outcome. `latencyMs` is null when the mirror never answered. */
export interface Probe {
  id: string
  url: string
  latencyMs: number | null
}

/**
 * Choose among probe results: fastest responder wins, else the caller's first
 * candidate is returned so the subsequent download surfaces a real error.
 *
 * Uses a single min-scan rather than a sort: `Array.prototype.sort` is not
 * guaranteed stable across engines for the all-equal case, and an all-`null`
 * input must come back in the caller's ordering, not in whichever order the
 * probes happened to finish.
 *
 * Returning the first candidate on total failure is deliberate. Silently picking
 * nothing would push the failure to a place with less context; picking the first
 * means the download fails with a real HTTP error the user can read.
 */
export function pickFastest(candidates: Candidate[], probes: Probe[]): Candidate {
  if (candidates.length === 0) {
    return { id: '', url: '' }
  }

  let best: Probe | null = null
  for (const probe of probes) {
    if (probe.latencyMs === null) continue
    if (best === null || probe.latencyMs < (best.latencyMs ?? Number.MAX_SAFE_INTEGER)) {
      best = probe
    }
  }

  if (best === null) {
    // Nothing answered — keep the caller's ordering rather than whichever probe
    // finished first.
    return candidates[0]
  }

  return { id: best.id, url: best.url }
}

// ---------------------------------------------------------------------------
// HTTP decision points
// ---------------------------------------------------------------------------

/**
 * Whether a status code is worth retrying.
 *
 * A 4xx other than 416 will not improve on retry — the request itself is wrong.
 * 416 (Range Not Satisfiable) is the exception: it means our `.part` is already
 * as large as the file, which is a resume condition to handle, not a failure.
 * 408/429 and every 5xx are transient.
 */
export function shouldRetryStatus(status: number): boolean {
  if (status === 416) return false
  if (status === 408 || status === 429) return true
  if (status >= 500) return true
  return false
}

/** Whether a response means "keep the bytes we already have". */
export function isResumableStatus(status: number): boolean {
  return status === 206
}

/**
 * Backoff before attempt N (1-based).
 *
 * Linear, not exponential: the retry loop already caps at three attempts, and a
 * mirror that is being rate-limited responds better to a short pause than to a
 * multi-second one. Jitter would help against synchronized retries from many
 * clients, which is not this app's shape.
 */
export function backoffMs(attempt: number): number {
  return Math.min(attempt, 3) * 400
}

// ---------------------------------------------------------------------------
// Progress math
// ---------------------------------------------------------------------------

/**
 * Percentage, guarding the unknown-length case.
 *
 * `totalBytes === 0` means the server sent no Content-Length (a chunked
 * response), so there is nothing honest to report; 0 is used rather than a
 * fake 100.
 */
export function percentOf(downloaded: number, total: number): number {
  if (total <= 0) return 0
  const pct = (downloaded / total) * 100
  return pct > 100 ? 100 : pct
}

/**
 * Whether a progress event may be emitted.
 *
 * A 30 MB archive arrives in ~300 chunks; emitting and re-rendering on each one
 * is pure overhead and the numbers are unreadable anyway. The final chunk is
 * always let through so the bar reaches 100%.
 */
export function shouldEmitProgress(
  downloaded: number,
  total: number,
  sinceLastEmitMs: number,
  throttleMs: number,
): boolean {
  const finished = total > 0 && downloaded >= total
  if (finished) return true
  return sinceLastEmitMs >= throttleMs
}

// ---------------------------------------------------------------------------
// Digest lists
// ---------------------------------------------------------------------------

/**
 * Parse a `SHASUMS256.txt`-style digest list into `filename -> lowercase hex`.
 *
 * Format is `<64 hex><whitespace><filename>`, optionally with a `*` binary-mode
 * marker before the name. Malformed lines are skipped rather than throwing: a
 * mirror that appends a signature block should not break verification of the
 * lines that are well-formed.
 */
export function parseShasums(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line)
    if (!match) continue
    const [, digest, name] = match
    out[name.trim()] = digest.toLowerCase()
  }
  return out
}

/** Case-insensitive, whitespace-tolerant digest comparison. */
export function digestsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

// ---------------------------------------------------------------------------
// Cache markers
// ---------------------------------------------------------------------------

export interface CacheMarker {
  sha256: string
  size: number
  mtimeMs: number
}

/**
 * Whether a sidecar marker still describes the file on disk.
 *
 * Size and mtime together are the cheapest sufficient check: a repeat install
 * can skip both the download and the re-hash. This is a performance cache, not a
 * security boundary — the archive was verified against a pinned digest when it
 * was written, and the marker is invalidated whenever either half disagrees.
 */
export function markerMatches(
  marker: CacheMarker | null,
  stamp: { size: number; mtimeMs: number } | null,
): boolean {
  if (!marker || !stamp) return false
  return marker.size === stamp.size && marker.mtimeMs === stamp.mtimeMs
}

/** Validate a parsed marker defensively — a truncated JSON write must not pass. */
export function isCacheMarker(value: unknown): value is CacheMarker {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.sha256 === 'string' &&
    v.sha256.length === 64 &&
    typeof v.size === 'number' &&
    Number.isFinite(v.size) &&
    typeof v.mtimeMs === 'number' &&
    Number.isFinite(v.mtimeMs)
  )
}

// ---------------------------------------------------------------------------
// PATH handling
// ---------------------------------------------------------------------------

/** Normalize one PATH entry for comparison: trim, drop trailing slash, keep case. */
export function normalizePathEntry(entry: string): string {
  return entry.trim().replace(/\/+$/, '')
}

/**
 * Merge PATH entry lists, deduplicating; first occurrence wins and order is
 * preserved.
 *
 * Returns the merged list plus the entries that were newly introduced by
 * `overlay`, which is what the UI reports as "this is what changed".
 *
 * Case is preserved on purpose. Windows lowercases for comparison because its
 * filesystem is case-insensitive; Linux is not, so two paths differing only in
 * case are genuinely different directories.
 */
export function mergePathEntries(
  base: string[],
  overlay: string[],
): { merged: string[]; added: string[] } {
  const seen = new Set<string>()
  const merged: string[] = []
  const added: string[] = []

  const push = (entry: string, trackAddition: boolean): void => {
    const normalized = normalizePathEntry(entry)
    if (normalized.length === 0) return
    if (seen.has(normalized)) return
    seen.add(normalized)
    merged.push(normalized)
    if (trackAddition) added.push(normalized)
  }

  for (const entry of base) push(entry, false)
  for (const entry of overlay) push(entry, true)

  return { merged, added }
}

/** Split a `:`-separated PATH value, dropping empty entries. */
export function splitPathValue(value: string): string[] {
  return value.split(':').filter((entry) => entry.trim().length > 0)
}

/**
 * Whether a shell rc file already exports the given directory.
 *
 * Matched loosely on the directory text so a hand-edited line with different
 * quoting is still recognized, which is what stops the installer appending the
 * same export on every run.
 */
export function rcFileMentions(content: string, dir: string): boolean {
  const needle = normalizePathEntry(dir)
  if (needle.length === 0) return false
  for (const line of content.split(/\r?\n/)) {
    if (!line.includes(needle)) continue
    // Only count lines that actually export or prepend a PATH.
    if (/\bPATH\b/.test(line) && /\bexport\b|PATH\s*=/.test(line)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Version parsing
// ---------------------------------------------------------------------------

/**
 * Pull a `x.y.z` version out of arbitrary command output.
 *
 * `node --version` prints `v22.14.0`; `npm --version` prints `10.9.2`;
 * `git --version` prints `git version 2.45.2`. One extractor handles all three
 * because the pipeline only ever needs the numeric triple.
 */
export function parseVersion(output: string): string | null {
  const match = /(\d+\.\d+\.\d+)/.exec(output)
  return match ? match[1] : null
}
