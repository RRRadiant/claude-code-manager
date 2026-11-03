/**
 * Node.js component installer — the portable-archive pipeline.
 *
 * Follows the eight-stage contract from the Rust build's `installer.rs` header,
 * with the Linux equivalents substituted where the platform differs:
 *
 *   1. Check if already installed      (probe with the refreshed PATH)
 *   2. Select source                   (concurrent mirror race)
 *   3. Cache decision                   (marker -> skip hash; else re-hash)
 *   4. Download                         (.part + Range resume + retries)
 *   5. Verify                           (pinned SHA256, cross-checked vs mirror)
 *   6. Extract                          (tar -xJf, strip top-level dir)
 *   7. Verify the extracted binary      (wide first-run budget)
 *   8. Put it on PATH                   (process PATH now, shell rc for later)
 *
 * Portable rather than apt, for the same reason the Windows build ships a
 * portable Node instead of using winget for it: the pipeline must be able to pin
 * an exact version, verify a digest, and place the result somewhere it owns. A
 * distribution package cannot do any of the three, and on a filtered network the
 * distro mirror is frequently the slowest path available.
 */

import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'

import {
  CACHE_DIR,
  NODE_SHA256,
  NODE_SOURCES,
  NODE_VERSION,
  managedBinDirs,
  nodeArchiveName,
  nodeArchiveUrl,
  nodeBinDir,
  nodeRuntimeRoot,
  shasumsUrl,
} from '../components'
import { ensureCacheDir, inspectCache, promotePart, writeMarker } from '../cache'
import { downloadToPart } from '../download'
import {
  FIRST_RUN_TIMEOUT_MS,
  addToShellRc,
  detectTool,
  ensureManagedDirs,
  refreshProcessPath,
  runCapture,
  runForOutput,
  shellPathDirs,
} from '../env'
import { AppError, codes } from '../errors'
import { extractTarXz, isExecutable, listEntries } from '../extract'
import { requireCandidate, selectFastestCandidate } from '../source'
import { assertFileDigest, crossCheckPinned, fetchShasums, verifyFile, verifyFileSync } from '../verify'
import { stepOk, type InstallStepResult } from '../types'
import { stage, throwIfCancelled, type InstallContext } from './context'

const COMPONENT = 'node' as const

/**
 * Force the portable path even when a usable system Node.js exists.
 *
 * Set `CCM_FORCE_PORTABLE=1`. This exists because the portable download is the
 * part of the pipeline that can actually fail — mirror selection, digest
 * verification, extraction, the executable check — and on a machine that already
 * has Node.js the short-circuit above means none of it ever runs. Verification on
 * such a machine would otherwise silently test nothing.
 *
 * It is an explicit opt-in, never a default, because preferring a fresh 30 MB
 * download over a working `/usr/bin/node` is the wrong behaviour for a user.
 */
function forcePortable(): boolean {
  return process.env.CCM_FORCE_PORTABLE === '1'
}

export interface NodeInstallOutcome extends InstallStepResult {
  /** Directories newly put on PATH, for the caller's summary. */
  pathDirs: string[]
  /** Shell rc files that received the PATH export, so the UI can say "new shell". */
  rcFiles: string[]
}

/**
 * Install or verify Node.js.
 *
 * Detection uses the *refreshed* PATH, and detection runs the binary rather than
 * trusting `which`. A tree whose mode bits were lost extracts fine and cannot
 * run; treating that as "installed" is the failure mode the Rust build calls out.
 */
