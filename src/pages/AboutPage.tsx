export default function AboutPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h1>关于</h1>
      </div>

      <div className="about-card glass">
        <div className="about-logo">CCM</div>
        <h2>Claude Code Manager</h2>
        <p className="about-version">v0.1.0</p>
        <p className="about-desc">
          Windows Claude Code 图形化管理工具。<br />
          让不熟悉命令行的用户也能轻松安装、配置和管理 Claude Code。
        </p>

        <div className="about-section">
          <h3>技术栈</h3>
          <div className="tech-tags">
            <span className="tag">Tauri 2</span>
            <span className="tag">Rust</span>
            <span className="tag">React</span>
            <span className="tag">TypeScript</span>
            <span className="tag">Vite</span>
            <span className="tag">Liquid Glass</span>
          </div>
        </div>

        <div className="about-section">
          <h3>链接</h3>
          <div className="about-links">
            <a href="#" className="about-link">GitHub</a>
            <a href="#" className="about-link">Issues</a>
            <a href="#" className="about-link">许可证</a>
          </div>
        </div>

        <div className="about-license">
          <p>MIT License © 2026 Claude Code Manager Contributors</p>
        </div>
      </div>
    </div>
  )
}
