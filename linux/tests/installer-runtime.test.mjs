/**
 * Runtime smoke test for the parts of the pipeline that must work outside Electron.
 *
 * The engine's value depends on a claim that is easy to get wrong: the decision
 * logic and the cache layer must not import `electron`. If they did, none of this
 * would be unit-testable and the cache markers could not be exercised without
 * booting a BrowserWindow.
 *
 * This test touches the real filesystem, but only inside a temp directory, and it
 * asserts on the behaviours that matter:
 *
 *   - the engine modules load without Electron present
 *   - a `.part` file is promoted atomically and gets a matching sidecar marker
 *   - a marker is invalidated when the archive changes underneath it
 *   - the cache decision falls through to a re-hash when the marker is missing
 *   - a digest mismatch rejects the file
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

const payload = Buffer.from('claude-code-manager-pipeline-smoke-test-payload')
const payloadSha = createHash('sha256').update(payload).digest('hex')

let dir

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccm-installer-test-'))
})

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Best effort cleanup.
  }
})

describe('engine loads without Electron', () => {
  test('pure and cache modules import cleanly', async () => {
    // A failure here means a module picked up an `electron` import, which would
    // make it untestable and unusable outside the app.
    const pure = await import('../src/main/installer/pure.ts')
    const cache = await import('../src/main/installer/cache.ts')
    const components = await import('../src/main/installer/components.ts')
    const verify = await import('../src/main/installer/verify.ts')
    const source = await import('../src/main/installer/source.ts')
    const errors = await import('../src/main/installer/errors.ts')
    const progress = await import('../src/main/installer/progress.ts')
    const task = await import('../src/main/installer/task.ts')

    assert.equal(typeof pure.pickFastest, 'function')
    assert.equal(typeof cache.promotePart, 'function')
    assert.equal(typeof verify.assertFileDigest, 'function')
    assert.equal(typeof source.selectFastestCandidate, 'function')
    assert.equal(typeof errors.toAppError, 'function')
    assert.equal(typeof progress.createProgressReporter, 'function')
    assert.equal(typeof task.TaskManager, 'function')
    // The pinned digest is a build-time constant; if it ever goes missing the
    // verification path silently degrades to "trust the mirror".
    assert.equal(typeof components.NODE_SHA256['node-v22.14.0-linux-x64.tar.xz'], 'string')
  })
})

describe('download cache', () => {
  test('promotePart moves the .part into place atomically', async () => {
    const { promotePart } = await import('../src/main/installer/cache.ts')

    const part = join(dir, 'archive.tar.xz.part')
    const dest = join(dir, 'archive.tar.xz')
    writeFileSync(part, payload)

    promotePart(part, dest)

    assert.equal(existsSync(part), false, 'the .part file should be gone')
    assert.equal(existsSync(dest), true, 'the destination should exist')
    assert.equal(readFileSync(dest).equals(payload), true, 'bytes should be intact')
    assert.equal(createHash('sha256').update(readFileSync(dest)).digest('hex'), payloadSha)
  })

  test('a written marker validates, and stops validating when the archive changes', async () => {
    const { writeMarker, cacheMarkerValid, readMarker } = await import('../src/main/installer/cache.ts')

    const archive = join(dir, 'marked.tar.xz')
    writeFileSync(archive, payload)
    writeMarker(archive, payloadSha)

    const marker = readMarker(archive)
    assert.ok(marker, 'a marker should have been written')
    assert.equal(marker.sha256, payloadSha)
    assert.equal(cacheMarkerValid(archive), true)

    // Rewrite the file with different bytes of a different size. Size and mtime
    // together are what the marker guards on; either changing must invalidate it.
    writeFileSync(archive, Buffer.concat([payload, Buffer.from('tampered')]))
    assert.equal(cacheMarkerValid(archive), false, 'a changed size must invalidate the marker')
  })

  test('invalidateCache drops the archive and its marker together', async () => {
    const { writeMarker, invalidateCache } = await import('../src/main/installer/cache.ts')
    const { cacheMarkerPath } = await import('../src/main/installer/components.ts')

    const archive = join(dir, 'doomed.tar.xz')
    writeFileSync(archive, payload)
    writeMarker(archive, payloadSha)
    assert.equal(existsSync(cacheMarkerPath(archive)), true)

    invalidateCache(archive)

    assert.equal(existsSync(archive), false)
    assert.equal(
      existsSync(cacheMarkerPath(archive)),
      false,
      'leaving the marker behind would pair a stale digest with fresh bytes',
    )
  })

  test('inspectCache reports missing for an absent archive', async () => {
    const { inspectCache } = await import('../src/main/installer/cache.ts')
    const decision = inspectCache(join(dir, 'never-existed.tar.xz'), () => ({
      ok: false,
      actual: '',
    }))
    assert.equal(decision.state, 'missing')
  })

  test('inspectCache re-hashes and marks when the marker is absent', async () => {
    const { inspectCache, readMarker } = await import('../src/main/installer/cache.ts')

    const archive = join(dir, 'unmarked.tar.xz')
    writeFileSync(archive, payload)

    const decision = inspectCache(archive, (path) => {
      const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
      return { ok: actual === payloadSha, actual }
    })

    assert.equal(decision.state, 'verified-by-hash')
    assert.equal(readMarker(archive)?.sha256, payloadSha, 'the marker should now exist')
  })

  test('inspectCache discards an archive whose digest no longer matches', async () => {
    const { inspectCache } = await import('../src/main/installer/cache.ts')

    const archive = join(dir, 'corrupt.tar.xz')
    writeFileSync(archive, payload)

    const decision = inspectCache(archive, () => ({ ok: false, actual: 'deadbeef' }))

    assert.equal(decision.state, 'missing')
    assert.equal(existsSync(archive), false, 'an unverified archive must not be kept')
  })

  test('inspectCache trusts a valid marker without re-hashing', async () => {
    const { writeMarker, inspectCache } = await import('../src/main/installer/cache.ts')

    const archive = join(dir, 'trusted.tar.xz')
    writeFileSync(archive, payload)
    writeMarker(archive, payloadSha)

    let verifyCalls = 0
    const decision = inspectCache(archive, () => {
      verifyCalls += 1
      return { ok: true, actual: payloadSha }
    })

    assert.equal(decision.state, 'verified-by-marker')
    assert.equal(verifyCalls, 0, 'a valid marker must skip the hash entirely')
  })
})

describe('digest verification', () => {
  test('assertFileDigest accepts a matching file', async () => {
    const { assertFileDigest } = await import('../src/main/installer/verify.ts')
    const file = join(dir, 'good.bin')
    writeFileSync(file, payload)
    const digest = await assertFileDigest(file, payloadSha, 'good.bin')
    assert.equal(digest, payloadSha)
  })

  test('assertFileDigest rejects a mismatch with both digests in the detail', async () => {
    const { assertFileDigest } = await import('../src/main/installer/verify.ts')
    const file = join(dir, 'bad.bin')
    writeFileSync(file, payload)

    await assert.rejects(
      () => assertFileDigest(file, 'a'.repeat(64), 'bad.bin'),
      (err) => {
        assert.equal(err.code, 'INSTALL_VERIFY_FAILED')
        assert.equal(err.retryable, true)
        // Both digests must be present, or a user report carries no information.
        assert.ok(err.details.includes(payloadSha), 'actual digest missing from details')
        assert.ok(err.details.includes('a'.repeat(64)), 'expected digest missing from details')
        return true
      },
    )
  })
})

describe('source selection against a dead endpoint', () => {
  test('falls back to the first candidate when nothing answers', async () => {
    const { selectFastestCandidate } = await import('../src/main/installer/source.ts')

    // Port 1 on localhost refuses instantly, so this exercises the total-failure
    // path without depending on the network.
    const candidates = [
      { id: 'first', url: 'http://127.0.0.1:1/a' },
      { id: 'second', url: 'http://127.0.0.1:1/b' },
    ]

    const winner = await selectFastestCandidate(candidates)
    assert.equal(winner.id, 'first', 'ordering must be preserved when nothing responds')
  })

  test('requireCandidate refuses an empty selection', async () => {
    const { requireCandidate } = await import('../src/main/installer/source.ts')
    assert.throws(
      () => requireCandidate({ id: '', url: '' }),
      (err) => {
        assert.equal(err.code, 'INSTALL_NETWORK_ERROR')
        assert.ok(Array.isArray(err.suggestions) && err.suggestions.length > 0)
        return true
      },
    )
  })
})

describe('task manager', () => {
  test('drives a task through to success and reports it', async () => {
    const { TaskManager } = await import('../src/main/installer/task.ts')

    const events = []
    const tasks = new TaskManager((state) => events.push(state))

    const id = tasks.create('install_full_environment', '安装完整环境', true)
    assert.equal(tasks.get(id)?.status, 'queued')

    tasks.start(id)
    tasks.updateProgress(id, 42, '下载 Node.js...')
    tasks.succeed(id, '完成')

    const final = tasks.get(id)
    assert.equal(final.status, 'success')
    assert.equal(final.progress, 100)
    assert.ok(final.finishedAt !== null)
    assert.ok(events.length >= 4, 'every state change should be pushed')
  })

  test('sanitizes secrets out of step lines and errors', async () => {
    const { TaskManager } = await import('../src/main/installer/task.ts')
    const tasks = new TaskManager()

    const id = tasks.create('install_claude_code', 'install', true)
    tasks.start(id)
    tasks.updateProgress(id, 10, 'using ANTHROPIC_AUTH_TOKEN=sk-ant-api03-REALSECRETVALUE123456')

    const step = tasks.get(id)?.step ?? ''
    assert.equal(step.includes('REALSECRETVALUE'), false, 'a token must not reach the UI')
    assert.ok(step.includes('[REDACTED'), 'the placeholder should be present')
  })

  test('cancellation flips the shared flag', async () => {
    const { TaskManager } = await import('../src/main/installer/task.ts')
    const tasks = new TaskManager()

    const id = tasks.create('install_full_environment', 'install', true)
    tasks.start(id)

    const flag = tasks.cancelFlag(id)
    assert.equal(flag.cancelled, false)

    assert.equal(tasks.requestCancel(id), true)
    assert.equal(flag.cancelled, true, 'the running work shares the same token')

    tasks.markCancelled(id)
    assert.equal(tasks.get(id)?.status, 'cancelled')
  })

  test('refuses to cancel a finished task', async () => {
    const { TaskManager } = await import('../src/main/installer/task.ts')
    const tasks = new TaskManager()
    const id = tasks.create('install_full_environment', 'install', true)
    tasks.start(id)
    tasks.succeed(id)
    assert.equal(tasks.requestCancel(id), false)
  })
})

describe('filesystem layout', () => {
  test('managed bin dirs sit directly under the runtime root', async () => {
    const c = await import('../src/main/installer/components.ts')

    // Regression: extraction runs with `--strip-components=1`, so the tarball's
    // top-level directory is removed. An earlier revision re-appended
    // NODE_TARBALL_ROOT when building the bin path, which produced a runtime that
    // installed "successfully" on a real machine and could not be found.
    assert.equal(
      c.nodeBinDir(),
      join(c.nodeRuntimeRoot(), 'bin'),
      'nodeBinDir must not re-append the tarball root',
    )
    assert.equal(
      c.nodeBinDir().includes(c.NODE_TARBALL_ROOT),
      false,
      `nodeBinDir must not contain ${c.NODE_TARBALL_ROOT}`,
    )
  })

  test('every managed bin dir is absolute and unique', async () => {
    const c = await import('../src/main/installer/components.ts')
    const dirs = c.managedBinDirs()

    assert.ok(dirs.length >= 2, 'npm bin and node bin should both be managed')
    assert.equal(new Set(dirs).size, dirs.length, 'managed dirs must be distinct')
    for (const dir of dirs) {
      // `isAbsolute`, not `startsWith('/')`: these tests also run on the
      // development workstation, where an absolute path starts with a drive
      // letter. The app targets Linux but the suite must not be platform-bound.
      assert.ok(isAbsolute(dir), `expected an absolute path, got ${dir}`)
    }
  })

  test('the npm global prefix is the parent of the npm bin dir', async () => {
    const c = await import('../src/main/installer/components.ts')
    // `npm install -g --prefix <dir>` puts the shim in `<dir>/bin`. If these two
    // ever disagree, the `claude` shim lands somewhere PATH does not cover.
    assert.equal(c.npmBinDir(), join(c.npmPrefixDir(), 'bin'))
  })

  test('the pinned archive name matches the pinned version and arch', async () => {
    const c = await import('../src/main/installer/components.ts')
    assert.equal(c.nodeArchiveName(), `node-${c.NODE_VERSION}-linux-${c.nodeArch()}.tar.xz`)
    assert.equal(
      c.NODE_TARBALL_ROOT,
      `node-${c.NODE_VERSION}-linux-${c.nodeArch()}`,
      'the tarball root must correspond to the archive name',
    )
  })

  test('a pinned digest exists for the archive this platform will download', async () => {
    const c = await import('../src/main/installer/components.ts')
    const digest = c.NODE_SHA256[c.nodeArchiveName()]
    // A missing digest silently degrades verification to "trust the mirror".
    assert.equal(typeof digest, 'string', `no pinned digest for ${c.nodeArchiveName()}`)
    assert.match(digest, /^[0-9a-f]{64}$/)
  })
})

describe('shell rc management', () => {
  const tmpRc = () => join(dir, `bashrc-${Math.random().toString(36).slice(2)}`)

  // Mirrors RC_BLOCK_BEGIN, so a test can assert on the marker without importing
  // the module at describe-evaluation time.
  const RC_BEGIN = '# >>> claude-code-manager >>>'

  test('appends the managed block once and reports it', async () => {
    const { addToShellRc, RC_BLOCK_BEGIN, RC_BLOCK_END } = await import('../src/main/installer/env.ts')

    const file = tmpRc()
    writeFileSync(file, '# my bashrc\nexport EDITOR=vim\n')

    const first = addToShellRc(['/a/bin', '/b/bin'], [file])
    assert.deepEqual(first.updated, [file])

    const content = readFileSync(file, 'utf-8')
    assert.ok(content.includes(RC_BLOCK_BEGIN))
    assert.ok(content.includes(RC_BLOCK_END))
    assert.ok(content.includes('export PATH="/a/bin:/b/bin:$PATH"'))
    // The user's own line must survive.
    assert.ok(content.includes('export EDITOR=vim'))
  })

  test('a second identical call is a no-op', async () => {
    const { addToShellRc } = await import('../src/main/installer/env.ts')

    const file = tmpRc()
    writeFileSync(file, '\n')
    addToShellRc(['/a/bin', '/b/bin'], [file])
    const afterFirst = readFileSync(file, 'utf-8')

    const second = addToShellRc(['/a/bin', '/b/bin'], [file])

    assert.deepEqual(second.alreadyPresent, [file], 'an unchanged block must not be rewritten')
    assert.equal(readFileSync(file, 'utf-8'), afterFirst, 'the file must be byte-identical')
  })

  test('a stale block is replaced in place, not duplicated (regression)', async () => {
    const { addToShellRc, RC_BLOCK_BEGIN } = await import('../src/main/installer/env.ts')

    // Exactly what an earlier build left on the test VM: a block exporting a
    // directory that does not exist, alongside the correct npm directory. The
    // old append-if-absent check saw the npm directory, decided the file was
    // fine, and appended a second block next to the broken one.
    const file = tmpRc()
    writeFileSync(
      file,
      [
        '# my bashrc',
        RC_BLOCK_BEGIN,
        'export PATH="/good/npm/bin:/bad/node-v22.14.0-linux-x64/bin:$PATH"',
        '# <<< claude-code-manager <<<',
        '',
      ].join('\n'),
    )

    const result = addToShellRc(['/good/npm/bin', '/good/node/bin'], [file])

    assert.deepEqual(result.updated, [file])
    const content = readFileSync(file, 'utf-8')
    const occurrences = content.split(RC_BLOCK_BEGIN).length - 1
    assert.equal(occurrences, 1, 'there must be exactly one managed block')
    assert.equal(content.includes('/bad/node-v22.14.0-linux-x64/bin'), false, 'the stale path must be gone')
    assert.ok(content.includes('export PATH="/good/npm/bin:/good/node/bin:$PATH"'))
  })

  test('duplicate blocks are all collapsed into one (regression)', async () => {
    const { addToShellRc, RC_BLOCK_BEGIN, RC_BLOCK_END } = await import('../src/main/installer/env.ts')

    // The state the test VM actually reached: three blocks, two of them stale,
    // because an earlier build appended on every run. `String.replace` with a
    // string pattern only rewrites the first match, so a naive fix left the rest.
    const stale = `${RC_BLOCK_BEGIN}\nexport PATH="/bad/bin:$PATH"\n${RC_BLOCK_END}`
    const file = tmpRc()
    writeFileSync(file, ['# my bashrc', stale, stale, stale, 'export EDITOR=vim', ''].join('\n'))

    const result = addToShellRc(['/good/npm/bin', '/good/node/bin'], [file])

    assert.deepEqual(result.updated, [file])
    assert.deepEqual(result.consolidated, [file], 'the collapse must be reported')
    const content = readFileSync(file, 'utf-8')
    assert.equal(content.split(RC_BLOCK_BEGIN).length - 1, 1, 'exactly one block must remain')
    assert.equal(content.includes('/bad/bin'), false)
    assert.ok(content.includes('export PATH="/good/npm/bin:/good/node/bin:$PATH"'))
    assert.ok(content.includes('export EDITOR=vim'), 'the user line must survive')
  })

  test('a hand-written export is respected rather than duplicated', async () => {
    const { addToShellRc, RC_BLOCK_BEGIN } = await import('../src/main/installer/env.ts')

    const file = tmpRc()
    writeFileSync(file, 'export PATH="/a/bin:/b/bin:$PATH"\n')

    const result = addToShellRc(['/a/bin', '/b/bin'], [file])

    assert.deepEqual(result.alreadyPresent, [file])
    assert.equal(readFileSync(file, 'utf-8').includes(RC_BLOCK_BEGIN), false)
  })

  test('removeFromShellRc strips only the managed block', async () => {
    const { addToShellRc, removeFromShellRc } = await import('../src/main/installer/env.ts')

    const file = tmpRc()
    writeFileSync(file, '# keep me\nexport EDITOR=vim\n')
    addToShellRc(['/a/bin'], [file])
    const withBlock = readFileSync(file, 'utf-8')
    assert.ok(withBlock.includes(RC_BEGIN))

    const cleaned = removeFromShellRc([file])

    assert.deepEqual(cleaned, [file])
    const after = readFileSync(file, 'utf-8')
    assert.equal(after.includes(RC_BEGIN), false, 'the block must be gone')
    assert.equal(after.includes('export PATH='), false)
    // Everything the user wrote must survive.
    assert.ok(after.includes('# keep me'))
    assert.ok(after.includes('export EDITOR=vim'))
  })

  test('removeFromShellRc is a no-op on a file with no block', async () => {
    const { removeFromShellRc } = await import('../src/main/installer/env.ts')

    const file = tmpRc()
    writeFileSync(file, '# untouched\nexport EDITOR=vim\n')
    const before = readFileSync(file, 'utf-8')

    const cleaned = removeFromShellRc([file])

    assert.deepEqual(cleaned, [])
    assert.equal(readFileSync(file, 'utf-8'), before)
  })
})

describe('progress reporting', () => {
  test('tags the primary component and publishes the winning mirror', async () => {
    const { createProgressReporter } = await import('../src/main/installer/progress.ts')

    const events = []
    const reporter = createProgressReporter((e) => events.push(e))

    reporter.setSource('node', 'huawei', 'https://mirrors.huaweicloud.com/nodejs/x.tar.xz')
    reporter.report({
      component: 'git',
      stage: 'downloading',
      percent: 50,
      speedBytesPerSec: 1024,
      downloadedBytes: 50,
      totalBytes: 100,
      source: 'https://example.invalid/git.exe',
    })

    assert.equal(events.length, 2)
    // Node.js owns the bar because Claude Code's install blocks on npm.
    assert.equal(events[0].primary, true)
    assert.equal(events[0].sourceId, 'huawei')
    // Git must not steal the bar even though it reported later.
    assert.equal(events[1].primary, false)
    assert.equal(events[1].componentLabel, 'Git')
  })
})
