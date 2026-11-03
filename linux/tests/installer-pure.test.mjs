/**
 * Unit tests for the install pipeline's decision logic.
 *
 * These import the real `pure.ts` rather than a reimplementation, so the tests
 * cannot silently drift from the shipped code. Node 24 loads TypeScript directly,
 * which is why no build step is needed here.
 *
 * Scope is deliberate: only functions that are pure by construction are covered.
 * Timing a real HTTP race in a unit test is inherently flaky — a CI runner has
 * been observed to time out on a mirror that answers instantly elsewhere — which
 * is exactly why the network layer and the decision layer are separate modules.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  backoffMs,
  digestsMatch,
  isCacheMarker,
  isResumableStatus,
  markerMatches,
  mergePathEntries,
  normalizePathEntry,
  parseShasums,
  parseVersion,
  percentOf,
  pickFastest,
  rcFileMentions,
  shouldEmitProgress,
  shouldRetryStatus,
  splitPathValue,
} from '../src/main/installer/pure.ts'

/**
 * @typedef {{ id: string, url: string }} Candidate
 * @typedef {{ id: string, url: string, latencyMs: number | null }} Probe
 */

// ---------------------------------------------------------------------------
// Mirror selection
// ---------------------------------------------------------------------------

describe('pickFastest', () => {
  /** @type {Candidate[]} */
  const candidates = [
    { id: 'official', url: 'https://nodejs.org/dist/x.tar.xz' },
    { id: 'npmmirror', url: 'https://npmmirror.com/mirrors/node/x.tar.xz' },
    { id: 'huawei', url: 'https://mirrors.huaweicloud.com/nodejs/x.tar.xz' },
  ]

  /**
   * @param {string} id
   * @param {number | null} latencyMs
   * @returns {Probe}
   */
  const probe = (id, latencyMs) => ({
    id,
    url: candidates.find((c) => c.id === id)?.url ?? '',
    latencyMs,
  })

  test('picks the lowest latency', () => {
    const winner = pickFastest(candidates, [probe('official', 900), probe('npmmirror', 120), probe('huawei', 400)])
    assert.equal(winner.id, 'npmmirror')
  })

  test('ignores unreachable mirrors even when they are first', () => {
    const winner = pickFastest(candidates, [probe('official', null), probe('npmmirror', null), probe('huawei', 700)])
    assert.equal(winner.id, 'huawei')
  })

  test('returns the first candidate when nothing answered', () => {
    const winner = pickFastest(candidates, [probe('official', null), probe('npmmirror', null), probe('huawei', null)])
    // Not "whichever probe finished first" — the caller's ordering is preserved
    // so the subsequent download surfaces a real error from a known URL.
    assert.equal(winner.id, 'official')
    assert.equal(winner.url, candidates[0].url)
  })

  test('keeps the first candidate on a tie', () => {
    const winner = pickFastest(candidates, [probe('official', 200), probe('npmmirror', 200), probe('huawei', 500)])
    assert.equal(winner.id, 'official')
  })

  test('handles an empty candidate list without throwing', () => {
    const winner = pickFastest([], [])
    assert.deepEqual(winner, { id: '', url: '' })
  })

  test('handles probes for only a subset of candidates', () => {
    const winner = pickFastest(candidates, [probe('huawei', 300)])
    assert.equal(winner.id, 'huawei')
  })

  test('returns a url, not an id (regression)', () => {
    // The Rust build records this exact bug in a comment: returning the tuple
    // as-is silently handed the id back as the URL.
    const winner = pickFastest(candidates, [probe('huawei', 300)])
    assert.ok(winner.url.startsWith('https://'), `expected a URL, got ${winner.url}`)
  })
})

// ---------------------------------------------------------------------------
// HTTP decision points
// ---------------------------------------------------------------------------

describe('shouldRetryStatus', () => {
  test('retries transient failures', () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      assert.equal(shouldRetryStatus(status), true, `expected ${status} to be retryable`)
    }
  })

  test('does not retry a hard client error', () => {
    for (const status of [400, 401, 403, 404, 410]) {
      assert.equal(shouldRetryStatus(status), false, `expected ${status} not to be retryable`)
    }
  })

  test('treats 416 as a resume condition, not a failure to retry', () => {
    // 416 means our .part is already as large as the file.
    assert.equal(shouldRetryStatus(416), false)
  })
})

describe('isResumableStatus', () => {
  test('only 206 means the server honoured the Range request', () => {
    assert.equal(isResumableStatus(206), true)
    // 200 means the server ignored Range and is resending from zero, so the
    // partial bytes must be discarded.
    assert.equal(isResumableStatus(200), false)
    assert.equal(isResumableStatus(416), false)
  })
})

