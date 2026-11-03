/**
 * Headless pipeline driver, for verifying the installer on a machine with no
 * display (a VM, a server, CI).
 *
 * The Electron GUI cannot start without an X/Wayland session, so the only way to
 * exercise the real pipeline on a headless box is to drive it from a terminal.
 * This entry point bundles together with the engine into one self-contained file
 * — the engine imports nothing but Node builtins — so the target machine needs
 * only a Node.js runtime, no `npm install`.
 *
 * It is a verification tool, not a product surface. It deliberately duplicates
 * nothing: every stage it runs is the same code the GUI's IPC layer calls.
 *
 * Usage:
 *   node ccm-installer.cjs detect            # read-only environment report
 *   node ccm-installer.cjs plan              # read-only install plan
 *   node ccm-installer.cjs install           # the full pipeline
 *   node ccm-installer.cjs install node      # one component
 *   node ccm-installer.cjs cache             # inspect the download cache
 *
 * Flags:
 *   --yes     skip the confirmation prompt (for scripted runs)
 *   --dry-run test mirror selection and cache state without downloading
 */

import { existsSync, readdirSync } from 'fs'
import { createInterface } from 'readline'
import { join } from 'path'

import { InstallPipeline } from './index'
import { CACHE_DIR, NODE_SHA256, NODE_SOURCES, NODE_VERSION, npmBinDir, nodeBinDir } from './components'
import { archiveStamp, readMarker } from './cache'
import { addToShellRc, computeRefreshedPath, detectSystem, refreshProcessPath } from './env'
import { selectFastestCandidate } from './source'
import { nodeArchiveName, nodeArchiveUrl } from './components'
import type { ComponentId, DownloadProgress, TaskState } from './types'

const argv = process.argv.slice(2)
const command = argv.find((a) => !a.startsWith('-')) ?? 'detect'
const flags = new Set(argv.filter((a) => a.startsWith('-')))
const componentArg = argv.filter((a) => !a.startsWith('-'))[1] as ComponentId | undefined

