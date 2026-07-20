import { useState } from 'react'
import type { DiagnosticReport, DiagCheckResult } from '../types'

export default function DiagnosticsPage() {
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [running, setRunning] = useState(false)

  const runDiagnostics = async () => {
    setRunning(true)
    // TODO: Connect to backend
    const mock: DiagnosticReport = {
      timestamp: new Date().toISOString(),
      total_checks: 8,
      passed: 0,
      warnings: 0,
      errors: 0,
      checks: [],
      system_info: 'Mock diagnostics'
    }
    setReport(mock)
    setRunning(false)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>故障诊断</h1>
        <button className="btn btn-primary" onClick={runDiagnostics} disabled={running}>
          {running ? '诊断中...' : '一键完整诊断'}
        </button>
      </div>

      {report && (
        <div className="section">
          <h2>诊断结果</h2>
          <div className="diag-summary">
            {report.checks.map((c, i) => (
              <div key={i} className={`diag-item ${c.status.toLowerCase()}`}>
                <span className={`diag-icon ${c.status.toLowerCase()}`}>
                  {c.status === 'Pass' ? '✓' : c.status === 'Warning' ? '⚠' : '✗'}
                </span>
                <div className="diag-content">
                  <span className="diag-name">{c.name}</span>
                  <span className="diag-message">{c.message}</span>
                  {c.fix_suggestion && (
                    <span className="diag-suggestion">{c.fix_suggestion}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!report && !running && (
        <div className="empty-state glass">
          <div className="empty-icon">🩺</div>
          <h3>运行诊断</h3>
          <p className="text-secondary">点击"一键完整诊断"检查系统状态</p>
        </div>
      )}
    </div>
  )
}
