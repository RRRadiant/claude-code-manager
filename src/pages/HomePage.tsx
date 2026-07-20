import { useEnvironmentStore } from '../stores/environmentStore'

export default function HomePage() {
  const { status, loading, detect } = useEnvironmentStore()

  return (
    <div className="page">
      <h1>Claude Code Manager</h1>
      <p className="subtitle">Windows Claude Code 图形化管理工具</p>

      <div className="welcome-cards">
        <a href="#environment" className="status-card glass">
          <div className="card-icon">🔧</div>
          <h3>环境检测与安装</h3>
          <p>检测系统环境、安装/修复/卸载 Claude Code</p>
        </a>
        <a href="#providers" className="status-card glass">
          <div className="card-icon">🔌</div>
          <h3>API 与模型</h3>
          <p>配置 Anthropic、DeepSeek 或自定义 API</p>
        </a>
        <a href="#config" className="status-card glass">
          <div className="card-icon">📝</div>
          <h3>配置文件</h3>
          <p>可视化编辑 settings.json、CLAUDE.md</p>
        </a>
        <a href="#mcp" className="status-card glass">
          <div className="card-icon">🔗</div>
          <h3>MCP 管理</h3>
          <p>管理和测试 MCP Server 连接</p>
        </a>
        <a href="#diagnostics" className="status-card glass">
          <div className="card-icon">🩺</div>
          <h3>故障诊断</h3>
          <p>一键扫描并修复常见问题</p>
        </a>
        <a href="#updates" className="status-card glass">
          <div className="card-icon">📦</div>
          <h3>软件更新</h3>
          <p>检查 Claude Code 和应用自身更新</p>
        </a>
      </div>

      <div className="section">
        <div className="section-header">
          <h2>环境概览</h2>
          <button className="btn btn-ghost" onClick={detect} disabled={loading}>
            {loading ? '检测中...' : '重新检测'}
          </button>
        </div>
        {status ? (
          <div className="overview-grid">
            <div className="overview-item">
              <span className="overview-label">系统</span>
              <span className="overview-value">{status.windows.architecture}</span>
            </div>
            <div className="overview-item">
              <span className="overview-label">Claude Code</span>
              <span className={`overview-value ${status.claude_code.installed ? 'text-success' : 'text-warning'}`}>
                {status.claude_code.installed ? status.claude_code.version || '已安装' : '未安装'}
              </span>
            </div>
            <div className="overview-item">
              <span className="overview-label">PowerShell</span>
              <span className={`overview-value ${status.powershell.available ? 'text-success' : 'text-error'}`}>
                {status.powershell.available ? '可用' : '不可用'}
              </span>
            </div>
            <div className="overview-item">
              <span className="overview-label">WebView2</span>
              <span className={`overview-value ${status.webview2.installed ? 'text-success' : 'text-warning'}`}>
                {status.webview2.installed ? '已安装' : '未检测到'}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-secondary">点击"重新检测"查看环境状态</p>
        )}
      </div>
    </div>
  )
}
