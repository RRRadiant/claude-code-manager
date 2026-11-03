/**
 * Environment detection and PATH handling for Linux.
 *
 * The Windows build has a whole module (`env_refresh.rs`) for one problem: a
 * running process inherits its environment block at creation time, while
 * installers modify the *registry* copy, so a freshly installed tool is
 * invisible until something bridges the gap.
 *
 * Linux splits that problem in two, and both halves are handled here:
 *
 *   1. **This app's own subprocesses.** There is no registry to re-read, so the
 *      fix is direct: prepend the directories this app manages to the PATH we
 *      hand to every child process. This takes effect immediately and is what
 *      makes "install Node.js then install Claude Code with it" work in one run
 *      — the thing the Windows build cannot do without a restart.
 *
 *   2. **The user's future shells.** A new terminal reads PATH from the login
 *      shell's rc files. We append an export there, idempotently. That change
 *      cannot reach a shell that is already running (only a new shell re-reads
 *      rc files), so the UI is told to say "新开一个终端" rather than "重启应用".
 */

import { execFile } from 'child_process'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, appendFileSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'

import { CLAUDE_PACKAGE, managedBinDirs, npmBinDir, npmPrefixDir } from './components'
import { mergePathEntries, parseVersion, rcFileMentions, splitPathValue } from './pure'

/** Markers so the block we append is identifiable and removable. */
export const RC_BLOCK_BEGIN = '# >>> claude-code-manager >>>'
export const RC_BLOCK_END = '# <<< claude-code-manager <<<'

/** Default probe budget for a `--version` style check. */
const PROBE_TIMEOUT_MS = 30_000

/**
 * Budget for the *first* run of a just-extracted executable.
 *
 * This is the one probe that can legitimately take a long time — 2,447 files
 * were written moments ago and real-time protection may scan them before the
 * binary is allowed to start. A tight cap here would turn "slow but working"
 * into a false failure, so it is deliberately much larger than the normal probe.
 */
export const FIRST_RUN_TIMEOUT_MS = 120_000

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

/**
 * Run a command with a hard deadline, capturing output.
 *
 * Every synchronous probe in the pipeline goes through here. The Windows build
 * documents why a timeout is mandatory: `Command::output()` blocks until the
 * child exits *and* its stdout pipe closes, so one hung probe froze the whole
 * install with no progress and no error.
 *
 * The command is always invoked as an argument array, never a shell string, so
 * no path containing a quote or `;` can alter it.
 */
export function runCapture(
  program: string,
  args: string[],
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<CommandResult> {
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS

  return new Promise<CommandResult>((resolve) => {
    let settled = false
    const child = execFile(
      program,
      args,
      {
        timeout: timeoutMs,
        env: opts.env ?? mergedEnv(),
        cwd: opts.cwd,
        maxBuffer: 8 * 1024 * 1024,
        killSignal: 'SIGKILL',
      },
      (err, stdout, stderr) => {
        if (settled) return
        settled = true
        // `execFile` kills the child with the configured signal on timeout and
        // marks both fields; checking either is enough to distinguish a timeout
        // from a plain non-zero exit.
        const execErr = err as (NodeJS.ErrnoException & { killed?: boolean }) | null
        const timedOut = Boolean(execErr?.killed)
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          timedOut,
        })
      },
    )
    child.on('error', () => {
      if (settled) return
      settled = true
      resolve({ code: 127, stdout: '', stderr: `${program}: not found`, timedOut: false })
    })
  })
}

