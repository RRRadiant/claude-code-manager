import { useEffect, useState, useCallback } from 'react'

import { Icon } from '../shared/Icon'

const HOOK_EVENTS = [
  'Setup', 'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'PreToolUse', 'PostToolUse', 'PreCompact', 'Stop',
  'SubagentStart', 'SubagentStop', 'PermissionRequest', 'Notification',
] as const

/** Set form, so an event key read from settings.json can be membership-tested. */
const KNOWN_EVENTS = new Set<string>(HOOK_EVENTS)

interface HookDefinition {
  type: string
  command: string
  timeout?: number
}

interface HookGroup {
  matcher?: string
  hooks: HookDefinition[]
}

type HooksData = Record<string, HookGroup[]>

interface Props {
  onSelect: (event: string, index: number) => void
}

/** Same rendering rule as before: seconds when the timeout is a whole/fractional second. */
function formatTimeout(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s` : `${ms}ms`
}

/**
 * Hooks list.
 *
 * Restyled onto the shared panel system. The old markup was Tailwind utilities
 * plus a positioned dropdown, and it had drifted into a wall of one-weight text:
 * the event rows were unlabelled, the delete action only existed on hover, and
 * the expand state was an emoji triangle.
 *
 * Behaviour preserved: same `hooks:list` / `hooks:remove` calls, same expand
 * state, same `onSelect(event, -1)` contract for "create". The add picker moved
 * from an absolutely positioned dropdown to an inline card, which is the only
 * structural change — every event button still calls the same handler.
 *
 * Two display bugs are fixed here (see the panel report): the header count now
 * counts the entries this panel actually renders, and event keys outside the
 * supported list are surfaced instead of being counted but hidden.
 */
export function HooksList({ onSelect }: Props): React.ReactElement {
  const [hooks, setHooks] = useState<HooksData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showAddPicker, setShowAddPicker] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.hooksList()
      if (result.success && result.data) {
        setHooks((result.data as { hooks: HooksData }).hooks || {})
      } else {
        setError(result.error || '读取 hooks 配置失败')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (event: string, index: number) => {
    if (!confirm(`删除「${event}」下的这条 Hook？此操作不可撤销。`)) return
    const result = await window.electronAPI.hooksRemove({ event, index })
    if (result.success) {
      load()
    } else {
      alert(`删除失败：${result.error}`)
    }
  }

  const handleAdd = (event: string) => {
    setShowAddPicker(false)
    // -1 signals a new hook to the parent
    onSelect(event, -1)
  }

  const toggleExpand = (event: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(event)) {
        next.delete(event)
      } else {
        next.add(event)
      }
      return next
    })
  }

  // Count only what is rendered below, so the header never disagrees with the list.
  const totalHooks = HOOK_EVENTS.reduce((sum, event) => sum + (hooks[event]?.length ?? 0), 0)

  // Settings written by a newer Claude Code (or by hand) can hold event keys this
  // panel does not know. They used to be counted in the header but never drawn,
  // which produced a count with an empty body and no empty state.
  const unknownEvents = Object.keys(hooks).filter(
    (event) => !KNOWN_EVENTS.has(event) && (hooks[event]?.length ?? 0) > 0,
  )

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Hooks</h1>
          <p className="page-subtitle">
            Claude Code 生命周期事件上自动执行的命令，写在 <code>~/.claude/settings.json</code> 的{' '}
            <code>hooks</code> 字段
            {totalHooks > 0 && ` · 共 ${totalHooks} 条`}
          </p>
        </div>

        {showAddPicker ? (
          <button className="btn-ghost" onClick={() => setShowAddPicker(false)}>
            取消
          </button>
        ) : (
          <button className="btn-primary" onClick={() => setShowAddPicker(true)}>
            <Icon name="bolt" size={14} />
            新建 Hook
          </button>
        )}
      </header>

      {showAddPicker && (
        <section className="section">
          <h2 className="section-label">选择事件类型</h2>
          <div className="card card-pad">
            <p className="field-hint" style={{ marginTop: 0, marginBottom: 12 }}>
              先选这条 Hook 挂在哪个事件上，再进编辑器填写 matcher 与要执行的命令。
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                gap: 8,
              }}
            >
              {HOOK_EVENTS.map((event) => (
                <button
                  key={event}
                  className="btn-secondary btn-sm"
                  onClick={() => handleAdd(event)}
                >
                  {event}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

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

      {unknownEvents.length > 0 && (
        <div className="callout callout-warn" style={{ marginBottom: 18 }}>
          <span className="callout-icon">
            <Icon name="info" size={15} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="callout-title">
              有 {unknownEvents.length} 个事件不在本面板支持的事件列表中
            </p>
            <p className="callout-body">
              <code>{unknownEvents.join('、')}</code> —— 这些条目仍保留在{' '}
              <code>settings.json</code> 中，本面板不会显示或改动它们，需要时请直接编辑该文件。
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <p className="muted" style={{ padding: '48px 0', textAlign: 'center' }}>
          加载中...
        </p>
      ) : totalHooks === 0 && !error ? (
        <div className="card">
          <div className="empty">
            <Icon name="hook" size={22} />
            <div
              style={{
                marginTop: 10,
                fontSize: 'var(--text-md)',
                color: 'var(--color-text-secondary)',
              }}
            >
              还没有 Hook
            </div>
            <p style={{ maxWidth: 480, margin: '6px auto 0', lineHeight: 1.7 }}>
              Hook 是 Claude Code 在生命周期事件上自动执行的命令，写在{' '}
              <code>~/.claude/settings.json</code> 的 <code>hooks</code> 字段里。每条由「事件 + matcher + 命令」组成，例如在{' '}
              <code>PreToolUse</code> 上匹配 <code>Bash</code>，执行一个脚本记录每次命令调用。
            </p>
            <button
              className="btn-secondary"
              onClick={() => setShowAddPicker(true)}
              style={{ marginTop: 16 }}
            >
              创建第一条 Hook
            </button>
          </div>
        </div>
      ) : (
        <div className="stack-2">
          {HOOK_EVENTS.map((event) => {
            const items = hooks[event] || []
            if (items.length === 0) return null
            const isOpen = expanded.has(event)
            return (
              <div key={event} className="card">
                <button
                  onClick={() => toggleExpand(event)}
                  aria-expanded={isOpen}
                  className="row-between"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    font: 'inherit',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span className="row" style={{ minWidth: 0, gap: 9 }}>
                    {/* One icon for both states, rotated when open — the old
                        markup used ▼/▶ glyphs, which are font-drawn emoji. */}
                    <span
                      style={{
                        display: 'inline-flex',
                        flexShrink: 0,
                        transform: isOpen ? 'rotate(90deg)' : 'none',
                        transition: 'transform 0.15s var(--ease)',
                      }}
                    >
                      <Icon name="chevron-right" size={14} className="muted" />
                    </span>
                    <span style={{ fontSize: 'var(--text-base)', fontWeight: 600 }}>{event}</span>
                  </span>
                  <span className="badge badge-muted tnum" style={{ flexShrink: 0 }}>
                    {items.length} 条
                  </span>
                </button>

                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                    {items.map((group, idx) => {
                      // `hooks` is required by the type but comes straight out of a
                      // hand-editable file, so read it defensively — this used to
                      // throw on a group with no `hooks` array and blank the panel.
                      const first = group.hooks?.[0]
                      const cmd = first?.command || '?'
                      const timeout = first?.timeout
                      const extraCommands = (group.hooks?.length ?? 0) - 1
                      return (
                        <div
                          key={idx}
                          onClick={() => onSelect(event, idx)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              onSelect(event, idx)
                            }
                          }}
                          className="row-between"
                          style={{
                            padding: '10px 16px',
                            cursor: 'pointer',
                            borderTop: idx > 0 ? '1px solid var(--color-border-subtle)' : 'none',
                          }}
                        >
                          <div className="row" style={{ flex: 1, minWidth: 0, gap: 7 }}>
                            <span className="tiny muted" style={{ flexShrink: 0 }}>
                              matcher
                            </span>
                            <code
                              className="tiny truncate"
                              style={{ color: 'var(--color-accent-hover)', maxWidth: 190 }}
                            >
                              {group.matcher || '*'}
                            </code>
                            <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                              <Icon name="chevron-right" size={12} className="muted" />
                            </span>
                            <code className="tiny truncate secondary" style={{ minWidth: 0 }}>
                              {cmd}
                            </code>
                            {timeout !== undefined && (
                              <span className="tiny muted tnum" style={{ flexShrink: 0 }}>
                                {formatTimeout(timeout)}
                              </span>
                            )}
                            {extraCommands > 0 && (
                              <span className="badge badge-muted" style={{ flexShrink: 0 }}>
                                另有 {extraCommands} 条命令
                              </span>
                            )}
                          </div>
                          <button
                            className="btn-ghost btn-sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDelete(event, idx)
                            }}
                            title={`删除「${event}」下的这条 Hook`}
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
