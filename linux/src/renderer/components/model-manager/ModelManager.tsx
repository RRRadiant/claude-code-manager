import { useCallback, useEffect, useMemo, useState } from 'react'

import { Icon } from '../shared/Icon'
import { useConfigStore } from '../../stores/configStore'

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  custom: '自定义',
}

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  openai: 'OpenAI 兼容接口',
  anthropic: 'Anthropic 官方 API',
  deepseek: 'DeepSeek 兼容接口',
  custom: '自定义端点',
}

type TierId = 'haiku' | 'sonnet' | 'opus'

const TIERS: Array<{ id: TierId; label: string; envKey: string; desc: string }> = [
  {
    id: 'haiku',
    label: 'Haiku',
    envKey: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    desc: '轻量任务：快速、便宜，适合格式化与简单改写',
  },
  {
    id: 'sonnet',
    label: 'Sonnet',
    envKey: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    desc: '日常默认：能力与成本平衡，适合绝大多数编码任务',
  },
  {
    id: 'opus',
    label: 'Opus',
    envKey: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    desc: '复杂推理：最强能力，耗时与成本最高',
  },
]

/**
 * Name hints for the auto-match button.
 *
 * Deliberately narrow. A wrong guess here writes a model ID into the user's
 * settings that they did not choose, so a tier is only filled when a name says
 * what it is; anything ambiguous is left for the user.
 */
const TIER_HINTS: Record<TierId, RegExp> = {
  haiku: /(haiku|mini|small|flash|lite|nano|tiny)/i,
  sonnet: /(sonnet|chat|medium|standard)/i,
  opus: /(opus|reason|think|large|ultra|max|pro)/i,
}

const isTier = (v: unknown): v is TierId => v === 'haiku' || v === 'sonnet' || v === 'opus'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Model manager — which endpoint, which tier, which model.
 *
 * The tier mapping used to be read-only here while the copy claimed it could be
 * edited in the API panel, where no such control existed: the three
 * `ANTHROPIC_DEFAULT_*_MODEL` variables could only be set by hand-editing
 * settings.json. They are the whole point of the panel — Claude Code picks a
 * tier per task, and on anything but the official endpoint those tiers have to
 * be pointed at real model IDs — so they are editable here now.
 */