/** Run a command and return its trimmed stdout, or null if it did not succeed. */
export async function runForOutput(
  program: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<string | null> {
  const result = await runCapture(program, args, opts)
  if (result.code !== 0) return null
  const out = result.stdout.trim()
  return out.length > 0 ? out : null
}

// ---------------------------------------------------------------------------
// PATH refresh
// ---------------------------------------------------------------------------

export interface RefreshedPath {
  /** Directories this app manages, highest priority first. */
  managed: string[]
  /** Managed directories that are NOT already on the process PATH. */
  added: string[]
  /** The merged PATH this app will hand to child processes. */
  merged: string
  /** Whether the refresh changed anything meaningful. */
  changed: boolean
}

/**
 * Compute the PATH this app should use for its subprocesses.
 *
 * Priority is managed-dirs → inherited PATH, which is the reverse of the Windows
 * order (system, then user, then process). The reason is the same though: the
 * most specific writer wins, and here the app *is* the most specific writer.
 * Putting our Node.js ahead of a system Node is intentional — the whole point is
 * that the version we pinned is the one npm and the `claude` shim resolve
 * against.
 */
export function computeRefreshedPath(processPath: string = process.env.PATH ?? ''): RefreshedPath {
  const managed = managedBinDirs()
  const inherited = splitPathValue(processPath)

  // `mergePathEntries` reports what the overlay introduced, so feed the
  // inherited list as base and the managed list as overlay.
  const { merged, added } = mergePathEntries(inherited, managed)

  return {
    managed,
    added,
    merged: merged.join(':'),
    changed: added.length > 0,
  }
}

/**
 * Environment for child processes: the current environment with PATH replaced by
 * the refreshed value.
 *
 * Returning a new object rather than mutating `process.env` keeps the side effect
 * local and makes the function safe to call from tests and from parallel steps.
 */
export function mergedEnv(processPath?: string): NodeJS.ProcessEnv {
  const refreshed = computeRefreshedPath(processPath)
  return { ...process.env, PATH: refreshed.merged }
}

/**
 * Apply the refreshed PATH to this process.
 *
 * Worth doing after a successful install so that any code path that forgets to
 * pass `mergedEnv()` still finds the newly installed tools. It does not help
 * other processes — nothing on Linux can, which is exactly why the rc-file
 * append and the "open a new terminal" guidance exist.
 */
export function refreshProcessPath(): RefreshedPath {
  const refreshed = computeRefreshedPath()
  process.env.PATH = refreshed.merged
  return refreshed
}

// ---------------------------------------------------------------------------
// Shell rc files
// ---------------------------------------------------------------------------

export interface RcUpdateResult {
  /** Files that were modified. */
  updated: string[]
  /** Files that already had the correct export. */
  alreadyPresent: string[]
  /** Files that do not exist and were skipped. */
  skipped: string[]
  /**
   * Files that held more than one managed block and were collapsed to one.
   *
   * Reported separately because it is the signature of an earlier build having
   * appended repeatedly, and it is worth telling the user their rc file was
   * cleaned up rather than silently rewriting it.
   */
  consolidated: string[]
  /** Set when every candidate was skipped, so the UI can explain it. */
  warning: string | null
}

/**
 * Shell rc files a new interactive shell is likely to read.
 *
 * `.bashrc` and `.zshrc` cover the two shells that matter on desktop Linux;
 * `.profile` catches login shells that read no rc file. All three are only
 * touched if they already exist — creating a `.zshrc` for someone who does not
 * use zsh would be an uninvited change to their home directory.
 */
export function rcCandidates(): string[] {
  const home = homedir()
  return [join(home, '.bashrc'), join(home, '.zshrc'), join(home, '.profile')]
}

/**
 * The subset of `dirs` that actually exists as a directory.
 *
 * The shell export is permanent — it lands in the user's rc files and stays there
 * for every future shell — so it must name directories that are really there. The
 * installer's "a Node.js is already present, nothing to do" branch takes no action
 * beyond this, and the managed node directory is never created on such a machine;
 * exporting it anyway put a dead entry on PATH forever on every shell that user
 * opens. `addToShellRc` itself stays a plain writer of what it is handed, which is
 * what its tests exercise; the decision of what deserves exporting lives here.
 */
export function shellPathDirs(dirs: string[]): string[] {
  return dirs.filter((dir) => {
    try {
      return statSync(dir).isDirectory()
    } catch {
      return false
    }
  })
}

/**
 * Append or refresh the PATH export block in the shell rc files.
 *
 * Idempotent by *replacement*, not by append-if-absent. That distinction matters:
 * an earlier revision only checked whether the directories appeared somewhere in
 * the file, so a block written by a buggy build (with a wrong directory) was
 * never corrected — the check saw the npm directory, decided the file was fine,
 * and appended a second block beside the stale one. On the test VM that left
 * `.bashrc` exporting a path that does not exist.
 *
 * The export is prepended (`PATH="$dirs:$PATH"`) rather than appended, because a
 * system Node earlier in PATH would otherwise shadow the version we pinned.
 */
export function addToShellRc(
  dirs: string[] = managedBinDirs(),
  files: string[] = rcCandidates(),
): RcUpdateResult {
  const result: RcUpdateResult = {
    updated: [],
    alreadyPresent: [],
    skipped: [],
    consolidated: [],
    warning: null,
  }
  const exportLine = `export PATH="${dirs.join(':')}:$PATH"`
  const block = [
    RC_BLOCK_BEGIN,
    '# Added by Claude Code Manager. Managed directories are prepended so the',
    '# pinned toolchain wins over any system-wide install.',
    exportLine,
    RC_BLOCK_END,
  ].join('\n')

  for (const file of files) {
    if (!existsSync(file)) {
      result.skipped.push(file)
      continue
    }

    let content = ''
    try {
      content = readFileSync(file, 'utf-8')
    } catch {
      result.skipped.push(file)
      continue
    }

    const blocks = findManagedBlocks(content)

    if (blocks.length > 0) {
      const single = blocks.length === 1 && blocks[0].trim() === block
      if (single) {
        result.alreadyPresent.push(file)
        continue
      }

      try {
        // Rewrite the whole span from the first block to the last, rather than
        // replacing each block individually. Identical blocks produce identical
        // strings, so a per-block `String.replace` call kept removing the same
        // first occurrence and left the rest behind — which is how three blocks
        // survived a pass that was supposed to collapse them.
        const first = content.indexOf(RC_BLOCK_BEGIN)
        const lastEnd = content.lastIndexOf(RC_BLOCK_END) + RC_BLOCK_END.length
        const next = (content.slice(0, first) + block + content.slice(lastEnd)).replace(
          /\n{3,}/g,
          '\n\n',
        )
        writeFileSync(file, next, 'utf-8')
        result.updated.push(file)
        if (blocks.length > 1) result.consolidated.push(file)
      } catch {
        result.skipped.push(file)
      }
      continue
    }

    // No managed block. Check for a hand-written export naming all our
    // directories before adding one, so we do not duplicate a user's own line.
    const allPresent = dirs.every((dir) => rcFileMentions(content, dir))
    if (allPresent) {
      result.alreadyPresent.push(file)
      continue
    }

    try {
      appendFileSync(file, `\n${block}\n`, 'utf-8')
      result.updated.push(file)
    } catch {
      result.skipped.push(file)
    }
  }

  if (result.updated.length === 0 && result.alreadyPresent.length === 0) {
    result.warning =
      '未能写入任何 shell 配置文件。请手动把以下目录加入 PATH：' + dirs.join(':')
  }

  return result
}

/** Every managed block in the file, in order. */
function findManagedBlocks(content: string): string[] {
  const blocks: string[] = []
  let cursor = 0
  for (;;) {
    const begin = content.indexOf(RC_BLOCK_BEGIN, cursor)
    if (begin === -1) break
    const end = content.indexOf(RC_BLOCK_END, begin)
    if (end === -1) break
    blocks.push(content.slice(begin, end + RC_BLOCK_END.length))
    cursor = end + RC_BLOCK_END.length
  }
  return blocks
}

/** Extract the managed block verbatim, or null when the file has none. */
function readManagedBlock(content: string): string | null {
  const begin = content.indexOf(RC_BLOCK_BEGIN)
  if (begin === -1) return null
  const end = content.indexOf(RC_BLOCK_END, begin)
  if (end === -1) return null
  return content.slice(begin, end + RC_BLOCK_END.length)
}

/**
 * Remove the block this app appended, leaving anything else untouched.
 *
 * `files` is injectable for the same reason as in `addToShellRc`: a test must be
 * able to exercise the removal without editing the developer's real rc files.
 */
export function removeFromShellRc(files: string[] = rcCandidates()): string[] {
  const cleaned: string[] = []
  for (const file of files) {
    if (!existsSync(file)) continue
    try {
      const content = readFileSync(file, 'utf-8')
      const blocks = findManagedBlocks(content)
      if (blocks.length === 0) continue
      // Same span removal as the add path, for the same reason: a per-block
      // replace would only ever drop the first occurrence.
      const first = content.indexOf(RC_BLOCK_BEGIN)
      const lastEnd = content.lastIndexOf(RC_BLOCK_END) + RC_BLOCK_END.length
      const next = (content.slice(0, first) + content.slice(lastEnd))
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd()
      writeFileSync(file, next + '\n', 'utf-8')
      cleaned.push(file)
    } catch {
      // Best effort; a read-only rc file is not worth failing an uninstall over.
    }
  }
  return cleaned
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface ToolInfo {
  installed: boolean
  version: string | null
  path: string | null
}

const notInstalled: ToolInfo = { installed: false, version: null, path: null }

/** Resolve a program on the refreshed PATH, returning its absolute path. */
export async function which(program: string): Promise<string | null> {
  const out = await runForOutput('which', [program])
  return out ? out.split('\n')[0].trim() : null
}

/**
 * Resolve an executable by walking a PATH, without spawning anything.
 *
 * The synchronous twin of `which`, and deliberately a different implementation:
 * `which` is not a POSIX utility and ships as its own package on minimal Debian
 * installs, so a PATH-narrowed lookup cannot rely on finding it *on that PATH*.
 * Walking the directories answers about the PATH it was given and nothing else.
 *
 * Callers that only hold a PATH string — and cannot await — should use this rather
 * than `execSync('which …')`, which silently answers about the process PATH
 * instead. That substitution is what made detection depend on how the app was
 * launched: right after an install, wrong after a reboot.
 */
export function resolveOnPath(program: string, pathValue: string): string | null {
  if (program.includes('/')) return isExecutableFile(program) ? program : null
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, program)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
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
 * Detect a tool by running it with a specific argument and parsing the version.
 *
 * Detection runs the probe rather than trusting `which` alone: a `claude` shim
 * whose native binary never landed is on PATH and still fails, and reporting
 * that as "installed" is precisely the bug the Windows build calls out.
 */
export async function detectTool(
  program: string,
  versionArg = '--version',
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ToolInfo> {
  const path = await which(program)
  if (!path) return notInstalled

  const result = await runCapture(program, [versionArg], { timeoutMs })
  if (result.code !== 0) return { installed: false, version: null, path }

  const version = parseVersion(result.stdout) ?? parseVersion(result.stderr)
  if (!version) return { installed: false, version: null, path }

  return { installed: true, version, path }
}

export interface ClaudeDetection extends ToolInfo {
  /** The package directory exists but no runnable binary does. */
  packagePresentButBroken: boolean
  installSource: 'managed-npm' | 'system' | null
}

/**
 * Detect Claude Code, distinguishing "absent" from "unpacked but not runnable".
 *
 * That second state is a distinct failure with a distinct fix (re-install with
 * `--include=optional` to pull the platform binary), and collapsing it into
 * "not installed" is what leaves a user staring at a successful-looking install
 * while their terminal says command not found.
 */
export async function detectClaudeCode(): Promise<ClaudeDetection> {
  const info = await detectTool('claude')

  const managed = npmBinDir()
  const installSource: ClaudeDetection['installSource'] = info.path
    ? info.path.startsWith(managed)
      ? 'managed-npm'
      : 'system'
    : null

  if (info.installed) {
    return { ...info, packagePresentButBroken: false, installSource }
  }

  return {
    ...info,
    packagePresentButBroken: claudePackagePresentButBroken(),
    installSource,
  }
}

/**
 * Whether the npm package directory exists without a runnable entry point.
 *
 * The wrapper unpacks to `<prefix>/lib/node_modules/@anthropic-ai/claude-code`;
 * if its postinstall could not fetch the ~220 MB platform binary, the directory
 * is there and `claude` still does not run.
 */
export function claudePackagePresentButBroken(): boolean {
  const pkgDir = join(npmPrefixDir(), 'lib', 'node_modules', ...CLAUDE_PACKAGE.split('/'))
  if (!existsSync(pkgDir)) return false
  return !existsSync(join(npmBinDir(), 'claude'))
}

/** Whether a `claude` binary exists anywhere we look, without running it. */
export function anyClaudeOnDisk(): boolean {
  return ['/usr/local/bin/claude', '/usr/bin/claude', join(homedir(), '.claude', 'local', 'claude')].some(
    (p) => existsSync(p),
  )
}

/**
 * Force the managed npm install even when another `claude` already resolves.
 *
 * Set `CCM_FORCE_MANAGED_CLAUDE=1`. The same rationale as `CCM_FORCE_PORTABLE`:
 * on a machine that already has Claude Code — installed by Anthropic's own
 * native installer, say — the short-circuit means the npm path is never
 * exercised, and verification there would silently test nothing.
 */
export function forceManagedClaude(): boolean {
  return process.env.CCM_FORCE_MANAGED_CLAUDE === '1'
}

export interface SystemInfo {
  distro: string
  distroVersion: string
  kernel: string
  arch: string
  node: ToolInfo
  npm: ToolInfo
  git: ToolInfo
  claude: ClaudeDetection
  hasApt: boolean
  hasTarXz: boolean
}

/** Whether the bundled `tar` can decompress xz, i.e. whether extraction will work. */
export async function hasTarXz(): Promise<boolean> {
  const tarPath = await which('tar')
  if (!tarPath) return false
  // `tar --help` mentions xz on any build configured with liblzma; checking the
  // archive directly is deferred to extraction time.
  const result = await runCapture('tar', ['--version'], { timeoutMs: 5000 })
  return result.code === 0
}

export async function detectSystem(): Promise<SystemInfo> {
  const [distro, distroVersion, kernel, node, npm, git, claude, aptPath, tarOk] = await Promise.all([
    runForOutput('sh', ['-c', '. /etc/os-release 2>/dev/null && printf %s "$NAME"']),
    runForOutput('sh', ['-c', '. /etc/os-release 2>/dev/null && printf %s "$VERSION_ID"']),
    runForOutput('uname', ['-r']),
    detectTool('node'),
    detectTool('npm'),
    detectTool('git'),
    detectClaudeCode(),
    which('apt-get'),
    hasTarXz(),
  ])

  return {
    distro: distro ?? 'unknown',
    distroVersion: distroVersion ?? '',
    kernel: kernel ?? 'unknown',
    arch: process.arch,
    node,
    npm,
    git,
    claude,
    hasApt: aptPath !== null,
    hasTarXz: tarOk,
  }
}

/** Ensure the directories this app owns exist. */
export function ensureManagedDirs(): void {
  for (const dir of [npmBinDir(), ...managedBinDirs()]) {
    mkdirSync(dir, { recursive: true })
  }
}
