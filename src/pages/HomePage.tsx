import { useEffect, useRef, useState } from 'react'
import { useEnvironmentStore } from '../stores/environmentStore'
import { GlassCard } from '../components/glass'
import * as api from '../services/tauri'

export default function HomePage() {
  const status = useEnvironmentStore((s) => s.status)
  const detect = useEnvironmentStore((s) => s.detect)
  const [launching, setLaunching] = useState(false)
  const [launchMsg, setLaunchMsg] = useState<string | null>(null)
  const launchMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (launchMsgTimer.current) clearTimeout(launchMsgTimer.current)
  }, [])

  const handleRunClaude = async () => {
    setLaunching(true)
    setLaunchMsg(null)
    try {
      const msg = await api.runClaude()
      setLaunchMsg(msg)
      launchMsgTimer.current = setTimeout(() => setLaunchMsg(null), 5000)
    } catch (e) {
      setLaunchMsg(api.errorMessage(e))
    } finally {
      setLaunching(false)
    }
  }

  const items = [
    { label: 'Claude Code', ok: !!status?.claude_code.installed, val: status?.claude_code.version || (status?.claude_code.installed ? '已安装' : '未安装'), tag: status?.claude_code.install_method },
    { label: 'Node.js',     ok: !!status?.node.node_version, val: status?.node.node_version ?? '未安装' },
    { label: 'npm',         ok: !!status?.node.npm_version,  val: status?.node.npm_version ?? '未安装' },
    { label: 'Git',         ok: !!status?.git.installed,     val: status?.git.version ?? '未安装' },
    { label: 'PowerShell',  ok: !!status?.powershell.available, val: status?.powershell.version ?? (status?.powershell.available ? '可用' : '不可用') },
    { label: 'WebView2',    ok: !!status?.webview2.installed, val: status?.webview2.version ?? (status?.webview2.installed ? '已安装' : '未检测到') },
    { label: '架构',         val: status?.windows.display_architecture ?? 'x86', ok: true },
  ]

  return (
    <div className="page">
      {/* Title row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 'var(--s5)',
      }}>
        <div>
          <h1 style={{ margin: 0, fontWeight: 700 }}>Claude Code Manager</h1>
          <span className="text-tertiary" style={{ fontSize: 'var(--text-sm)' }}>
            {status?.windows.version ?? 'Windows'}
          </span>
        </div>
        <button className="btn btn-ghost" onClick={detect} style={{ gap: 'var(--s1)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          刷新
        </button>
      </div>

      {status ? (
        <>
          {/* Glass card grid — visionOS style layered panes */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 'var(--s2)', marginBottom: 'var(--s4)',
          }}>
            {items.map(item => (
              <GlassCard key={item.label} blur={7} tint="rgba(255,255,255,0.08)" hover>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s0)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s1)' }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: 3,
                      background: item.ok ? 'var(--success)' : 'var(--text-tertiary)',
                      flexShrink: 0,
                    }} />
                    <span style={{
                      fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
                      textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 500,
                    }}>
                      {item.label}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 'var(--text-lg)', fontWeight: 600,
                    color: item.ok ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  }}>
                    {item.val}
                  </div>
                  {item.tag && <span style={{
                    fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
                    alignSelf: 'flex-start',
                  }}>{item.tag}</span>}
                </div>
              </GlassCard>
            ))}
          </div>

          {/* Bottom status row — glass */}
          {status.claude_code.installed && (
            <div style={{ marginBottom: 'var(--s2)' }}>
              <GlassCard blur={10} tint="rgba(10,132,255,0.06)" hover style={{ padding: 'var(--s3) var(--s4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-md)', color: 'var(--text-secondary)' }}>Claude Code</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {status.claude_code.version || '已安装'} {status.claude_code.install_method && `(${status.claude_code.install_method})`}
                  </div>
                </div>
                <button className="btn btn-primary" onClick={handleRunClaude} disabled={launching} style={{ fontSize: 'var(--text-sm)' }}>
                  {launching ? '启动中...' : '🚀 运行 Claude Code'}
                </button>
              </GlassCard>
              {launchMsg && (
                <div style={{
                  marginTop: 'var(--s1)', padding: 'var(--s1) var(--s2)',
                  borderRadius: 'var(--r2)', fontSize: 'var(--text-xs)',
                  background: 'rgba(48,209,88,0.08)',
                  border: '1px solid rgba(48,209,88,0.2)',
                  color: 'var(--success)',
                }}>
                  ✓ {launchMsg}
                </div>
              )}
            </div>
          )}

          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s2)',
          }}>
            {status.claude_code.details && status.claude_code.details.length > 0 && (
              <GlassCard blur={10} tint="rgba(255,255,255,0.04)">
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--s1)', color: 'var(--text-secondary)' }}>
                  检测日志
                </div>
                <div style={{ fontSize: 'var(--text-xs)', lineHeight: 1.8, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                  {status.claude_code.details.slice(0, 5).map((d, i) => <div key={i}>{d}</div>)}
                </div>
              </GlassCard>
            )}
            {status.claude_code.config_path && (
              <GlassCard blur={10} tint="rgba(255,255,255,0.04)">
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--s1)', color: 'var(--text-secondary)' }}>
                  配置目录
                </div>
                <code style={{ fontSize: 'var(--text-xs)', wordBreak: 'break-all' }}>
                  {status.claude_code.config_path}
                </code>
              </GlassCard>
            )}
          </div>
        </>
      ) : (
        <div style={{
          textAlign: 'center', padding: 'var(--s6) 0', color: 'var(--text-tertiary)',
        }}>
          <p>点击右上角刷新以检测环境</p>
        </div>
      )}
    </div>
  )
}
