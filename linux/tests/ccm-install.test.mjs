/**
 * install.sh must accept a release binary that was downloaded without +x.
 * Browsers and `curl -o` keep the file mode at 0644, and the old check
 * required the file to already be executable, so a fresh install skipped it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The runner bundles this file, so import.meta.url is not the source path.
// It spawns node with cwd set to linux/.
const scriptSource = join(resolve(process.cwd()), 'cli', 'ccm-tui', 'install.sh')
const onLinux = process.platform === 'linux'

function releaseName() {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
  return arch ? `ccm-linux-${arch}` : null
}

test(
  'a downloaded release binary is installed even when it is not yet executable',
  { skip: onLinux ? false : 'install.sh selects a Linux asset from uname' },
  () => {
    const asset = releaseName()
    assert.ok(asset, `unsupported arch ${process.arch}`)
    const home = mkdtempSync(join(tmpdir(), 'ccm-install-home-'))
    const root = mkdtempSync(join(tmpdir(), 'ccm-install-src-'))
    try {
      const dist = join(root, 'dist')
      mkdirSync(dist)
      const downloaded = join(dist, asset)
      writeFileSync(downloaded, '#!/bin/sh\necho ccm-ok\n')
      chmodSync(downloaded, 0o644)
      assert.equal(statSync(downloaded).mode & 0o111, 0)

      const scriptPath = join(root, 'install.sh')
      writeFileSync(scriptPath, readFileSync(scriptSource))
      chmodSync(scriptPath, 0o755)

      const result = spawnSync('bash', [scriptPath], {
        encoding: 'utf-8',
        env: { ...process.env, HOME: home },
      })
      assert.equal(result.status, 0, result.stderr || result.stdout)

      const installed = join(home, '.local', 'bin', 'ccm')
      assert.equal(statSync(installed).mode & 0o111, 0o111)
      const run = spawnSync(installed, { encoding: 'utf-8' })
      assert.equal(run.status, 0, run.stderr)
      assert.equal(run.stdout.trim(), 'ccm-ok')
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
    }
  },
)
