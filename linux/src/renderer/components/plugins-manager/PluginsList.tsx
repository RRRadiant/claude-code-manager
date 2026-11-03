import { useEffect, useState, useCallback } from 'react'

import { Icon } from '../shared/Icon'

interface Props {
  onSelect: (pluginId: string) => void
  onBrowseMarketplace?: () => void
}

/**
 * Installed plugins.
 *
 * Restyled onto the shared panel system. The previous version was the only
 * panel still fully on Tailwind utilities: state was a bare coloured dot (green
 * or grey) with no text, the enable/disable control was a 36px switch with no
 * label at all, and the header was English while the rest of the app is Chinese.
 *
 * Behaviour is unchanged — same optimistic toggle with a revert when the IPC
 * call reports failure, same file-watcher refresh, same section split.
 */
export function PluginsList({ onSelect, onBrowseMarketplace }: Props): React.ReactElement {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPlugins = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.pluginsList()
      if (result.success && result.data) {
        setPlugins(result.data)
      } else {
        setError(result.error || '加载插件失败')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])

  // File watcher auto-refresh on /plugins/ directory changes
  useEffect(() => {
    const cleanup = window.electronAPI.onFileChanged(({ paths }) => {
      if (paths.some((p) => p.includes('/plugins/'))) {
        loadPlugins()
      }
    })
    return cleanup
  }, [loadPlugins])

  const handleToggle = async (pluginId: string, currentEnabled: boolean, e: React.MouseEvent) => {
    e.stopPropagation()
    // Optimistic update
    setPlugins((prev) =>
      prev.map((p) => (p.id === pluginId ? { ...p, enabled: !currentEnabled } : p))
    )
    const result = await window.electronAPI.pluginsToggle({ pluginId, enabled: !currentEnabled })
    if (!result.success) {
      // Revert on failure
      setPlugins((prev) =>
        prev.map((p) => (p.id === pluginId ? { ...p, enabled: currentEnabled } : p))
      )
    }
  }

  const enabledPlugins = plugins.filter((p) => p.enabled)
  const disabledPlugins = plugins.filter((p) => !p.enabled)

  return (
    <div className="page">
      <header className="page-header" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">插件管理</h1>
          <p className="page-subtitle">
            通过 Marketplace 安装的扩展，启用状态同步到 <code>~/.claude/</code> 的插件配置
            {plugins.length > 0 && ` · 共 ${plugins.length} 个`}
          </p>
        </div>

        {onBrowseMarketplace && (
          <button className="btn-primary" onClick={onBrowseMarketplace}>
            <Icon name="puzzle" size={14} />
            浏览 Marketplace
          </button>
        )}
      </header>

      {error && (
        <div className="callout callout-danger" style={{ marginBottom: 18 }}>
          <span className="callout-icon">
            <Icon name="alert" size={15} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="callout-title">读取插件失败</p>
            <p className="callout-body">{error}</p>
          </div>
          <button className="btn-secondary btn-sm" onClick={loadPlugins}>
            重试
          </button>
        </div>
      )}

      {loading ? (
        <p className="muted" style={{ padding: '48px 0', textAlign: 'center' }}>
          加载中...
        </p>
      ) : plugins.length === 0 && !error ? (
        <div className="card">
          <div className="empty">
            <Icon name="puzzle" size={22} />
            <div
              style={{
                marginTop: 10,
                fontSize: 'var(--text-md)',
                color: 'var(--color-text-secondary)',
              }}
            >
              还没有安装插件
            </div>
            <p style={{ maxWidth: 460, margin: '6px auto 0', lineHeight: 1.7 }}>
              插件是给 Claude Code 增加能力的扩展包，由 Marketplace 分发，安装后可以单独启用或禁用。
              在 Marketplace 里按分类或关键词找到需要的插件，安装命令会复制给你在终端执行。
            </p>
            {onBrowseMarketplace && (
              <button
                className="btn-secondary"
                onClick={onBrowseMarketplace}
                style={{ marginTop: 16 }}
              >
                打开 Marketplace
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="stack-3">
          {enabledPlugins.length > 0 && (
            <section className="section" style={{ marginBottom: 0 }}>
              <h2 className="section-label">已启用 · {enabledPlugins.length}</h2>
              <div className="stack-2">
                {enabledPlugins.map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    onSelect={onSelect}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            </section>
          )}

          {disabledPlugins.length > 0 && (
            <section className="section" style={{ marginBottom: 0 }}>
              <h2 className="section-label">已禁用 · {disabledPlugins.length}</h2>
              <div className="stack-2">
                {disabledPlugins.map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    onSelect={onSelect}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One installed plugin row.
 *
 * The status is carried by three things at once — an icon, the button label and
 * the badge tone — because the old markup expressed it with a coloured dot
 * alone, which is invisible to anyone who cannot separate green from grey.
 */
function PluginCard({
  plugin,
  onSelect,
  onToggle,
}: {
  plugin: PluginInfo
  onSelect: (pluginId: string) => void
  onToggle: (pluginId: string, currentEnabled: boolean, e: React.MouseEvent) => void
}): React.ReactElement {
  return (
    <div
      className="card card-hover"
      onClick={() => onSelect(plugin.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(plugin.id)
        }
      }}
      style={{ cursor: 'pointer', padding: '13px 15px' }}
    >
      <div className="row-between">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span
              className="row"
              style={{ gap: 7, fontSize: 'var(--text-md)', fontWeight: 600, minWidth: 0 }}
            >
              <Icon name={plugin.enabled ? 'plug' : 'puzzle'} size={14} />
              <span className="truncate">{plugin.name}</span>
            </span>
            {plugin.marketplace && (
              <span className="badge badge-accent">{plugin.marketplace}</span>
            )}
            <span className="badge badge-muted tnum">v{plugin.version}</span>
          </div>
          <p className="tiny muted truncate" style={{ margin: 0, fontFamily: 'inherit' }}>
            {plugin.description || plugin.installPath}
          </p>
        </div>

        <div className="row" style={{ flexShrink: 0, gap: 10 }}>
          <button
            type="button"
            role="switch"
            aria-checked={plugin.enabled}
            className="btn-secondary btn-sm"
            onClick={(e) => onToggle(plugin.id, plugin.enabled, e)}
            title={plugin.enabled ? `禁用 ${plugin.name}` : `启用 ${plugin.name}`}
          >
            <span className={`badge ${plugin.enabled ? 'badge-ok' : 'badge-muted'}`}>
              {plugin.enabled ? '已启用' : '已禁用'}
            </span>
          </button>
          <Icon name="chevron-right" size={15} className="muted" />
        </div>
      </div>
    </div>
  )
}
