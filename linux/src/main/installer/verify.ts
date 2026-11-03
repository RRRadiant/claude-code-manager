/**
 * SHA256 verification.
 *
 * Ported from `sha256_file` / `verify_node_sha256` in `installer.rs`, minus the
 * Windows-specific pain. The Rust version needed two fallbacks (`certutil`, then
 * PowerShell `Get-FileHash`) and documents a real bug where `certutil`'s header
 * is written in the OEM code page, so a strict UTF-8 decode returned None on
 * every non-English Windows. Node's `crypto` has no such problem — one code path,
 * no external helper, nothing to be missing or blocked by policy.
 */

import { createHash } from 'crypto'
import { createReadStream, readFileSync } from 'fs'

import { AppError, codes } from './errors'
import { digestsMatch, parseShasums } from './pure'

/** Stream a file through SHA256 and return lowercase hex. */
export async function sha256File(path: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Synchronous SHA256 of a file.
 *
 * Exists for the cache-decision helper, which is a pure function by design and
 * therefore cannot await. A 30 MB archive hashes in well under a second, so the
 * blocking cost is not worth threading a promise through the decision logic.
 */
export function sha256FileSync(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Synchronous digest comparison, for the cache path. */
export function verifyFileSync(
  path: string,
  expected: string,
): { ok: boolean; actual: string; expected: string } {
  const actual = sha256FileSync(path)
  return { ok: digestsMatch(actual, expected), actual, expected }
}

export interface VerifyResult {
  ok: boolean
  /** What the file actually hashes to. */
  actual: string
  /** What it was expected to hash to. */
  expected: string
}

/**
 * Compare a file against a known digest.
 *
 * Returns a result rather than throwing so the caller can decide between
 * "re-download" (cache path) and "fail the install" (verified download path).
 */
export async function verifyFile(path: string, expected: string): Promise<VerifyResult> {
  const actual = await sha256File(path)
  return { ok: digestsMatch(actual, expected), actual, expected }
}

/**
 * Throw if a file does not match its expected digest.
 *
 * The error text names both digests. A mismatch that only says "校验失败" gives
 * the user nothing to report and gives us nothing to diagnose.
 */
export async function assertFileDigest(
  path: string,
  expected: string,
  filename: string,
): Promise<string> {
  const result = await verifyFile(path, expected)
  if (!result.ok) {
    throw new AppError({
      code: codes.VERIFY_FAILED,
      title: '文件校验失败',
      message: `${filename} 的 SHA256 与预期不符，已丢弃该文件。`,
      details: `期望 ${result.expected}\n实际 ${result.actual}`,
      suggestions: [
        '重试下载（通常是传输中断或镜像同步延迟）',
        '如果反复失败，请在设置中更换下载源',
      ],
      retryable: true,
    })
  }
  return result.actual
}

/**
 * Fetch a `SHASUMS256.txt` digest list from a mirror.
 *
 * Used as an *independent cross-check* on the pinned digest, not as the source
 * of truth. The Windows build states the reason the pinned value exists at all:
 * a checksum fetched at install time travels the same channel as the payload, so
 * anything able to swap the installer could swap the digest. Two sources
 * agreeing is stronger than either alone, and the pinned value holds the veto.
 */
export async function fetchShasums(url: string, timeoutMs = 15_000): Promise<Record<string, string>> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': 'claude-code-manager' },
  })
  if (!res.ok) {
    throw new AppError({
      code: codes.NETWORK,
      title: '无法获取校验文件',
      message: `获取 SHA256 清单失败：HTTP ${res.status}`,
      details: url,
      retryable: true,
    })
  }
  const text = await res.text()
  const parsed = parseShasums(text)
  if (Object.keys(parsed).length === 0) {
    throw new AppError({
      code: codes.VERIFY_FAILED,
      title: '校验文件无效',
      message: 'SHA256 清单中没有可解析的条目。',
      details: url,
    })
  }
  return parsed
}

/**
 * Cross-check the pinned digest against the mirror's published list.
 *
 * A mirror that publishes a *different* digest for the pinned filename is a
 * mirror serving different bytes, and the install is refused even before the
 * download starts. A mirror that publishes nothing for the filename is merely
 * unhelpful, so the pinned value alone is used and the caller is told.
 */
export function crossCheckPinned(
  pinned: string | undefined,
  published: Record<string, string>,
  filename: string,
): { digest: string | undefined; note: string | null } {
  if (!pinned) return { digest: undefined, note: null }
  const fromMirror = published[filename]
  if (!fromMirror) {
    return { digest: pinned, note: `镜像未发布 ${filename} 的摘要，仅使用内置钉死值` }
  }
  if (!digestsMatch(fromMirror, pinned)) {
    throw new AppError({
      code: codes.VERIFY_FAILED,
      title: '下载源与内置摘要不一致',
      message: `${filename} 在该镜像上的 SHA256 与内置钉死值不同，已拒绝下载。`,
      details: `内置 ${pinned}\n镜像 ${fromMirror}`,
      suggestions: [
        '这是一个信号，不是普通故障：该镜像可能同步到了不同版本，或已被篡改',
        '请在设置中更换下载源后重试',
      ],
    })
  }
  return { digest: pinned, note: '内置摘要与镜像发布值一致' }
}
