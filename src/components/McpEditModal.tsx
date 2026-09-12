import { useState } from 'react'
import type { McpServerDef } from '../types'
import { updateMcpServer, errorMessage } from '../services/tauri'
import { GlassModal } from './glass'

interface Props {
  server: McpServerDef | null
  onClose: () => void
  onSaved: () => void
}

interface EnvEntry {
  key: string
  value: string
}

export default function McpEditModal({ server, onClose, onSaved }: Props) {
  // Seed the form from `server` during render rather than from an effect.
  //
  // An effect that calls setState on mount renders twice and lints as
  // `react(set-state-in-effect)`. The caller passes a `key`, so opening a
  // different server remounts this component and these initialisers run again —
  // which is exactly what the effect was emulating.
  const [name, setName] = useState(server?.name ?? '')
  const [type_, setType_] = useState<'Stdio' | 'Http'>(server?.type_ ?? 'Stdio')
  const [command, setCommand] = useState(server?.command ?? '')
  const [argsText, setArgsText] = useState((server?.args ?? []).join('\n'))
  const [url, setUrl] = useState(server?.url ?? '')
  // Preserve existing env vars when editing a server instead of resetting them.
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>(
    (server?.env ?? []).map(e => ({ key: e.key, value: e.value })),
  )
  const [timeout, setTimeout_] = useState((server?.timeout_ms ?? 60000) / 1000)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!server?.source_file) { setError('未指定源文件路径'); return }
    if (!name.trim()) { setError('请输入名称'); return }
    if (type_ === 'Stdio' && !command.trim()) { setError('请输入命令'); return }
    if (type_ === 'Http' && !url.trim()) { setError('请输入 URL'); return }

    setSaving(true)
    setError('')

    try {
      const configJson = JSON.stringify({
        type: type_ === 'Stdio' ? undefined : 'http',
        command: type_ === 'Stdio' ? command.trim() : undefined,
        args: argsText.trim()
          ? argsText.split('\n').map(s => s.trim()).filter(Boolean)
          : undefined,
        url: type_ === 'Http' ? url.trim() : undefined,
        timeout: timeout * 1000,
        env: (() => {
          const valid = envEntries.filter(e => e.key.trim() !== '')
          return valid.length > 0
            ? Object.fromEntries(valid.map(e => [e.key.trim(), e.value]))
            : undefined
        })(),
      })

      const originalName = name !== server.name ? server.name : undefined
      await updateMcpServer(name.trim(), configJson, server.source_file, originalName)
      onSaved()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const addEnv = () => setEnvEntries([...envEntries, { key: '', value: '' }])
  const updateEnv = (i: number, field: 'key' | 'value', val: string) => {
    setEnvEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } as EnvEntry : e))
  }
  const removeEnv = (i: number) => setEnvEntries(envEntries.filter((_, idx) => idx !== i))

  return (
    <GlassModal
      open={!!server}
      onClose={onClose}
      title="编辑 MCP 服务器"
      style={{ minWidth: 520, maxWidth: 600 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)', fontSize: 'var(--text-sm)' }}>
        {/* Name */}
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>名称</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} style={{ maxWidth: '100%' }} />
        </div>

        {/* Type */}
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>传输类型</label>
          <div style={{ display: 'flex', gap: 'var(--s1)' }}>
            {(['Stdio', 'Http'] as const).map(t => (
              <button
                key={t}
                onClick={() => setType_(t)}
                className={`btn ${type_ === t ? 'btn-primary' : ''}`}
                style={{ fontSize: 'var(--text-sm)' }}
              >
                {t === 'Stdio' ? 'stdio' : 'HTTP / SSE'}
              </button>
            ))}
          </div>
        </div>

        {/* Command (stdio) */}
        {type_ === 'Stdio' && (
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>命令</label>
            <input className="input" value={command} onChange={e => setCommand(e.target.value)} placeholder="例如: npx" style={{ maxWidth: '100%' }} />
          </div>
        )}

        {/* Args (stdio) */}
        {type_ === 'Stdio' && (
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>参数（每行一个）</label>
            <textarea
              className="input"
              value={argsText}
              onChange={e => setArgsText(e.target.value)}
              rows={4}
              placeholder="--arg1&#10;--arg2"
              style={{ maxWidth: '100%', resize: 'vertical', fontFamily: 'var(--font-mono)' }}
            />
          </div>
        )}

        {/* URL (http) */}
        {type_ === 'Http' && (
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>URL</label>
            <input className="input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/mcp" style={{ maxWidth: '100%' }} />
          </div>
        )}

        {/* Timeout */}
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>超时（秒）</label>
          <input className="input" type="number" value={timeout} onChange={e => setTimeout_(Number(e.target.value) || 60)} style={{ maxWidth: 120 }} />
        </div>

        {/* Env vars */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 500, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>环境变量</span>
            <button className="btn btn-ghost" style={{ fontSize: 'var(--text-xs)', padding: '2px var(--s1)' }} onClick={addEnv}>+ 添加</button>
          </div>
          {envEntries.length === 0 && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', padding: 'var(--s1) 0' }}>无环境变量</div>
          )}
          {envEntries.map((entry, i) => (
            <div key={i} style={{ display: 'flex', gap: 'var(--s0)', marginBottom: 'var(--s0)' }}>
              <input className="input" placeholder="KEY" value={entry.key} onChange={e => updateEnv(i, 'key', e.target.value)} style={{ flex: 1, maxWidth: 200, fontSize: 'var(--text-xs)' }} />
              <input className="input" placeholder="VALUE" value={entry.value} onChange={e => updateEnv(i, 'value', e.target.value)} style={{ flex: 2, maxWidth: 300, fontSize: 'var(--text-xs)' }} />
              <button className="btn btn-ghost" style={{ fontSize: 'var(--text-xs)', padding: '2px var(--s1)', color: 'var(--error)' }} onClick={() => removeEnv(i)}>✕</button>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="alert" style={{ fontSize: 'var(--text-xs)' }}>{error}</div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s1)', marginTop: 'var(--s1)' }}>
          <button className="btn" onClick={onClose} style={{ fontSize: 'var(--text-sm)' }}>取消</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 'var(--text-sm)' }}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </GlassModal>
  )
}
