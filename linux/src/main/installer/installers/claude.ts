/**
 * Claude Code component installer — npm based.
 *
 * Follows the Rust build's `install_claude`, including the three things that
 * version learned the hard way:
 *
 *   1. **Preflight with the same PATH you will execute with.** Checking npm
 *      availability with one PATH and running it with another is what let
 *      "npm 可用" and "npm 不是内部或外部命令" both be true in a single run.
 *   2. **Restore any global config you touch.** The Windows build switched the
 *      global npm registry and restored it unconditionally, including on error
 *      and cancellation. This version goes one better: it passes the registry as
 *      an environment variable instead of mutating global config at all, so
 *      there is nothing to restore.
 *   3. **Treat "package present but no runnable binary" as its own failure.**
 *      npm unpacks the wrapper, then its postinstall fetches the ~220 MB platform
 *      binary. When that fetch does not happen the directory is there and
 *      `claude` still does not run; reporting success at that point is exactly
 *      what leaves a user with a terminal that says command not found.
 */

import { existsSync } from 'fs'
import { join } from 'path'

import {
  CLAUDE_PACKAGE,
  NPM_FAST_FLAGS,
  NPM_MIRROR,
  NPM_OFFICIAL_REGISTRY,
  npmBinDir,
  npmPrefixDir,
} from '../components'
import { detectClaudeCode, computeRefreshedPath, forceManagedClaude, refreshProcessPath, runCapture, runForOutput, which } from '../env'
import { AppError, codes } from '../errors'
import { stepFail, stepOk, type InstallStepResult } from '../types'
import { stage, throwIfCancelled, type InstallContext } from './context'

const COMPONENT = 'claude-code' as const

/** npm install budget. The platform binary is ~220 MB. */
const NPM_INSTALL_TIMEOUT_MS = 300_000

/** Budget for the repair re-install, which downloads the platform binary again. */
const NPM_REPAIR_TIMEOUT_MS = 900_000

export async function installClaudeCode(ctx: InstallContext): Promise<InstallStepResult> {
  // ---- Stage 1: already installed? -------------------------------------
  const existing = await detectClaudeCode()
  if (existing.installed && existing.version && !forceManagedClaude()) {
    ctx.log('info', `Claude Code ${existing.version} already installed (${existing.installSource})`)
    stage(ctx, COMPONENT, 'installing', `Claude Code ${existing.version} 已安装`)
    return stepOk(COMPONENT, existing.version, `Claude Code ${existing.version} 已安装`)
  }
  if (existing.installed && forceManagedClaude()) {
    ctx.log(
      'info',
      `CCM_FORCE_MANAGED_CLAUDE=1 — ignoring ${existing.path} and installing into the managed npm prefix`,
    )
  }

  throwIfCancelled(ctx)

  // ---- Preflight: npm reachable on the PATH we will actually use --------
  const npmPath = await which('npm')
  if (!npmPath) {
    ctx.log('error', 'npm is not available; Node.js must be installed first')
    return stepFail(
      COMPONENT,
      'npm 不可用，请先完成 Node.js 安装。若刚装完 Node.js，请重试本步骤。',
    )
  }

  const npmVersion = await runForOutput('npm', ['--version'])
  if (!npmVersion) {
    ctx.log('error', `npm found at ${npmPath} but is not runnable with the current PATH`)
    return stepFail(
      COMPONENT,
      `npm 存在（${npmPath}）但无法执行。请重启应用后重试。`,
    )
  }
  ctx.log('info', `npm ${npmVersion} reachable via refreshed PATH`)

  // ---- Registry mirror ------------------------------------------------
  const originalRegistry = await readNpmRegistry(ctx)

  stage(ctx, COMPONENT, 'installing', `安装 ${CLAUDE_PACKAGE}...`)

  const install = await runNpmGlobal(ctx, 'install', [
    ...NPM_FAST_FLAGS,
    '--include=optional',
  ], NPM_INSTALL_TIMEOUT_MS)

  // ---- Verify ----------------------------------------------------------
  stage(ctx, COMPONENT, 'verifying', '验证安装...')
  refreshProcessPath()

  // Verify the artifact we produced, not whatever `which` happens to resolve.
  // On a machine that already had a `claude` on PATH — Anthropic's native
  // installer puts one in /usr/local/bin — a `which`-based check would report
  // success no matter what npm actually did.
  let installed = await verifyManagedInstall()
  ctx.log(
    'info',
    installed.installed
      ? `managed shim verified at ${installed.path}`
      : `managed shim not usable yet (${installed.path ?? 'absent'})`,
  )

  // ---- Self-repair: wrapper unpacked, platform binary missing ----------
  if (!installed.installed && managedPackagePresentButBroken()) {
    ctx.log(
      'warn',
      'claude-code package present but no runnable binary; attempting repair re-install',
    )
    stage(ctx, COMPONENT, 'installing', '安装不完整，正在补装原生程序（约 220MB）...')

    await runNpmGlobal(ctx, 'install', ['--include=optional', '--force'], NPM_REPAIR_TIMEOUT_MS)
    refreshProcessPath()
    installed = await verifyManagedInstall()
  }

  if (installed.installed && installed.version) {
    ctx.log('info', `Claude Code ${installed.version} installed to the managed prefix`)
    return stepOk(
      COMPONENT,
      installed.version,
      `Claude Code ${installed.version} 安装完成（托管于 ${npmBinDir()}）`,
    )
  }

  // ---- Failure, with the specific cause named --------------------------
  if (managedPackagePresentButBroken()) {
    return stepFail(
      COMPONENT,
      'Claude Code 安装不完整：npm 包已下载，但原生程序（约 220MB）没有装上。\n' +
        '常见原因是 npm 配置了 omit=optional，或该二进制下载失败。\n' +
        `请在终端执行：npm config get omit（应不含 optional），然后重试；\n` +
        `或手动执行：npm install -g ${CLAUDE_PACKAGE} --include=optional --prefix ${npmPrefixDir()}`,
    )
  }

  const detail = firstLines(`${install.stdout}\n${install.stderr}`, 400)
  return stepFail(
    COMPONENT,
    detail.length > 0
      ? `Claude Code 验证失败：\n${detail}`
      : `Claude Code 验证失败。请在终端手动执行 npm install -g ${CLAUDE_PACKAGE} --prefix ${npmPrefixDir()} 查看原因。`,
  )
}

