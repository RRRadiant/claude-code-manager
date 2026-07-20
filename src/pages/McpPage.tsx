import { useState } from 'react'

interface McpServer {
  name: string
  type: string
  command: string
  scope: string
  enabled: boolean
}

export default function McpPage() {
  const [servers] = useState<McpServer[]>([])
  const [filter, setFilter] = useState('all')

  return (
    <div className="page">
      <div className="page-header">
        <h1>MCP 管理</h1>
        <div className="page-actions">
          <button className="btn btn-primary">新增 MCP</button>
          <button className="btn btn-secondary">导入</button>
          <button className="btn btn-secondary">导出</button>
        </div>
      </div>

      <div className="section">
        <div className="toolbar">
          <input className="input search-input" placeholder="搜索 MCP Server..." />
          <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">所有作用域</option>
            <option value="local">Local</option>
            <option value="project">Project</option>
            <option value="user">User</option>
          </select>
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="empty-state glass">
          <div className="empty-icon">🔗</div>
          <h3>暂无 MCP Server</h3>
          <p className="text-secondary">点击"新增 MCP"添加第一个服务，或从现有配置中自动发现。</p>
          <div className="empty-actions">
            <button className="btn btn-primary">新增 MCP</button>
            <button className="btn btn-secondary">自动发现</button>
          </div>
        </div>
      ) : (
        <div className="mcp-list">
          {servers.map((s) => (
            <div key={s.name} className="mcp-item card glass">
              <div className="mcp-header">
                <span className={`mcp-status ${s.enabled ? 'enabled' : 'disabled'}`} />
                <h3>{s.name}</h3>
                <span className="mcp-type">{s.type}</span>
                <span className="mcp-scope">{s.scope}</span>
              </div>
              <code className="mcp-command">{s.command}</code>
              <div className="mcp-actions">
                <button className="btn btn-small btn-ghost">测试连接</button>
                <button className="btn btn-small btn-ghost">编辑</button>
                <button className="btn btn-small btn-ghost">删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
