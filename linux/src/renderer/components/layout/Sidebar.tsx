import { useState } from 'react'

import { Icon, type IconName } from '../shared/Icon'

interface NavItem {
  id: string
  label: string
  icon: IconName
}

/** Grouped so related panels sit together instead of forming one long list. */
const NAV_GROUPS: Array<{ label: string | null; items: NavItem[] }> = [
  {
    label: null,
    items: [{ id: 'environment', label: '环境', icon: 'puzzle' }],
  },
  {
    label: '配置',
    items: [
      { id: 'api', label: 'API 配置', icon: 'key' },
      { id: 'models', label: '模型管理', icon: 'brain' },
      { id: 'settings', label: '通用设置', icon: 'settings' },
    ],
  },
  {
    label: '扩展',
    items: [
      { id: 'skills', label: 'Skills', icon: 'bolt' },
      { id: 'agents', label: 'Agents', icon: 'robot' },
      { id: 'hooks', label: 'Hooks', icon: 'hook' },
      { id: 'mcp', label: 'MCP Servers', icon: 'plug' },
      { id: 'plugins', label: 'Plugins', icon: 'package' },
    ],
  },
  {
    label: '文件',
    items: [{ id: 'config-files', label: '配置文件', icon: 'file' }],
  },
]

interface SidebarProps {
  activeId: string
  onSelect: (id: string) => void
}

export function Sidebar({ activeId, onSelect }: SidebarProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: collapsed ? 56 : 214,
        flexShrink: 0,
        background: 'var(--color-sidebar)',
        borderRight: '1px solid var(--color-border-subtle)',
        transition: 'width 0.18s var(--ease)',
      }}
    >
      {/* Brand */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: collapsed ? '16px 0' : '16px 14px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            flexShrink: 0,
            borderRadius: 7,
            background: 'linear-gradient(135deg, var(--color-accent), #4b8cff)',
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          C
        </div>
        {!collapsed && (
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 'var(--text-base)',
                fontWeight: 620,
                letterSpacing: '-0.01em',
                lineHeight: 1.25,
              }}
            >
              Claude Manager
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Linux</div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label ?? `g${gi}`} style={{ marginBottom: 14 }}>
            {group.label && !collapsed && (
              <div
                style={{
                  padding: '0 11px 6px',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-muted)',
                }}
              >
                {group.label}
              </div>
            )}
            {group.items.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={`nav-item ${activeId === item.id ? 'is-active' : ''}`}
                title={collapsed ? item.label : undefined}
                style={collapsed ? { justifyContent: 'center', padding: '9px 0' } : undefined}
              >
                <span className="nav-icon">
                  <Icon name={item.icon} size={16} />
                </span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="nav-item"
        style={{
          margin: 8,
          justifyContent: collapsed ? 'center' : 'flex-start',
          color: 'var(--color-text-muted)',
        }}
        title={collapsed ? '展开侧栏' : '收起侧栏'}
      >
        <span className="nav-icon">
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={15} />
        </span>
        {!collapsed && <span style={{ fontSize: 'var(--text-xs)' }}>收起</span>}
      </button>
    </aside>
  )
}