/**
 * Verify the shim this pipeline produces, at the path this pipeline owns.
 *
 * Deliberately not `which claude`: that answers "is some Claude Code reachable",
 * which is a different and much weaker question once any other install exists.
 */
async function verifyManagedInstall(): Promise<{
  installed: boolean
  version: string | null
  path: string | null
}> {
  const shim = claudeShimPath()
  if (!existsSync(shim)) return { installed: false, version: null, path: shim }

  // Run it with the managed bin dirs prepended, which is exactly the PATH the
  // app hands its children — the shim needs its sibling `node` to resolve.
  const env = { ...process.env, PATH: computeRefreshedPath().merged }
  const probe = await runCapture(shim, ['--version'], { timeoutMs: 60_000, env })
  const version = probe.code === 0 ? /(\d+\.\d+\.\d+)/.exec(probe.stdout)?.[1] ?? null : null

  return { installed: version !== null, version, path: shim }
}

/** Whether the npm package directory exists without a runnable shim beside it. */
function managedPackagePresentButBroken(): boolean {
  const pkgDir = join(npmPrefixDir(), 'lib', 'node_modules', ...CLAUDE_PACKAGE.split('/'))
  if (!existsSync(pkgDir)) return false
  return !existsSync(claudeShimPath())
}

/**
 * Run a global npm install into this app's own prefix.
 *
 * The registry is supplied through `npm_config_registry` rather than
 * `npm config set`. That is strictly better than the Windows build's
 * switch-and-restore dance: an environment variable cannot leak into the user's
 * `~/.npmrc`, so there is no window in which a crash leaves their global npm
 * pointed at a mirror, and no restore call that a cancelled operation can skip.
 */
async function runNpmGlobal(
  ctx: InstallContext,
  verb: 'install' | 'uninstall',
  extra: readonly string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const registry = ctx.registryOverride ?? NPM_MIRROR

  const env = {
    ...process.env,
    npm_config_registry: registry,
    npm_config_prefix: npmPrefixDir(),
    // Suppress the update-notifier's network call and its progress spam.
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
  }

  const result = await runCapture(
    'npm',
    [verb, '-g', CLAUDE_PACKAGE, ...extra],
    { timeoutMs, env },
  )

  if (result.timedOut) {
    throw new AppError({
      code: codes.FAILED,
      title: 'npm 超时',
      message: `npm ${verb} 超过 ${Math.round(timeoutMs / 1000)} 秒未完成。`,
      suggestions: ['检查网络后重试', '确认磁盘剩余空间充足'],
      retryable: true,
    })
  }

  return { code: result.code, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Read the user's configured registry so the default can be honoured.
 *
 * If they have already pointed npm at a mirror, that mirror is used and the
 * built-in one is not forced on them.
 */
async function readNpmRegistry(ctx: InstallContext): Promise<string> {
  const configured = await runForOutput('npm', ['config', 'get', 'registry'])
  if (!configured) {
    ctx.registryOverride = NPM_MIRROR
    return NPM_OFFICIAL_REGISTRY
  }

  const isMirror = /npmmirror|taobao|tencent|huawei|ustc|tuna/i.test(configured)
  ctx.registryOverride = isMirror ? configured : NPM_MIRROR

  if (!isMirror) {
    ctx.log(
      'info',
      `npm registry is ${configured}; using ${NPM_MIRROR} for this install via npm_config_registry (global config untouched)`,
    )
  }
  return configured
}

function firstLines(text: string, max: number): string {
  const cleaned = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned
}

/** Availability probe for the planning step. */
export async function planClaudeCode(): Promise<InstallStepResult> {
  const claude = await detectClaudeCode()
  if (claude.installed && claude.version) {
    return stepOk(COMPONENT, claude.version, '已安装')
  }
  if (claude.packagePresentButBroken) {
    return stepFail(COMPONENT, '安装不完整（需补装原生程序）')
  }
  return { component: COMPONENT, success: false, version: null, message: '需要安装' }
}

/** Path the `claude` shim should land at, exported for the UI. */
export function claudeShimPath(): string {
  return join(npmBinDir(), 'claude')
}

/** Whether the shim exists on disk, regardless of whether it runs. */
export function claudeShimPresent(): boolean {
  return existsSync(claudeShimPath())
}
