// Claude Code Manager - Sidebar navigation
import { useAppStore } from '../stores/appStore'

const NAV_ITEMS = [
  { id: 'home', label: '首页' },
  { id: 'environment', label: '安装与环境' },
  { id: 'providers', label: 'API 与模型' },
  { id: 'config', label: '配置文件' },
  { id: 'mcp', label: 'MCP 管理' },
  { id: 'diagnostics', label: '故障诊断' },
  { id: 'updates', label: '软件更新' },
  { id: 'settings', label: '设置' },
  { id: 'about', label: '关于' },
]

const ICONS: Record<string, string> = {
  home: '🏠', environment: '🔧', providers: '🔌', config: '📝',
  mcp: '🔗', diagnostics: '🩺', updates: '📦', settings: '⚙️', about: '📖',
}

export default function Sidebar({ currentPage }: { currentPage?: string }) {
  const { sidebarCollapsed, toggleSidebar } = useAppStore()

  return (
    <nav className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        {!sidebarCollapsed && <span className="sidebar-title">CCM</span>}
        <button className="sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}>
          {sidebarCollapsed ? '☰' : '✕'}
        </button>
      </div>
      <ul className="sidebar-nav">
        {NAV_ITEMS.map((page) => (
          <li key={page.id}>
            <a
              href={`#${page.id}`}
              className={`sidebar-link ${currentPage === page.id ? 'active' : ''}`}
              title={sidebarCollapsed ? page.label : undefined}
            >
              <span className="nav-icon">{ICONS[page.id] || '•'}</span>
              {!sidebarCollapsed && <span className="nav-label">{page.label}</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
