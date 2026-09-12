import { useShallow } from 'zustand/react/shallow'
import { useEnvironmentStore } from '../stores/environmentStore'
import { useConsoleStore } from '../stores/consoleStore'

export default function StatusBar() {
  const status = useEnvironmentStore((s) => s.status)
  const { activeTask, expanded, toggle, entries } = useConsoleStore(
    useShallow((s) => ({
      activeTask: s.activeTask,
      expanded: s.expanded,
      toggle: s.toggle,
      entries: s.entries,
    })),
  )
  const ok = !!status?.claude_code.installed

  // Collapse the whole claude status into one truncatable string so it cannot
  // push the system info into a second line.
  const claudeLabel = status?.claude_code.version
    || (status?.claude_code.installed ? 'Claude Code 已安装' : '未安装 Claude Code')

  // One label for the system info: version + architecture were two separate
  // elements with their own separators, which wrapped independently.
  const sysVersion = status?.windows.version
  const sysArch = status?.windows.display_architecture ?? 'x86'
  const systemLabel = sysVersion ? `${sysVersion} · ${sysArch}` : sysArch

  return (
    <footer style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: 34, padding: '0 var(--s3)',
      fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
      borderTop: '1px solid var(--border-secondary)',
      background: 'rgba(255,255,255,0.02)',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
      // The row is a fixed 34px; without clipping, a long Claude Code version
      // string forces the system info to wrap onto a second line and the two
      // overlap. Truncate instead of colliding.
      overflow: 'hidden',
    }}>
      {/* Left: Claude Code status + plan 3 progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s1)', flex: 1, minWidth: 0 }}>
        <span style={{
          width: 5, height: 5, borderRadius: 2, flexShrink: 0,
          background: ok ? 'var(--success)' : 'var(--text-tertiary)',
        }} />
        <span
          title={claudeLabel}
          style={{
            fontWeight: 500, color: ok ? 'var(--text-secondary)' : undefined,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            minWidth: 0, flexShrink: 1,
          }}
        >
          {claudeLabel}
        </span>

        {/* Plan 3: Compact progress bar */}
        {activeTask?.status === 'running' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s0)', flex: 1, minWidth: 0, maxWidth: 200 }}>
            <div style={{
              flex: 1, height: 3, borderRadius: 2,
              background: 'var(--bg-tertiary)', overflow: 'hidden',
            }}>
              <div style={{
                width: `${Math.max(2, activeTask.progress)}%`,
                height: '100%', borderRadius: 2,
                background: 'var(--accent)',
                transition: 'width 0.3s ease',
              }} />
            </div>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>
              {activeTask.step}
            </span>
          </div>
        )}
      </div>

      {/* Right: console toggle + system */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s1)', flexShrink: 0 }}>
        <button
          onClick={toggle}
          title="执行记录"
          aria-label={expanded ? '收起执行记录' : '展开执行记录'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: expanded ? 'var(--accent)' : 'var(--text-tertiary)',
            display: 'flex', alignItems: 'center', gap: 3,
            fontSize: 'var(--text-xs)', padding: '2px 6px',
            borderRadius: 'var(--r1)',
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M13 3h5a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h5" />
            <path d="M13 17h6" /><path d="M13 13h6" /><path d="M13 9h6" />
            <path d="M9 7l-3 3 3 3" />
          </svg>
          {entries.length > 0 && !expanded && (
            <span>({entries.length})</span>
          )}
        </button>
        <span style={{ color: 'var(--border-primary)' }}>·</span>
        <span
          title={systemLabel}
          style={{
            whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis', maxWidth: 220, flexShrink: 0,
          }}
        >
          {systemLabel}
        </span>
      </div>
    </footer>
  )
}
