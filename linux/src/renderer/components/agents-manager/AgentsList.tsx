import { useEffect, useState, useCallback } from 'react'

import { Icon } from '../shared/Icon'

interface Props {
  onSelect: (filename: string) => void
}

/**
 * Model tier labels.
 *
 * Plain text rather than the emoji these used to carry (`⚡ Haiku`): the model
 * badge sits next to a coloured status dot, and mixing a colour emoji into a
 * monochrome badge row made the row look like two different design systems.
 */
const MODEL_LABELS: Record<string, string> = {
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
}

/**
 * Agents list (custom subagents).
 *
 * Restyled onto the shared panel system. Same information as before — name,
 * model tier, description, tool count — but with a page header, a properly
 * labelled create form, tool count as a badge instead of loose grey text, and a
 * per-row delete affordance in place of a bare "删除" text link.
 */
export function AgentsList({ onSelect }: Props): React.ReactElement {
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const loadAgents = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.agentsList()
      if (result.success && result.data) setAgents(result.data)
      else setError(result.error || '加载失败')
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  // Refresh when ~/.claude/agents/ changes underneath us.
  useEffect(() => {
    const cleanup = window.electronAPI.onFileChanged(({ paths }) => {
      if (paths.some((p) => p.includes('/agents/'))) loadAgents()
    })
    return cleanup
  }, [loadAgents])

  const handleDelete = async (filename: string) => {
    if (!confirm(`删除「${filename}」？此操作不可撤销。`)) return
    try {
      const result = await window.electronAPI.agentsDelete({ filename })
      if (result.success) setAgents((prev) => prev.filter((a) => a.filename !== filename))
      else alert(`删除失败：${result.error}`)
    } catch (err) {
      alert(`删除失败：${String(err)}`)
    }
  }

  const handleNew = async () => {
    const name = newName.trim()
    if (!name) return
    const filename = `${name}.md`
    const body = `# ${name}\n\n在此处编写 Agent 的系统提示...`
    setBusy(true)
    try {
      const res = await window.electronAPI.agentsWrite({
        filename,
        frontmatter: { name, description: '' },
        body,
      })
      if (res.success) {
        // The main process may have kebab-cased the name, so trust the filename
        // it reports back rather than the one we proposed.
        const actualFilename = res.data?.filename || filename
        await loadAgents()
        onSelect(actualFilename)
        setShowCreate(false)
        setNewName('')
      } else {
        alert(`创建失败：${res.error}`)
      }
    } catch (err) {
      alert(`创建失败：${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Agents</h1>
          <p className="page-subtitle">
            自定义子代理，存放在 <code>~/.claude/agents/</code>
            {agents.length > 0 && ` · 共 ${agents.length} 个`}
          </p>
        </div>

        {showCreate ? (
          <div className="row">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNew()
                if (e.key === 'Escape') {
                  setShowCreate(false)
                  setNewName('')
                }
              }}
              placeholder="agent-name"
              className="form-input"
              style={{ width: 190 }}
              autoFocus
              aria-label="新 Agent 名称"
              spellCheck={false}
            />
            <button className="btn-primary btn-sm" onClick={handleNew} disabled={busy || !newName.trim()}>
              创建
            </button>
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                setShowCreate(false)
                setNewName('')
              }}
            >
              取消
            </button>
          </div>
        ) : (
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Icon name="robot" size={14} />
            新建 Agent
          </button>
        )}
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
          <button className="btn-secondary btn-sm" onClick={loadAgents}>
            重试
          </button>
        </div>
      )}

      {loading ? (
        <p className="muted" style={{ padding: '48px 0', textAlign: 'center' }}>
          加载中...
        </p>
      ) : agents.length === 0 ? (
        <div className="card">
          <div className="empty">
            <Icon name="robot" size={22} />
            <div
              style={{ marginTop: 10, fontSize: 'var(--text-md)', color: 'var(--color-text-secondary)' }}
            >
              还没有自定义 Agent
            </div>
            <p style={{ maxWidth: 420, margin: '6px auto 0', lineHeight: 1.7 }}>
              Agent 是一个带独立系统提示的子代理：在{' '}
              <code>~/.claude/agents/</code> 下放一个 Markdown 文件，用 YAML
              frontmatter 声明名称、描述、可用工具与模型档位。
            </p>
            <button
              className="btn-secondary"
              onClick={() => setShowCreate(true)}
              style={{ marginTop: 16 }}
            >
              创建第一个 Agent
            </button>
          </div>
        </div>
      ) : (
        <div className="stack-2">
          {agents.map((agent) => (
            <div
              key={agent.filename}
              className="card card-pad card-hover"
              onClick={() => onSelect(agent.filename)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(agent.filename)
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              <div className="row-between">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>{agent.name}</span>
                    {agent.model && (
                      <span className="badge badge-accent">
                        {MODEL_LABELS[agent.model] || agent.model}
                      </span>
                    )}
                    {agent.tools && agent.tools.length > 0 && (
                      <span className="badge badge-muted">{agent.tools.length} 个工具</span>
                    )}
                  </div>
                  <p className="tiny muted truncate" style={{ margin: 0, fontFamily: 'inherit' }}>
                    {agent.description || '（无描述）'}
                  </p>
                </div>

                <div className="row" style={{ flexShrink: 0 }}>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(agent.filename)
                    }}
                    title={`删除 ${agent.filename}`}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                  <Icon name="chevron-right" size={15} className="muted" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
