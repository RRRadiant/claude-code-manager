import { GlassCard } from '../components/glass'

export default function AboutPage() {
  return (
    <div className="page" style={{ textAlign: 'center' }}>
      <div style={{ maxWidth: 420, margin: '0 auto' }}>
        <GlassCard blur={14} tint="rgba(255,255,255,0.06)" style={{ padding: 'var(--s6) var(--s5)', position: 'relative', overflow: 'hidden' }}>
          {/* Decorative background */}
          <div style={{
            position: 'absolute', inset: 0, opacity: 0.04,
            backgroundImage: 'url(/avatar.jpg)',
            backgroundSize: 'cover', backgroundPosition: 'center',
            filter: 'blur(40px) saturate(1.2)',
            transform: 'scale(1.5)',
          }} />
          {/* Avatar */}
          <div style={{
            width: 80, height: 80, margin: '0 auto var(--s3)',
            borderRadius: '50%', overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            border: '2px solid rgba(255,255,255,0.1)',
            position: 'relative', zIndex: 1,
          }}>
            <img
              src="/avatar.jpg"
              alt="avatar"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>

          <div style={{ position: 'relative', zIndex: 1 }}>
            <p className="text-tertiary" style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--s4)' }}>v0.1.0</p>

            <p style={{
              color: 'var(--text-secondary)', fontSize: 'var(--text-sm)',
              lineHeight: 1.6, marginBottom: 'var(--s4)',
            }}>
              Windows Claude Code 图形化管理工具。<br />
              让不熟悉命令行的用户也能轻松安装、<br />
              配置和管理 Claude Code。
            </p>

            <div style={{
              display: 'flex', justifyContent: 'center', gap: 'var(--s1)',
              flexWrap: 'wrap', marginBottom: 'var(--s4)',
            }}>
              {['Tauri 2', 'Rust', 'React', 'TypeScript', 'Vite', 'Liquid Glass'].map(t => (
                <span key={t} className="tag">{t}</span>
              ))}
            </div>

            <p className="text-tertiary" style={{ fontSize: 'var(--text-xs)' }}>
              MIT License © 2026
            </p>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
