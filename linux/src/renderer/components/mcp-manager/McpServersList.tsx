import { useEffect, useState, useCallback } from 'react'

import { Icon } from '../shared/Icon'

interface McpEntry {
  name: string
  type: string
  command?: string
  args?: string[]
  url?: string
}

interface Props {
  onSelect: (name: string) => void
  /** Open the editor for a server that does not exist yet. */
  onAdd: () => void
}

/**
 * MCP server list.
 *
 * Restyled onto the shared panel system: a page header with the primary action
 * beside it, a transport badge that says what the entry *is* in words as well as
 * colour, the resolved command/URL on a second line, and a delete control that
 * is always visible instead of hover-only.
 *
 * Behaviour preserved: same `mcp:list` / `mcp:remove` calls, same `onSelect` /
 * `onAdd` contract.
 *
 * One bug is fixed here (see the panel report): the transport badge called
 * `s.type.toUpperCase()` directly, so a server entry without an explicit `type`
 * — which Claude Code accepts and treats as stdio — threw during render and took
 * the whole panel down. The type is now normalised, and a type this panel does
 * not know is shown as-is rather than mislabelled.
 */
export function McpServersList({ onSelect, onAdd }: Props): React.ReactElement {
  const [servers, setServers] = useState<McpEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.mcpList()
      if (result.success && result.data) {
        setServers(result.data as McpEntry[])
      } else {
        setError(result.error || '读取 mcpServers 失败')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (name: string) => {
    if (!confirm(`删除 MCP 服务器「${name}」？此操作不可撤销。`)) return
    const result = await window.electronAPI.mcpRemove({ name })
    if (result.success) {
      load()
    } else {
      alert(`删除失败：${result.error}`)
    }
  }

  const handleAdd = () => {
    onAdd()
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">MCP 服务器</h1>
          <p className="page-subtitle">
            为 Claude Code 接入外部工具与数据源的服务，写在 <code>~/.claude/settings.json</code> 的{' '}
            <code>mcpServers</code> 字段
            {servers.length > 0 && ` · 共 ${servers.length} 个`}
          </p>
        </div>
        <button className="btn-primary" onClick={handleAdd}>
          <Icon name="plug" size={14} />
          添加服务器
        </button>
      </header>

      {error && (
        <div className="callout callout-danger" style={{ marginBottom: 18 }}>
          <span className="callout-icon">
            <Icon name="alert" size={15} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="callout-title">读取失败</p>
            <p className="callout-body">{error}</p>
          </div>
          <button className="btn-secondary btn-sm" onClick={load}>
            重试
          </button>
        </div>
      )}

      {loading ? (
        <p className="muted" style={{ padding: '48px 0', textAlign: 'center' }}>
          加载中...
        </p>
      ) : servers.length === 0 && !error ? (
        <div className="card">
          <div className="empty">
            <Icon name="plug" size={22} />
            <div
              style={{
                marginTop: 10,
                fontSize: 'var(--text-md)',
                color: 'var(--color-text-secondary)',
              }}
            >
              还没有 MCP 服务器
            </div>
            <p style={{ maxWidth: 480, margin: '6px auto 0', lineHeight: 1.7 }}>
              MCP（Model Context Protocol）服务器为 Claude Code 提供额外的工具与数据源，例如文件系统、数据库或内部 API。每个服务器写在{' '}
              <code>~/.claude/settings.json</code> 的 <code>mcpServers</code> 字段下：本地进程用{' '}
              <code>command</code> + <code>args</code>，远程端点用 <code>url</code>。
            </p>
            <button className="btn-secondary" onClick={handleAdd} style={{ marginTop: 16 }}>
              添加第一个服务器
            </button>
          </div>
        </div>
      ) : (
        <div className="stack-2">
          {servers.map((s) => {
            // `type` is optional in settings.json; Claude Code treats a missing
            // type as stdio. Anything else is shown verbatim rather than guessed.
            const isRemote = s.type === 'sse'
            const isStdio = s.type === 'stdio' || !s.type
            const typeLabel = isRemote
              ? 'SSE 远程'
              : isStdio
                ? 'STDIO 本地'
                : `${s.type} 未知类型`
            const target = isRemote ? s.url : s.command

            return (
              <div
                key={s.name}
                className="card card-pad card-hover"
                onClick={() => onSelect(s.name)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(s.name)
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <div className="row-between">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>{s.name}</span>
                      <span
                        className={`badge ${
                          isRemote ? 'badge-accent' : isStdio ? 'badge-muted' : 'badge-warn'
                        }`}
                        style={{ flexShrink: 0 }}
                      >
                        <Icon name={isRemote ? 'external' : 'terminal'} size={11} />
                        {typeLabel}
                      </span>
                    </div>
                    <p className="tiny muted truncate" style={{ margin: 0 }}>
                      {target || (isRemote ? '（未填写 URL）' : '（未填写 command）')}
                    </p>
                  </div>

                  <div className="row" style={{ flexShrink: 0 }}>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(s.name)
                      }}
                      title={`删除 ${s.name}`}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                    <Icon name="chevron-right" size={15} className="muted" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
