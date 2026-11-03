import { useEffect, useState, useCallback } from 'react'

import { Icon } from '../shared/Icon'
import { useConfigStore } from '../../stores/configStore'

interface ProviderInfo {
  id: string
  label: string
  baseUrl: string
  hint: string
}

/**
 * Providers with their default endpoint and a hint that says something useful
 * about that specific provider.
 *
 * `hint` is per provider rather than one shared string: the DeepSeek endpoint
 * needs an `/anthropic` suffix for Anthropic-compatible mode while the others do
 * not, and a generic hint left the user to discover that from a 404.
 */
const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    hint: '官方 API。Key 形如 sk-ant-api03-...',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    hint: '默认 https://api.deepseek.com；使用 Anthropic 兼容模式需要保留 /anthropic 后缀。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    hint: 'OpenAI 兼容端点。模型名需与端点支持的名称一致。',
  },
  {
    id: 'custom',
    label: '自定义',
    baseUrl: '',
    hint: '任何 OpenAI / Anthropic 兼容端点。检测模型时会自动尝试剥离 /anthropic 与 /v1 后缀。',
  },
]

/**
 * API configuration panel.
 *
 * Rebuilt on the panel design system. The previous version used Tailwind utility
 * classes for every element, which produced a wall of unlabelled text: headings
 * and help text shared one weight, form fields had no visible boundary, and the
 * provider buttons ran together with no separation, so which one was selected was
 * impossible to tell.
 *
 * Key behaviours preserved from before: the key is loaded as its real value
 * (never the mask), and saving merges into `env` rather than replacing it — both
 * of which were bug fixes, not styling.
 */
