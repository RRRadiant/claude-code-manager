/**
 * Tests for the system-dependency check.
 *
 * The bug these exist for: the 系统依赖 card asked `which npm` on the *raw process
 * PATH*, while every other part of the app asks on a PATH with the app's own
 * managed directories prepended. The installer refreshes the process PATH only
 * for the run that installs something, so the two answers agreed on the day of
 * the install and disagreed on every launch after it — which is how a user ends up
 * with the app reporting Node.js 已就绪 in one card and npm 缺失 in the next.
 *
 * The check now resolves programs against the same managed PATH the rest of the
 * app uses, and takes that PATH as a parameter so it can be pinned in a test.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkDependencies, dpkgQueryArgs } from '../src/main/services/dependency-checker.ts'
import {
  InvalidPackageNameError,
  isDebianPackageName,
} from '../src/main/services/dependency-installer.ts'
import { managedBinDirs } from '../src/main/installer/components.ts'

/** A directory holding an executable `npm`, to stand in for a real toolchain. */
let toolchainDir

before(() => {
  toolchainDir = mkdtempSync(join(tmpdir(), 'ccm-deps-test-'))
  writeFileSync(join(toolchainDir, 'npm'), '#!/bin/sh\necho 10.9.2\n', 'utf-8')
  chmodSync(join(toolchainDir, 'npm'), 0o755)
})

after(() => {
  try {
    rmSync(toolchainDir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

const npmOf = (result) => result.checks.find((c) => c.name === 'npm')

describe('checkDependencies', () => {
  test('finds npm when the PATH it is given contains it', async () => {
    const result = await checkDependencies({ path: toolchainDir })
    assert.equal(
      npmOf(result)?.installed,
      true,
      'npm exists in the supplied PATH, so it must be reported as installed',
    )
  })

  test('reports npm missing when the PATH it is given is empty', async () => {
    const result = await checkDependencies({ path: '/nonexistent' })
    assert.equal(npmOf(result)?.installed, false)
  })

  test('the default PATH is the managed one, not the raw process PATH', async () => {
    // This is the fix in one assertion: the app's own toolchain directories are
    // part of the PATH this check uses, whether or not the process that launched
    // the app had them. Without it the card contradicts the install plan on any
    // launch that did not inherit an rc-file PATH.
    const result = await checkDependencies()
    assert.equal(result.pathValue.split(':').length > 0, true)
    for (const dir of managedBinDirs()) {
      assert.ok(
        result.pathValue.includes(dir),
        `the managed directory ${dir} must be on the checked PATH`,
      )
    }
  })

  test('apt package checks do not depend on PATH', async () => {
    // dpkg-query is an absolute lookup in /var/lib/dpkg, so libfuse2 and friends
    // must keep answering the same way regardless of the PATH handed in.
    const withPath = await checkDependencies({ path: toolchainDir })
    const withoutPath = await checkDependencies({ path: '/nonexistent' })
    const names = withPath.checks.map((c) => c.name)
    for (const name of ['libfuse2', 'zlib1g', 'libsecret-1-0']) {
      assert.equal(
        withPath.checks[names.indexOf(name)].installed,
        withoutPath.checks[names.indexOf(name)].installed,
        `${name} is an apt package and must not vary with PATH`,
      )
    }
  })

  test('apt lookups use an argument array and a package-name allow pattern', () => {
    assert.deepEqual(dpkgQueryArgs('libsecret-1-0'), ['-W', '-f=${Status}', 'libsecret-1-0'])
    assert.equal(isDebianPackageName('zlib1g'), true)
    assert.throws(() => dpkgQueryArgs('zlib1g;touch /tmp/x'), InvalidPackageNameError)
    assert.throws(() => dpkgQueryArgs('$(id)'), InvalidPackageNameError)
    assert.throws(() => dpkgQueryArgs('-y'), InvalidPackageNameError)
  })

  test('every package name the checker reports is safe to pass to apt', async () => {
    const result = await checkDependencies({ path: '/nonexistent' })
    for (const check of result.checks) {
      assert.equal(isDebianPackageName(check.name), true, check.name)
    }
  })

  test('every check still reports the shape the UI renders', async () => {
    const result = await checkDependencies()
    assert.equal(typeof result.allOk, 'boolean')
    assert.ok(result.checks.length > 0)
    for (const check of result.checks) {
      assert.equal(typeof check.name, 'string')
      assert.equal(typeof check.description, 'string')
      assert.equal(typeof check.installed, 'boolean')
      assert.ok(check.installCmd === null || typeof check.installCmd === 'string')
    }
    assert.equal(
      result.allOk,
      result.checks.every((c) => c.installed),
      'allOk must stay the conjunction of the individual checks',
    )
  })
})
