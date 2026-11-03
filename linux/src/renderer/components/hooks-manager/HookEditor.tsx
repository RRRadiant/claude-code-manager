import { useEffect, useState } from 'react'

import { Icon } from '../shared/Icon'

const HOOK_EVENTS = [
  'Setup', 'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'PreToolUse', 'PostToolUse', 'PreCompact', 'Stop',
  'SubagentStart', 'SubagentStop', 'PermissionRequest', 'Notification',
] as const

interface Props {
  event: string
  index: number | null
  onBack: () => void
}

/**
 * Hook editor — reached from the hooks list, either for an existing entry
 * (`index`) or for a new one (`index === null`, which the list signals with -1).
 *
 * Restyled onto the shared panel system: an explicit back control, a title that
 * says which event is being edited, labels on every field, and save state
 * rendered as text plus an icon rather than a bare coloured line.
 *
 * Behaviour preserved: `hooks:list` on open, `hooks:add` / `hooks:update` on
 * save, the digits-only timeout filter, the disabled-until-there-is-a-command
 * save button, and the 500 ms `onBack()` after a successful save.
 *
 * One bug is fixed here: the event selector used to stay editable while editing
 * an existing entry, and `hooks:update` writes to `hooks[event][index]` — so
 * changing the event did not move the hook, it overwrote whatever entry sat at
 * that index under the *other* event and left the original in place. The
 * selector is now read-only for an existing entry.
 */
export function HookEditor({ event: initialEvent, index, onBack }: Props): React.ReactElement {
  const isNew = index === null

  const [event, setEvent] = useState(initialEvent)
  const [matcher, setMatcher] = useState('*')
  const [command, setCommand] = useState('')
  const [timeout, setTimeout_] = useState('30000')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!isNew) {
      loadHook()
    }
  }, [])

  const loadHook = async () => {
    try {
      const result = await window.electronAPI.hooksList()
      if (result.success && result.data) {
        const hooks = (
          result.data as {
            hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string; timeout?: number }> }>>
          }
        ).hooks
        const items = hooks[initialEvent]
        if (items && index !== null && items[index] !== undefined) {
          const group = items[index]
          setMatcher(group.matcher || '*')
          setCommand(group.hooks[0]?.command || '')
          setTimeout_(String(group.hooks[0]?.timeout ?? 30000))
        }
      }
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    const opts = {
      event,
      matcher: matcher || '*',
      command,
      timeout: parseInt(timeout, 10) || 30000,
    }
    try {
      const result = isNew
        ? await window.electronAPI.hooksAdd(opts)
        : await window.electronAPI.hooksUpdate({ ...opts, index: index as number })
      if (result.success) {
        setMessage({ type: 'success', text: '已保存' })
        setTimeout(() => onBack(), 500)
      } else {
        setMessage({ type: 'error', text: result.error || '保存失败' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="page">
        <p className="muted" style={{ padding: '48px 0', textAlign: 'center' }}>
          加载中...
        </p>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-header">
        <div style={{ minWidth: 0 }}>
          <button
            className="btn-ghost btn-sm"
            onClick={onBack}
            style={{ marginBottom: 8, marginLeft: -10 }}
          >
            <Icon name="chevron-left" size={14} />
            返回 Hook 列表
          </button>
          <h1 className="page-title">{isNew ? '新建 Hook' : `编辑 Hook · ${initialEvent}`}</h1>
          <p className="page-subtitle">
            {isNew
              ? '选择事件、matcher 与要执行的命令，保存后写入 settings.json'
              : `修改「${initialEvent}」下第 ${(index as number) + 1} 条 Hook 的 matcher 与命令`}
          </p>
        </div>
      </header>

      {/* ── 触发条件 ───────────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">触发条件</h2>
        <div className="card card-pad">
          <div className="field">
            <label className="field-label" htmlFor="hook-event">
              生命周期事件
            </label>
            <select
              id="hook-event"
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              disabled={!isNew}
              className="form-select"
              style={{ maxWidth: 320 }}
            >
              {HOOK_EVENTS.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </select>
            <p className="field-hint">
              {isNew ? (
                <>Hook 在所选事件触发时执行命令。</>
              ) : (
                <>
                  事件是这条 Hook 在 <code>settings.json</code> 中的归属键，此处不可更改：把一条
                  Hook 挂到别的事件下等于新建一条。需要更换事件时，请回到列表删除它，再在新事件下重建。
                </>
              )}
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="hook-matcher">
              Matcher（匹配器）
            </label>
            <input
              id="hook-matcher"
              type="text"
              value={matcher}
              onChange={(e) => setMatcher(e.target.value)}
              placeholder="*"
              className="form-input"
              style={{ maxWidth: 320 }}
              spellCheck={false}
              autoComplete="off"
            />
            <p className="field-hint">
              Glob 模式。带工具名的事件（如 <code>PreToolUse</code> /{' '}
              <code>PostToolUse</code>）用它筛选工具；不确定时保留 <code>*</code>{' '}
              匹配全部。留空保存时会按 <code>*</code> 处理。
            </p>
          </div>
        </div>
      </section>

      {/* ── 执行 ───────────────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">执行的命令</h2>
        <div className="card card-pad">
          <div className="field">
            <label className="field-label" htmlFor="hook-command">
              Command
            </label>
            <input
              id="hook-command"
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="/path/to/script 或 echo done >> /tmp/hook.log"
              className="form-input"
              spellCheck={false}
              autoComplete="off"
            />
            <p className="field-hint">
              由 shell 执行的一整条命令，可以带参数。必填——为空时无法保存。
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="hook-timeout">
              Timeout（毫秒）
            </label>
            <input
              id="hook-timeout"
              type="text"
              inputMode="numeric"
              value={timeout}
              onChange={(e) => {
                const v = e.target.value
                // Allow only digits
                if (v === '' || /^\d+$/.test(v)) {
                  setTimeout_(v)
                }
              }}
              className="form-input tnum"
              style={{ maxWidth: 180 }}
            />
            <p className="field-hint">
              超过该时长后 Claude Code 不再等待这条命令，默认 30000（30 秒）。
            </p>
          </div>
        </div>
      </section>

      {/* ── 保存 ───────────────────────────────────────────────────────── */}
      <div className="actions">
        <button className="btn-primary" onClick={handleSave} disabled={saving || !command.trim()}>
          {saving ? '保存中...' : isNew ? '创建 Hook' : '保存修改'}
        </button>
        <button className="btn-ghost" onClick={onBack}>
          取消
        </button>
        {message && (
          <span
            className="row"
            style={{
              fontSize: 'var(--text-sm)',
              color: message.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
              gap: 6,
            }}
          >
            <Icon name={message.type === 'success' ? 'check' : 'alert'} size={14} />
            {message.text}
          </span>
        )}
      </div>
    </div>
  )
}
