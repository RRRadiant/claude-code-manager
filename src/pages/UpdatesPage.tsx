import { useEnvironmentStore } from '../stores/environmentStore'
import { GlassCard } from '../components/glass'

// Application version — single source would be ideal (build-time injection),
// but for now we keep it in sync with package.json / Cargo.toml / tauri.conf.json.
const APP_VERSION = 'v0.1.0'

export default function UpdatesPage() {
  const { status } = useEnvironmentStore()

  return (
    <div className="page">
      <h1 style={{ marginBottom: 'var(--s4)' }}>更新</h1>

      {/* Claude Code — read-only version display */}
      <GlassCard blur={8} tint="rgba(255,255,255,0.05)" style={{ marginBottom: 'var(--s2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--s3) var(--s4)' }}>
          <div>
            <h3 style={{ marginBottom: 2 }}>Claude Code</h3>
            <p className="text-tertiary" style={{ fontSize: 'var(--text-sm)' }}>
              {status?.claude_code.version ?? '未安装'}
            </p>
          </div>
          <span className={`tag ${status?.claude_code.health === 'healthy' ? 'tag-ok' : 'tag-warn'}`}>
            {status?.claude_code.health ?? '未知'}
          </span>
        </div>
      </GlassCard>

      {/* Claude Code Manager — version only, no self-update */}
      <GlassCard blur={8} tint="rgba(255,255,255,0.05)" style={{ marginBottom: 'var(--s2)' }}>
        <div style={{ padding: 'var(--s3) var(--s4)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s1)' }}>
            <h3 style={{ marginBottom: 0 }}>Claude Code Manager</h3>
            <span className="tag">{APP_VERSION}</span>
          </div>
          <p className="text-tertiary" style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
            应用自身的自动更新功能尚未启用。
            如需升级，请手动前往项目发布页关注新版本 Release。
          </p>
        </div>
      </GlassCard>

      {/* Hint */}
      <GlassCard blur={6} tint="rgba(10,132,255,0.04)">
        <div style={{ padding: 'var(--s3) var(--s4)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
          💡 Claude Code 自身内置更新机制，可在终端运行 <code>claude update</code> 检查更新。
        </div>
      </GlassCard>
    </div>
  )
}
