/**
 * Locating the `claude` CLI.
 *
 * Two sources, deliberately. The app installs `claude` into its own npm prefix,
 * which is on the user's PATH only in a shell that has read the rc-file export —
 * and that export is not part of the environment an app launched from the desktop
 * menu inherits. Asking `which claude` alone therefore answered "installed" or
 * "missing" depending on how the app happened to be started, on the same machine
 * with the same files on disk. After a reboot the app is normally started from the
 * desktop, which is exactly when the wrong answer appeared.
 *
 * So the app's own directories are checked first, with no PATH involved, and the
 * managed PATH is the second source. Neither depends on the launch environment.
 */

import { execFileSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'

import { computeRefreshedPath, resolveOnPath } from '../installer/env'
import { npmBinDir } from '../installer/components'

export interface CliStatus {
  installed: boolean
  version: string | null
  path: string | null
  installMethod: 'native' | 'npm' | 'bun' | 'snap' | null
}

export type CliInstallMethod = NonNullable<CliStatus['installMethod']>

export interface ClaudeCandidate {
  path: string
  method: CliInstallMethod
}

/**
 * Where `claude` is looked for, in priority order.
 *
 * The app's own npm prefix comes first so the version this app manages wins over a
 * system-wide install — the same precedence the PATH export uses, for the same
 * reason: it is the copy the panel is responsible for.
 *
 * Exported because the ordering is the part worth testing, and because a caller
 * that wants to explain "where did it look" should not re-derive the list.
 */
export function claudeSearchPaths(home: string = homedir()): ClaudeCandidate[] {
  return [
    // Owned by this app. Present regardless of how the app was launched.
    { path: join(npmBinDir(), 'claude'), method: 'npm' },
    // Managed PATH: covers the native installer's own location and anything else
    // the user put on PATH that the app can see.
    { path: join(home, '.local', 'bin', 'claude'), method: 'native' },
    { path: '/usr/local/bin/claude', method: 'native' },
    { path: '/usr/bin/claude', method: 'native' },
    { path: '/snap/bin/claude-code', method: 'snap' },
    { path: join(home, '.npm-global', 'bin', 'claude'), method: 'npm' },
    { path: join(home, '.bun', 'bin', 'claude'), method: 'bun' },
  ]
}

/**
 * Detect Claude Code, without letting the launch environment decide the answer.
 *
 * Order: the managed PATH (which finds a `claude` the user installed themselves),
 * then the known locations above (which find the one this app installed even when
 * PATH says nothing).
 */
export function detectClaudeCode(): CliStatus {
  const onPath = resolveOnPath('claude', computeRefreshedPath().merged)
  if (onPath) {
    const version = getVersion(onPath)
    if (version) {
      return { installed: true, version, path: onPath, installMethod: detectInstallMethod(onPath) }
    }
  }

  for (const candidate of claudeSearchPaths()) {
    const version = getVersion(candidate.path)
    if (version) {
      return { installed: true, version, path: candidate.path, installMethod: candidate.method }
    }
  }

  return { installed: false, version: null, path: null, installMethod: null }
}

/** Run `<binary> --version` and pull the version out of it. */
function getVersion(binaryPath: string): string | null {
  try {
    const output = execFileSync(binaryPath, ['--version'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    const match = output.match(/(\d+\.\d+\.\d+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

function detectInstallMethod(binaryPath: string): CliStatus['installMethod'] {
  if (binaryPath.includes('.npm-global') || binaryPath.includes('claude-code-manager')) return 'npm'
  if (binaryPath.includes('.bun')) return 'bun'
  if (binaryPath.includes('snap')) return 'snap'
  return 'native'
}
