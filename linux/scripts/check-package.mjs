/**
 * Delivery guard: a release zip must be a structurally valid, fully readable archive.
 *
 * Why this exists
 * ---------------
 * The 1.3.3 delivery zip arrived on the user's Kali box with 972 bytes of foreign
 * data after the end of the archive, and 7-Zip refused it:
 *
 *     ERRORS: Headers Error / Unconfirmed start of archive
 *     WARNINGS: There are data after the end of archive -- Tail Size = 972
 *     Physical Size = 122362760  (the real archive is 122363732 bytes)
 *
 * The master copy in the workspace was fine, so the damage happened in transit and
 * nothing we ran would ever have caught it: `electron-builder` does not checksum the
 * zip it writes, and the app's own gates only look inside the build tree. A truncated
 * or appended zip is also *silently* tolerated by some extractors, which is worse --
 * the user gets a half-written deb and an install failure that looks like our bug.
 *
 * What it checks, per zip
 * -----------------------
 *   1. Local file headers are reachable and the central directory adds up to the EOCD.
 *   2. There are no bytes after the EOCD (the exact 1.3.3 failure).
 *   3. Every entry CRC32s to the value stored in the header, and inflates to the
 *      declared uncompressed length -- i.e. the payload is genuinely readable.
 *   4. `.deb` entries are real `ar` archives whose members decompress cleanly, so a
 *      structurally fine zip wrapping a truncated deb is still rejected.
 *   5. `SHA256SUMS.txt` sits beside the zip so the receiving end can verify a copy
 *      instead of discovering damage at install time.
 *
 * Usage:
 *   node scripts/check-package.mjs <zip> [<zip> ...]      # verify existing artifacts
 *   node scripts/check-package.mjs --write-sums <zip>...  # write SHA256SUMS.txt beside each zip
 *
 * Exits non-zero on the first failing archive so `package:*` and CI stop loudly.
 */

import { createHash } from 'node:crypto'
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { inflateRawSync, gunzipSync } from 'node:zlib'

const EOCD_SIG = 0x06054b50
const CD_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

/* ------------------------------------------------------------------ CRC32 */
// Standard reflected CRC-32 (polynomial 0xEDB88320). Self-checked below: if this
// table is ever wrong, every entry "fails" and the guard becomes noise, so the
// known vector is asserted before any archive is judged.
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff]
  return (c ^ -1) >>> 0
}

function assertCrcSelfTest() {
  const got = crc32(Buffer.from('123456789', 'ascii'))
  if (got !== 0xcbf43926) {
    throw new Error(`crc32 self-test failed: got ${got.toString(16)}, expected cbf43926`)
  }
}

/* ------------------------------------------------------------- zip reader */
class ZipFile {
  constructor(path) {
    this.path = path
    this.size = statSync(path).size
    this.fd = openSync(path, 'r')
  }
  read(offset, length) {
    const buf = Buffer.alloc(length)
    const got = readSync(this.fd, buf, 0, length, offset)
    return got === length ? buf : buf.subarray(0, got)
  }
  close() {
    closeSync(this.fd)
  }
}

/** Read the EOCD record; also report whether the file carries trailing rubbish. */
function readEocd(zip) {
  const scanLen = Math.min(zip.size, 65535 + 22 + 64)
  const scan = zip.read(zip.size - scanLen, scanLen)
  for (let i = scan.length - 22; i >= 0; i--) {
    if (scan.readUInt32LE(i) === EOCD_SIG) {
      const eocd = zip.size - scanLen + i
      const rec = zip.read(eocd, 22)
      const commentLen = rec.readUInt16LE(20)
      return {
        offset: eocd,
        entries: rec.readUInt16LE(10),
        cdSize: rec.readUInt32LE(12),
        cdOffset: rec.readUInt32LE(16),
        declaredEnd: eocd + 22 + commentLen,
      }
    }
  }
  return null
}