export async function installNode(ctx: InstallContext): Promise<NodeInstallOutcome> {
  // ---- Stage 1: already installed? -------------------------------------
  const existing = await detectTool('node')
  if (existing.installed && existing.version && !forcePortable()) {
    ctx.log('info', `Node.js ${existing.version} already installed at ${existing.path}`)
    stage(ctx, COMPONENT, 'installing', `Node.js ${existing.version} 已安装`)
    const onPath = await ensureOnPath(ctx)
    return {
      ...stepOk(COMPONENT, existing.version, `Node.js ${existing.version} 已安装`),
      pathDirs: onPath.added,
      rcFiles: onPath.rcFiles,
    }
  }
  if (existing.installed && forcePortable()) {
    ctx.log(
      'info',
      `CCM_FORCE_PORTABLE=1 — ignoring the system Node.js at ${existing.path} and installing the pinned portable build`,
    )
  }

  throwIfCancelled(ctx)
  ensureManagedDirs()
  ensureCacheDir()

  const archivePath = join(CACHE_DIR, nodeArchiveName())
  const expectedPinned = NODE_SHA256[nodeArchiveName()]

  // ---- Stage 3: cache decision -----------------------------------------
  if (expectedPinned) {
    const decision = inspectCache(archivePath, (path) => verifyFileSync(path, expectedPinned))

    if (decision.state !== 'missing') {
      ctx.log('info', `Node.js archive cache hit (${decision.state})`)
      stage(ctx, COMPONENT, 'downloading', '使用已校验的缓存归档...')
    } else {
      await fetchArchive(ctx, archivePath, expectedPinned)
    }
  } else {
    // No pinned digest for this architecture. Say so loudly rather than
    // silently trusting whatever the mirror served.
    ctx.log(
      'warn',
      `没有 ${nodeArchiveName()} 的内置摘要；校验将只依赖镜像发布的清单`,
    )
    await fetchArchive(ctx, archivePath, undefined)
  }

  throwIfCancelled(ctx)

  // ---- Stage 6: extract -------------------------------------------------
  const runtimeRoot = nodeRuntimeRoot()
  stage(ctx, COMPONENT, 'extracting', '解压 Node.js...')
  await extractTarXz(archivePath, runtimeRoot)

  throwIfCancelled(ctx)

  // ---- Stage 7: verify the extracted binary -----------------------------
  const nodeExe = join(nodeBinDir(), 'node')
  if (!existsSync(nodeExe)) {
    // Name what actually landed. The Windows build learned this lesson too:
    // "node.exe not found" alone gave no clue whether extraction produced
    // nothing or produced a tree at an unexpected depth.
    const listing = listEntries(runtimeRoot, 12)
    const binListing = listEntries(nodeBinDir(), 12)
    throw new AppError({
      code: codes.EXTRACT_FAILED,
      title: '解压后未找到 node',
      message: `解压完成但在 ${nodeBinDir()} 中未找到 node。`,
      details:
        `目标: ${nodeExe}\n` +
        `运行时根目录内容: [${listing.join(', ') || '<空>'}]` +
        (binListing.length > 0 ? `\nbin 目录内容: [${binListing.join(', ')}]` : '\nbin 目录不存在或为空'),
      suggestions: [
        '删除缓存后重试（缓存可能是半截文件）',
        '确认磁盘空间充足',
      ],
    })
  }
  if (!isExecutable(nodeExe)) {
    throw new AppError({
      code: codes.EXTRACT_FAILED,
      title: 'node 不可执行',
      message: `${nodeExe} 存在但没有执行权限。`,
      details: '常见原因：目标文件系统以 noexec 挂载，或缓存写入时丢失了权限位。',
      suggestions: [
        '若 ~/.local/share 位于 noexec 分区，请把应用数据目录改到可执行分区',
        '或执行 chmod +x 后重试',
      ],
    })
  }

  stage(ctx, COMPONENT, 'installing', '验证 Node.js...')

  // First run of a freshly extracted binary: this is the one probe that can
  // legitimately be slow (2,447 files written moments ago), so it gets the wide
  // budget rather than the standard one.
  const probe = await runCapture(nodeExe, ['--version'], { timeoutMs: FIRST_RUN_TIMEOUT_MS })
  const version = probe.code === 0 ? /(\d+\.\d+\.\d+)/.exec(probe.stdout)?.[1] ?? null : null

  if (!version) {
    throw new AppError({
      code: codes.FAILED,
      title: 'Node.js 验证失败',
      message: `${nodeExe} 无法正常运行。`,
      details:
        `退出码 ${probe.code}` +
        (probe.timedOut ? '（探测超时）' : '') +
        (probe.stderr.trim() ? `\n${probe.stderr.trim()}` : ''),
      suggestions: ['删除缓存后重试', '确认 glibc 版本满足 Node.js 要求（需 2.28+）'],
    })
  }

  // ---- Stage 8: PATH ----------------------------------------------------
  const onPath = await ensureOnPath(ctx)
  ctx.log('info', `Node.js ${version} installed to ${nodeBinDir()}`)

  return {
    ...stepOk(COMPONENT, version, `Node.js ${version} 安装完成`),
    pathDirs: onPath.added,
    rcFiles: onPath.rcFiles,
  }
}

/**
 * Download the archive and verify it before it is allowed to become the cache.
 *
 * Verification order matters: the pinned digest is cross-checked against the
 * mirror's published list *before* the download, so a mirror serving different
 * bytes is rejected without spending 30 MB of bandwidth to find out.
 */
