/**
 * Mirror selection: probe every candidate concurrently, pick the fastest.
 *
 * Ported from `benchmark_source` / `select_fastest_candidate` in `installer.rs`.
 *
 * Concurrency is the whole point. Probing sequentially accumulates one timeout
 * per unreachable mirror *before the download even starts*, which on a filtered
 * network is the difference between a 2.5-second decision and a 7.5-second one.
 * The decision itself lives in `pickFastest` in `./pure`, which is testable
 * without touching the network.
 */

import { AppError, codes } from './errors'
import { type Candidate, type Probe, pickFastest } from './pure'

/**
 * Probe timeout.
 *
 * 2.5s is enough to rank reachable mirrors; a longer budget only delays the whole
 * install when a mirror is blackholed rather than refusing the connection.
 */
const PROBE_TIMEOUT_MS = 2500

/**
 * HEAD a single URL and return its round-trip latency in ms, or null.
 *
 * HEAD is used rather than a ranged GET so the probe costs no payload. A mirror
 * that answers with a redirect still counts as reachable — some of them bounce
 * to a CDN, and that redirect is part of the real download path anyway.
 */
export async function benchmarkSource(url: string): Promise<number | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const started = Date.now()

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'claude-code-manager' },
    })
    // Drain anything the runtime attached so the socket can be reused.
    await res.arrayBuffer().catch(() => undefined)
    return res.ok || (res.status >= 300 && res.status < 400) ? Date.now() - started : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Race every candidate and return the fastest reachable one.
 *
 * Falls back to the caller's first candidate when nothing answered, so the
 * subsequent download surfaces a real error instead of failing earlier with a
 * less informative one.
 */
export async function selectFastestCandidate(candidates: Candidate[]): Promise<Candidate> {
  const probes: Probe[] = await Promise.all(
    candidates.map(async (candidate) => ({
      id: candidate.id,
      url: candidate.url,
      latencyMs: await benchmarkSource(candidate.url),
    })),
  )
  return pickFastest(candidates, probes)
}

/** Labels for the mirrors that lost the race, for the log line. */
export function describeRace(candidates: Candidate[], probes: Probe[]): string {
  return probes
    .map((p) => `${p.id}=${p.latencyMs === null ? 'unreachable' : `${p.latencyMs}ms`}`)
    .join(' ')
    .concat(candidates.length > probes.length ? ` (${candidates.length - probes.length} unprobed)` : '')
}

/** Guard for callers that must not proceed without a URL. */
export function requireCandidate(candidate: Candidate): Candidate {
  if (!candidate.url) {
    throw new AppError({
      code: codes.NETWORK,
      title: '无可用下载源',
      message: '所有下载源都不可达，请检查网络或代理设置。',
      suggestions: [
        '确认网络可以访问外网（公司网络可能需要配置代理）',
        '在设置中手动指定下载源后重试',
      ],
      retryable: true,
    })
  }
  return candidate
}
