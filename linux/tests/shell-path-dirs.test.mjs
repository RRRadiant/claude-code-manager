/**
 * Tests for what the app puts on the user's PATH.
 *
 * The install writes a PATH export into the shell rc files so future terminals
 * find the toolchain. Two things went wrong with that:
 *
 *  1. When a suitable Node.js was already on the system, the installer took the
 *     "nothing to do" branch and still wrote the export — pointing at
 *     `…/runtime/node/v22.14.0/bin`, a directory that branch never creates. Every
 *     shell on that machine then carried a permanent dead PATH entry naming a
 *     directory that would never exist.
 *  2. Once `claude` resolves from the system, that directory is the only managed
 *     entry left; if it exists, it should be exported, and if nothing managed
 *     exists we should leave the user's rc files alone entirely.
 *
 * The behaviour lives in `shellPathDirs`, which is pure so it can be checked
 * without a session and without the six existing rc-file tests having to care.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root
let realA
let realB

before(() => {
  root = mkdtempSync(join(tmpdir(), 'ccm-pathdirs-'))
  realA = join(root, 'a')
  realB = join(root, 'b')
  mkdirSync(realA, { recursive: true })
})

after(() => {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

describe('shellPathDirs', () => {
  test('keeps directories that exist, in the order given', async () => {
    const { shellPathDirs } = await import('../src/main/installer/env.ts')
    assert.deepEqual(shellPathDirs([realA, realB]), [realA])
  })

  test('drops every directory that does not exist', async () => {
    const { shellPathDirs } = await import('../src/main/installer/env.ts')
    assert.deepEqual(shellPathDirs([join(root, 'nope'), join(root, 'also-nope')]), [])
  })

  test('returns empty rather than guessing when nothing exists', async () => {
    // The important one: an empty answer must stay empty. Returning a fallback
    // here is what put a dead directory on every shell's PATH.
    const { shellPathDirs } = await import('../src/main/installer/env.ts')
    assert.deepEqual(shellPathDirs([]), [])
  })

  test('a file is not mistaken for a directory', async () => {
    const { shellPathDirs } = await import('../src/main/installer/env.ts')
    const { writeFileSync } = await import('node:fs')
    const file = join(root, 'not-a-dir')
    writeFileSync(file, 'x')
    assert.deepEqual(shellPathDirs([file]), [])
  })

  test('does not mutate or duplicate the input', async () => {
    const { shellPathDirs } = await import('../src/main/installer/env.ts')
    const input = [realA, realA]
    const out = shellPathDirs(input)
    assert.deepEqual(input, [realA, realA], 'the caller list must be untouched')
    assert.deepEqual(out, [realA, realA], 'duplicates are the caller concern, not ours')
    mkdirSync(realB, { recursive: true })
    assert.deepEqual(shellPathDirs([realA, realB]), [realA, realB])
  })
})
