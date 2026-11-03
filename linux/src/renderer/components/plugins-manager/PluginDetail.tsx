import { useEffect, useState, useCallback } from 'react'

import { Icon } from '../shared/Icon'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Rich plugin data merged from installed list + marketplace catalog. */
interface PluginDetailData extends PluginInfo {
  description?: string
  author?: { name: string; email?: string; url?: string }
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
  tags?: string[]
}

interface Props {
  pluginId: string
  onBack: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Open a URL in the system default browser.
 * Uses `window.open` with `noopener`; Electron typically opens these
 * externally when `target=_blank` is handled by the shell.
 */
function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** One "label …… value" metadata row. */
function Kv({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}): React.ReactElement {
  return (
    <div className="kv">
      <span className="kv-label">{label}</span>
      <span className={`kv-value${mono ? ' is-mono' : ''}`}>{value || '—'}</span>
    </div>
  )
}

/** External link rendered as a button, so a long URL keeps its full text. */
function LinkButton({
  label,
  url,
}: {
  label: string
  url: string
}): React.ReactElement {
  return (
    <button
      className="btn-ghost btn-sm"
      onClick={() => openExternal(url)}
      title={url}
      style={{ maxWidth: '100%' }}
    >
      <Icon name="external" size={13} />
      <span className="truncate">{label}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// PluginDetail
// ---------------------------------------------------------------------------

/**
 * Plugin detail page.
 *
 * Restyled onto the shared panel system. The information was all present
 * before, but it was a single dense card: four metadata fields in a two-column
 * grid, author and links and tags stacked underneath, and English section
 * headings against a Chinese surrounding UI. It is now split into labelled
 * `.section` blocks with `.kv` metadata rows, badges for the categorical facts,
 * and a bordered danger block for the destructive action.
 *
 * Behaviour is unchanged: the installed list is still merged with the
 * best-effort marketplace lookup, the toggle is still optimistic with a revert,
 * and uninstall still confirms before calling the IPC.
 */
export function PluginDetail({ pluginId, onBack }: Props): React.ReactElement {
  const [plugin, setPlugin] = useState<PluginDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)

  // -----------------------------------------------------------------------
  // Fetch: installed list + marketplace catalog, then merge
  // -----------------------------------------------------------------------

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // 1. Fetch installed plugin info
      const listResult = await window.electronAPI.pluginsList()
      if (!listResult.success || !listResult.data) {
        setError(listResult.error || 'Failed to load plugin list')
        return
      }

      const found = listResult.data.find((p) => p.id === pluginId)
      if (!found) {
        setError('Plugin not found')
        return
      }

      // 2. Attempt to enrich with marketplace catalog metadata
      const enriched: PluginDetailData = { ...found }

      try {
        const marketResult = await window.electronAPI.marketplaceList()
        if (marketResult.success && marketResult.data) {
          const catalogEntry = marketResult.data.plugins.find(
            (mp) => mp.name === found.name && mp.marketplace === found.marketplace,
          )
          if (catalogEntry) {
            enriched.description = catalogEntry.description || enriched.description
            enriched.author = catalogEntry.author as PluginDetailData['author']
            enriched.homepage = (catalogEntry as Record<string, unknown>).homepage as
              | string
              | undefined
            enriched.repository = (catalogEntry as Record<string, unknown>).repository as
              | string
              | undefined
            enriched.license = (catalogEntry as Record<string, unknown>).license as
              | string
              | undefined
            enriched.tags = catalogEntry.tags
          }
        }
      } catch {
        // Marketplace fetch is best-effort; proceed with basic info
      }

      setPlugin(enriched)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [pluginId])

  useEffect(() => {
    load()
  }, [load])

  // -----------------------------------------------------------------------
  // Toggle enable / disable
  // -----------------------------------------------------------------------

  const handleToggle = async () => {
    if (!plugin) return
    setToggling(true)

    const prevEnabled = plugin.enabled
    const newEnabled = !prevEnabled

    // Optimistic update
    setPlugin({ ...plugin, enabled: newEnabled })

    const result = await window.electronAPI.pluginsToggle({
      pluginId,
      enabled: newEnabled,
    })

    if (!result.success) {
      // Revert on failure
      setPlugin({ ...plugin, enabled: prevEnabled })
    }

    setToggling(false)
  }

  // -----------------------------------------------------------------------
  // Uninstall
  // -----------------------------------------------------------------------

  const handleUninstall = async () => {
    if (!plugin) return

    const confirmed = confirm(
      `确定要卸载「${plugin.name}」吗？\n\n此操作不可撤销。`,
    )
    if (!confirmed) return

    setUninstalling(true)
    const result = await window.electronAPI.pluginsUninstall({ pluginId })
    if (result.success) {
      onBack()
    } else {
      alert(`卸载失败：${result.error}`)
      setUninstalling(false)
    }
  }

  // -----------------------------------------------------------------------
  // Derived values
  // -----------------------------------------------------------------------

  const allTags = plugin ? [...(plugin.keywords ?? []), ...(plugin.tags ?? [])] : []

  const scopeLabel = plugin?.scope === 'user' ? '用户级（~/.claude/）' : '项目级（.claude/）'
  const installedDate = plugin
    ? new Date(plugin.installedAt).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="page">
      <header className="page-header" style={{ flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title truncate">{plugin ? plugin.name : '插件详情'}</h1>
          <p className="page-subtitle">
            {plugin ? (
              <>
                {plugin.marketplace ? `@${plugin.marketplace} · ` : ''}
                <span className="tnum">v{plugin.version}</span>
                {' · '}
                <span className="mono">{plugin.installPath}</span>
              </>
            ) : (
              '插件详情'
            )}
          </p>
        </div>

        {plugin && (
          <button
            className={plugin.enabled ? 'btn-secondary' : 'btn-primary'}
            onClick={handleToggle}
            disabled={toggling}
          >
            <Icon name={plugin.enabled ? 'x' : 'check'} size={14} />
            {toggling ? '处理中...' : plugin.enabled ? '禁用插件' : '启用插件'}
          </button>
        )}
      </header>

      {loading ? (
        <p className="muted" style={{ padding: '48px 0', textAlign: 'center' }}>
          加载中...
        </p>
      ) : error || !plugin ? (
        <div className="card">
          <div className="empty">
            <Icon name="alert" size={22} />
            <div
              style={{
                marginTop: 10,
                fontSize: 'var(--text-md)',
                color: 'var(--color-text-secondary)',
              }}
            >
              无法打开这个插件
            </div>
            <p style={{ maxWidth: 460, margin: '6px auto 0', lineHeight: 1.7 }}>{error}</p>
            <p className="tiny muted" style={{ maxWidth: 460, margin: '6px auto 0' }}>
              插件可能已被卸载，或插件目录暂时无法读取。返回列表可以看到当前已安装的插件。
            </p>
            <button className="btn-secondary" onClick={onBack} style={{ marginTop: 16 }}>
              <Icon name="chevron-left" size={13} />
              返回插件列表
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── 状态 ─────────────────────────────────────────────────── */}
          <section className="section">
            <h2 className="section-label">状态</h2>
            <div className="card card-pad">
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <span className={`badge ${plugin.enabled ? 'badge-ok' : 'badge-muted'}`}>
                  <Icon name={plugin.enabled ? 'check' : 'x'} size={11} />
                  {plugin.enabled ? '已启用' : '已禁用'}
                </span>
                {plugin.marketplace && (
                  <span className="badge badge-accent">@{plugin.marketplace}</span>
                )}
                <span className="badge badge-muted tnum">v{plugin.version}</span>
                {plugin.license && <span className="badge badge-muted">{plugin.license}</span>}
              </div>

              {plugin.description && (
                <p
                  className="secondary"
                  style={{ margin: '13px 0 0', lineHeight: 1.7, fontSize: 'var(--text-sm)' }}
                >
                  {plugin.description}
                </p>
              )}

              <div style={{ marginTop: 13 }}>
                <Kv label="安装范围" value={scopeLabel} />
                <Kv label="版本" value={plugin.version} />
                <Kv label="安装路径" value={plugin.installPath} mono />
                <Kv label="安装时间" value={installedDate} />
              </div>

              <p className="field-hint">
                启用状态由本应用写入插件目录中的配置，禁用后插件仍保留在磁盘上，可以随时重新启用。
              </p>
            </div>
          </section>

          {/* ── 来源 ─────────────────────────────────────────────────── */}
          {(plugin.author?.name || plugin.author?.email || plugin.author?.url || plugin.homepage || plugin.repository) && (
            <section className="section">
              <h2 className="section-label">来源与链接</h2>
              <div className="card card-pad">
                <Kv label="作者" value={plugin.author?.name || '—'} />
                {plugin.author?.email && <Kv label="邮箱" value={plugin.author.email} mono />}
                {plugin.author?.url && (
                  <div className="kv">
                    <span className="kv-label">作者主页</span>
                    <span className="kv-value" style={{ minWidth: 0 }}>
                      <LinkButton label={plugin.author.url} url={plugin.author.url} />
                    </span>
                  </div>
                )}
                {plugin.homepage && (
                  <div className="kv">
                    <span className="kv-label">Homepage</span>
                    <span className="kv-value" style={{ minWidth: 0 }}>
                      <LinkButton label={plugin.homepage} url={plugin.homepage} />
                    </span>
                  </div>
                )}
                {plugin.repository && (
                  <div className="kv">
                    <span className="kv-label">仓库</span>
                    <span className="kv-value" style={{ minWidth: 0 }}>
                      <LinkButton label={plugin.repository} url={plugin.repository} />
                    </span>
                  </div>
                )}
                <p className="field-hint">链接会交给系统默认浏览器打开。</p>
              </div>
            </section>
          )}

          {/* ── 标签 ─────────────────────────────────────────────────── */}
          {(plugin.license || allTags.length > 0) && (
            <section className="section">
              <h2 className="section-label">元数据</h2>
              <div className="card card-pad">
                {plugin.license && <Kv label="许可证" value={plugin.license} />}
                {allTags.length > 0 && (
                  <div className="kv">
                    <span className="kv-label">关键词</span>
                    <span
                      className="kv-value row"
                      style={{ flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }}
                    >
                      {allTags.map((tag) => (
                        <span key={tag} className="badge badge-muted">
                          {tag}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── 危险操作 ─────────────────────────────────────────────── */}
          <section className="section">
            <h2 className="section-label">危险操作</h2>
            <div className="card card-pad">
              <div className="callout callout-danger">
                <span className="callout-icon">
                  <Icon name="alert" size={15} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="callout-title">卸载插件</p>
                  <p className="callout-body">
                    从 <code>{plugin.installPath}</code> 删除该插件及其配置。此操作不可撤销，
                    需要重新从 Marketplace 安装。
                  </p>
                </div>
                <button
                  className="btn-danger"
                  onClick={handleUninstall}
                  disabled={uninstalling}
                  style={{ flexShrink: 0, alignSelf: 'center' }}
                >
                  <Icon name="trash" size={13} />
                  {uninstalling ? '卸载中...' : '卸载插件'}
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