describe('backoffMs', () => {
  test('grows linearly and caps at the third attempt', () => {
    assert.equal(backoffMs(1), 400)
    assert.equal(backoffMs(2), 800)
    assert.equal(backoffMs(3), 1200)
    assert.equal(backoffMs(9), 1200)
  })
})

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

describe('percentOf', () => {
  test('computes a plain percentage', () => {
    assert.equal(percentOf(50, 100), 50)
  })

  test('reports 0 when the length is unknown', () => {
    // A chunked response has no Content-Length; there is nothing honest to show.
    assert.equal(percentOf(1234, 0), 0)
  })

  test('clamps above 100 when the server over-delivers', () => {
    assert.equal(percentOf(120, 100), 100)
  })
})

describe('shouldEmitProgress', () => {
  test('throttles mid-transfer updates', () => {
    assert.equal(shouldEmitProgress(10, 1000, 50, 150), false)
    assert.equal(shouldEmitProgress(10, 1000, 150, 150), true)
  })

  test('always lets the final chunk through', () => {
    // Otherwise a throttled tail leaves the bar stuck below 100%.
    assert.equal(shouldEmitProgress(1000, 1000, 1, 150), true)
  })

  test('does not mistake an unknown total for completion', () => {
    assert.equal(shouldEmitProgress(1000, 0, 1, 150), false)
  })
})

// ---------------------------------------------------------------------------
// Digest lists
// ---------------------------------------------------------------------------

describe('parseShasums', () => {
  const sample = [
    '69b09dba5c8dcb05c4e4273a4340db1005abeafe3927efda2bc5b249e80437ec  node-v22.14.0-linux-x64.tar.xz',
    '08bfbf538bad0e8cbb0269f0173cca28d705874a67a22f60b57d99dc99e30050 *node-v22.14.0-linux-arm64.tar.xz',
    '',
    '# a comment',
    'not-a-digest  some-file.txt',
  ].join('\n')

  test('parses both plain and binary-mode lines', () => {
    const parsed = parseShasums(sample)
    assert.equal(
      parsed['node-v22.14.0-linux-x64.tar.xz'],
      '69b09dba5c8dcb05c4e4273a4340db1005abeafe3927efda2bc5b249e80437ec',
    )
    // The leading `*` marks binary mode and is not part of the filename.
    assert.equal(
      parsed['node-v22.14.0-linux-arm64.tar.xz'],
      '08bfbf538bad0e8cbb0269f0173cca28d705874a67a22f60b57d99dc99e30050',
    )
  })

  test('skips malformed lines instead of throwing', () => {
    const parsed = parseShasums(sample)
    assert.equal(Object.keys(parsed).length, 2)
    assert.equal(parsed['some-file.txt'], undefined)
  })

  test('tolerates CRLF line endings', () => {
    const parsed = parseShasums(`abc${'0'.repeat(61)}  file.txt\r\n`)
    assert.equal(parsed['file.txt'], `abc${'0'.repeat(61)}`)
  })
})

describe('digestsMatch', () => {
  test('is case-insensitive and trims', () => {
    assert.equal(digestsMatch('ABCDEF', 'abcdef'), true)
    assert.equal(digestsMatch(' abc ', 'abc'), true)
  })

  test('rejects a missing side', () => {
    assert.equal(digestsMatch(null, 'abc'), false)
    assert.equal(digestsMatch('abc', undefined), false)
  })
})

// ---------------------------------------------------------------------------
// Cache markers
// ---------------------------------------------------------------------------

describe('markerMatches', () => {
  const marker = { sha256: 'a'.repeat(64), size: 100, mtimeMs: 1000 }

  test('accepts an unchanged file', () => {
    assert.equal(markerMatches(marker, { size: 100, mtimeMs: 1000 }), true)
  })

  test('rejects a size change', () => {
    assert.equal(markerMatches(marker, { size: 101, mtimeMs: 1000 }), false)
  })

  test('rejects an mtime change even at the same size', () => {
    // Same size, different bytes — this is precisely why mtime is recorded too.
    assert.equal(markerMatches(marker, { size: 100, mtimeMs: 1001 }), false)
  })

  test('rejects a missing marker or stamp', () => {
    assert.equal(markerMatches(null, { size: 100, mtimeMs: 1000 }), false)
    assert.equal(markerMatches(marker, null), false)
  })
})

describe('isCacheMarker', () => {
  test('accepts a well-formed marker', () => {
    assert.equal(isCacheMarker({ sha256: 'f'.repeat(64), size: 1, mtimeMs: 2 }), true)
  })

  test('rejects a truncated JSON write', () => {
    assert.equal(isCacheMarker({ sha256: 'f'.repeat(64), size: 1 }), false)
  })

  test('rejects a short digest', () => {
    assert.equal(isCacheMarker({ sha256: 'abc', size: 1, mtimeMs: 2 }), false)
  })

  test('rejects non-objects', () => {
    assert.equal(isCacheMarker(null), false)
    assert.equal(isCacheMarker('marker'), false)
    assert.equal(isCacheMarker(42), false)
  })

  test('rejects non-finite numbers', () => {
    assert.equal(isCacheMarker({ sha256: 'f'.repeat(64), size: Number.NaN, mtimeMs: 2 }), false)
  })
})