export function ApiConfigPanel(): React.ReactElement {
  const { settings, loading, loadConfig, saveConfig } = useConfigStore()

  const [provider, setProvider] = useState<string>('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.anthropic.com')
  const [timeoutMs, setTimeoutMs] = useState('300000')
  const [keyVisible, setKeyVisible] = useState(false)

  const [detectedModels, setDetectedModels] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [manualModelInput, setManualModelInput] = useState('')

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    if (!settings) return

    const envProvider = settings.env?.ANTHROPIC_PROVIDER
    if (envProvider && PROVIDERS.some((p) => p.id === envProvider)) {
      setProvider(envProvider)
    }
    setApiKey(settings.env?.ANTHROPIC_AUTH_TOKEN || '')
    setBaseUrl(settings.env?.ANTHROPIC_BASE_URL || 'https://api.anthropic.com')
    setTimeoutMs(settings.env?.API_TIMEOUT_MS || '300000')

    const savedModels = settings.env?.ANTHROPIC_SELECTED_MODELS
    if (savedModels) {
      const modelList = savedModels
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (modelList.length > 0) {
        setDetectedModels(modelList)
        setSelectedModels(new Set(modelList))
      }
    }
  }, [settings])

  const activeProvider = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0]

  const handleProviderChange = useCallback((p: ProviderInfo) => {
    setProvider(p.id)
    setBaseUrl(p.baseUrl)
    setDetectError(null)
  }, [])

  const handleDetectModels = useCallback(async () => {
    if (!apiKey.trim()) {
      setDetectError('请先输入 API Key')
      return
    }
    setDetecting(true)
    setDetectError(null)

    try {
      const result = await window.electronAPI.apiDetectModels({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl || undefined,
      })
      if (result.success && result.data && result.data.length > 0) {
        // Merge rather than replace, so a re-detect does not silently drop models
        // the user added by hand.
        setDetectedModels((prev) => [...new Set([...prev, ...result.data!])])
        setSelectedModels((prev) => new Set([...prev, ...result.data!]))
      } else {
        setDetectError(result.error || '未检测到模型，请在下方手动输入模型 ID')
      }
    } catch (err) {
      setDetectError(String(err))
    } finally {
      setDetecting(false)
    }
  }, [provider, apiKey, baseUrl])

  const toggleModel = useCallback((model: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev)
      if (next.has(model)) next.delete(model)
      else next.add(model)
      return next
    })
  }, [])

  const toggleAllModels = useCallback(() => {
    if (detectedModels.length === 0) return
    setSelectedModels((prev) =>
      prev.size === detectedModels.length ? new Set() : new Set(detectedModels),
    )
  }, [detectedModels])

  const addManualModel = useCallback(() => {
    const model = manualModelInput.trim()
    if (!model) return
    setDetectedModels((prev) => (prev.includes(model) ? prev : [...prev, model]))
    setSelectedModels((prev) => new Set(prev).add(model))
    setManualModelInput('')
  }, [manualModelInput])

  const removeModel = useCallback((model: string) => {
    setDetectedModels((prev) => prev.filter((m) => m !== model))
    setSelectedModels((prev) => {
      const next = new Set(prev)
      next.delete(model)
      return next
    })
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setMessage(null)
    try {
      await saveConfig({
        env: {
          ANTHROPIC_PROVIDER: provider,
          ANTHROPIC_AUTH_TOKEN: apiKey,
          ANTHROPIC_BASE_URL: baseUrl,
          ANTHROPIC_SELECTED_MODELS: [...selectedModels].join(','),
          API_TIMEOUT_MS: timeoutMs,
        },
      })
      setMessage({ type: 'success', text: '配置已保存' })
    } catch (err) {
      setMessage({ type: 'error', text: `保存失败：${String(err)}` })
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(null), 4000)
    }
  }, [provider, apiKey, baseUrl, selectedModels, timeoutMs, saveConfig])

  if (loading) {
    return (
      <div className="page">
        <p className="muted" style={{ padding: '48px 0', textAlign: 'center' }}>
          加载中...
        </p>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">API 配置</h1>
          <p className="page-subtitle">配置 Claude Code 使用哪个端点与凭据</p>
        </div>
      </header>

      {/* ── Provider ───────────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">服务商</h2>
        <div className="seg">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleProviderChange(p)}
              className={`seg-item ${provider === p.id ? 'is-on' : ''}`}
              aria-pressed={provider === p.id}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="field-hint">{activeProvider.hint}</p>
      </section>

      {/* ── Credentials ────────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">凭据</h2>
        <div className="card card-pad">
          <div className="field">
            <label className="field-label" htmlFor="api-key">
              API Key
            </label>
            <div className="input-group">
              <input
                id="api-key"
                type={keyVisible ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-api03-..."
                className="form-input"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                className="btn-secondary"
                onClick={() => setKeyVisible((v) => !v)}
                title={keyVisible ? '隐藏' : '显示'}
                style={{ flexShrink: 0 }}
              >
                {keyVisible ? '隐藏' : '显示'}
              </button>
            </div>
            <p className="field-hint">
              保存后会明文写入 <code>~/.claude/settings.json</code> 的{' '}
              <code>env.ANTHROPIC_AUTH_TOKEN</code>。Claude Code 只按字面值读取该字段，
              无法解析凭据引用，因此这是它唯一可用的形式——请把该文件视为敏感文件。
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="base-url">
              Base URL
            </label>
            <input
              id="base-url"
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.anthropic.com"
              className="form-input"
              spellCheck={false}
            />
            <p className="field-hint">可自由编辑；切换服务商会自动填入该服务商的默认端点。</p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="timeout">
              请求超时（毫秒）
            </label>
            <input
              id="timeout"
              type="text"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(e.target.value)}
              className="form-input tnum"
              style={{ maxWidth: 180 }}
            />
            <p className="field-hint">单次 API 请求的最长等待时间，默认 300000（5 分钟）。</p>
          </div>
        </div>
      </section>

      {/* ── Models ─────────────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">可用模型</h2>
        <div className="card card-pad">
          <div className="row-between" style={{ marginBottom: detectedModels.length > 0 ? 12 : 0 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 550 }}>
                {detectedModels.length > 0
                  ? `已记录 ${detectedModels.length} 个模型，已选 ${selectedModels.size} 个`
                  : '尚未检测到模型'}
              </div>
              <div className="tiny muted" style={{ marginTop: 2 }}>
                检测会请求所选端点的模型列表接口
              </div>
            </div>
            <button className="btn-secondary btn-sm" onClick={handleDetectModels} disabled={detecting}>
              <Icon name="refresh" size={12} className={detecting ? 'spin' : undefined} />
              {detecting ? '检测中' : '检测模型'}
            </button>
          </div>

          {detectError && (
            <div className="callout callout-warn" style={{ marginBottom: 12 }}>
              <span className="callout-icon">
                <Icon name="alert" size={14} />
              </span>
              <p className="callout-body" style={{ whiteSpace: 'pre-line' }}>
                {detectError}
              </p>
            </div>
          )}

          {detectedModels.length > 0 && (
            <div className="check-list" style={{ marginBottom: 12 }}>
              <label className="check-row is-all">
                <input
                  type="checkbox"
                  checked={detectedModels.length > 0 && selectedModels.size === detectedModels.length}
                  onChange={toggleAllModels}
                />
                <span style={{ fontSize: 'var(--text-sm)' }}>
                  全选（{selectedModels.size}/{detectedModels.length}）
                </span>
              </label>
              {detectedModels.map((model) => (
                <label key={model} className="check-row">
                  <input
                    type="checkbox"
                    checked={selectedModels.has(model)}
                    onChange={() => toggleModel(model)}
                  />
                  <span className="check-name" title={model}>
                    {model}
                  </span>
                  <button
                    className="check-remove"
                    onClick={(e) => {
                      e.preventDefault()
                      removeModel(model)
                    }}
                    title="移除模型"
                  >
                    <Icon name="x" size={12} />
                  </button>
                </label>
              ))}
            </div>
          )}

          <div className="input-group">
            <input
              type="text"
              value={manualModelInput}
              onChange={(e) => setManualModelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addManualModel()
              }}
              placeholder="手动输入模型 ID，按 Enter 添加"
              className="form-input"
              spellCheck={false}
            />
            <button className="btn-secondary" onClick={addManualModel} style={{ flexShrink: 0 }}>
              添加
            </button>
          </div>
        </div>
      </section>

      {/* ── Save ───────────────────────────────────────────────────────── */}
      <div className="actions">
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存配置'}
        </button>
        {message && (
          <span
            className="row"
            style={{
              fontSize: 'var(--text-sm)',
              color:
                message.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
              gap: 6,
            }}
          >
            <Icon name={message.type === 'success' ? 'check' : 'alert'} size={14} />
            {message.text}
          </span>
        )}
      </div>
    </div>
  )
}
