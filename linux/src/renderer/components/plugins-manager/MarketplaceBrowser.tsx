import { useEffect, useState, useCallback } from 'react'

import { Icon } from '../shared/Icon'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  onBack: () => void
}

type Tab = 'browse' | 'sources'

// ---------------------------------------------------------------------------
// MarketplaceBrowser
// ---------------------------------------------------------------------------

/**
 * Marketplace browser (catalog browse + source management).
 *
 * Restyled onto the shared panel system. The two tabs were a bespoke pill
 * group that only differed from the shared segmented control by colour;
 * category filters were the same pill repeated as raw buttons; plugin cards had
 * no status element beyond an "已安装" label. Now: a real page header, `.seg`
 * for the tabs, badges for marketplace/version/installed state, a card grid
 * that states whether an install is needed, and source rows as key/value pairs
 * with a labelled remove affordance.
 *
 * Behaviour is unchanged: same parallel load, same `name@marketplace`
 * installed-key check, same prompt/confirm flows, and the install action still
 * only tells the user which terminal command to run.
 */
export function MarketplaceBrowser({ onBack }: Props): React.ReactElement {
  const [tab, setTab] = useState<Tab>('browse')
  const [marketplaceData, setMarketplaceData] = useState<MarketplaceData | null>(null)
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')

  // -----------------------------------------------------------------------
  // Fetch: marketplace catalog + installed plugins in parallel
  // -----------------------------------------------------------------------

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [marketResult, installedResult] = await Promise.all([
        window.electronAPI.marketplaceList(),
        window.electronAPI.pluginsList(),
      ])

      if (!marketResult.success || !marketResult.data) {
        setError(marketResult.error || '加载 Marketplace 数据失败')
        return
      }

      setMarketplaceData(marketResult.data)

      // Build a set of "name@marketplace" keys for installed plugins so we
      // can disable the "安装" button on cards that are already installed.
      if (installedResult.success && installedResult.data) {
        const keys = new Set(
          installedResult.data.map((p) => `${p.name}@${p.marketplace}`),
        )
        setInstalledIds(keys)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // -----------------------------------------------------------------------
  // Source management
  // -----------------------------------------------------------------------

  const handleAddSource = async () => {
    const name = prompt('Marketplace 名称:')
    if (!name || !name.trim()) return
    const repo = prompt('GitHub 仓库 (格式: owner/repo):')
    if (!repo || !repo.trim()) return

    const result = await window.electronAPI.marketplaceAddSource({
      name: name.trim(),
      repo: repo.trim(),
    })

    if (result.success) {
      load()
    } else {
      alert(`添加失败: ${result.error}`)
    }
  }

  const handleRemoveSource = async (sourceName: string) => {
    if (!confirm(`确定要移除 marketplace "${sourceName}" 吗？`)) return

    const result = await window.electronAPI.marketplaceRemoveSource({
      name: sourceName,
    })

    if (result.success) {
      load()
    } else {
      alert(`移除失败: ${result.error}`)
    }
  }

  // -----------------------------------------------------------------------
  // Install flow
  // -----------------------------------------------------------------------

  const handleInstall = (pluginName: string, marketplaceName: string) => {
    alert(`请在终端运行:\nclaude plugin install ${pluginName}@${marketplaceName}`)
  }

  // -----------------------------------------------------------------------
  // Derived values for browse tab
  // -----------------------------------------------------------------------

  const plugins = marketplaceData?.plugins ?? []

  // Build category list: "All" first, then deduplicated from plugin data.
  const categories = [
    'All',
    ...Array.from(new Set(plugins.map((p) => p.category).filter(Boolean))).sort(),
  ] as string[]

  // Filter by search text and selected category.
  const filtered = plugins.filter((p) => {
    const q = search.toLowerCase()
    const matchSearch =
      !search ||
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    const matchCat = category === 'All' || p.category === category
    return matchSearch && matchCat
  })

  const sources = marketplaceData?.marketplaces ?? []

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="page">
      <header className="page-header" style={{ flexWrap: 'wrap' }}>
        <div>
          <button className="btn-ghost btn-sm" onClick={onBack} style={{ marginLeft: -8 }}>
            <Icon name="chevron-left" size={13} />
            返回插件列表
          </button>
          <h1 className="page-title" style={{ marginTop: 4 }}>
            Marketplace
          </h1>
          <p className="page-subtitle">
            浏览已注册源提供的插件目录，并管理这些源
            {plugins.length > 0 && ` · 目录中共 ${plugins.length} 个插件`}
          </p>
        </div>
      </header>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <section className="section">
        <div className="seg">
          <button
            className={`seg-item ${tab === 'browse' ? 'is-on' : ''}`}
            onClick={() => setTab('browse')}
            aria-pressed={tab === 'browse'}
          >
            浏览插件
          </button>
          <button
            className={`seg-item ${tab === 'sources' ? 'is-on' : ''}`}
            onClick={() => setTab('sources')}
            aria-pressed={tab === 'sources'}
          >
            源管理
          </button>
        </div>
      </section>

      {error ? (
        <div className="callout callout-danger" style={{ marginBottom: 18 }}>
          <span className="callout-icon">
            <Icon name="alert" size={15} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="callout-title">读取 Marketplace 失败</p>
            <p className="callout-body">{error}</p>
          </div>
          <button className="btn-secondary btn-sm" onClick={load}>
            重试
          </button>
        </div>
      ) : loading ? (
        <p className="muted" style={{ padding: '48px 0', textAlign: 'center' }}>
          加载中...
        </p>
      ) : tab === 'browse' ? (
        <>
          {/* ── Search + categories ──────────────────────────────────── */}
          <section className="section">
            <div className="input-group">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索插件名称或描述..."
                className="form-input"
                aria-label="搜索插件"
                spellCheck={false}
              />
              {search && (
                <button
                  className="btn-secondary"
                  onClick={() => setSearch('')}
                  style={{ flexShrink: 0 }}
                >
                  清除
                </button>
              )}
            </div>

            {categories.length > 1 && (
              <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    aria-pressed={category === cat}
                    className={`badge ${category === cat ? 'badge-accent' : 'badge-muted'}`}
                    style={{ cursor: 'pointer', padding: '4px 10px' }}
                  >
                    {cat === 'All' ? '全部' : cat}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ── Results ──────────────────────────────────────────────── */}
          <section className="section">
            <h2 className="section-label">
              插件目录
              {filtered.length > 0 && ` · ${filtered.length} 个结果`}
            </h2>

            {filtered.length === 0 ? (
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
                    {search || category !== 'All' ? '没有匹配的插件' : 'Marketplace 中暂无可用的插件'}
                  </div>
                  <p style={{ maxWidth: 460, margin: '6px auto 0', lineHeight: 1.7 }}>
                    {search || category !== 'All'
                      ? '换个关键词，或把分类切回「全部」再试。'
                      : '目录来自已注册的源。到「源管理」添加一个 GitHub 仓库（owner/repo）后，这里就会列出它提供的插件。'}
                  </p>
                  {(search || category !== 'All') && (
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setSearch('')
                        setCategory('All')
                      }}
                      style={{ marginTop: 16 }}
                    >
                      清除筛选条件
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                {filtered.map((p) => {
                  const pluginKey = `${p.name}@${p.marketplace}`
                  const isInstalled = installedIds.has(pluginKey)

                  return (
                    <div
                      key={pluginKey}
                      className="card card-pad"
                      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                    >
                      <div className="row-between" style={{ alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0 }}>
                          <div
                            className="truncate"
                            style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}
                          >
                            {p.name}
                          </div>
                          <div className="tiny muted truncate">@{p.marketplace}</div>
                        </div>
                        {p.version && (
                          <span className="badge badge-muted tnum" style={{ flexShrink: 0 }}>
                            v{p.version}
                          </span>
                        )}
                      </div>

                      {p.category && (
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <span className="badge badge-muted">{p.category}</span>
                        </div>
                      )}

                      <p
                        className="tiny secondary"
                        style={{
                          margin: 0,
                          flex: 1,
                          lineHeight: 1.6,
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {p.description || '（该插件没有提供描述）'}
                      </p>

                      <div className="row-between" style={{ gap: 8 }}>
                        <span className="tiny muted truncate">
                          {p.author?.name ? p.author.name : '未署名'}
                        </span>
                        {isInstalled ? (
                          <span className="badge badge-ok" style={{ flexShrink: 0 }}>
                            <Icon name="check" size={11} />
                            已安装
                          </span>
                        ) : (
                          <button
                            className="btn-secondary btn-sm"
                            onClick={() => handleInstall(p.name, p.marketplace)}
                            style={{ flexShrink: 0 }}
                            title={`安装 ${pluginKey}`}
                          >
                            <Icon name="download" size={12} />
                            安装
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <p className="field-hint">
              安装需要在终端执行 Claude Code 的插件命令，点击「安装」会给出对应的命令行。
            </p>
          </section>
        </>
      ) : (
        /* ── Sources tab ────────────────────────────────────────────── */
        <section className="section">
          <h2 className="section-label">
            已注册的源
            {sources.length > 0 && ` · ${sources.length} 个`}
          </h2>

          {sources.length === 0 ? (
            <div className="card">
              <div className="empty">
                <Icon name="package" size={22} />
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 'var(--text-md)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  还没有注册任何 Marketplace 源
                </div>
                <p style={{ maxWidth: 460, margin: '6px auto 0', lineHeight: 1.7 }}>
                  一个源就是一个 GitHub 仓库（格式 <code>owner/repo</code>），
                  仓库里放着插件目录清单。添加之后，「浏览插件」标签页会列出它提供的插件。
                </p>
                <button className="btn-primary" onClick={handleAddSource} style={{ marginTop: 16 }}>
                  <Icon name="download" size={14} />
                  添加源
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
                <button className="btn-primary btn-sm" onClick={handleAddSource}>
                  <Icon name="download" size={13} />
                  添加源
                </button>
              </div>
              <div className="card card-pad">
                {sources.map((m) => (
                  <div className="kv" key={m.name}>
                    <span className="kv-label row" style={{ gap: 7 }}>
                      <Icon name="package" size={13} />
                      {m.name}
                    </span>
                    <span
                      className="kv-value row"
                      style={{ gap: 10, justifyContent: 'flex-end', minWidth: 0 }}
                    >
                      <span className="mono truncate" title={m.source.repo}>
                        {m.source.repo}
                      </span>
                      <button
                        className="btn-danger btn-sm"
                        onClick={() => handleRemoveSource(m.name)}
                        title={`移除 ${m.name}`}
                        style={{ flexShrink: 0 }}
                      >
                        <Icon name="trash" size={12} />
                        移除
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <p className="field-hint">
                移除源只会取消注册，已经安装的插件不会被删除。
              </p>
            </>
          )}
        </section>
      )}
    </div>
  )
}