function listEntries(zip, eocd) {
  const entries = []
  let off = eocd.cdOffset
  for (let i = 0; i < eocd.entries; i++) {
    const head = zip.read(off, 46)
    if (head.length < 46 || head.readUInt32LE(0) !== CD_SIG) {
      throw new Error(`central directory entry ${i} at ${off} has a bad signature`)
    }
    const nameLen = head.readUInt16LE(28)
    const extraLen = head.readUInt16LE(30)
    const commentLen = head.readUInt16LE(32)
    entries.push({
      name: zip.read(off + 46, nameLen).toString('utf8'),
      method: head.readUInt16LE(10),
      crc: head.readUInt32LE(16),
      compressedSize: head.readUInt32LE(20),
      uncompressedSize: head.readUInt32LE(24),
      localOffset: head.readUInt32LE(42),
    })
    off += 46 + nameLen + extraLen + commentLen
  }
  return { entries, cdEnd: off }
}

/** Resolve an entry's payload; the local header can carry different extra lengths. */
function entryPayload(zip, entry) {
  const local = zip.read(entry.localOffset, 30)
  if (local.length < 30 || local.readUInt32LE(0) !== LOCAL_SIG) {
    throw new Error(`local header at ${entry.localOffset} has a bad signature`)
  }
  const dataOffset = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
  const raw = zip.read(dataOffset, entry.compressedSize)
  if (raw.length !== entry.compressedSize) {
    throw new Error(`entry data truncated: wanted ${entry.compressedSize} bytes, got ${raw.length}`)
  }
  if (entry.method === 0) return raw
  if (entry.method === 8) return inflateRawSync(raw)
  throw new Error(`unsupported compression method ${entry.method}`)
}

/** Walk an `ar` archive (the .deb container) and prove each member decompresses. */
function checkDeb(payload) {
  const problems = []
  const notes = []
  if (payload.subarray(0, 8).toString('latin1') !== '!<arch>\n') {
    return { problems: ['deb does not start with the ar magic "!<arch>"'], notes }
  }
  let pos = 8
  let member = 0
  while (pos + 60 <= payload.length) {
    const header = payload.subarray(pos, pos + 60).toString('latin1')
    const name = header.slice(0, 16).trim().replace(/\/$/, '')
    const size = Number.parseInt(header.slice(48, 58).trim(), 10)
    if (!Number.isFinite(size) || size < 0) {
      problems.push(`ar member ${member} has an unreadable size field`)
      break
    }
    const body = payload.subarray(pos + 60, pos + 60 + size)
    if (body.length !== size) {
      problems.push(`ar member ${name || member} is truncated (${body.length}/${size})`)
      break
    }
    const magic2 = body.subarray(0, 2).toString('latin1')
    const magic6 = body.subarray(0, 6).toString('latin1')
    if (magic2 === '\x1f\x8b') {
      try {
        notes.push(`${name}: gzip ok, ${gunzipSync(body).length} bytes`)
      } catch (err) {
        problems.push(`ar member ${name} failed to gunzip: ${err.message}`)
      }
    } else if (magic6 === '\xfd7zXZ\x00') {
      // Node has no xz decoder, so the payload itself is not validated here. It is
      // covered by the entry's CRC32 above (that is what detects a truncated member)
      // and by the real `dpkg -i` pass; say so instead of implying a deep check.
      notes.push(`${name}: xz, structure only (payload covered by the entry CRC32)`)
    } else if (magic2 === '\x28\xb5') {
      notes.push(`${name}: zstd, structure only (payload covered by the entry CRC32)`)
    } else {
      notes.push(`${name}: unknown container, structure only`)
    }
    pos += 60 + size + (size % 2)
    member++
  }
  if (member === 0) problems.push('deb contains no ar members')
  return { problems, notes }
}

