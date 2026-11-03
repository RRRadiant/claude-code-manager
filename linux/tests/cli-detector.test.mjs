/**
 * Tests for locating the `claude` CLI.
 *
 * The bug these exist for is the same one that hit the dependency card: this
 * detector asked `which claude` on whatever PATH the app inherited. The app
 * installs `claude` into its own directory, which is only on that PATH when the
 * app was started from a shell that had read the rc-file export — so the answer
 * changed depending on how the app was launched, and after a reboot it could
 * report Claude Code missing while it was sitting on disk the whole time.
 *
 * The fix gives the detector two independent ways to find it: the app's known
 * install directory (no PATH involved), and the managed PATH.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { claudeSearchPaths } from '../src/main/services/cli-detector.ts'
import { npmBinDir, nodeBinDir } from '../src/main/installer/components.ts'

describe('cli-detector search paths', () => {
  test('the app-owned install directory is searched without consulting PATH', () => {
    const paths = claudeSearchPaths()
    assert.ok(
      paths.some((candidate) => candidate.path === join(npmBinDir(), 'claude')),
      `the managed bin dir (${npmBinDir()}) must be among the candidates -- it is where ` +
        `this app puts claude, and finding it must not depend on the launch environment`,
    )
  })

  test('the managed directory is tried before unrelated system locations', () => {
    const paths = claudeSearchPaths()
    const managed = paths.findIndex((candidate) => candidate.path === join(npmBinDir(), 'claude'))
    const system = paths.findIndex((candidate) => candidate.path === '/usr/local/bin/claude')
    assert.ok(managed >= 0 && system >= 0)
    assert.ok(
      managed < system,
      'the version this app manages should win over a system-wide install, matching PATH order',
    )
  })

  test('every candidate carries the method it would be attributed to', () => {
    for (const candidate of claudeSearchPaths()) {
      assert.equal(typeof candidate.path, 'string')
      assert.ok(candidate.path.length > 0)
      assert.ok(
        ['native', 'npm', 'bun', 'snap'].includes(candidate.method),
        `${candidate.path} has an unknown method ${candidate.method}`,
      )
    }
  })

  test('the managed npm prefix is reported as npm, not native', () => {
    const managed = claudeSearchPaths().find(
      (candidate) => candidate.path === join(npmBinDir(), 'claude'),
    )
    assert.equal(
      managed?.method,
      'npm',
      'a globally-installed npm package must not be mislabelled as a native install',
    )
  })

  test('node dir is not offered as a place claude lives', () => {
    // The managed node runtime holds node/npm, never claude. Including it would be
    // a wasted stat at best and a wrong answer if a stray file ever appeared there.
    const nodeCandidate = claudeSearchPaths().some((c) => c.path.startsWith(nodeBinDir()))
    assert.equal(nodeCandidate, false)
  })
})

