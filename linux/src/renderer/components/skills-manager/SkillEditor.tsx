import { useEffect, useState, useCallback } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

import { Icon } from '../shared/Icon'

loader.config({ monaco })

interface Props {
  filename: string | null
  onBack: () => void
}

/** Monaco options shared by every editor instance in this panel. */
const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 13,
  wordWrap: 'on' as const,
  lineNumbers: 'on' as const,
  padding: { top: 12 },
  scrollBeyondLastLine: false,
  tabSize: 2,
}

/**
 * Skill editor.
 *
 * Restyled onto the shared panel system as an editor page rather than a bare
 * form: a back button that says where it goes, a title that names the file
 * being edited (or the fact that this is a new one), the format as a badge
 * instead of a blue/purple pill that used to be the only signal of it, and a
 * bordered editor card that fills the leftover height instead of a hardcoded
 * 400px.
 *
 * Behaviour is unchanged: the frontmatter/JSON serialisation on save is the
 * same, the filename is still derived the same way for new skills, and the
 * loaded format still wins over the local state for existing files.
 */
export function SkillEditor({ filename, onBack }: Props): React.ReactElement {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [format, setFormat] = useState<'markdown' | 'json'>('markdown')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  )
  const [loading, setLoading] = useState(!!filename)

  const isNew = !filename

  const loadSkill = useCallback(async (fname: string) => {
    setLoading(true)
    try {
      const result = await window.electronAPI.commandsRead({ filename: fname })
      if (result.success && result.data) {
        setName(result.data.name)
        setDescription(result.data.description || '')
        setContent(result.data.content)
        setFormat(result.data.format)
      } else {
        setMessage({ type: 'error', text: result.error || '读取 Skill 失败' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (filename) {
      loadSkill(filename)
    } else {
      // Reset form for new skill creation
      setName('')
      setDescription('')
      setContent('')
      setFormat('markdown')
      setLoading(false)
      setMessage(null)
    }
  }, [filename, loadSkill])

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)

    // Determine the correct filename with proper extension
    let saveFilename: string
    if (isNew) {
      const ext = format === 'json' ? 'json' : 'md'
      saveFilename = `${name || 'untitled'}.${ext}`
    } else {
      saveFilename = filename
    }

    // Build file content according to format
    let saveContent: string
    if (format === 'markdown') {
      saveContent = `---\ndescription: ${description}\nargument-hint: \n---\n\n${content}`
    } else {
      saveContent = JSON.stringify(
        {
          name,
          description: description || '',
          prompt: content,
        },
        null,
        2,
      )
    }

    try {
      const result = await window.electronAPI.commandsWrite({
        filename: saveFilename,
        content: saveContent,
        format,
      })
      if (result.success) {
        setMessage({ type: 'success', text: `已保存到 ${saveFilename}` })
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
    // Flex column with a resolved height so the editor card can absorb the
    // leftover space (Monaco needs a definite height).
    <div
      className="page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 76px)',
        minHeight: 480,
      }}
    >
      <header className="page-header" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <button className="btn-ghost btn-sm" onClick={onBack} style={{ marginLeft: -8 }}>
            <Icon name="chevron-left" size={13} />
            返回 Skill 列表
          </button>
          <h1 className="page-title truncate" style={{ marginTop: 4 }}>
            {isNew ? '新建 Skill' : `编辑：${filename}`}
          </h1>
          <p className="page-subtitle">
            {isNew ? (
              <>
                保存后会写入 <code>~/.claude/commands/</code>，文件名就是斜杠命令名
              </>
            ) : (
              <>
                正在编辑 <code>~/.claude/commands/{filename}</code>
              </>
            )}
          </p>
        </div>

        <div className="row" style={{ flexShrink: 0 }}>
          {isNew ? (
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'markdown' | 'json')}
              className="form-select"
              style={{ width: 120 }}
              aria-label="文件格式"
            >
              <option value="markdown">Markdown</option>
              <option value="json">JSON</option>
            </select>
          ) : (
            <span className={`badge ${format === 'json' ? 'badge-accent' : 'badge-muted'}`}>
              {format === 'json' ? 'JSON' : 'Markdown'}
            </span>
          )}
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
          <p className="callout-body" style={{ flex: 1, minWidth: 0 }}>
            {message.text}
          </p>
        </div>
      )}

      {/* ── Metadata ─────────────────────────────────────────────────── */}
      <section className="section" style={{ marginBottom: 14 }}>
        <h2 className="section-label">基本信息</h2>
        <div className="card card-pad">
          <div className="field">
            <label className="field-label" htmlFor="skill-name">
              名称
            </label>
            <input
              id="skill-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-skill"
              className="form-input"
              spellCheck={false}
            />
            <p className="field-hint">
              斜杠命令名。新建时用它拼出文件名（<code>{name || 'untitled'}.md</code>）；
              编辑已有 Skill 时只作为显示名称，不会重命名文件。
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="skill-description">
              描述
            </label>
            <input
              id="skill-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话说明这个 Skill 做什么"
              className="form-input"
            />
            <p className="field-hint">
              {format === 'json'
                ? '写入 JSON 的 description 字段。'
                : '写入 frontmatter 的 description 字段，列表页和 Claude Code 都用它说明用途。'}
            </p>
          </div>
        </div>
      </section>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <section
        className="section"
        style={{ marginBottom: 0, flex: 1, minHeight: 240, display: 'flex', flexDirection: 'column' }}
      >
        <h2 className="section-label">
          {format === 'json' ? 'Prompt（JSON 的 prompt 字段）' : '正文（Markdown body）'}
        </h2>
        <div
          className="card"
          style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}
        >
          <Editor
            height="100%"
            language={format === 'json' ? 'json' : 'markdown'}
            value={content}
            onChange={(val) => setContent(val || '')}
            theme="vs-dark"
            options={EDITOR_OPTIONS}
            loading={
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
            }
          />
        </div>
        <p className="field-hint">
          {format === 'json'
            ? '这段文本会作为 JSON 的 prompt 字段保存。'
            : 'frontmatter 里的 description 由上面的「描述」字段维护，正文从分隔线之后开始。'}
        </p>
      </section>
    </div>
  )
}
