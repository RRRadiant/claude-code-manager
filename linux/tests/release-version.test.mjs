/**
 * Guards the version number the user actually types into a terminal.
 *
 * Why this exists
 * ---------------
 * The version lives in more than one place: `package.json` decides what the deb is
 * called, and `resources/linux/安装说明.txt` tells the user which filename to pass to
 * `apt install`. Releasing means bumping both, and nothing tied them together — a
 * missed edit produces a perfectly valid package whose instructions name a file that
 * is not in it (`E: Unable to locate package ./claude-code-manager_1.3.3_amd64.deb`),
 * which is exactly the kind of failure the recipient cannot diagnose.
 *
 * The same edit also has to reach the "current version" references scattered through
 * the install notes. Rather than freeze a list of line numbers, this scans for any
 * version-looking string and insists every one of them is either the current version
 * or a version mentioned as history (1.2.x and older, which the notes deliberately
 * keep referring to when explaining what changed).
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// `scripts/run-tests.mjs` bundles every test into `node_modules/.cache/ccm-tests/`
// before running it, so `import.meta.url` points at the bundle and not at this file.
// The runner spawns node with `cwd` set to the repository root, which is the only
// stable anchor available to a bundled test.
const ROOT = resolve(process.cwd())
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const notes = readFileSync(join(ROOT, 'resources', 'linux', '安装说明.txt'), 'utf8')

const VERSION = pkg.version

/** Compare dotted versions numerically; 1.3.10 is newer than 1.3.9, unlike string order. */
function isOlderThan(candidate, reference) {
  const a = candidate.split('.').map(Number)
  const b = reference.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left < right
  }
  return false
}

describe('release version consistency', () => {
  test('package.json version looks like a version', () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+$/)
  })

  test('the install notes name the deb this version actually builds', () => {
    const debName = `claude-code-manager_${VERSION}_amd64.deb`
    assert.ok(
      notes.includes(debName),
      `安装说明.txt never mentions ${debName} -- bumping package.json without updating ` +
        `the notes ships instructions that name a file the user does not have`,
    )
  })

  test('the install notes do not point at some other version as current', () => {
    // History is deliberately preserved in the notes ("1.3.3 起「已有配置」里会…"),
    // so a plain "every version string must be current" rule is wrong. What must
    // never go stale is the *filename*: the notes say exactly which file the user
    // types. Those references are stripped out, and any version left over has to be
    // historical, i.e. an older release being spoken about rather than a live file
    // name.
    const artifactRefs = [
      /claude-code-manager_\d+\.\d+\.\d+_amd64\.deb/g,
      /CCM-Kali-[\d.]+\.SHA256SUMS\.txt/g,
      /CCM-Kali-[\d.]+\.zip/g,
    ]
    let stripped = notes
    for (const pattern of artifactRefs) stripped = stripped.replace(pattern, '<artifact>')

    const mentioned = new Set(stripped.match(/\b\d+\.\d+\.\d+\b/g) ?? [])
    const stale = [...mentioned].filter((v) => v !== VERSION && !isOlderThan(v, VERSION))
    assert.deepEqual(
      stale,
      [],
      `安装说明.txt refers to ${stale.join(', ')} outside of a filename, but the current ` +
        `version is ${VERSION}; either bump those references or, if they are history, ` +
        `rephrase them so they read as history`,
    )
  })

  test('the notes state the version they are paired with', () => {
    assert.ok(
      notes.includes(`本说明配套版本：${VERSION}`),
      `the "本说明配套版本" line does not say ${VERSION}`,
    )
  })

  test('every plain-text artifact agrees on the version', () => {
    // 安装说明.txt is the only shipped text that carries a version; check the
    // unpacked delivery folder is named for this version too so make-delivery.mjs
    // cannot be pointed at last release's folder.
    const deliveryFolder = join(ROOT, '..', `CCM-Kali-${VERSION}`)
    const notesInFolder = join(deliveryFolder, '安装说明.txt')
    try {
      const folderNotes = readFileSync(notesInFolder, 'utf8')
      assert.ok(
        folderNotes.includes(`本说明配套版本：${VERSION}`),
        `${deliveryFolder} still holds notes for another version`,
      )
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      // The folder is assembled on the packaging machine, not in the repo; its
      // absence is normal during development.
    }
  })
})