export function ModelManager(): React.ReactElement {
  const { settings, loading, loadConfig } = useConfigStore()

  const [tiers, setTiers] = useState<Record<TierId, string>>({ haiku: '', sonnet: '', opus: '' })
  const [defaultTier, setDefaultTier] = useState<TierId>('sonnet')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Load on mount. This panel reads `settings` directly but never fetched it, so
  // opening 模型管理 as the first panel after launch showed every field as empty —
  // no endpoint, no tier mappings, no selected models — while the data was sitting
  // in ~/.claude/settings.json the whole time.
  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // Adopt what is on disk whenever it changes underneath us, but never while the
  // user has unsaved edits in front of them.
  useEffect(() => {
    if (!settings || dirty) return
    setTiers({
      haiku: str(settings.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL),
      sonnet: str(settings.env?.ANTHROPIC_DEFAULT_SONNET_MODEL),
      opus: str(settings.env?.ANTHROPIC_DEFAULT_OPUS_MODEL),
    })
    setDefaultTier(isTier(settings.model) ? settings.model : 'sonnet')
  }, [settings, dirty])

  const detectedModels = useMemo(
    () =>
      str(settings?.env?.ANTHROPIC_SELECTED_MODELS)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [settings],
  )

  const providerKey = str(settings?.env?.ANTHROPIC_PROVIDER) || 'anthropic'
  const baseUrl = str(settings?.env?.ANTHROPIC_BASE_URL)
  const mapped = TIERS.filter((t) => tiers[t.id].trim().length > 0).length

  const setTier = useCallback((id: TierId, value: string) => {
    setTiers((prev) => ({ ...prev, [id]: value }))
    setDirty(true)
    setMessage(null)
  }, [])

  /** Fill only the tiers whose model name says what it is; leave the rest alone. */
  const autoMatch = useCallback(() => {
    if (detectedModels.length === 0) return
    const next = { ...tiers }
    const taken = new Set<string>()
    let filled = 0

    for (const tier of TIERS) {
      const hit = detectedModels.find((m) => TIER_HINTS[tier.id].test(m) && !taken.has(m))
      if (!hit) continue
      taken.add(hit)
      if (next[tier.id] !== hit) {
        next[tier.id] = hit
        filled += 1
      }
    }

    setTiers(next)
    // Never *clear* the dirty flag here: a manual edit made before an
    // unsuccessful auto-match still needs saving, and clearing it would disable
    // the save button while the edited value sits in the field.
    if (filled > 0) setDirty(true)
    setMessage(
      filled > 0
        ? { type: 'success', text: `已按名字匹配 ${filled} 个层级，确认后点保存` }
        : { type: 'error', text: '模型名字里没有可识别的层级信息，请手动选择' },
    )
  }, [detectedModels, tiers])

  const save = useCallback(async () => {
    setSaving(true)
    setMessage(null)
    try {
      const result = await window.electronAPI.configWriteTierModels({
        tiers: Object.fromEntries(TIERS.map((t) => [t.envKey, tiers[t.id]])),
        defaultTier,
      })
      if (!result.success) throw new Error(result.error || '写入失败')
      setDirty(false)
      await loadConfig()
      setMessage({ type: 'success', text: '已保存到 ~/.claude/settings.json' })
    } catch (err) {
      setMessage({ type: 'error', text: `保存失败：${String(err)}` })
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(null), 5000)
    }
  }, [tiers, defaultTier, loadConfig])

  if (loading && !settings) {
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
          <h1 className="page-title">模型管理</h1>
          <p className="page-subtitle">
            把 Haiku / Sonnet / Opus 三个层级指向端点上真实的模型 ID
          </p>
        </div>
        <div className="row">
          {dirty && <span className="badge badge-warn">有未保存的修改</span>}
          <button className="btn-primary btn-sm" onClick={save} disabled={saving || !dirty}>
            <Icon name="check" size={13} />
            {saving ? '保存中' : '保存'}
          </button>
        </div>
      </header>

      {message && (
        <div
          className={`callout ${message.type === 'success' ? 'callout-info' : 'callout-danger'}`}
          style={{ marginBottom: 18 }}
        >
          <span className="callout-icon">
            <Icon name={message.type === 'success' ? 'info' : 'alert'} size={15} />
          </span>
          <div>
            <p className="callout-body">{message.text}</p>
          </div>
        </div>
      )}

      {/* ── Endpoint ───────────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">当前服务商</h2>
        <div className="card card-pad">
          <div className="row" style={{ gap: 10, marginBottom: baseUrl ? 10 : 0 }}>
            <span className="badge badge-accent" style={{ fontSize: 'var(--text-xs)', padding: '3px 10px' }}>
              {PROVIDER_LABELS[providerKey] || providerKey}
            </span>
            <span className="tiny muted">{PROVIDER_DESCRIPTIONS[providerKey] || '未知服务商'}</span>
          </div>
          {baseUrl ? (
            <code className="tiny" style={{ color: 'var(--color-text-secondary)', wordBreak: 'break-all' }}>
              {baseUrl}
            </code>
          ) : (
            <p className="field-hint" style={{ margin: 0 }}>
              尚未配置端点。请到「API 配置」面板设置 Base URL。
            </p>
          )}
        </div>
      </section>

      {/* ── Tier mapping ───────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">模型层级映射</h2>

        {detectedModels.length === 0 && (
          <div className="callout callout-warn" style={{ marginBottom: 12 }}>
            <span className="callout-icon">
              <Icon name="alert" size={15} />
            </span>
            <div>
              <p className="callout-title">还没有可选的模型</p>
              <p className="callout-body">
                先到「API 配置」填好 Key 并点「检测模型」，这里就会列出端点上真实的模型 ID
                供选择。也可以直接在下面手动输入模型 ID。
              </p>
            </div>
          </div>
        )}

        <div className="card card-pad">
          <div className="stack-3">
            {TIERS.map((tier) => (
              <div className="field" key={tier.id} style={{ marginTop: 0 }}>
                <div className="row-between" style={{ marginBottom: 6 }}>
                  <label className="field-label" style={{ margin: 0 }} htmlFor={`tier-${tier.id}`}>
                    {tier.label}
                  </label>
                  <button
                    className={`btn-ghost btn-sm${defaultTier === tier.id ? ' is-on' : ''}`}
                    onClick={() => {
                      setDefaultTier(tier.id)
                      setDirty(true)
                      setMessage(null)
                    }}
                    title="设为 Claude Code 启动时的默认层级"
                  >
                    {defaultTier === tier.id ? (
                      <>
                        <Icon name="check" size={12} />
                        默认层级
                      </>
                    ) : (
                      '设为默认'
                    )}
                  </button>
                </div>

                <input
                  id={`tier-${tier.id}`}
                  className="form-input"
                  list="ccm-model-options"
                  value={tiers[tier.id]}
                  placeholder="留空则用端点默认；也可填 deepseek-chat 这类 ID"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setTier(tier.id, e.target.value)}
                />
                <p className="field-hint">{tier.desc}</p>
              </div>
            ))}
          </div>

          <datalist id="ccm-model-options">
            {detectedModels.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>

          <div className="actions">
            <button
              className="btn-secondary btn-sm"
              onClick={autoMatch}
              disabled={detectedModels.length === 0}
            >
              按名字自动匹配
            </button>
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                setTiers({ haiku: '', sonnet: '', opus: '' })
                setDirty(true)
                setMessage(null)
              }}
              disabled={mapped === 0}
            >
              全部清空
            </button>
            <span className="tiny muted" style={{ marginLeft: 'auto' }}>
              {mapped} / 3 个层级已映射
            </span>
          </div>
        </div>

        <p className="field-hint">
          写入 <code>env.ANTHROPIC_DEFAULT_HAIKU_MODEL</code> /
          <code> ANTHROPIC_DEFAULT_SONNET_MODEL</code> /
          <code> ANTHROPIC_DEFAULT_OPUS_MODEL</code>；留空的层级会删掉对应键，
          Claude Code 便继续使用端点自己的默认值。
        </p>
      </section>

      {/* ── Selected models ────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">
          端点上的模型{detectedModels.length > 0 && ` · ${detectedModels.length}`}
        </h2>
        {detectedModels.length === 0 ? (
          <div className="card">
            <div className="empty">
              <Icon name="brain" size={22} />
              <p style={{ maxWidth: 380, margin: '10px auto 0', lineHeight: 1.7 }}>
                还没有选择模型。到「API 配置」点击「检测模型」，从端点返回的列表中勾选需要的模型。
              </p>
            </div>
          </div>
        ) : (
          <div className="card card-pad">
            <div className="stack-1">
              {detectedModels.map((model) => (
                <div key={model} className="row" style={{ gap: 9 }}>
                  <Icon name="check" size={13} className="secondary" />
                  <code className="tiny truncate" style={{ color: 'var(--color-text-primary)', flex: 1 }}>
                    {model}
                  </code>
                  {TIERS.some((t) => tiers[t.id] === model) && (
                    <span className="badge badge-accent">
                      {TIERS.filter((t) => tiers[t.id] === model)
                        .map((t) => t.label)
                        .join(' / ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
