import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/appStore'

export default function SettingsPage() {
  const {
    theme, setTheme,
    reducedMotion, setReducedMotion,
    reducedGlass, setReducedGlass,
    sidebarCollapsed, toggleSidebar,
  } = useAppStore(
    useShallow((s) => ({
      theme: s.theme, setTheme: s.setTheme,
      reducedMotion: s.reducedMotion, setReducedMotion: s.setReducedMotion,
      reducedGlass: s.reducedGlass, setReducedGlass: s.setReducedGlass,
      sidebarCollapsed: s.sidebarCollapsed, toggleSidebar: s.toggleSidebar,
    })),
  )

  return (
    <div className="page">
      <h1 style={{ marginBottom: 'var(--s4)' }}>设置</h1>

      <h3 style={{ marginBottom: 'var(--s2)' }}>外观</h3>
      <div className="settings-group" style={{ marginBottom: 'var(--s4)' }}>
        <Setting label="主题" desc="浅色 / 深色 / 跟随系统">
          <select className="input" style={{ width: 'auto', minWidth: 120 }}
            value={theme}
            onChange={e => setTheme(e.target.value as 'light'|'dark'|'system')}>
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </Setting>
        <Setting label="减少动画" desc="关闭过渡动效">
          <label className="toggle">
            <input type="checkbox" aria-label="减少动画" checked={reducedMotion} onChange={e => setReducedMotion(e.target.checked)} />
            <span className="toggle-slider" aria-hidden="true" />
          </label>
        </Setting>
        <Setting label="减少玻璃效果" desc="关闭 Liquid Glass 特效">
          <label className="toggle">
            <input type="checkbox" aria-label="减少玻璃效果" checked={reducedGlass} onChange={e => setReducedGlass(e.target.checked)} />
            <span className="toggle-slider" aria-hidden="true" />
          </label>
        </Setting>
      </div>

      <h3 style={{ marginBottom: 'var(--s2)' }}>布局</h3>
      <div className="settings-group">
        <Setting label="侧边栏" desc={sidebarCollapsed ? '已收起' : '已展开'}>
          <button className="btn btn-ghost" onClick={toggleSidebar}>
            {sidebarCollapsed ? '展开' : '收起'}
          </button>
        </Setting>
      </div>
    </div>
  )
}

function Setting({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="setting-item">
      <div>
        <div className="setting-label">{label}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      {children}
    </div>
  )
}
