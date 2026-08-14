import { useState } from 'react'
import type { DiagnosticReport } from '../types'
import { runDiagnostics, errorMessage } from '../services/tauri'
import { GlassCard } from '../components/glass'

export default function DiagnosticsPage() {
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRun = async () => {
    setRunning(true); setError(null)
    try {
      const r = await runDiagnostics()
      setReport(r)
    } catch (e) {
      setError(errorMessage(e))
    } finally { setRunning(false) }
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--s4)' }}>
        <h1 style={{ margin: 0 }}>故障诊断</h1>
        <button className="btn btn-primary" onClick={handleRun} disabled={running}>
          {running ? '诊断中...' : '运行诊断'}
        </button>
      </div>

      {error && <div className="alert" style={{ marginBottom: 'var(--s2)' }}>{error}</div>}

      {report && (
        <>
          {/* Summary */}
          <div style={{
            display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s3)',
          }}>
            <GlassCard blur={8} tint="rgba(48,209,88,0.06)" style={{ flex: 1, textAlign: 'center', padding: 'var(--s3)' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{report.passed}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>通过</div>
            </GlassCard>
            <GlassCard blur={8} tint="rgba(255,159,10,0.06)" style={{ flex: 1, textAlign: 'center', padding: 'var(--s3)' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--warning)' }}>{report.warnings}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>警告</div>
            </GlassCard>
            <GlassCard blur={8} tint="rgba(255,69,58,0.06)" style={{ flex: 1, textAlign: 'center', padding: 'var(--s3)' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--error)' }}>{report.errors}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>错误</div>
            </GlassCard>
          </div>

          {/* Checks */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s1)' }}>
            {report.checks.map((c, i) => (
              <GlassCard key={i} blur={5} tint={c.status === 'Pass' ? 'rgba(48,209,88,0.04)' : 'rgba(255,69,58,0.04)'}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--s1)' }}>
                  <span style={{
                    fontSize: 14, fontWeight: 700, flexShrink: 0, width: 20, textAlign: 'center',
                    color: c.status === 'Pass' ? 'var(--success)' : c.status === 'Warning' ? 'var(--warning)' : 'var(--error)',
                  }}>
                    {c.status === 'Pass' ? '✓' : c.status === 'Warning' ? '⚠' : '✗'}
                  </span>
                  <div>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{c.name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{c.message}</div>
                    {c.details && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>{c.details}</div>}
                    {c.fix_suggestion && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)', marginTop: 4 }}>
                        {c.fix_suggestion}
                      </div>
                    )}
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        </>
      )}

      {!report && !running && !error && (
        <div style={{ textAlign: 'center', padding: 'var(--s6) 0', color: 'var(--text-tertiary)' }}>
          <p>点击"运行诊断"检查系统状态</p>
        </div>
      )}
    </div>
  )
}
