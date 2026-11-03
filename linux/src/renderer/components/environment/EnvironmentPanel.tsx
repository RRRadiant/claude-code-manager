import { useEffect } from 'react'

import { Icon } from '../shared/Icon'
import { DependenciesCard } from './DependenciesCard'
import { ExistingConfigCard } from './ExistingConfigCard'
import { RestartPrompt } from './RestartPrompt'
import {
  formatDownloadLine,
  formatError,
  selectPrimaryProgress,
  useEnvironmentStore,
} from '../../stores/environmentStore'

/**
 * Environment panel — drives the install pipeline and renders its progress.
 *
 * Layout notes, since the previous version got these wrong on a real screen:
 *
 *   - System facts are a responsive grid, not a vertical list. Eight one-per-row
 *     tiles filled the viewport and pushed the actual actions below the fold.
 *   - The header holds the section actions, so "重新检测 / 刷新计划" sit next to
 *     the title they act on instead of floating in the middle of the content.
 *   - Percentage and byte counts use tabular figures, so the numbers do not
 *     jitter horizontally while a download ticks.
 *   - State is carried by a coloured dot plus a label, never by colour alone.
 */
export function EnvironmentPanel(): React.ReactElement {
  const {
    detected,
    plan,
    progress,
    task,
    log,
    detecting,
    planning,
    error,
    needsNewShell,
    rcFiles,
    desktopShortcut,
    detect,
    loadPlan,
    installFull,
    installComponent,
    cancel,
    clearCache,
    openClaude,
    createDesktopShortcut,
    refreshShortcutStatus,
  } = useEnvironmentStore()

  useEffect(() => {
    detect()
    loadPlan()
    refreshShortcutStatus()
  }, [detect, loadPlan, refreshShortcutStatus])

  const running = task?.status === 'running' || task?.status === 'queued'

  // Whether Claude Code itself is usable. Drives the "next steps" panel: showing
  // a "launch" button before anything is installed would be worse than showing
  // nothing.
  const claudeReady = detected?.system.claude.installed === true
  const claudeVersion = detected?.system.claude.version ?? ''
  const primary = selectPrimaryProgress(progress)
  const downloading = primary?.stage === 'downloading' && primary.percent > 0
  // A byte-level bar wins while a download is in flight; otherwise the coarse
  // task percent drives it. Same precedence the Windows page uses.
  const barPercent = downloading ? primary.percent : task?.progress ?? 0
  const stepLine = downloading ? formatDownloadLine(primary) : task?.step
  // Before a task reports its first step there is nothing measurable to show, so
  // the bar sweeps instead of sitting at a misleading 0%.
  const indeterminate = running && !downloading && barPercent === 0

  return (
    <div className="page">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="page-header">
        <div>
          <h1 className="page-title">环境</h1>
          <p className="page-subtitle">
            {detected
              ? `${detected.system.distro} ${detected.system.distroVersion} · ${detected.system.arch}`
              : '正在读取系统信息...'}
          </p>
        </div>
        <div className="row">
          {/* Lives here, not behind "Claude Code 已就绪": the icon launches this
              app, and needing Claude Code installed before you can put the app
              on your desktop is backwards. */}
          {desktopShortcut?.available && !desktopShortcut.exists && (
            <button className="btn-secondary btn-sm" onClick={createDesktopShortcut}>
              <Icon name="plus" size={13} />
              添加到桌面
            </button>
          )}
          <button className="btn-ghost btn-sm" onClick={detect} disabled={detecting}>
            <Icon name="refresh" size={13} className={detecting ? 'spin' : undefined} />
            {detecting ? '检测中' : '重新检测'}
          </button>
          <button className="btn-secondary btn-sm" onClick={loadPlan} disabled={planning}>
            {planning ? '读取中' : '刷新计划'}
          </button>
        </div>
      </header>

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {error && (
        <div className="callout callout-danger" style={{ marginBottom: 18 }}>
          <span className="callout-icon">
            <Icon name="alert" size={15} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="callout-title">{error.title}</p>
            <p className="callout-body" style={{ whiteSpace: 'pre-line' }}>
              {formatError(error)}
            </p>
            {error.details && (
              <details style={{ marginTop: 8 }}>
                <summary
                  style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', cursor: 'pointer' }}
                >
                  技术细节
                </summary>
                <pre
                  className="code-block"
                  style={{ marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                >
                  {error.details}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}

      {/* ── Restart after an install ───────────────────────────────────── */}
      <RestartPrompt visible={needsNewShell && !running} rcFiles={rcFiles} />

      {/* ── Next steps, once Claude Code is usable ─────────────────────── */}
      {claudeReady && !running && (
        <section className="section">
          <div className="card card-pad">
            <div className="row-between" style={{ marginBottom: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Icon name="check" size={15} className="secondary" />
                  <span style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>
                    Claude Code 已就绪
                  </span>
                </div>
                <p className="tiny muted" style={{ margin: '3px 0 0', fontFamily: 'inherit' }}>
                  版本 {claudeVersion} · 可以直接开始使用
                </p>
              </div>
            </div>

            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button className="btn-primary" onClick={openClaude}>
                <Icon name="terminal" size={14} />
                打开 Claude Code
              </button>

              {desktopShortcut?.exists && (
                <span className="badge badge-ok">
                  <Icon name="check" size={10} />
                  桌面图标已就绪
                </span>
              )}
            </div>

            <p className="field-hint" style={{ marginTop: 10 }}>
              「打开 Claude Code」会新开一个终端窗口运行 claude；关掉那个窗口即可退出。
            </p>
          </div>
        </section>
      )}

      {/* ── Install action + live progress ─────────────────────────────── */}
      <section className="section">
        <div className="card card-pad">
          <div className="row-between" style={{ marginBottom: running || task ? 14 : 0 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>完整环境安装</div>
              <div className="tiny muted" style={{ marginTop: 2 }}>
                Node.js → Git → Claude Code，按依赖顺序执行；单个组件也可在下方单独安装
              </div>
            </div>
            <div className="row">
              {running && (
                <button className="btn-ghost btn-sm" onClick={cancel}>
                  取消
                </button>
              )}
              <button className="btn-primary" onClick={installFull} disabled={running}>
                <Icon name="download" size={14} />
                {running ? '安装中' : '一键安装'}
              </button>
            </div>
          </div>

          {(running || task) && (
            <div>
              <div className="progress">
                <div
                  className={`progress-fill ${indeterminate ? 'is-indeterminate' : ''}`}
                  style={{ width: indeterminate ? undefined : `${Math.max(1.5, barPercent)}%` }}
                />
              </div>
              <div
                className="row-between"
                style={{ marginTop: 9, fontSize: 'var(--text-xs)' }}
              >
                <span className="secondary truncate" style={{ minWidth: 0 }}>
                  {stepLine ?? task?.title}
                </span>
                {!indeterminate && (
                  <span className="tnum muted" style={{ flexShrink: 0 }}>
                    {barPercent.toFixed(0)}%
                  </span>
                )}
              </div>

              {/* Parallel downloads: show every stream so the second one is not
                  invisible just because it does not own the main bar. */}
              {Object.values(progress).length > 1 && (
                <div className="stack-1" style={{ marginTop: 11 }}>
                  {Object.values(progress).map(
                    (p) =>
                      p && (
                        <div
                          key={p.component}
                          className="row-between"
                          style={{ fontSize: 'var(--text-xs)' }}
                        >
                          <span className="muted truncate">
                            {p.componentLabel}
                            {p.sourceId && ` · ${p.sourceId}`}
                            {!p.primary && (
                              <span className="badge badge-muted" style={{ marginLeft: 6 }}>
                                并行
                              </span>
                            )}
                          </span>
                          <span className="tnum muted" style={{ flexShrink: 0 }}>
                            {p.stage === 'downloading' ? `${p.percent.toFixed(0)}%` : p.stage}
                          </span>
                        </div>
                      ),
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Install plan ───────────────────────────────────────────────── */}
      {plan && plan.length > 0 && (
        <section className="section">
          <h2 className="section-label">安装计划</h2>
          <div className="stack-2">
            {plan.map((item) => (
              <div key={item.component} className="card card-pad card-hover">
                <div className="row-between">
                  <div className="row" style={{ minWidth: 0, gap: 11 }}>
                    <span className={`stat-dot ${item.success ? 'is-ok' : 'is-warn'}`} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>
                        {componentLabel(item.component)}
                      </div>
                      <div className="tiny muted truncate" style={{ marginTop: 1 }}>
                        {item.version ? `版本 ${item.version}` : item.message}
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ flexShrink: 0 }}>
                    {item.success ? (
                      <span className="badge badge-ok">
                        <Icon name="check" size={10} />
                        已就绪
                      </span>
                    ) : (
                      <button
                        className="btn-secondary btn-sm"
                        disabled={running}
                        onClick={() => installComponent(item.component)}
                      >
                        安装
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── System dependencies ────────────────────────────────────────── */}
      <DependenciesCard />

      {/* ── What is already configured ─────────────────────────────────── */}
      <ExistingConfigCard />

      {/* ── System facts ───────────────────────────────────────────────── */}
      {detected && <SystemFacts detected={detected} />}

      {/* ── Cache ──────────────────────────────────────────────────────── */}
      <section className="section">
        <div className="row-between tiny muted">
          <span className="truncate" style={{ minWidth: 0 }}>
            下载缓存与运行时：<code>{detected?.layout.appDataDir ?? '~/.local/share/claude-code-manager'}</code>
          </span>
          <button className="btn-ghost btn-sm" onClick={clearCache} disabled={running} style={{ flexShrink: 0 }}>
            <Icon name="trash" size={12} />
            清除缓存
          </button>
        </div>
      </section>

      {/* ── Log ────────────────────────────────────────────────────────── */}
      {log.length > 0 && (
        <section className="section">
          <h2 className="section-label">安装日志</h2>
          <pre className="log">{log.join('\n')}</pre>
        </section>
      )}
    </div>
  )
}

function componentLabel(component: InstallComponent): string {
  const labels: Record<InstallComponent, string> = {
    node: 'Node.js',
    git: 'Git',
    'claude-code': 'Claude Code',
  }
  return labels[component]
}

/** Tone of a fact tile: ok, warn (optional/absent but fine), bad, or neutral. */
type Tone = 'ok' | 'warn' | 'bad' | 'none'

function SystemFacts({ detected }: { detected: InstallerDetect }): React.ReactElement {
  const { system, path } = detected

  const facts: Array<{ label: string; value: string; tone: Tone }> = [
    { label: '发行版', value: `${system.distro} ${system.distroVersion}`.trim() || '未知', tone: 'none' },
    { label: '内核', value: system.kernel, tone: 'none' },
    {
      label: 'Node.js',
      value: system.node.version ?? '未安装',
      tone: system.node.installed ? 'ok' : 'bad',
    },
    { label: 'npm', value: system.npm.version ?? '未安装', tone: system.npm.installed ? 'ok' : 'bad' },
    {
      label: 'Git',
      // Git is optional for Claude Code, so absence is a warning, not a failure.
      value: system.git.version ?? '未安装（可选）',
      tone: system.git.installed ? 'ok' : 'warn',
    },
    {
      label: 'Claude Code',
      value:
        system.claude.version ??
        (system.claude.packagePresentButBroken ? '安装不完整' : '未安装'),
      tone: system.claude.installed ? 'ok' : system.claude.packagePresentButBroken ? 'warn' : 'bad',
    },
    { label: 'xz 解压', value: system.hasTarXz ? '可用' : '不可用', tone: system.hasTarXz ? 'ok' : 'bad' },
    { label: 'apt', value: system.hasApt ? '可用' : '不可用', tone: system.hasApt ? 'ok' : 'warn' },
  ]

  return (
    <section className="section">
      <h2 className="section-label">系统环境</h2>
      <div className="stat-grid">
        {facts.map((fact) => (
          <div key={fact.label} className="stat">
            <span
              className={`stat-dot ${fact.tone !== 'none' ? `is-${fact.tone}` : ''}`}
              aria-hidden="true"
            />
            <div className="stat-body">
              <div className="stat-label">{fact.label}</div>
              <div className={`stat-value ${fact.tone === 'none' ? '' : fact.tone === 'ok' ? '' : 'is-muted'}`}>
                {fact.value}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Managed PATH — the Linux-specific part worth surfacing */}
      <div className="card card-pad" style={{ marginTop: 10 }}>
        <div className="stat-label" style={{ marginBottom: 7 }}>
          受管 PATH 目录
        </div>
        <div className="stack-1">
          {path.managed.map((dir) => (
            <div key={dir} className="row" style={{ gap: 8 }}>
              <code className="tiny truncate" style={{ flex: 1, color: 'var(--color-text-secondary)' }}>
                {dir}
              </code>
              {path.added.includes(dir) && <span className="badge badge-accent">本次新增</span>}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
