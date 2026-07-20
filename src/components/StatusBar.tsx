// Claude Code Manager - Bottom status bar
import { useEnvironmentStore } from '../stores/environmentStore'

export default function StatusBar() {
  const { status, lastDetected, loading } = useEnvironmentStore()

  return (
    <footer className="status-bar">
      <div className="status-left">
        {loading ? (
          <span className="status-item">检测中...</span>
        ) : status ? (
          <>
            <span className={`status-dot ${status.claude_code.installed ? 'ok' : 'warn'}`} />
            <span className="status-item">
              Claude Code: {status.claude_code.installed
                ? status.claude_code.version || '已安装'
                : '未安装'}
            </span>
            <span className="status-divider" />
            <span className="status-item">
              {status.windows.architecture}
            </span>
          </>
        ) : (
          <span className="status-item">就绪</span>
        )}
      </div>
      <div className="status-right">
        {lastDetected && (
          <span className="status-item">
            最近检测: {new Date(lastDetected).toLocaleTimeString()}
          </span>
        )}
      </div>
    </footer>
  )
}
