import { useEffect, useState } from 'react'
import { useEnvironmentStore } from '../stores/environmentStore'
import type { EnvironmentStatus } from '../types'

export default function EnvironmentPage() {
  const { status, loading, detect } = useEnvironmentStore()
  const [installStatus, setInstallStatus] = useState<string | null>(null)

  useEffect(() => { detect() }, [])

  const handleInstall = async () => {
    setInstallStatus('installing')
    // TODO: Connect to Tauri backend
    setInstallStatus('not-implemented')
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>安装与环境</h1>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={handleInstall} disabled={installStatus === 'installing'}>
            {installStatus === 'installing' ? '安装中...' : '一键安装 Claude Code'}
          </button>
          <button className="btn btn-secondary" onClick={detect} disabled={loading}>
            {loading ? '检测中...' : '重新检测'}
          </button>
        </div>
      </div>

      {installStatus === 'not-implemented' && (
        <div className="alert alert-info">
          <span>安装功能将连接 Rust 后端执行。当前为 UI 原型阶段。</span>
        </div>
      )}

      <div className="section">
        <h2>系统环境</h2>
        {renderCheckGroups(status, loading)}
      </div>

      <div className="section">
        <h2>安装选项</h2>
        <div className="card-grid">
          <div className="card glass">
            <h3>官方推荐（原生）</h3>
            <p>通过 PowerShell 安装 Claude Code 原生 Windows 版本。不需要 Node.js。</p>
            <button className="btn btn-primary" onClick={handleInstall}>安装</button>
          </div>
          <div className="card glass">
            <h3>WinGet</h3>
            <p>通过 Windows 包管理器安装。需要 WinGet 支持。</p>
            <button className="btn btn-secondary">安装</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function renderCheckGroups(status: EnvironmentStatus | null, loading: boolean) {
  if (loading) return <p className="text-secondary">检测中...</p>
  if (!status) return <p className="text-secondary">点击"重新检测"开始</p>

  const checks = [
    { label: 'Windows 版本', value: status.windows.display_version, ok: true },
    { label: '系统架构', value: status.windows.architecture, ok: true },
    { label: '管理员权限', value: status.windows.is_elevated ? '是' : '否', ok: true },
    { label: 'PowerShell', value: status.powershell.available ? `可用 (${status.powershell.version || ''})` : '不可用', ok: status.powershell.available },
    { label: 'Git for Windows', value: status.git.installed ? `已安装 (${status.git.version || ''})` : '未安装（可选）', ok: true },
    { label: 'WebView2', value: status.webview2.installed ? '已安装' : '未检测到', ok: status.webview2.installed },
    { label: 'Claude Code', value: status.claude_code.installed ? `已安装 (${status.claude_code.version || ''})` : '未安装', ok: status.claude_code.installed },
    { label: 'PATH 配置', value: status.path.claude_bin_in_path ? '已配置' : '未配置', ok: status.path.claude_bin_in_path },
  ]

  return (
    <div className="check-list">
      {checks.map((c) => (
        <div key={c.label} className={`check-item ${c.ok ? 'ok' : 'warn'}`}>
          <span className={`check-dot ${c.ok ? 'bg-success' : 'bg-warning'}`} />
          <span className="check-label">{c.label}</span>
          <span className="check-value">{c.value}</span>
          {!c.ok && <button className="btn btn-small btn-ghost">修复</button>}
        </div>
      ))}
    </div>
  )
}
