import { useEffect, useRef } from 'react'
import { useConsoleStore } from '../stores/consoleStore'

export default function ConsolePanel() {
  const { entries, expanded, clear, toggle } = useConsoleStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (expanded) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length, expanded])

  if (!expanded) return null

  const colors: Record<string, string> = {
    info:     'var(--text-tertiary)',
    success:  'var(--success)',
    error:    'var(--error)',
    progress: 'var(--accent)',
  }

  return (
    <div style={{
      borderTop: '1px solid var(--border-secondary)',
      background: 'rgba(0,0,0,0.03)',
      backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column',
      maxHeight: 200, overflow: 'hidden',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
        borderBottom: '1px solid var(--border-secondary)',
      }}>
        <span style={{ fontWeight: 600 }}>执行记录</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={clear}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}
          >清除</button>
          <button
            onClick={toggle}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}
          >关闭</button>
        </div>
      </div>
      {/* Log area */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '6px 12px',
        fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
        lineHeight: 1.7,
      }}>
        {entries.length === 0 ? (
          <span style={{ color: 'var(--text-tertiary)' }}>暂无日志</span>
        ) : (
          entries.map(e => (
            <div key={e.id} style={{ color: colors[e.kind] || 'var(--text-tertiary)' }}>
              <span style={{ opacity: 0.5 }}>{e.time}</span>
              {' '}{e.text}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
