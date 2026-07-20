import { useState } from 'react'

export default function UpdatesPage() {
  const [ccVersion] = useState<string | null>(null)
  const [ccLatest] = useState<string | null>(null)
  const [checkingCC, setCheckingCC] = useState(false)

  return (
    <div className="page">
      <div className="page-header">
        <h1>软件更新</h1>
      </div>

      <div className="section">
        <div className="card glass">
          <h2>Claude Code 更新</h2>
          <div className="update-info">
            <div className="update-row">
              <span className="update-label">当前版本</span>
              <span className="update-value">{ccVersion || '未安装'}</span>
            </div>
            <div className="update-row">
              <span className="update-label">最新版本</span>
              <span className="update-value">{ccLatest || '未知'}</span>
            </div>
          </div>
          <button className="btn btn-secondary" disabled={checkingCC}>
            {checkingCC ? '检查中...' : '检查更新'}
          </button>
        </div>
      </div>

      <div className="section">
        <div className="card glass">
          <h2>Claude Code Manager 更新</h2>
          <div className="update-info">
            <div className="update-row">
              <span className="update-label">当前版本</span>
              <span className="update-value">v0.1.0</span>
            </div>
            <div className="update-row">
              <span className="update-label">更新通道</span>
              <span className="update-value">Stable</span>
            </div>
          </div>
          <div className="update-actions">
            <button className="btn btn-secondary">检查更新</button>
            <button className="btn btn-primary">立即更新</button>
          </div>
        </div>
      </div>
    </div>
  )
}
