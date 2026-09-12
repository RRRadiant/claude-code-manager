import { useCallback, useEffect, useState } from 'react'
import type { McpServerDef, McpTestResult } from '../types'
import { listMcpServers, testMcpServer, errorMessage } from '../services/tauri'
import { GlassCard } from '../components/glass'
import McpEditModal from '../components/McpEditModal'

const SCAN_PATHS = [
  '~/.claude.json',
  '~/.claude/settings.json',
  '~/.claude/claude.json',
  '~/.claude/mcp.json',
  '~/.claude/settings.local.json',
  '%APPDATA%/Claude/claude_desktop_config.json',
  '.mcp.json',
  '.claude/settings.json',
  '.claude/mcp.json',
  '.claude/settings.local.json',
]

export default function McpPage() {
  const [servers, setServers] = useState<McpServerDef[]>([])
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ name: string; result: McpTestResult } | null>(null)
  const [editServer, setEditServer] = useState<McpServerDef | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Declared before the effect that calls it: referencing a `const` arrow
  // function from an effect defined above it reads the binding before its
  // initialiser runs, which the React Compiler lints as ambiguous.
  const reload = useCallback(async () => {
    setLoading(true)
    setTestResult(null)
    try {
      setServers(await listMcpServers())
      setLoadError(null)
    } catch (e) {
      setLoadError(errorMessage(e))
    }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { reload() }, [reload])

  const handleTest = async (name: string) => {
    setTesting(name)
    setTestResult(null)
    try {
      const r = await testMcpServer(name)
      setTestResult({ name, result: r })
    } catch (e) {
      setTestResult({ name, result: { success: false, protocol_version: null, server_name: null, server_version: null, tool_count: null, tool_names: [], response_time_ms: 0, stdout_summary: null, stderr_summary: null, suggestions: [errorMessage(e)] } })
    }
    finally { setTesting(null) }
  }

  const enabled = servers.filter(s => s.enabled)
  const disabled = servers.filter(s => !s.enabled)

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--s4)' }}>
        <h1 style={{ margin: 0 }}>MCP 管理</h1>
        <button className="btn btn-ghost" onClick={reload} disabled={loading}>
          {loading ? '加载中...' : '刷新'}
        </button>
      </div>

      {loadError && <div className="alert" style={{ marginBottom: 'var(--s2)' }}>{loadError}</div>}

      {servers.length === 0 && !loading ? (
        <GlassCard blur={6} tint="rgba(255,255,255,0.05)"
          style={{ textAlign: 'center', padding: 'var(--s5) var(--s4)' }}
        >
          <div style={{ fontSize: 'var(--text-md)', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 'var(--s2)' }}>
            未检测到 MCP 配置
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: 'var(--s3)' }}>
            已扫描以下配置来源：
          </div>
          <div style={{ display: 'inline-block', textAlign: 'left', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 2 }}>
            {SCAN_PATHS.map(path => (
              <div key={path}>✓ {path}</div>
            ))}
          </div>
        </GlassCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s1)' }}>
          {enabled.map(s => (
            <GlassCard key={s.name} blur={7} tint="rgba(255,255,255,0.07)">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--s1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s1)', flexWrap: 'wrap' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--success)' }} />
                  <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{s.name}</span>
                  <span className="tag">{s.type_}</span>
                  <span className="tag">
                    {s.scope === 'User' ? '用户' : s.scope === 'Project' ? '项目' : s.scope}
                  </span>
                  {s.source_file && (
                    <span style={{
                      fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: 200,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {s.source_file}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 'var(--s0)' }}>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 'var(--text-sm)', padding: '4px var(--s1)' }}
                    onClick={() => setEditServer(s)}
                  >
                    编辑
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 'var(--text-sm)', padding: '4px var(--s1)' }}
                    onClick={() => handleTest(s.name)}
                    disabled={testing === s.name}
                  >
                    {testing === s.name ? '测试中...' : '测试'}
                  </button>
                </div>
              </div>
              <code style={{ fontSize: 'var(--text-xs)', wordBreak: 'break-all' }}>
                {s.command && `$ ${s.command} ${s.args?.join(' ') || ''}`}
                {s.url}
              </code>

              {/* Test result */}
              {testResult?.name === s.name && (
                <div style={{
                  marginTop: 'var(--s1)', padding: 'var(--s1) var(--s2)',
                  borderRadius: 'var(--r2)', fontSize: 'var(--text-xs)',
                  background: testResult.result.success ? 'rgba(48,209,88,0.08)' : 'rgba(255,69,58,0.08)',
                  border: `1px solid ${testResult.result.success ? 'rgba(48,209,88,0.2)' : 'rgba(255,69,58,0.2)'}`,
                }}>
                  <div style={{ color: testResult.result.success ? 'var(--success)' : 'var(--error)', fontWeight: 600, marginBottom: 'var(--s0)' }}>
                    {testResult.result.success ? '✓ 连接成功' : '✗ 连接失败'}
                    <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 'var(--s1)' }}>
                      {testResult.result.response_time_ms}ms
                    </span>
                  </div>
                  {testResult.result.server_name && (
                    <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
                      服务端: {testResult.result.server_name} {testResult.result.server_version && `v${testResult.result.server_version}`}
                    </div>
                  )}
                  {testResult.result.protocol_version && (
                    <div style={{ color: 'var(--text-tertiary)' }}>协议: {testResult.result.protocol_version}</div>
                  )}
                  {testResult.result.tool_count && testResult.result.tool_count > 0 && (
                    <div style={{ color: 'var(--text-tertiary)' }}>
                      暴露 {testResult.result.tool_names.length} 个工具
                    </div>
                  )}
                  {testResult.result.suggestions.length > 0 && (
                    <div style={{ color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.6 }}>
                      {testResult.result.suggestions.map((s, i) => (
                        <div key={i}>💡 {s}</div>
                      ))}
                    </div>
                  )}
                  {testResult.result.stdout_summary && !testResult.result.success && (
                    <pre style={{ marginTop: 4, padding: 'var(--s0) var(--s1)', background: 'rgba(0,0,0,0.06)', borderRadius: 'var(--r1)', maxHeight: 80, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {testResult.result.stdout_summary}
                    </pre>
                  )}
                </div>
              )}
            </GlassCard>
          ))}
          {disabled.map(s => (
            <GlassCard key={s.name} blur={4} tint="rgba(255,255,255,0.03)" style={{ opacity: 0.55 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s1)' }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--text-tertiary)' }} />
                <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{s.name}</span>
                <span className="tag">{s.type_}</span>
                <span className="tag">已禁用</span>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Edit modal */}
      <McpEditModal
        key={editServer?.name ?? 'none'}
        server={editServer}
        onClose={() => setEditServer(null)}
        onSaved={reload}
      />
    </div>
  )
}
