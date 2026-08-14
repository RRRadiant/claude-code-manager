import { useState, useEffect, useCallback } from 'react'
import type { ModelInfo, ProviderConfigDraft } from '../types'
import { GlassCard } from '../components/glass'
import * as api from '../services/tauri'

const PROVIDERS = [
  { key: 'anthropic', name: 'Anthropic', desc: 'Claude 模型官方 API', color: '#d4a574' },
  { key: 'deepseek', name: 'DeepSeek', desc: '兼容接口，支持 V4 系列模型', color: '#4fc3f7' },
  { key: 'custom',   name: '自定义',    desc: '任意兼容服务商', color: '#a78bfa' },
] as const

type ProviderKey = (typeof PROVIDERS)[number]['key']

interface FieldDef {
  key: string
  label: string
  hint?: string
  placeholder?: string
  defaultValue?: string
  type?: string
  password?: boolean
}

const anthropicFields: FieldDef[] = [
  { key: 'api_key', label: 'API Key', hint: '存储在 Windows Credential Manager 中', placeholder: 'sk-ant-...', password: true },
  { key: 'base_url', label: 'Base URL', defaultValue: 'https://api.anthropic.com' },
  { key: 'default_model', label: '默认模型', defaultValue: 'claude-sonnet-4-20250514' },
  { key: 'fast_model', label: '快速模型', defaultValue: 'claude-haiku-4-20250514' },
  { key: 'high_capability_model', label: '高能力模型', defaultValue: 'claude-opus-4-6-20260217' },
  { key: 'timeout_secs', label: '超时（秒）', defaultValue: '60' },
]

const deepseekFields: FieldDef[] = [
  { key: 'api_key', label: 'API Key', password: true, placeholder: 'sk-...' },
  { key: 'base_url', label: 'Anthropic 兼容 URL', defaultValue: 'https://api.deepseek.com/anthropic' },
  { key: 'default_model', label: '默认模型', defaultValue: 'deepseek-v4-pro' },
  { key: 'timeout_secs', label: '超时（秒）', defaultValue: '120' },
]

const customFields: FieldDef[] = [
  { key: 'name', label: '配置名称', placeholder: '我的服务商' },
  { key: 'base_url', label: 'Base URL', placeholder: 'https://your-api.com' },
  { key: 'api_key', label: 'API Key', password: true, placeholder: '...' },
  { key: 'custom_headers', label: '自定义 Headers', hint: 'JSON 格式', placeholder: '{"Authorization": "Bearer ..."}', type: 'textarea' },
  { key: 'default_model', label: '默认模型', placeholder: 'model-name' },
]

const FIELD_MAP: Record<ProviderKey, FieldDef[]> = {
  anthropic: anthropicFields,
  deepseek: deepseekFields,
  custom: customFields,
}

export default function ProvidersPage() {
  const [tab, setTab] = useState<ProviderKey>('anthropic')

  return (
    <div className="page">
      <h1 style={{ marginBottom: 'var(--s4)' }}>API 与模型</h1>

      {/* Provider cards as glass tabs */}
      <div style={{ display: 'flex', gap: 'var(--s1)', marginBottom: 'var(--s4)' }}>
        {PROVIDERS.map(p => (
          <GlassCard
            key={p.key}
            blur={tab === p.key ? 8 : 4}
            tint={tab === p.key ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)'}
            hover
            style={{
              flex: 1, cursor: 'pointer', padding: 'var(--s2) var(--s3)',
              border: tab === p.key ? '1px solid rgba(255,255,255,0.15)' : undefined,
            }}
            onClick={() => setTab(p.key)}
          >
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 2 }}>{p.name}</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{p.desc}</div>
          </GlassCard>
        ))}
      </div>

      {/* Form */}
      <ProviderForm key={tab} providerType={tab} title={`${PROVIDERS.find(p => p.key === tab)!.name} — ${tab === 'custom' ? '自定义服务商' : '官方'}`} fields={FIELD_MAP[tab]} />
    </div>
  )
}

// ── Reusable form ──