/* ------------------------------------------------------------- the verdict */
function verifyZip(path, log) {
  const problems = []
  let zip
  try {
    zip = new ZipFile(path)
  } catch (err) {
    return { problems: [`cannot open: ${err.message}`], entries: 0 }
  }

  try {
    const eocd = readEocd(zip)
    if (!eocd) return { problems: ['no end-of-central-directory record found'], entries: 0 }

    const trailing = zip.size - eocd.declaredEnd
    if (trailing !== 0) {
      // This is the 1.3.3 signature. Extractor behaviour varies, so treat any
      // trailing data as fatal rather than "probably fine".
      problems.push(
        `${trailing} bytes of data after the end of the archive ` +
          `(archive ends at ${eocd.declaredEnd}, file is ${zip.size}) ` +
          `-- a truncated or re-appended transfer`,
      )
    }

    const { entries, cdEnd } = listEntries(zip, eocd)
    if (cdEnd !== eocd.offset) {
      problems.push(`central directory ends at ${cdEnd} but the EOCD is at ${eocd.offset}`)
    }

    let checked = 0
    for (const entry of entries) {
      if (entry.name.endsWith('/')) continue // directory marker
      try {
        const plain = entryPayload(zip, entry)
        if (plain.length !== entry.uncompressedSize) {
          problems.push(
            `${entry.name}: inflated to ${plain.length} bytes, header says ${entry.uncompressedSize}`,
          )
          continue
        }
        const actual = crc32(plain)
        if (actual !== entry.crc) {
          problems.push(
            `${entry.name}: CRC mismatch (calculated ${actual.toString(16).padStart(8, '0')}, ` +
              `header says ${entry.crc.toString(16).padStart(8, '0')})`,
          )
          continue
        }
        checked++
        if (entry.name.toLowerCase().endsWith('.deb')) {
          const { problems: debProblems, notes } = checkDeb(plain)
          for (const note of notes) log(`        ${entry.name} -> ${note}`)
          problems.push(...debProblems.map((p) => `${entry.name}: ${p}`))
        }
      } catch (err) {
        problems.push(`${entry.name}: ${err.message}`)
      }
    }
    return { problems, entries: checked }
  } catch (err) {
    return { problems: [`unreadable archive: ${err.message}`], entries: 0 }
  } finally {
    zip.close()
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/* ------------------------------------------------------------------- main */
function main(argv) {
  const writeSums = argv.includes('--write-sums')
  const targets = argv.filter((a) => !a.startsWith('--'))
  if (targets.length === 0) {
    console.error('usage: node scripts/check-package.mjs [--write-sums] <zip> [<zip> ...]')
    process.exit(2)
  }

  assertCrcSelfTest()

  const sums = []
  let failed = false
  for (const target of targets) {
    const lines = []
    const log = (msg) => lines.push(msg)
    let size = 0
    try {
      size = statSync(target).size
    } catch {
      console.error(`FAIL  ${target}: file not found`)
      failed = true
      continue
    }
    const { problems, entries } = verifyZip(target, log)
    const digest = problems.length === 0 && writeSums ? sha256(target) : null

    if (problems.length === 0) {
      console.log(`PASS  ${basename(target)}  (${entries} entries, ${size} bytes)`)
      for (const line of lines) console.log(line)
      if (digest) sums.push({ path: target, digest, size })
    } else {
      failed = true
      console.log(`FAIL  ${basename(target)}  (${size} bytes)`)
      for (const line of lines) console.log(line)
      for (const problem of problems) console.log(`        - ${problem}`)
    }
  }

  for (const { path, digest, size } of sums) {
    // One checksum file per artifact, named after it. A shared `SHA256SUMS.txt` looked
    // tidier but silently kept only the last zip when several were checked in one run.
    const stem = basename(path).replace(/\.zip$/i, '')
    const sumsPath = join(dirname(path), `${stem}.SHA256SUMS.txt`)
    const body = `${digest}  ${basename(path)}\n# ${size} bytes\n# verify with:  sha256sum -c ${basename(sumsPath)}\n`
    writeFileSync(sumsPath, body, 'utf8')
    console.log(`      wrote ${basename(sumsPath)}`)
  }

  if (failed) {
    console.error('\nPackage verification failed -- do not ship this artifact.')
    process.exit(1)
  }
  console.log('\nAll artifacts verified.')
}

main(process.argv.slice(2))
