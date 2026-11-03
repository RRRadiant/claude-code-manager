import { useEffect, useState, useCallback } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

import { Icon } from '../shared/Icon'

loader.config({ monaco })

interface Props {
  filename: string | null
  onBack: () => void
}

const AVAILABLE_TOOLS = ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'WebFetch', 'WebSearch']
const MODEL_OPTIONS = ['', 'haiku', 'sonnet', 'opus']

/** Monaco options shared by the body and source editors. */
const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 13,
  wordWrap: 'on' as const,
  lineNumbers: 'on' as const,
  padding: { top: 12 },
  scrollBeyondLastLine: false,
  tabSize: 2,
}

// Matches "---\n<frontmatter>\n---\n<body>"
const YAML_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

// ---------------------------------------------------------------------------
// Pure helpers — no React state dependency
// ---------------------------------------------------------------------------

interface ExtractedSource {
  name: string
  description: string
  tools: string[]
  model: string
  body: string
  rawFm: Record<string, unknown>
}

/**
 * Parse a raw markdown string (YAML frontmatter + body) into structured values.
 * Returns null if no frontmatter is found.
 */
function extractFromSource(source: string): ExtractedSource | null {
  const match = source.match(YAML_REGEX)
  if (!match) return null

  const fmText = match[1]
  const bodyText = match[2]

  let name = ''
  let description = ''
  let model = ''
  const tools: string[] = []
  const rawFm: Record<string, unknown> = {}

  const lines = fmText.split('\n')
  for (const line of lines) {
    // YAML list item: "  - ToolName"
    const toolMatch = line.match(/^\s*-\s+(\S+)/)
    if (toolMatch) {
      const toolName = toolMatch[1]
      tools.push(toolName)
      continue
    }

    // key: value pairs
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (kvMatch) {
      const key = kvMatch[1]
      const value = kvMatch[2].trim()
      rawFm[key] = value

      if (key === 'name') name = value
      else if (key === 'description') description = value
      else if (key === 'model') model = value
    }
  }

  if (tools.length > 0) rawFm.tools = tools

  return { name, description, tools, model, body: bodyText, rawFm }
}

/**
 * Build a raw markdown string from structured values.
 */
