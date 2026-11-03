import { execFileSync } from 'child_process'
import { accessSync, constants, statSync } from 'fs'
import { delimiter, join } from 'path'

import { mergedEnv } from '../installer/env'
import { assertDebianPackageName } from './dependency-installer'

export interface DepCheckResult {
  /** Overall status */
  allOk: boolean
  /** Per-dependency results */
  checks: DepItem[]
  /**
   * The PATH the command lookups ran against.
   *
   * Returned rather than hidden because this value is the difference between the
   * card agreeing with the install plan and contradicting it — see
   * `checkDependencies`. The UI ignores it; tests and bug reports use it.
   */
  pathValue: string
}

export interface DepItem {
  name: string
  description: string
  installed: boolean
  /** The command to install (Ubuntu/Debian) */
  installCmd: string | null
}

/**
 * Check system dependencies required for Claude Code and the management panel.
 *
 * The command checks run against the *managed* PATH — the process PATH with the
 * directories this app installs into prepended — not the raw one the app happened
 * to inherit. That difference was a real bug: `which npm` on the inherited PATH
 * answered differently depending on how the app was started, because the installer
 * refreshes `process.env.PATH` only for the run that installs something, and after
 * that the value comes from whatever launched the app. Launched from a terminal it
 * carries the rc-file export (correct); launched from the desktop menu after a
 * reboot it does not (wrong). The result was one card reading 已就绪 while the
 * next reported the same toolchain as 缺失 — on the same screen, from the same
 * machine, differing only by launch path.
 *
 * `path` exists so a test can pin the lookup instead of depending on the host's
 * toolchain. `hasCommand` also spawns `which`, so this stays synchronous.
 */
export function checkDependencies(opts: { path?: string } = {}): DepCheckResult {
  const pathValue = opts.path ?? mergedEnv().PATH ?? ''

  const checks: DepItem[] = [
    {
      name: 'libfuse2',
      description: 'AppImage 运行支持（FUSE）',
      installed: hasLibFuse(),
      installCmd: 'sudo apt install -y libfuse2 || echo "如果失败，使用 --appimage-extract 提取运行"',
    },
    {
      name: 'zlib1g',
      description: '压缩库（Electron 运行必需）',
      installed: hasPkg('zlib1g'),
      installCmd: 'sudo apt install -y zlib1g',
    },
    {
      name: 'gnome-keyring',
      description: 'API Key 加密存储（safeStorage）',
      installed: hasCommand('gnome-keyring-daemon', pathValue) || hasPkg('gnome-keyring'),
      installCmd: 'sudo apt install -y gnome-keyring',
    },
    {
      name: 'libsecret-1-0',
      description: '密钥环底层库',
      installed: hasPkg('libsecret-1-0') || hasPkg('libsecret-1'),
      installCmd: 'sudo apt install -y libsecret-1-0',
    },
    {
      name: 'curl',
      description: '下载工具',
      installed: hasCommand('curl', pathValue),
      installCmd: 'sudo apt install -y curl',
    },
    {
      name: 'npm',
      description: 'Node.js 包管理器（npm 安装方式需要）',
      installed: hasCommand('npm', pathValue),
      installCmd: 'sudo apt install -y npm',
    },
    {
      name: 'git',
      description: '版本控制（GitHub Release 安装方式需要）',
      installed: hasCommand('git', pathValue),
      installCmd: 'sudo apt install -y git',
    },
  ]

  const allOk = checks.every((c) => c.installed)
  return { allOk, checks, pathValue }
}

/**
 * Whether `cmd` resolves on the given PATH.
 *
 * Resolved by walking the PATH here rather than by spawning `which`, for two
 * reasons. Spawning it means the lookup can only describe a PATH that still
 * contains `which` — passing a narrow PATH in (the whole point of the parameter)
 * removes the very tool doing the looking, which is how the first version of this
 * fix managed to find nothing. And `which` is not a POSIX utility; reading the
 * directories is both more direct and portable.
 *
 * A bare name is accepted, as are paths up to the PATH_SEPARATOR limit of the
 * platform, matching what a shell would do.
 */
function hasCommand(cmd: string, pathValue: string): boolean {
  if (cmd.includes('/')) return isExecutableFile(cmd)
  for (const dir of pathValue.split(delimiter)) {
    if (dir && isExecutableFile(join(dir, cmd))) return true
  }
  return false
}

/** A regular file the current user may execute. */
function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false
  } catch {
    return false
  }
  if (process.platform === 'win32') return true
  try {
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * argv for `dpkg-query`. The package name is a separate element, so it cannot
 * change the command even if a caller forgets the name check.
 */
export function dpkgQueryArgs(pkg: string): string[] {
  return ['-W', '-f=${Status}', assertDebianPackageName(pkg)]
}

function hasPkg(pkg: string): boolean {
  let args: string[]
  try {
    args = dpkgQueryArgs(pkg)
  } catch {
    return false
  }
  try {
    // dpkg-query -W exits 0 when the package is known to dpkg, non-zero otherwise.
    // An absolute package-database lookup: PATH does not enter into it, which is
    // why these rows kept answering correctly while the command rows did not.
    // execFile never goes through a shell, so `${Status}` stays a format string.
    execFileSync('dpkg-query', args, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

function hasLibFuse(): boolean {
  // Check all possible FUSE package names across Ubuntu versions
  return hasPkg('libfuse2') || hasPkg('libfuse2t64') || hasPkg('libfuse3') || hasPkg('fuse')
}
