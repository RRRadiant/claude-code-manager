import { useEffect, useState, useCallback } from 'react'

import { Icon } from '../shared/Icon'

interface Props {
  onSelect: (filename: string) => void
}

/**
 * Skills list (Claude Code slash commands).
 *
 * Restyled onto the shared panel system: a real page header with the primary
 * action beside it, an empty state that explains what a skill *is* rather than
 * just that none exist, and per-row affordances instead of a bare "Delete" text
 * link. The `+ New Skill` inline form now has a label and a visible focus state,
 * which the previous one-field version lacked.
 */
export function SkillsList({ onSelect }: Props): React.ReactElement {
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const loadSkills = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.commandsList()
      if (result.success && result.data) setSkills(result.data)
      else setError(result.error || 'Failed to load skills')
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  // Refresh when Claude Code (or the user) edits ~/.claude/commands/ outside the
  // app, so the list never shows a stale view of the directory.
  useEffect(() => {
    const cleanup = window.electronAPI.onFileChanged(({ paths }) => {
      if (paths.some((p) => p.includes('/commands/'))) loadSkills()
    })
    return cleanup
  }, [loadSkills])

  const handleDelete = async (filename: string) => {
    if (!confirm(`删除「${filename}」？此操作不可撤销。`)) return
    try {
      const result = await window.electronAPI.commandsDelete({ filename })
      if (result.success) setSkills((prev) => prev.filter((s) => s.filename !== filename))
      else alert(`删除失败：${result.error}`)
    } catch (err) {
      alert(`删除失败：${String(err)}`)
    }
  }

  const handleNew = async () => {
    const name = newName.trim()
    if (!name) return
    const filename = `${name}.md`
    const content = `---\ndescription: \nargument-hint: \n---\n\n`
    setBusy(true)
    try {
      const result = await window.electronAPI.commandsWrite({ filename, content, format: 'markdown' })
      if (result.success) {
        await loadSkills()
        onSelect(filename)
        setShowCreate(false)
        setNewName('')
      } else {
        alert(`创建失败：${result.error}`)
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
          <h1 className="page-title">Skills</h1>
          <p className="page-subtitle">
            Claude Code 的斜杠命令，存放在 <code>~/.claude/commands/</code>
            {skills.length > 0 && ` · 共 ${skills.length} 个`}
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
              placeholder="skill-name"
              className="form-input"
              style={{ width: 190 }}
              autoFocus
              aria-label="新 Skill 名称"
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
            <Icon name="bolt" size={14} />
            新建 Skill
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
          <button className="btn-secondary btn-sm" onClick={loadSkills}>
            重试
          </button>
        </div>
      )}

      {loading ? (
        <p className="muted" style={{ padding: '48px 0', textAlign: 'center' }}>
          加载中...
        </p>
      ) : skills.length === 0 ? (
        <div className="card">
          <div className="empty">
            <Icon name="bolt" size={22} />
            <div style={{ marginTop: 10, fontSize: 'var(--text-md)', color: 'var(--color-text-secondary)' }}>
              还没有 Skill
            </div>
            <p style={{ maxWidth: 420, margin: '6px auto 0', lineHeight: 1.7 }}>
              Skill 是 Claude Code 的斜杠命令：在 <code>~/.claude/commands/</code> 下放一个
              Markdown 文件，文件名就是命令名，之后在 Claude Code 里输入{' '}
              <code>/文件名</code> 即可调用。
            </p>
            <button
              className="btn-secondary"
              onClick={() => setShowCreate(true)}
              style={{ marginTop: 16 }}
            >
              创建第一个 Skill
            </button>
          </div>
        </div>
      ) : (
        <div className="stack-2">
          {skills.map((skill) => (
            <div
              key={skill.filename}
              className="card card-pad card-hover"
              onClick={() => onSelect(skill.filename)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(skill.filename)
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              <div className="row-between">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>{skill.name}</span>
                    <span className={`badge ${skill.format === 'json' ? 'badge-accent' : 'badge-muted'}`}>
                      {skill.format === 'json' ? 'JSON' : 'MD'}
                    </span>
                  </div>
                  <p
                    className="tiny muted truncate"
                    style={{ margin: 0, fontFamily: 'inherit' }}
                  >
                    {skill.description || '（无描述）'}
                  </p>
                </div>

                <div className="row" style={{ flexShrink: 0 }}>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(skill.filename)
                    }}
                    title={`删除 ${skill.filename}`}
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