function ProviderForm({ providerType, title, fields }: { providerType: ProviderKey; title: string; fields: FieldDef[] }) {
  // Dynamic form state
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<Record<string, { success: boolean; message: string } | null>>({})
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [initDone, setInitDone] = useState(false)
  const [existingKeyMask, setExistingKeyMask] = useState<string | null>(null)

  // Initialize from saved config
  useEffect(() => {
    const init: Record<string, string> = {}
    for (const f of fields) {
      init[f.key] = f.defaultValue ?? ''
    }
    setValues(init)

    Promise.all([
      api.getProviderCredential(providerType).catch(() => ({ exists: false, masked: null, api_key: null })),
      api.loadProviderConfig(providerType).catch<Partial<ProviderConfigDraft>>(() => ({})),
    ]).then(([cred, cfg]) => {
      const merged = { ...init }
      // SECURITY: do NOT load the real API key into the form.
      // Leave the field empty; if a key is already stored we surface a
      // masked hint via `existingKeyMask` so the user knows it is configured.
      if (cred.exists && cred.masked) setExistingKeyMask(cred.masked)
      else setExistingKeyMask(null)
      if (cfg.base_url) merged['base_url'] = cfg.base_url
      if (cfg.default_model) merged['default_model'] = cfg.default_model
      if (cfg.fast_model) merged['fast_model'] = cfg.fast_model
      if (cfg.high_capability_model) merged['high_capability_model'] = cfg.high_capability_model
      if (cfg.timeout_secs) merged['timeout_secs'] = String(cfg.timeout_secs)
      if (cfg.name) merged['name'] = cfg.name
      if (cfg.custom_headers) merged['custom_headers'] = cfg.custom_headers
      setValues(merged)
      setInitDone(true)
    })
  }, [providerType, fields])

  const setVal = (key: string, val: string) => setValues(prev => ({ ...prev, [key]: val }))

  // ── 测试连接 ──
  const handleTest = useCallback(async () => {
    const apiKey = values['api_key']?.trim()
    if (!apiKey) { setResults(prev => ({ ...prev, test: { success: false, message: '请先输入 API Key' } })); return }

    setLoading(prev => ({ ...prev, test: true }))
    setResults(prev => ({ ...prev, test: null }))
    try {
      const r = await api.testProviderConnection(
        providerType,
        apiKey,
        values['base_url'] || undefined,
        values['default_model'] || undefined,
        values['timeout_secs'] ? parseInt(values['timeout_secs']) : undefined,
      )
      setResults(prev => ({ ...prev, test: { success: r.success, message: r.message } }))
    } catch (e) {
      setResults(prev => ({ ...prev, test: { success: false, message: api.errorMessage(e) } }))
    } finally {
      setLoading(prev => ({ ...prev, test: false }))
    }
  }, [providerType, values])

  // ── 检测模型 ──
  const handleDetectModels = useCallback(async () => {
    const apiKey = values['api_key']?.trim()
    if (!apiKey) { setResults(prev => ({ ...prev, models: { success: false, message: '请先输入 API Key' } })); return }

    setModelsLoading(true)
    setModels(null)
    setResults(prev => ({ ...prev, models: null }))
    try {
      const r = await api.detectProviderModels(providerType, apiKey, values['base_url'] || undefined)
      setModels(r.models)
      setResults(prev => ({ ...prev, models: { success: true, message: `检测到 ${r.count} 个模型` } }))
    } catch (e) {
      setResults(prev => ({ ...prev, models: { success: false, message: api.errorMessage(e) } }))
    } finally {
      setModelsLoading(false)
    }
  }, [providerType, values])

  // ── 保存 ──
  const handleSave = useCallback(async () => {
    setLoading(prev => ({ ...prev, save: true }))
    setResults(prev => ({ ...prev, save: null }))
    try {
      const apiKey = values['api_key']?.trim()
      await api.saveProviderConfig(
        providerType,
        values['name'] || providerType,
        values['base_url'] || undefined,
        values['default_model'] || undefined,
        values['fast_model'] || undefined,
        values['high_capability_model'] || undefined,
        values['timeout_secs'] ? parseInt(values['timeout_secs']) : undefined,
        values['custom_headers'] || undefined,
        apiKey || undefined,
      )
      setResults(prev => ({ ...prev, save: { success: true, message: '配置已保存到 Claude Code 设置' } }))
    } catch (e) {
      setResults(prev => ({ ...prev, save: { success: false, message: api.errorMessage(e) } }))
    } finally {
      setLoading(prev => ({ ...prev, save: false }))
    }
  }, [providerType, values])

  if (!initDone) {
    return (
      <GlassCard blur={10} tint="rgba(255,255,255,0.06)" style={{ textAlign: 'center', padding: 'var(--s4)' }}>
        <span className="text-tertiary">加载中...</span>
      </GlassCard>
    )
  }

  return (
    <GlassCard blur={10} tint="rgba(255,255,255,0.06)">
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--s3)', color: 'var(--text-secondary)' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
        {fields.map(f => (
          <div key={f.key}>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 500, marginBottom: 'var(--s0)', display: 'block' }}>{f.label}</label>
            {f.hint && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--s0)' }}>{f.hint}</div>}
            {f.type === 'textarea' ? (
              <textarea
                className="input textarea" rows={3}
                placeholder={f.placeholder}
                value={values[f.key] ?? ''}
                onChange={e => setVal(f.key, e.target.value)}
              />
            ) : (
              <input
                type={f.password ? 'password' : 'text'}
                className="input"
                placeholder={f.key === 'api_key' && existingKeyMask ? `已配置（${existingKeyMask}）·重新输入将覆盖` : f.placeholder}
                value={values[f.key] ?? ''}
                onChange={e => setVal(f.key, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 'var(--s1)', marginTop: 'var(--s3)', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={handleTest} disabled={loading['test']}>
          {loading['test'] ? '测试中...' : '测试连接'}
        </button>
        <button className="btn btn-ghost" onClick={handleDetectModels} disabled={modelsLoading}>
          {modelsLoading ? '检测中...' : '检测模型'}
        </button>
        <button className="btn btn-ghost" onClick={handleSave} disabled={loading['save']}>
          {loading['save'] ? '保存中...' : '保存'}
        </button>
      </div>

      {/* Results */}
      {results['test'] && (
        <ResultBox success={results['test']!.success} message={results['test']!.message} />
      )}
      {results['models'] && (
        <ResultBox success={results['models']!.success} message={results['models']!.message} />
      )}
      {results['save'] && (
        <ResultBox success={results['save']!.success} message={results['save']!.message} />
      )}

      {/* Model list */}
      {models && models.length > 0 && (
        <div style={{ marginTop: 'var(--s2)' }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--s1)' }}>
            可用模型 ({models.length}) — 点击选择
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflow: 'auto' }}>
            {models.map((m) => {
              const modelId = m.id
              const displayName = m.display_name ?? ''
              const isDefault = values['default_model'] === modelId
              const isFast = values['fast_model'] === modelId
              const isHighCap = values['high_capability_model'] === modelId

              return (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px var(--s1)', borderRadius: 'var(--r1)',
                  background: isDefault ? 'rgba(10,132,255,0.1)' : 'rgba(255,255,255,0.03)',
                  border: isDefault ? '1px solid rgba(10,132,255,0.2)' : '1px solid transparent',
                  transition: 'background 0.15s',
                }}
                  onMouseEnter={e => { if (!isDefault) e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
                  onMouseLeave={e => { if (!isDefault) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                >
                  <button
                    type="button"
                    onClick={() => setVal('default_model', modelId)}
                    aria-label={`选择模型 ${modelId}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--s1)', minWidth: 0,
                      flex: 1, background: 'none', border: 'none', padding: 0,
                      cursor: 'pointer', textAlign: 'left', color: 'inherit',
                    }}
                  >
                    <span style={{
                      fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
                      color: isDefault ? 'var(--accent)' : 'var(--text-secondary)',
                      fontWeight: isDefault ? 600 : 400,
                    }}>{modelId}</span>
                    {displayName && (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displayName}
                      </span>
                    )}
                  </button>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {isDefault && <span className="tag" style={{ fontSize: 10, padding: '1px 4px' }}>默认</span>}
                    {isFast && <span className="tag" style={{ fontSize: 10, padding: '1px 4px' }}>快速</span>}
                    {isHighCap && <span className="tag" style={{ fontSize: 10, padding: '1px 4px' }}>高能力</span>}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 10, padding: '1px 6px', opacity: 0.5 }}
                      onClick={() => setVal('fast_model', modelId)}
                      title="设为快速模型"
                    >快速</button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 10, padding: '1px 6px', opacity: 0.5 }}
                      onClick={() => setVal('high_capability_model', modelId)}
                      title="设为高能力模型"
                    >高能力</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </GlassCard>
  )
}

function ResultBox({ success, message }: { success: boolean; message: string }) {
  return (
    <div style={{
      marginTop: 'var(--s2)', padding: 'var(--s1) var(--s2)',
      borderRadius: 'var(--r2)', fontSize: 'var(--text-xs)',
      background: success ? 'rgba(48,209,88,0.08)' : 'rgba(255,69,58,0.08)',
      border: `1px solid ${success ? 'rgba(48,209,88,0.2)' : 'rgba(255,69,58,0.2)'}`,
      color: success ? 'var(--success)' : 'var(--error)',
      lineHeight: 1.5,
    }}>
      {success ? '✓ ' : '✗ '}{message}
    </div>
  )
}