async function fetchArchive(
  ctx: InstallContext,
  archivePath: string,
  pinned: string | undefined,
): Promise<void> {
  // ---- Stage 2: select source ------------------------------------------
  stage(ctx, COMPONENT, 'benchmarking', '测速镜像源...')

  const candidates = NODE_SOURCES.map((source) => ({
    id: source.id,
    url: nodeArchiveUrl(source.baseUrl),
  }))

  const winner = requireCandidate(await selectFastestCandidate(candidates))
  ctx.reporter.setSource(COMPONENT, winner.id, winner.url)
  ctx.log('info', `Node.js source selected: ${winner.id} -> ${winner.url}`)

  // Cross-check the pinned digest against the winning mirror's own list.
  if (pinned) {
    const baseUrl = NODE_SOURCES.find((s) => s.id === winner.id)?.baseUrl
    if (baseUrl) {
      try {
        const published = await fetchShasums(shasumsUrl(baseUrl))
        const check = crossCheckPinned(pinned, published, nodeArchiveName())
        if (check.note) ctx.log('info', check.note)
      } catch (e) {
        // A mirror that cannot serve its digest list is unhelpful, not hostile.
        // The pinned value stands on its own, so this is a warning rather than a
        // stop — unless it was the mismatch error, which must propagate.
        if (e instanceof AppError && e.code === codes.VERIFY_FAILED) throw e
        ctx.log('warn', `无法从镜像获取摘要清单，仅使用内置钉死值: ${String(e)}`)
      }
    }
  }

  // ---- Stage 4: download ------------------------------------------------
  stage(ctx, COMPONENT, 'downloading', `下载 Node.js ${NODE_VERSION}...`)

  const { partPath } = await downloadToPart({
    url: winner.url,
    dest: archivePath,
    component: COMPONENT,
    onProgress: (update) => ctx.reporter.report(update),
    cancel: ctx.cancel,
  })

  // ---- Stage 5: verify then promote -------------------------------------
  stage(ctx, COMPONENT, 'verifying', '校验 SHA256...')

  try {
    if (pinned) {
      const digest = await assertFileDigest(partPath, pinned, nodeArchiveName())
      ctx.log('info', `Node.js archive verified: ${digest}`)
      promotePart(partPath, archivePath)
      writeMarker(archivePath, digest)
    } else {
      // No pinned value: record what we got so the marker path still works, but
      // do not claim the bytes are trustworthy.
      const actual = (await verifyFile(partPath, '0'.repeat(64))).actual
      promotePart(partPath, archivePath)
      writeMarker(archivePath, actual)
      ctx.log('warn', `归档已下载但未与内置摘要比对: ${actual}`)
    }
  } catch (e) {
    // Never let an unverified payload reach the cache path.
    try {
      if (existsSync(partPath)) unlinkSync(partPath)
    } catch {
      // Best effort.
    }
    throw e
  }
}

/**
 * Put the managed directories on PATH: this process now, shell rc files for
 * future terminals.
 *
 * The Windows build needs a whole restart dance here because its PATH lives in
 * the registry. Linux needs none of it for *this* app — writing
 * `process.env.PATH` is enough for every child process we spawn — and the only
 * thing a new shell needs is the rc-file export.
 */
async function ensureOnPath(
  ctx: InstallContext,
): Promise<{ added: string[]; rcFiles: string[] }> {
  const refreshed = refreshProcessPath()

  // Only directories that exist are exported. On the "a Node.js is already
  // installed" branch nothing is created, so the managed node directory is absent
  // by definition; writing it into the user's rc files would leave a dead PATH
  // entry behind on every shell they ever open, naming a directory this machine
  // will never have. When nothing managed exists there is nothing to export and
  // the rc files are better left untouched.
  const exportable = shellPathDirs(managedBinDirs())
  if (exportable.length === 0) {
    ctx.log('info', '未创建自有目录（沿用系统已有的工具链），不修改 shell 配置')
    return { added: refreshed.added, rcFiles: [] }
  }

  const rc = addToShellRc(exportable)

  if (rc.updated.length > 0) {
    ctx.log('info', `PATH export written to: ${rc.updated.join(', ')}`)
  }
  if (rc.consolidated.length > 0) {
    ctx.log(
      'warn',
      `合并了重复的 PATH 块（早期版本重复追加所致）: ${rc.consolidated.join(', ')}`,
    )
  }
  if (rc.alreadyPresent.length > 0) {
    ctx.log('info', `PATH export already correct in: ${rc.alreadyPresent.join(', ')}`)
  }
  if (rc.warning) {
    ctx.log('warn', rc.warning)
  }

  return { added: refreshed.added, rcFiles: [...rc.updated, ...rc.alreadyPresent] }
}

/**
 * Cheap availability probe used by the orchestrator's planning step.
 *
 * Mirrors `generate_install_plan`: report what exists so the UI can render a plan
 * before anything is downloaded.
 */
export async function planNode(): Promise<InstallStepResult> {
  const node = await detectTool('node')
  const npm = await runForOutput('npm', ['--version'])
  if (node.installed && node.version) {
    return stepOk(COMPONENT, node.version, npm ? '已安装' : '已安装（npm 缺失）')
  }
  return { component: COMPONENT, success: false, version: null, message: '需要安装' }
}

/** The managed Node.js binary path, exported for the Claude Code installer. */
export function managedNodeExe(): string {
  return join(nodeBinDir(), 'node')
}

/** Whether the managed runtime directory holds a usable `bin/node`. */
export function managedNodePresent(): boolean {
  return existsSync(managedNodeExe())
}
