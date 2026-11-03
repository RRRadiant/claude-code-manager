/**
 * Assemble and verify a delivery zip, then write the checksum the receiving end needs.
 *
 * Why this exists
 * ---------------
 * The 1.3.3 zip reached the user's Kali box with 972 bytes of foreign data appended and
 * 7-Zip refused it. The workspace master was perfect, so the damage happened while the
 * file was moved -- and because nothing was published alongside the zip, the user had no
 * way to tell a bad copy from a bad build. Both halves are fixed here: the zip is built
 * by one command (so the step is repeatable), verified, and shipped next to SHA256SUMS.txt.
 *
 * The arc of the workflow it replaces was: build the deb in WSL, copy it out, drag files
 * into a folder by hand, right-click -> compress. Every one of those steps can silently
 * drop or append bytes; this script cannot, and it refuses to emit an unverified artifact.
 *
 * Usage:
 *   node scripts/make-delivery.mjs <version> <content-dir> [--out <dir>]
 *
 *   version      e.g. 1.3.4 -- the deb inside must be named claude-code-manager_<version>_amd64.deb
 *   content-dir  folder holding the deb, 安装说明.txt and screenshots/ to be zipped
 *   --out        where to write the zip (default: the parent of content-dir)
 *
 * Exit status is non-zero if the zip fails verification, so an unshippable artifact can
 * never look like a successful build.
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')

function usage(message) {
  if (message) console.error(`error: ${message}\n`)
  console.error('usage: node scripts/make-delivery.mjs <version> <content-dir> [--out <dir>]')
  process.exit(2)
}

const argv = process.argv.slice(2)
let outDir = null
const positional = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') {
    outDir = argv[++i]
    if (!outDir) usage('--out needs a directory')
  } else {
    positional.push(argv[i])
  }
}

const [version, contentDirArg] = positional
if (!version || !contentDirArg) usage('version and content-dir are both required')

const contentDir = resolve(contentDirArg)
if (!existsSync(contentDir) || !statSync(contentDir).isDirectory()) {
  usage(`content directory does not exist: ${contentDir}`)
}

/* ------------------------------------------------ what has to be in the folder */
const problems = []
const debName = `claude-code-manager_${version}_amd64.deb`
const required = [debName, '安装说明.txt']
for (const name of required) {
  if (!existsSync(join(contentDir, name))) problems.push(`missing required file: ${name}`)
}

const screenshotDir = join(contentDir, 'screenshots')
let screenshots = []
if (!existsSync(screenshotDir)) {
  problems.push('missing screenshots/ directory')
} else {
  screenshots = readdirSync(screenshotDir).filter((f) => !f.startsWith('.'))
  if (screenshots.length === 0) problems.push('screenshots/ is empty')
}

// Catch the classic version slip: a 1.3.4 folder still holding the 1.3.3 deb.
const debs = readdirSync(contentDir).filter((f) => f.endsWith('.deb'))
for (const stray of debs) {
  if (stray !== debName) {
    problems.push(`unexpected deb in the folder (version mismatch?): ${stray} -- expected ${debName}`)
  }
}

if (problems.length > 0) {
  console.error(`Delivery folder ${contentDir} is not ready:`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log(`content   : ${contentDir}`)
console.log(`  ${debName}  ${statSync(join(contentDir, debName)).size} bytes`)
console.log(`  安装说明.txt  ${statSync(join(contentDir, '安装说明.txt')).size} bytes`)
console.log(`  screenshots/  ${screenshots.length} files`)

/* ------------------------------------------- checksum that travels with the deb */
// Written *into* the folder before zipping, so it is present the moment the user
// extracts. The checksum published next to the zip only covers the zip, so a user
// who has already extracted has nothing to check the deb against -- and telling
// them to verify the deb against the zip's checksum is simply wrong.
//
// Comments start with `#` because `sha256sum -c` warns about any line it cannot
// parse as a checksum. Explanatory prose without them makes the very command these
// notes tell the user to run print "N lines are improperly formatted", which reads
// like a failure when nothing is wrong. `#` lines are skipped silently.
const debPath = join(contentDir, debName)
const debSize = statSync(debPath).size
const debDigest = createHash('sha256').update(readFileSync(debPath)).digest('hex')
writeFileSync(
  join(contentDir, '校验值.txt'),
  [
    `# claude-code-manager_${version} 安装包校验值`,
    '#',
    `${debDigest}  ${debName}`,
    '#',
    '# 怎么用：在这个文件夹里打开终端，执行',
    '#     sha256sum -c 校验值.txt',
    '# 显示 OK 就是文件完好；显示 FAILED 说明文件在传输中损坏，请重新拷贝。',
    '#',
    `# 安装包大小 ${debSize} 字节，也可以直接比大小。`,
    '',
  ].join('\n'),
  'utf8',
)
console.log(`  校验值.txt    写入 ${debName} 的 sha256`)

/* ------------------------------------------------------------------ build it */
const zipName = `CCM-Kali-${version}.zip`
const targetDir = outDir ? resolve(outDir) : dirname(contentDir)
const zipPath = join(targetDir, zipName)

if (existsSync(zipPath)) {
  console.error(`\nrefusing to overwrite an existing artifact: ${zipPath}`)
  console.error('remove it deliberately if you really mean to rebuild the same version.')
  process.exit(1)
}

// Zip a folder *containing* the payload, so extracting always produces one tidy
// `CCM-Kali-<version>/` directory. An earlier version archived the contents at the
// root, which scattered the deb into whatever directory the user extracted into --
// and silently overwrote a same-named deb if one was already there. The install
// notes also tell the user to open a terminal *inside* that folder, which only
// works if extraction actually creates it.
const zipArgs = ['-r', '-X', '-q', zipPath, basename(contentDir), '-x', '.*']
console.log(`\nzipping   : ${zipName}`)
const zip = spawnSync('zip', zipArgs, { cwd: dirname(contentDir), encoding: 'utf8' })
if (zip.error || zip.status !== 0) {
  console.error(`zip failed (${zip.error ? zip.error.message : `exit ${zip.status}`})`)
  if (zip.stderr) console.error(zip.stderr.trim())
  process.exit(1)
}

/* ------------------------------------------------------------------ verify it */
console.log('\nverifying :')
const verify = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-package.mjs'), zipPath], {
  encoding: 'utf8',
})
process.stdout.write(verify.stdout || '')
if (verify.stderr) process.stderr.write(verify.stderr)
if (verify.status !== 0) {
  console.error('\nThe zip failed verification -- deleting it so it cannot be shipped by accident.')
  const { unlinkSync } = await import('node:fs')
  unlinkSync(zipPath)
  process.exit(1)
}

/* ------------------------------------------------------------- publish digest */
const digest = createHash('sha256').update(readFileSync(zipPath)).digest('hex')
const size = statSync(zipPath).size
const sumsPath = join(targetDir, `CCM-Kali-${version}.SHA256SUMS.txt`)
writeFileSync(
  sumsPath,
  `${digest}  ${zipName}\n# ${size} bytes\n# verify with:  sha256sum -c ${basename(sumsPath)}\n`,
  'utf8',
)

console.log(`\nready     : ${zipPath}`)
console.log(`            ${size} bytes`)
console.log(`            sha256 ${digest}`)
console.log(`            ${sumsPath}`)
console.log('\nHand the user both files. A copy that fails sha256sum is a transfer problem,')
console.log('not a build problem -- re-copy it instead of debugging the app.')
