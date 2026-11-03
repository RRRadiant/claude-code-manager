/**
 * Component definitions: pinned versions, URLs and digests.
 *
 * Ported from the constants at the top of `installer.rs`. The rule that matters
 * is the same one the Windows build documents: the Git digest is inlined on
 * purpose. Fetching a checksum at install time defeats the point — the checksum
 * would travel over the same channel as the payload, so anything able to swap
 * the installer could swap the digest too.
 *
 * The Node.js digest is *also* pinned here, and additionally cross-checked
 * against the mirror's published SHASUMS256.txt at install time. Two independent
 * sources agreeing is stronger than either alone; the pinned value is the one
 * that can veto.
 */

import { homedir } from 'os'
import { join } from 'path'
import { arch } from 'process'
import type { ComponentId } from './types'

/** Pinned Node.js version. Must have a matching entry in NODE_SHA256. */
export const NODE_VERSION = 'v22.14.0'

/**
 * Node.js mirror candidates, probed concurrently before every download.
 *
 * All three were verified to serve byte-identical archives for v22.14.0
 * (29,893,360 bytes on x64, SHA256 69b09dba…37ec for the .tar.xz). The 404
 * caveat the Windows build records for Tencent is the reason this list is short:
 * a mirror that answers but 404s costs one full probe timeout per install.
 */
export const NODE_SOURCES: ReadonlyArray<{ id: string; label: string; baseUrl: string }> = [
  { id: 'official', label: 'Official', baseUrl: 'https://nodejs.org/dist/' },
  { id: 'npmmirror', label: 'Aliyun', baseUrl: 'https://npmmirror.com/mirrors/node/' },
  { id: 'huawei', label: 'Huawei', baseUrl: 'https://mirrors.huaweicloud.com/nodejs/' },
]

/** Node.js arch token for the tarball name. */
export function nodeArch(): string {
  return arch === 'arm64' ? 'arm64' : 'x64'
}

export function nodeArchiveName(): string {
  return `node-${NODE_VERSION}-linux-${nodeArch()}.tar.xz`
}

/**
 * SHA256 of the official Node.js archives, pinned.
 *
 * Taken from `https://nodejs.org/dist/v22.14.0/SHASUMS256.txt` and verified by
 * downloading the x64 archive from an independent mirror and hashing it.
 */
export const NODE_SHA256: Record<string, string> = {
  'node-v22.14.0-linux-x64.tar.xz':
    '69b09dba5c8dcb05c4e4273a4340db1005abeafe3927efda2bc5b249e80437ec',
  'node-v22.14.0-linux-arm64.tar.xz':
    '08bfbf538bad0e8cbb0269f0173cca28d705874a67a22f60b57d99dc99e30050',
}

/** Where a mirror publishes the digest list, used as an independent cross-check. */
export const shasumsUrl = (baseUrl: string): string =>
  `${baseUrl}${NODE_VERSION}/SHASUMS256.txt`

export function nodeArchiveUrl(baseUrl: string): string {
  return `${baseUrl}${NODE_VERSION}/${nodeArchiveName()}`
}

/** The directory name inside the Node.js tarball. */
export const NODE_TARBALL_ROOT = `node-${NODE_VERSION}-linux-${nodeArch()}`

/** npm registry used for the Claude Code package, and the mirror we switch to. */
export const NPM_OFFICIAL_REGISTRY = 'https://registry.npmjs.org/'
export const NPM_MIRROR = 'https://registry.npmmirror.com/'

export const CLAUDE_PACKAGE = '@anthropic-ai/claude-code'

/**
 * Flags that remove network round-trips and skew from a global install:
 * no audit report, no funding banner, prefer the npm cache.
 */
export const NPM_FAST_FLAGS = ['--no-audit', '--no-fund', '--prefer-offline'] as const

/**
 * Git version pinned for the fallback source build / apt path.
 *
 * Unlike Node.js there is no downloaded artifact here, so no digest is pinned:
 * Git comes from the distribution's signed package repositories, whose trust
 * chain is apt's, not ours.
 */
export const GIT_VERSION = '2.45.2'

// ---------------------------------------------------------------------------
// Filesystem layout
// ---------------------------------------------------------------------------

/**
 * Root of everything this app installs.
 *
 * `~/.local/share/claude-code-manager` follows the XDG data convention, so it
 * survives an AppImage upgrade and is obviously ours to delete on uninstall.
 */
export const APP_DATA_DIR = join(homedir(), '.local', 'share', 'claude-code-manager')

/** Downloaded-and-verified archives, keyed by filename. */
export const CACHE_DIR = join(APP_DATA_DIR, 'cache', 'installers')

/**
 * Versioned Node.js runtime root, so a future version bump cannot half-overwrite.
 *
 * Extraction runs with `--strip-components=1`, which *removes* the tarball's own
 * top-level directory (`node-v22.14.0-linux-x64/`): `bin/`, `lib/`, `include/`
 * and `share/` land directly here. Do not re-append `NODE_TARBALL_ROOT` when
 * building paths under this root — doing so yields a runtime that installs
 * "successfully" and cannot be found.
 *
 * Verified on Kali: `<root>/bin/node` reports `v22.14.0` and `<root>/bin/npm`
 * reports `10.9.2` after extraction.
 */
export const nodeRuntimeRoot = (): string => join(APP_DATA_DIR, 'runtime', 'node', NODE_VERSION)

/** Directory holding `node` and `npm`, i.e. what goes on PATH. */
export const nodeBinDir = (): string => join(nodeRuntimeRoot(), 'bin')

/** npm prefix for globally installed packages, owned by this app. */
export const npmPrefixDir = (): string => join(APP_DATA_DIR, 'runtime', 'npm-global')

/** Where `claude` lands after `npm install -g`. */
export const npmBinDir = (): string => join(npmPrefixDir(), 'bin')

/** Directories this app wants on the user's PATH, in priority order. */
export function managedBinDirs(): string[] {
  return [npmBinDir(), nodeBinDir()]
}

/** Directories of installed components that may own a component id. */
export function componentCachePath(filename: string): string {
  return join(CACHE_DIR, filename)
}

/** Marker recording the digest a cached archive was verified against. */
export function cacheMarkerPath(archivePath: string): string {
  return `${archivePath}.verified.json`
}

/** Live progress state file, so a crash mid-download leaves no false "done". */
export const TASK_STATE_FILENAME = 'install-state.json'

export const COMPONENT_ORDER: ComponentId[] = ['node', 'git', 'claude-code']
