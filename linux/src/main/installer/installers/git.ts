/**
 * Git component installer.
 *
 * Git is *optional* for Claude Code, and the Rust build says so in its plan
 * output ("Optional"). That changes the failure contract: a Git that cannot be
 * installed is reported and the pipeline continues, because refusing to install
 * Claude Code over a missing optional tool would be the wrong trade.
 *
 * Source strategy differs from Node.js on purpose. Git is available from every
 * distribution's signed repositories, and there is no single upstream tarball
 * worth racing mirrors for: building Git from source to avoid `apt` would trade a
 * signed-package trust chain for a digest we would have to pin and maintain. So
 * this installer prefers `apt-get` and has no download mirror race.
 */

import { existsSync } from 'fs'

import { detectTool, runCapture, which } from '../env'
import { stepOk, stepFail, type InstallStepResult } from '../types'
import { stage, throwIfCancelled, type InstallContext } from './context'

const COMPONENT = 'git' as const

/** Generous: apt may need to refresh indexes over a slow mirror. */
const APT_TIMEOUT_MS = 300_000

export async function installGit(ctx: InstallContext): Promise<InstallStepResult> {
  // ---- Stage 1: already installed? -------------------------------------
  const existing = await detectTool('git')
  if (existing.installed && existing.version) {
    ctx.log('info', `Git ${existing.version} already installed at ${existing.path}`)
    stage(ctx, COMPONENT, 'installing', `Git ${existing.version} 已安装`)
    return stepOk(COMPONENT, existing.version, `Git ${existing.version} 已安装`)
  }

  throwIfCancelled(ctx)

  // ---- apt path ---------------------------------------------------------
  const aptGet = await which('apt-get')
  if (!aptGet) {
    ctx.log('warn', 'apt-get not found; Git installation skipped')
    return stepFail(
      COMPONENT,
      '未找到 apt-get（非 Debian 系发行版）。Git 为可选项，可稍后手动安装。',
    )
  }

  stage(ctx, COMPONENT, 'installing', '通过 apt 安装 Git...')

  // `apt-get install` needs root. Elevation is attempted only here, and only
  // after the user has asked for a full environment install — the Windows build
  // follows the same rule ("elevate only for specific operations with clear user
  // consent").
  const result = await runApt(aptGet, ['install', '-y', 'git'])

  if (result.code !== 0) {
    const stderr = result.stderr.trim()
    const needsPassword = /sudo:|terminal is required|no tty|a password is required/i.test(stderr)
    ctx.log('error', `Git install failed: ${stderr || `exit ${result.code}`}`)

    return stepFail(
      COMPONENT,
      needsPassword
        ? '安装 Git 需要管理员权限，但当前环境无法弹出密码提示。请在终端执行：sudo apt install -y git'
        : `Git 安装失败：${firstLine(stderr) || `apt 退出码 ${result.code}`}`,
    )
  }

  // ---- Verify after install --------------------------------------------
  const installed = await detectTool('git')
  if (installed.installed && installed.version) {
    ctx.log('info', `Git ${installed.version} installed`)
    return stepOk(COMPONENT, installed.version, `Git ${installed.version} 安装完成`)
  }

  // apt claimed success but the binary is not usable. Report honestly instead
  // of letting the user find out later.
  return stepFail(
    COMPONENT,
    'apt 报告安装成功，但 git 仍不可用。请在终端执行 git --version 确认。',
  )
}

/**
 * Run apt, preferring a non-interactive sudo.
 *
 * Tries `sudo -n` first: when the user has a valid cached credential, this
 * succeeds silently instead of hanging on a password prompt that has nowhere to
 * appear in a GUI process. Falling back to plain `apt-get` covers the case where
 * the app itself is already running as root.
 */
async function runApt(aptGet: string, args: string[]): Promise<{ code: number; stderr: string }> {
  const direct = await runCapture(aptGet, args, { timeoutMs: APT_TIMEOUT_MS })
  if (direct.code === 0) return direct

  // A non-root apt-get fails immediately with a permissions error; retry under
  // sudo. `-n` (non-interactive) is what keeps this from blocking forever.
  const sudoPath = await which('sudo')
  if (!sudoPath) return direct

  const elevated = await runCapture(sudoPath, ['-n', aptGet, ...args], { timeoutMs: APT_TIMEOUT_MS })
  return elevated.code === 0 ? elevated : elevated
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0)
  return line ? line.trim().slice(0, 300) : ''
}

/** Whether Git is present, for the planning step. */
export async function planGit(): Promise<InstallStepResult> {
  const git = await detectTool('git')
  if (git.installed && git.version) {
    return stepOk(COMPONENT, git.version, '已安装')
  }
  // "Optional" is the honest label: the pipeline continues without it.
  return { component: COMPONENT, success: false, version: null, message: '可选' }
}

/** Whether a git binary exists anywhere we look, without running it. */
export function gitPresentOnDisk(): boolean {
  return existsSync('/usr/bin/git') || existsSync('/usr/local/bin/git')
}
