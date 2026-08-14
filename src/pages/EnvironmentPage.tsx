import { useEffect, useState } from 'react'
import { useEnvironmentStore } from '../stores/environmentStore'
import { useConsoleStore } from '../stores/consoleStore'
import type { EnvironmentStatus, InstallStepResult } from '../types'
import * as api from '../services/tauri'
import { GlassCard } from '../components/glass'

export default function EnvironmentPage() {
  const status = useEnvironmentStore((s) => s.status)
  const loading = useEnvironmentStore((s) => s.loading)
  const detect = useEnvironmentStore((s) => s.detect)
  const activeTask = useConsoleStore((s) => s.activeTask)
  const [plan, setPlan] = useState<InstallStepResult[] | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { detect() }, [detect])

  const loadPlan = async () => {
    setPlanLoading(true)
    setError(null)
    try { setPlan(await api.generateInstallPlan()) }
    catch (e) { setError(api.errorMessage(e)) }
    finally { setPlanLoading(false) }
  }

  return (
    <div className="page">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--s4)' }}>
        <h1 style={{ margin: 0 }}>环境</h1>
        <div style={{ display: 'flex', gap: 'var(--s1)' }}>
          <button className="btn btn-secondary" onClick={detect} disabled={loading}>
            {loading ? '检测中...' : '重新检测'}
          </button>
          <button className="btn btn-primary" onClick={loadPlan} disabled={planLoading}>
            {planLoading ? '...' : '安装计划'}
          </button>
        </div>
      </div>

      {error && <div className="alert" style={{ marginBottom: 'var(--s2)' }}>{error}</div>}

      {/* Real-time progress bar (Plan 1: EnvironmentPage progress) */}
      {activeTask && activeTask.status === 'running' && (
        <GlassCard blur={10} tint="rgba(10,132,255,0.06)" style={{ marginBottom: 'var(--s3)' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--s1)', color: 'var(--text-secondary)' }}>
            {activeTask.title}
          </div>
          <div style={{
            height: 4, borderRadius: 2, background: 'var(--bg-tertiary)',
            overflow: 'hidden', marginBottom: 'var(--s1)',
          }}>
            <div style={{
              width: `${Math.max(2, activeTask.progress)}%`,
              height: '100%', borderRadius: 2,
              background: 'var(--accent)',
              transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {activeTask.step}
          </div>
        </GlassCard>
      )}

      {/* System info */}
      <SystemInfo status={status} />

      {/* Install plan */}
      {plan && plan.length > 0 && (
        <div style={{ marginTop: 'var(--s4)' }}>
          <h2 style={{ marginBottom: 'var(--s2)' }}>安装计划</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s1)' }}>
            {plan.map(item => (
              <GlassCard key={item.component} blur={6} tint="rgba(255,255,255,0.06)">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s1)' }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: 4, flexShrink: 0,
                      background: item.success ? 'var(--success)' : 'var(--text-tertiary)',
                    }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{item.component}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {item.version ?? item.message}
                      </div>
                    </div>
                  </div>
                  {!item.success && (
                    <button className="btn btn-ghost" style={{ fontSize: 'var(--text-sm)' }}
                      disabled={activeTask?.status === 'running'}
                      onClick={() => {
                        if (item.component === 'Claude Code')
                          api.installClaudeCode().catch(e => setError(api.errorMessage(e)))
                        else
                          api.installFullEnvironment().catch(e => setError(api.errorMessage(e)))
                      }}
                    >
                      安装
                    </button>
                  )}
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── System info ──

function SystemInfo({ status }: { status: EnvironmentStatus | null }) {
  if (!status) return <p className="text-tertiary" style={{ marginTop: 'var(--s4)' }}>点击"重新检测"开始</p>

  const items: [string, string | undefined, boolean][] = [
    ['Windows', status.windows.display_version, true],
    ['架构', status.windows.display_architecture, true],
    ['PowerShell', status.powershell.version ?? (status.powershell.available ? '可用' : '不可用'), status.powershell.available],
    ['Git', status.git.version ?? undefined, status.git.installed],
    ['Node', status.node.node_version ?? undefined, !!status.node.node_version],
    ['npm', status.node.npm_version ?? undefined, !!status.node.npm_version],
    ['Claude Code', status.claude_code.version || (status.claude_code.installed ? '已安装' : undefined), status.claude_code.installed],
    ['WebView2', status.webview2.version ?? (status.webview2.installed ? '已安装' : '未检测到'), status.webview2.installed],
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--s1)' }}>
      {items.map(([label, value, ok]) => (
        <div key={label} style={{
          display: 'flex', alignItems: 'center', gap: 'var(--s1)',
          padding: 'var(--s2)', borderRadius: 'var(--r2)',
          background: 'var(--bg-secondary)', border: '1px solid var(--border-secondary)',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, background: ok ? 'var(--success)' : 'var(--text-tertiary)' }} />
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: ok ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{value ?? '—'}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