function buildSource(
  name: string,
  description: string,
  tools: string[],
  model: string,
  body: string,
): string {
  const fm: string[] = [`name: ${name}`, `description: ${description}`]
  if (tools.length > 0) {
    fm.push('tools:')
    tools.forEach((t) => fm.push(`  - ${t}`))
  }
  if (model) fm.push(`model: ${model}`)
  return `---\n${fm.join('\n')}\n---\n\n${body}`
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Placeholder shown while Monaco's bundle finishes loading. */
function EditorLoading(): React.ReactElement {
  return (
    <div
      className="muted"
      style={{
        display: 'grid',
        placeItems: 'center',
        height: '100%',
        background: '#1e1e1e',
        fontSize: 'var(--text-sm)',
      }}
    >
      正在加载编辑器...
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Agent editor (custom subagents).
 *
 * Restyled onto the shared panel system as an editor page. The form mode now
 * separates the two halves that used to blur together — the YAML frontmatter
 * that becomes the agent's declared identity (name / model / description /
 * tools) and the Markdown body that becomes its system prompt — so it is clear
 * which parts end up between the `---` markers. The mode switch is the shared
 * segmented control, the tool picker states each tool's on/off status in text
 * rather than a border colour alone, and both editors fill their available
 * height instead of 300/500px.
 *
 * Behaviour is unchanged: form↔source conversion still runs on every switch,
 * the effective filename is still tracked across saves because the backend may
 * kebab-case it, and the save path still serialises the same frontmatter.
 */
export function AgentEditor({ filename, onBack }: Props): React.ReactElement {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tools, setTools] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [body, setBody] = useState('')
  const [rawSource, setRawSource] = useState('')
  const [mode, setMode] = useState<'form' | 'source'>('form')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [loading, setLoading] = useState(!!filename)
  // Track the effective filename across saves — the backend may sanitize/kebab-case it
  const [effectiveFilename, setEffectiveFilename] = useState(filename)

  const isNew = !filename

  // -------------------------------------------------------------------------
  // Load agent from disk
  // -------------------------------------------------------------------------

  const loadAgent = useCallback(async (fname: string) => {
    setLoading(true)
    try {
      const result = await window.electronAPI.agentsRead({ filename: fname })
      if (result.success && result.data) {
        const fm = result.data.frontmatter
        setName((fm.name as string) || '')
        setDescription((fm.description as string) || '')
        setTools(Array.isArray(fm.tools) ? (fm.tools as string[]) : [])
        setModel((fm.model as string) || '')
        setBody(result.data.body)
        setRawSource(result.data.raw)
      } else {
        setMessage({ type: 'error', text: result.error || '加载失败' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (filename) {
      loadAgent(filename)
    }
  }, [filename, loadAgent])

  // Keep effective filename in sync when the parent changes the prop
  useEffect(() => {
    setEffectiveFilename(filename)
  }, [filename])

  // -------------------------------------------------------------------------
  // Mode switching
  // -------------------------------------------------------------------------

  const handleToggleMode = (newMode: 'form' | 'source') => {
    if (newMode === 'source' && mode === 'form') {
      // Reconstruct raw markdown from current form state
      setRawSource(buildSource(name, description, tools, model, body))
    }
    if (newMode === 'form' && mode === 'source') {
      // Parse raw markdown to populate form fields
      const extracted = extractFromSource(rawSource)
      if (extracted) {
        setName(extracted.name)
        setDescription(extracted.description)
        setTools(extracted.tools)
        setModel(extracted.model)
        setBody(extracted.body)
      }
    }
    setMode(newMode)
  }

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)

    let saveFrontmatter: Record<string, unknown>
    let saveBody: string
    let saveFilename: string

    if (mode === 'form') {
      // Form mode: construct frontmatter from field values
      saveFrontmatter = { name, description }
      if (tools.length > 0) saveFrontmatter.tools = tools
      if (model) saveFrontmatter.model = model
      saveBody = body
      saveFilename = isNew ? `${sanitizeFilename(name) || 'untitled'}.md` : effectiveFilename!
    } else {
      // Source mode: parse raw markdown directly (no state dependency)
      const extracted = extractFromSource(rawSource)
      if (extracted) {
        saveFrontmatter = extracted.rawFm
        // Ensure name and description are always present
        if (!saveFrontmatter.name) saveFrontmatter.name = extracted.name || ''
        if (!saveFrontmatter.description) saveFrontmatter.description = extracted.description || ''
        saveBody = extracted.body
      } else {
        // No frontmatter found — treat entire source as body
        saveFrontmatter = { name: name || '', description: description || '' }
        saveBody = rawSource
      }
      saveFilename = isNew
        ? `${sanitizeFilename(extractFromSource(rawSource)?.name || '') || 'untitled'}.md`
        : effectiveFilename!
    }

    try {
      const result = await window.electronAPI.agentsWrite({
        filename: saveFilename,
        frontmatter: saveFrontmatter,
        body: saveBody,
      })
      if (result.success) {
        // The backend may sanitize the filename (kebab-case). Track the actual
        // filename returned so subsequent saves target the same file.
        if (result.data?.filename) {
          setEffectiveFilename(result.data.filename)
        }
        setMessage({ type: 'success', text: `已保存到 ${result.data?.filename || saveFilename}` })
      } else {
        setMessage({ type: 'error', text: result.error || '保存失败' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  // -------------------------------------------------------------------------
  // Tool toggle (form mode only)
  // -------------------------------------------------------------------------

  const toggleTool = (tool: string) => {
    setTools((prev) => (prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]))
  }

  // -------------------------------------------------------------------------
  // Render: loading state
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="page">
        <p className="muted" style={{ padding: '48px 0', textAlign: 'center' }}>
          加载中...
        </p>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    // Flex column with a resolved height so the editor cards can absorb the
    // leftover space (Monaco needs a definite height).
    <div
      className="page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 76px)',
        minHeight: 520,
      }}
    >
      <header className="page-header" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <button className="btn-ghost btn-sm" onClick={onBack} style={{ marginLeft: -8 }}>
            <Icon name="chevron-left" size={13} />
            返回 Agent 列表
          </button>
          <h1 className="page-title truncate" style={{ marginTop: 4 }}>
            {isNew ? '新建 Agent' : `编辑：${effectiveFilename}`}
          </h1>
          <p className="page-subtitle">
            {isNew ? (
              <>
                保存后会写入 <code>~/.claude/agents/</code>；文件名由名称转为 kebab-case 生成
              </>
            ) : (
              <>
                正在编辑 <code>~/.claude/agents/{effectiveFilename}</code>
              </>
            )}
          </p>
        </div>

        <div className="row" style={{ flexShrink: 0 }}>
          <div className="seg">
            <button
              className={`seg-item ${mode === 'form' ? 'is-on' : ''}`}
              onClick={() => handleToggleMode('form')}
              aria-pressed={mode === 'form'}
            >
              表单模式
            </button>
            <button
              className={`seg-item ${mode === 'source' ? 'is-on' : ''}`}
              onClick={() => handleToggleMode('source')}
              aria-pressed={mode === 'source'}
            >
              源码模式
            </button>
          </div>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </header>

      {message && (
        <div
          className={`callout ${message.type === 'success' ? 'callout-info' : 'callout-danger'}`}
          style={{ marginBottom: 12 }}
        >
          <span className="callout-icon">
            <Icon name={message.type === 'success' ? 'check' : 'alert'} size={15} />
          </span>
          <p className="callout-body mono" style={{ flex: 1, minWidth: 0 }}>
            {message.text}
          </p>
        </div>
      )}

      {mode === 'form' ? (
        <>
          {/* ── Frontmatter ──────────────────────────────────────────── */}
          <section className="section" style={{ marginBottom: 14 }}>
            <h2 className="section-label">YAML Frontmatter</h2>
            <div className="card card-pad">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 16,
                }}
              >
                <div>
                  <label className="field-label" htmlFor="agent-name">
                    名称
                  </label>
                  <input
                    id="agent-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="my-agent"
                    className="form-input"
                    spellCheck={false}
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="agent-model">
                    模型
                  </label>
                  <select
                    id="agent-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="form-select"
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m || 'default'} value={m}>
                        {m || '默认（跟随会话）'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="agent-description">
                  描述
                </label>
                <input
                  id="agent-description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="描述此 Agent 的功能"
                  className="form-input"
                />
              </div>

              <div className="field">
                <span className="field-label">可用工具</span>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {AVAILABLE_TOOLS.map((tool) => {
                    const on = tools.includes(tool)
                    return (
                      <button
                        key={tool}
                        onClick={() => toggleTool(tool)}
                        aria-pressed={on}
                        className={`badge ${on ? 'badge-accent' : 'badge-muted'}`}
                        style={{ cursor: 'pointer', padding: '5px 11px' }}
                        title={on ? `移除 ${tool}` : `允许 ${tool}`}
                      >
                        <Icon name={on ? 'check' : 'x'} size={11} />
                        {tool}
                      </button>
                    )
                  })}
                </div>
                <p className="field-hint">
                  已选 {tools.length} 个工具
                  {tools.length === 0
                    ? '：一个都不选表示不限制，Agent 可以使用全部工具。'
                    : '；未选中的工具不会被写入 frontmatter。'}
                </p>
              </div>

              <p className="field-hint">
                以上字段会写成文件开头的 <code>---</code> 区块；模型留空则不写 model 字段。
              </p>
            </div>
          </section>

          {/* ── Body ─────────────────────────────────────────────────── */}
          <section
            className="section"
            style={{
              marginBottom: 0,
              flex: 1,
              minHeight: 240,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <h2 className="section-label">系统提示（Body）</h2>
            <div className="card" style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
              <Editor
                height="100%"
                language="markdown"
                value={body}
                onChange={(val) => setBody(val || '')}
                theme="vs-dark"
                options={EDITOR_OPTIONS}
                loading={<EditorLoading />}
              />
            </div>
            <p className="field-hint">
              frontmatter 之后的 Markdown 正文，就是每次调用这个子代理时的系统提示。
            </p>
          </section>
        </>
      ) : (
        /* ── Source mode ──────────────────────────────────────────────── */
        <section
          className="section"
          style={{
            marginBottom: 0,
            flex: 1,
            minHeight: 260,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <h2 className="section-label">完整源文件</h2>
          <div className="card" style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
            <Editor
              height="100%"
              language="markdown"
              value={rawSource}
              onChange={(val) => setRawSource(val || '')}
              theme="vs-dark"
              options={EDITOR_OPTIONS}
              loading={<EditorLoading />}
            />
          </div>
          <p className="field-hint">
            直接编辑整份文件，包含 <code>---</code> 包裹的 frontmatter。切回表单模式时，
            这里的内容会被解析回各个字段；切到源码模式时，则用当前表单值重新生成这份文本。
          </p>
        </section>
      )}
    </div>
  )
}
