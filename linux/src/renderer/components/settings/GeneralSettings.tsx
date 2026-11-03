import { useEffect } from 'react'

import { Icon } from '../shared/Icon'
import { useAppStore } from '../../stores/appStore'
import { useConfigStore } from '../../stores/configStore'

/**
 * General settings — a read-only summary of `settings.json`.
 *
 * Nothing here is editable. The first version did not make that clear, so the
 * rows looked like controls that did not respond. It now says so outright and
 * points at the two places that *can* change these values: the API panel and the
 * config-file editor.
 *
 * Values are grouped into what they affect rather than listed in file order, and
 * long lists (enabled plugins, marketplaces, permission counts) are summarised
 * instead of printed inline where they wrapped across several lines.
 */
export function GeneralSettings(): React.ReactElement {
  const { settings, loading, loadConfig } = useConfigStore()
  const openOnboarding = useAppStore((s) => s.openOnboarding)

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  if (loading) {
    return (
      <div className="page">
        <p className="muted" style={{ padding: '48px 0', textAlign: 'center' }}>
          加载中...
        </p>
      </div>
    )
  }

  const allow = settings?.permissions?.allow?.length ?? 0
  const deny = settings?.permissions?.deny?.length ?? 0
  const pluginCount = settings?.enabledPlugins ? Object.keys(settings.enabledPlugins).length : 0
  const marketCount = settings?.extraKnownMarketplaces
    ? Object.keys(settings.extraKnownMarketplaces).length
    : 0

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">通用设置</h1>
          <p className="page-subtitle">
            以下为 <code>~/.claude/settings.json</code> 的当前内容摘要（只读）
          </p>
        </div>
      </header>

      <div className="callout callout-info" style={{ marginBottom: 18 }}>
        <span className="callout-icon">
          <Icon name="info" size={15} />
        </span>
        <div>
          <p className="callout-title">本页为只读</p>
          <p className="callout-body">
            API 相关项请到「API 配置」修改；其余字段可直接在「配置文件」面板中编辑
            settings.json。
          </p>
        </div>
      </div>

      {/* ── Appearance ─────────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">外观</h2>
        <div className="card card-pad">
          <div className="kv">
            <span className="kv-label">主题</span>
            <span className="kv-value">
              <span className="badge badge-muted">
                {settings?.theme === 'light' ? '浅色' : '深色'}
              </span>
            </span>
          </div>
          <div className="kv">
            <span className="kv-label">状态行</span>
            <span className="kv-value">
              {settings?.statusLine ? (
                settings.statusLine.type === 'static' ? (
                  <>
                    静态文本：<code>{settings.statusLine.text}</code>
                  </>
                ) : (
                  <>
                    命令：<code>{settings.statusLine.command}</code>
                  </>
                )
              ) : (
                <span className="muted">未配置（使用默认）</span>
              )}
            </span>
          </div>
        </div>
      </section>

      {/* ── Permissions ────────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">权限</h2>
        <div className="card card-pad">
          <div className="kv">
            <span className="kv-label">允许规则</span>
            <span className="kv-value">
              <span className="badge badge-ok">{allow} 条</span>
            </span>
          </div>
          <div className="kv">
            <span className="kv-label">拒绝规则</span>
            <span className="kv-value">
              <span className={`badge ${deny > 0 ? 'badge-bad' : 'badge-muted'}`}>{deny} 条</span>
            </span>
          </div>
          {allow === 0 && deny === 0 && (
            <p className="field-hint" style={{ marginTop: 10 }}>
              未设置任何权限规则，Claude Code 会在执行敏感操作时逐次询问。规则通常写在{' '}
              <code>settings.local.json</code> 中。
            </p>
          )}
        </div>
      </section>

      {/* ── Behaviour ──────────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">行为</h2>
        <div className="card card-pad">
          <div className="kv">
            <span className="kv-label">跳过工作流用量警告</span>
            <span className="kv-value">
              {settings?.skipWorkflowUsageWarning ? (
                <span className="badge badge-warn">已跳过</span>
              ) : (
                <span className="badge badge-muted">未跳过</span>
              )}
            </span>
          </div>
          <div className="kv">
            <span className="kv-label">已启用插件</span>
            <span className="kv-value">
              {pluginCount === 0 ? (
                <span className="muted">无</span>
              ) : (
                <span className="badge badge-accent">{pluginCount} 个</span>
              )}
            </span>
          </div>
          <div className="kv">
            <span className="kv-label">额外 Marketplace</span>
            <span className="kv-value">
              {marketCount === 0 ? (
                <span className="muted">无</span>
              ) : (
                <span className="badge badge-accent">{marketCount} 个</span>
              )}
            </span>
          </div>
          {pluginCount > 0 && (
            <div className="code-block" style={{ marginTop: 12 }}>
              {Object.keys(settings?.enabledPlugins ?? {}).join('\n')}
            </div>
          )}
          {marketCount > 0 && (
            <div className="code-block" style={{ marginTop: 8 }}>
              {Object.entries(settings?.extraKnownMarketplaces ?? {})
                .map(([name, src]) => {
                  const repo = (src as { source?: { repo?: string } })?.source?.repo
                  return repo ? `${name}  →  ${repo}` : name
                })
                .join('\n')}
            </div>
          )}
        </div>
      </section>

      {/* ── Backups ────────────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">备份</h2>
        <div className="card card-pad">
          <p className="field-hint" style={{ margin: 0 }}>
            Claude Code 会把 <code>settings.json</code> 的历史版本保存在{' '}
            <code>~/.claude/backups/</code>。本工具写入配置前也会生成 <code>.bak</code>{' '}
            备份，但不提供图形化回滚——需要恢复时请从上述目录手动复制。
          </p>
        </div>
      </section>

      {/* ── Guide ──────────────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">使用向导</h2>
        <div className="card card-pad">
          <div className="row-between">
            <p className="field-hint" style={{ margin: 0 }}>
              首次打开时出现的六步向导，可以随时再看一遍。
            </p>
            <button className="btn-secondary btn-sm" onClick={openOnboarding}>
              <Icon name="info" size={13} />
              重新打开向导
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