const ok = (s: string): string => `\x1b[32m${s}\x1b[0m`
const bad = (s: string): string => `\x1b[31m${s}\x1b[0m`
const warn = (s: string): string => `\x1b[33m${s}\x1b[0m`
const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`
const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** One line per progress event, overwritten in place so the log stays readable. */
let lastProgressLine = ''
function renderProgress(event: DownloadProgress): void {
  if (event.stage !== 'downloading') {
    if (lastProgressLine) {
      process.stdout.write('\n')
      lastProgressLine = ''
    }
    console.log(dim(`  · ${event.componentLabel}: ${event.stage}${event.sourceId ? ` (${event.sourceId})` : ''}`))
    return
  }
  const line =
    `  · ${event.componentLabel} ${event.percent.toFixed(1)}%` +
    ` ${formatBytes(event.speedBytesPerSec)}/s` +
    (event.totalBytes > 0 ? ` (${formatBytes(event.downloadedBytes)}/${formatBytes(event.totalBytes)})` : '')
  process.stdout.write(`\r${line.padEnd(lastProgressLine.length)}`)
  lastProgressLine = line
}

function renderTask(state: TaskState): void {
  if (state.status === 'running') return
  if (lastProgressLine) {
    process.stdout.write('\n')
    lastProgressLine = ''
  }
  const mark =
    state.status === 'success' ? ok('✓') : state.status === 'cancelled' ? warn('⊘') : bad('✗')
  console.log(`${mark} ${state.title} — ${state.status}${state.error ? `: ${state.error}` : ''}`)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdDetect(): Promise<void> {
  const system = await detectSystem()

  console.log(bold('\n系统'))
  console.log(`  发行版      ${system.distro} ${system.distroVersion}`.trimEnd())
  console.log(`  内核        ${system.kernel}`)
  console.log(`  架构        ${system.arch}`)

  console.log(bold('\n工具链'))
  const row = (label: string, info: { installed: boolean; version: string | null; path: string | null }): void => {
    const mark = info.installed ? ok('✓') : dim('·')
    console.log(`  ${mark} ${label.padEnd(12)}${info.version ?? dim('未安装')}${info.path ? dim(`  ${info.path}`) : ''}`)
  }
  row('Node.js', system.node)
  row('npm', system.npm)
  row('Git', system.git)

  const c = system.claude
  const mark = c.installed ? ok('✓') : dim('·')
  console.log(
    `  ${mark} ${'Claude Code'.padEnd(12)}${c.version ?? dim(c.packagePresentButBroken ? '安装不完整' : '未安装')}` +
      (c.installSource ? dim(`  (${c.installSource})`) : ''),
  )

  console.log(bold('\n前置条件'))
  console.log(`  ${system.hasTarXz ? ok('✓') : bad('✗')} tar 可用（xz 解压）`)
  console.log(`  ${system.hasApt ? ok('✓') : warn('·')} apt-get 可用${system.hasApt ? '' : '（非 Debian 系，Git 需手动装）'}`)

  const path = computeRefreshedPath()
  console.log(bold('\nPATH'))
  console.log(`  受管目录:`)
  for (const dir of path.managed) {
    const exists = existsSync(dir)
    console.log(`    ${exists ? ok('✓') : dim('·')} ${dir}${path.added.includes(dir) ? warn('  [本次新增]') : ''}`)
  }
  console.log(`  ${dim(`进程 PATH 共 ${path.merged.split(':').length} 项`)}`)
  console.log()
}

async function cmdPlan(): Promise<void> {
  const pipeline = new InstallPipeline({ onProgress: () => undefined, onTask: () => undefined })
  const plan = await pipeline.plan()

  console.log(bold('\n安装计划'))
  for (const item of plan) {
    const mark = item.success ? ok('✓ 已装') : warn('· 待装')
    console.log(`  ${mark}  ${item.component.padEnd(14)}${item.version ?? item.message}`)
  }
  console.log()
}

async function cmdCache(): Promise<void> {
  console.log(bold('\n下载缓存'))
  console.log(`  目录: ${CACHE_DIR}`)

  let files: string[] = []
  try {
    files = readdirSync(CACHE_DIR)
  } catch {
    console.log(dim('  （缓存目录不存在，尚未下载过任何东西）\n'))
    return
  }

  if (files.length === 0) {
    console.log(dim('  （空）\n'))
    return
  }

  for (const name of files) {
    const full = join(CACHE_DIR, name)
    const stamp = archiveStamp(full)
    if (!stamp) continue
    if (name.endsWith('.verified.json')) continue

    const partial = name.endsWith('.part')
    const marker = readMarker(full)
    const verified = !partial && marker?.size === stamp.size
    const state = partial ? warn('未完成') : verified ? ok('已校验') : dim('未校验')
    console.log(`  ${state}  ${name}  ${formatBytes(stamp.size)}`)
    if (marker && !partial) console.log(dim(`            sha256 ${marker.sha256}`))
  }
  console.log()
}

/**
 * Read-only rehearsal of the download decision: race the mirrors, report cache
 * state, and stop before anything is written.
 */
async function cmdDryRun(): Promise<void> {
  console.log(bold('\n镜像测速（只读，不下载）'))
  const filename = nodeArchiveName()

  const candidates = NODE_SOURCES.map((s) => ({ id: s.id, url: nodeArchiveUrl(s.baseUrl) }))
  const started = Date.now()

  // Probe each mirror individually so the report shows every latency, not just
  // the winner — that is the whole point of a dry run.
  const probes = await Promise.all(
    candidates.map(async (c) => {
      const t0 = Date.now()
      try {
        const res = await fetch(c.url, { method: 'HEAD', signal: AbortSignal.timeout(2500) })
        await res.arrayBuffer().catch(() => undefined)
        return { id: c.id, ok: res.ok, ms: Date.now() - t0, size: Number(res.headers.get('content-length') ?? 0) }
      } catch {
        return { id: c.id, ok: false, ms: Date.now() - t0, size: 0 }
      }
    }),
  )

  for (const p of probes) {
    const mark = p.ok ? ok('✓') : bad('✗')
    const label = NODE_SOURCES.find((s) => s.id === p.id)?.label ?? p.id
    console.log(
      `  ${mark} ${label.padEnd(10)}${p.ok ? `${String(p.ms).padStart(6)}ms` : '  不可达'}` +
        (p.size > 0 ? dim(`  ${formatBytes(p.size)}`) : ''),
    )
  }

  const winner = await selectFastestCandidate(candidates)
  console.log(`\n  选定源: ${bold(winner.id)} ${dim(winner.url)}`)
  console.log(dim(`  总耗时 ${Date.now() - started}ms`))

  console.log(bold('\n速度对比参考'))
  console.log(dim(`  归档  ${filename}`))
  console.log(dim(`  钉死  ${NODE_SHA256[filename] ?? '（此架构无内置摘要）'}`))

  const archive = join(CACHE_DIR, filename)
  const stamp = archiveStamp(archive)
  console.log(
    `  缓存  ${stamp ? `${formatBytes(stamp.size)}${readMarker(archive) ? ' · 有标记' : ''}` : dim('未缓存')}`,
  )
  console.log()
}

async function confirm(question: string): Promise<boolean> {
  if (flags.has('--yes')) return true
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise<string>((resolve) => rl.question(`${question} [y/N] `, resolve))
  rl.close()
  return /^y(es)?$/i.test(answer.trim())
}

async function cmdInstall(): Promise<void> {
  // The pipeline is push-based, so completion arrives through the task sink.
  // Resolving this deferred from there is the entire wait mechanism — no polling.
  let resolveDone: (state: TaskState) => void = () => undefined
  const finished = new Promise<TaskState>((resolve) => {
    resolveDone = resolve
  })

  const pipeline = new InstallPipeline({
    onProgress: renderProgress,
    onTask: (state) => {
      renderTask(state)
      if (state.status === 'success' || state.status === 'failed' || state.status === 'cancelled') {
        resolveDone(state)
      }
    },
  })

  const target = componentArg ?? null

  console.log(bold(`\n开始安装${target ? ` ${target}` : '完整环境'}`))
  console.log(dim('  将写入应用数据目录、修改 PATH，并把 export 追加到 shell rc 文件\n'))

  const proceed = await confirm(
    target ? `确认安装 ${target}？` : '确认安装完整环境（Node.js + Git + Claude Code）？',
  )
  if (!proceed) {
    console.log(warn('已取消，未做任何改动。\n'))
    return
  }

  if (target) pipeline.startComponent(target)
  else pipeline.startFull()

  // Ctrl+C should stop the download rather than orphan it.
  const onSigint = (): void => {
    for (const state of pipeline.tasks.all()) {
      if (state.status === 'running' || state.status === 'queued') pipeline.cancel(state.id)
    }
    console.log(warn('\n已请求取消...'))
  }
  process.on('SIGINT', onSigint)

  let outcome: TaskState
  try {
    outcome = await finished
  } finally {
    process.off('SIGINT', onSigint)
  }

  if (lastProgressLine) {
    process.stdout.write('\n')
    lastProgressLine = ''
  }

  // Post-run report, re-detected rather than inferred from what we just did.
  console.log(bold('\n结果'))
  refreshProcessPath()
  const system = await detectSystem()
  const row = (label: string, info: { installed: boolean; version: string | null }): void => {
    console.log(`  ${info.installed ? ok('✓') : bad('✗')} ${label.padEnd(12)}${info.version ?? '未安装'}`)
  }
  row('Node.js', system.node)
  row('npm', system.npm)
  row('Git', system.git)
  row('Claude Code', system.claude)

  if (outcome.status === 'failed' && outcome.error) {
    console.log(bad(`\n失败原因: ${outcome.error}`))
  }

  if (system.claude.installed) {
    const rc = addToShellRc()
    console.log(bold('\nPATH'))
    console.log(`  node   ${nodeBinDir()}`)
    console.log(`  claude ${npmBinDir()}`)
    if (rc.updated.length > 0) console.log(ok(`  已写入 ${rc.updated.join('、')}`))
    if (rc.alreadyPresent.length > 0) console.log(dim(`  已存在 ${rc.alreadyPresent.join('、')}`))
    console.log(warn('  已打开的终端不会自动生效 —— 请新开一个终端后运行 claude'))
  }
  console.log()
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  switch (command) {
    case 'detect':
      await cmdDetect()
      break
    case 'plan':
      await cmdPlan()
      break
    case 'cache':
      await cmdCache()
      break
    case 'dry-run':
      await cmdDryRun()
      break
    case 'install':
      await cmdInstall()
      break
    default:
      console.log(`
用法: node ccm-installer.cjs <命令> [组件] [--yes] [--dry-run]

命令:
  detect            只读：环境检测报告
  plan              只读：安装计划
  cache             只读：下载缓存状态
  dry-run           只读：镜像测速 + 缓存状态，不下载
  install           执行安装（完整环境）
  install node      只装 Node.js
  install git       只装 Git
  install claude-code  只装 Claude Code

标志:
  --yes             跳过确认提示
`)
  }
}

main().catch((e) => {
  console.error(bad(`\n失败: ${e instanceof Error ? e.message : String(e)}`))
  if (e && typeof e === 'object' && 'suggestions' in e) {
    for (const s of (e as { suggestions?: string[] }).suggestions ?? []) console.error(dim(`  · ${s}`))
    if ((e as { details?: string }).details) console.error(dim(`  技术细节: ${(e as { details?: string }).details}`))
  }
  process.exit(1)
})