// ---------------------------------------------------------------------------
// PATH handling
// ---------------------------------------------------------------------------

describe('normalizePathEntry', () => {
  test('trims and drops trailing slashes', () => {
    assert.equal(normalizePathEntry('  /usr/local/bin/  '), '/usr/local/bin')
    assert.equal(normalizePathEntry('/usr/local/bin///'), '/usr/local/bin')
  })

  test('preserves case, unlike the Windows implementation', () => {
    // Linux filesystems are case-sensitive, so these are different directories.
    assert.notEqual(normalizePathEntry('/opt/Node'), normalizePathEntry('/opt/node'))
  })
})

describe('mergePathEntries', () => {
  test('puts base first and reports overlay additions', () => {
    const { merged, added } = mergePathEntries(['/usr/bin', '/bin'], ['/home/u/.local/bin'])
    assert.deepEqual(merged, ['/usr/bin', '/bin', '/home/u/.local/bin'])
    assert.deepEqual(added, ['/home/u/.local/bin'])
  })

  test('deduplicates and does not report an existing entry as added', () => {
    const { merged, added } = mergePathEntries(['/usr/bin', '/bin'], ['/usr/bin'])
    assert.deepEqual(merged, ['/usr/bin', '/bin'])
    assert.deepEqual(added, [])
  })

  test('deduplicates within the overlay itself', () => {
    // The managed list has two entries and a repeat must not appear twice.
    const { merged, added } = mergePathEntries([], ['/a', '/a', '/b'])
    assert.deepEqual(merged, ['/a', '/b'])
    assert.deepEqual(added, ['/a', '/b'])
  })

  test('treats a trailing slash as the same directory', () => {
    const { merged, added } = mergePathEntries(['/usr/bin'], ['/usr/bin/'])
    assert.deepEqual(merged, ['/usr/bin'])
    assert.deepEqual(added, [])
  })

  test('skips empty entries', () => {
    const { merged } = mergePathEntries(['', '   ', '/usr/bin'], [''])
    assert.deepEqual(merged, ['/usr/bin'])
  })

  test('handles two empty lists', () => {
    const { merged, added } = mergePathEntries([], [])
    assert.deepEqual(merged, [])
    assert.deepEqual(added, [])
  })
})

describe('splitPathValue', () => {
  test('splits on colons and drops blanks', () => {
    assert.deepEqual(splitPathValue('/a:/b::/c'), ['/a', '/b', '/c'])
  })

  test('returns empty for an empty value', () => {
    assert.deepEqual(splitPathValue(''), [])
  })
})

describe('rcFileMentions', () => {
  test('recognizes a prepend export', () => {
    const content = 'export PATH="/home/u/.local/share/x/bin:$PATH"'
    assert.equal(rcFileMentions(content, '/home/u/.local/share/x/bin'), true)
  })

  test('recognizes a plain assignment', () => {
    assert.equal(rcFileMentions('PATH=/opt/tools:$PATH', '/opt/tools'), true)
  })

  test('ignores a mention that does not touch PATH', () => {
    // A comment or an unrelated variable must not suppress the append, or the
    // export would never be written.
    assert.equal(rcFileMentions('# see /opt/tools for details', '/opt/tools'), false)
  })

  test('ignores a different directory', () => {
    assert.equal(rcFileMentions('export PATH="/other/bin:$PATH"', '/opt/tools'), false)
  })

  test('returns false for an empty directory', () => {
    assert.equal(rcFileMentions('export PATH="/x:$PATH"', ''), false)
  })
})

// ---------------------------------------------------------------------------
// Version parsing
// ---------------------------------------------------------------------------

describe('parseVersion', () => {
  test('handles the three real output shapes', () => {
    assert.equal(parseVersion('v22.14.0'), '22.14.0') // node --version
    assert.equal(parseVersion('10.9.2'), '10.9.2') // npm --version
    assert.equal(parseVersion('git version 2.45.2'), '2.45.2') // git --version
  })

  test('handles surrounding whitespace and newlines', () => {
    assert.equal(parseVersion('  v22.14.0\n'), '22.14.0')
  })

  test('returns null when there is no version', () => {
    assert.equal(parseVersion('command not found'), null)
    assert.equal(parseVersion(''), null)
  })

  test('takes the first triple when several appear', () => {
    assert.equal(parseVersion('v1.2.3 (built with 4.5.6)'), '1.2.3')
  })
})
