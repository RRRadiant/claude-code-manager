import { useAppStore } from '../stores/appStore'

export default function SettingsPage() {
  const {
    theme, setTheme,
    reducedMotion, setReducedMotion,
    reducedGlass, setReducedGlass,
    sidebarCollapsed, toggleSidebar,
  } = useAppStore()

  return (
    <div className="page">
      <div className="page-header">
        <h1>设置</h1>
      </div>

      <div className="section">
        <h2>外观</h2>
        <div className="settings-group">
          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-label">主题</span>
              <span className="setting-desc">选择界面主题风格</span>
            </div>
            <select className="input setting-input" value={theme} onChange={(e) => setTheme(e.target.value as any)}>
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </div>
          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-label">减少动画</span>
              <span className="setting-desc">关闭过渡动效，提升响应速度</span>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-label">减少玻璃效果</span>
              <span className="setting-desc">关闭 Liquid Glass 特效，提升性能</span>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={reducedGlass} onChange={(e) => setReducedGlass(e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
      </div>

      <div className="section">
        <h2>界面布局</h2>
        <div className="settings-group">
          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-label">侧边栏</span>
              <span className="setting-desc">展开或收起左侧导航</span>
            </div>
            <button className="btn btn-secondary setting-input" onClick={toggleSidebar}>
              {sidebarCollapsed ? '展开' : '收起'}
            </button>
          </div>
        </div>
      </div>

      <div className="section">
        <h2>数据</h2>
        <div className="settings-group">
          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-label">日志目录</span>
              <span className="setting-desc">查看应用日志文件位置</span>
            </div>
            <button className="btn btn-secondary setting-input">打开</button>
          </div>
          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-label">数据目录</span>
              <span className="setting-desc">查看用户数据存储位置</span>
            </div>
            <button className="btn btn-secondary setting-input">打开</button>
          </div>
        </div>
      </div>
    </div>
  )
}
