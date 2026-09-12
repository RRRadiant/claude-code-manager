import { useEffect, useState, useCallback } from 'react'
import type { ConfigFileInfo, ConfigScope } from '../types'
import { listConfigFiles, readConfigFile, writeConfigFile, errorMessage } from '../services/tauri'
import { GlassCard } from '../components/glass'

export default function ConfigPage() {
  const [files, setFiles] = useState<ConfigFileInfo[]>([])
  const [active, setActive] = useState<ConfigScope | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Declared before the effect that calls it: referencing a `const` arrow
  // function from an effect defined above it reads the binding before its
  // initialiser runs, which the React Compiler lints as ambiguous.
  const loadFiles = useCallback(async () => {
    try {
      setFiles(await listConfigFiles())
      setLoadError(null)
    } catch (e) {
      setLoadError(errorMessage(e))
    }
  }, [])

  useEffect(() => { loadFiles() }, [loadFiles])

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleSelect = async (scope: ConfigScope) => {
    setActive(scope); setLoading(true); setSaveMsg(null)
    try {
      const r = await readConfigFile(scope)
      setContent(r?.content ?? '')
    } catch (e) {
      setContent('// 无法读取')
      setSaveMsg({ ok: false, msg: errorMessage(e) })
    }
    finally { setLoading(false) }
  }

  const handleFormat = useCallback(() => {
    setSaveMsg(null)
    try {
      const parsed = JSON.parse(content)
      setContent(JSON.stringify(parsed, null, 2))
    } catch {
      setSaveMsg({ ok: false, msg: 'JSON 格式无效，无法格式化' })
    }
  }, [content])

  const handleSave = useCallback(async () => {
    if (!active) return
    setSaving(true); setSaveMsg(null)
    try {
      // Validate JSON before saving
      JSON.parse(content)
      await writeConfigFile(active, content)
      setSaveMsg({ ok: true, msg: '保存成功' })
    } catch (e) {
      setSaveMsg({ ok: false, msg: errorMessage(e) })
    } finally {
      setSaving(false)
    }
  }, [active, content])

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 34px)' }}>
      <h1 style={{ marginBottom: 'var(--s4)', flexShrink: 0 }}>配置文件</h1>

      {loadError && <div className="alert" style={{ marginBottom: 'var(--s2)', flexShrink: 0 }}>{loadError}</div>}

      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '220px 1fr', gap: 'var(--s2)' }}>
        {/* Sidebar file list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s0)', overflow: 'auto', minHeight: 0 }}>
          {files.length === 0 && (
            <GlassCard blur={6} tint="rgba(255,255,255,0.04)" style={{ padding: 'var(--s2)', textAlign: 'center' }}>
              <span className="text-tertiary" style={{ fontSize: 'var(--text-sm)' }}>暂无配置</span>
            </GlassCard>
          )}
          {files.map(f => (
            <GlassCard
              key={f.scope}
              blur={active === f.scope ? 8 : 4}
              tint={active === f.scope ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)'}
              hover
              compact
              style={{
                cursor: 'pointer', padding: 'var(--s2)',
                border: active === f.scope ? '1px solid rgba(255,255,255,0.12)' : undefined,
              }}
              onClick={() => handleSelect(f.scope)}
            >
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{f.name}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 1 }}>
                {f.exists ? '✓ 存在' : '— 不存在'}
              </div>
            </GlassCard>
          ))}
        </div>

        {/* Editor — fills grid cell */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', borderRadius: 'var(--r4)', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(10px)' }}>
          {loading ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="text-tertiary">加载中...</span>
            </div>
          ) : active ? (
            <>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: 'var(--s2) var(--s3)', borderBottom: '1px solid rgba(255,255,255,0.06)',
                flexShrink: 0,
              }}>
                <span className="text-tertiary" style={{ fontSize: 'var(--text-sm)' }}>{active}</span>
                <div style={{ display: 'flex', gap: 'var(--s0)' }}>
                  <button className="btn btn-ghost" style={{ fontSize: 'var(--text-sm)', padding: '4px var(--s1)' }} onClick={handleFormat}>格式化</button>
                  <button className="btn btn-ghost" style={{ fontSize: 'var(--text-sm)', padding: '4px var(--s1)' }} onClick={handleSave} disabled={saving}>
                    {saving ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
              {saveMsg && (
                <div style={{
                  padding: 'var(--s0) var(--s3)', fontSize: 'var(--text-xs)',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  color: saveMsg.ok ? 'var(--success)' : 'var(--error)',
                }}>
                  {saveMsg.ok ? '✓ ' : '✗ '}{saveMsg.msg}
                </div>
              )}
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                spellCheck={false}
                style={{
                  flex: 1, minHeight: 0, border: 'none', resize: 'none', outline: 'none',
                  padding: 'var(--s3)',
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
                  background: 'transparent', color: 'var(--text-primary)',
                  lineHeight: 1.6,
                }}
              />
            </>
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="text-tertiary">选择一个配置文件</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
