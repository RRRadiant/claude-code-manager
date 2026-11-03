import { useEffect, useState, useCallback } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

import { Icon, type IconName } from '../shared/Icon'

// Use local Monaco (not CDN) — required for Electron apps
loader.config({ monaco })

interface ConfigFileEntry {
  name: string
  path: string
  size: number
}

interface CliPathEntry {
  location: string
  exists: boolean
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function detectLanguage(filename: string): string {
  if (filename.endsWith('.json')) return 'json'
  if (filename.endsWith('.md')) return 'markdown'
  if (filename.endsWith('.yaml') || filename.endsWith('.yml')) return 'yaml'
  if (filename.endsWith('.toml')) return 'ini'
  if (filename.endsWith('.js') || filename.endsWith('.mjs')) return 'javascript'
  if (filename.endsWith('.ts')) return 'typescript'
  return 'plaintext'
}

/** Short label shown in the type badge of a file row. */
function formatLabel(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toUpperCase()
  return filename.includes('.') ? ext : 'FILE'
}

function fileIcon(filename: string): IconName {
  if (filename.endsWith('.json')) return 'settings'
  return 'file'
}

/**
 * Shared Monaco options — identical for every editor instance in this panel.
 *
 * Monaco needs a definite pixel height. `height="100%"` works because each
 * wrapper below is a flex child with `flex: 1` and `min-height: 0`, so it has a
 * resolved height to give to the editor.
 */
const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 13,
  wordWrap: 'on' as const,
  lineNumbers: 'on' as const,
  padding: { top: 12 },
  scrollBeyondLastLine: false,
  tabSize: 2,
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

/**
 * Config file browser / editor for `~/.claude/`.
 *
 * Restyled onto the shared panel system. The file list was a stack of
 * full-width buttons with hover-only affordances, the type was signalled by
 * emoji, and the Monaco instance was pinned to `height="500px"` so it left a
 * gap on a tall window and overflowed a short one — it now fills the space the
 * panel is given, inside a bordered, rounded card.
 *
 * Behaviour is unchanged; see the report for the one dead function removed.
 */
export function ConfigFileEditor(): React.ReactElement {
  const [files, setFiles] = useState<ConfigFileEntry[]>([])
  const [cliPaths, setCliPaths] = useState<CliPathEntry[]>([])
  const [selectedFile, setSelectedFile] = useState<ConfigFileEntry | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      // Use allSettled so one failing/hanging IPC call does not block the other
      const results = await Promise.allSettled([
        window.electronAPI.configListFiles(),
        window.electronAPI.configCliPath(),
      ])

      const filesSettled = results[0]
      const cliSettled = results[1]

      if (filesSettled.status === 'fulfilled') {
        const filesResult = filesSettled.value
        if (filesResult.success && filesResult.data) {
          const sorted = [...filesResult.data].sort((a, b) => {
            const aIsConfig = a.name.startsWith('settings') || a.name === 'CLAUDE.md'
            const bIsConfig = b.name.startsWith('settings') || b.name === 'CLAUDE.md'
            if (aIsConfig && !bIsConfig) return -1
            if (!aIsConfig && bIsConfig) return 1
            return a.name.localeCompare(b.name)
          })
          setFiles(sorted)
        } else if (filesResult.error) {
          setMessage({ type: 'error', text: `读取文件列表失败：${filesResult.error}` })
        }
      } else {
        setMessage({ type: 'error', text: `读取文件列表失败：${String(filesSettled.reason)}` })
      }

      if (cliSettled.status === 'fulfilled') {
        const cliResult = cliSettled.value
        if (cliResult.success && cliResult.data) {
          setCliPaths(cliResult.data.paths)
        }
        // CLI path failure is non-critical; silently ignore
      }
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  const openFile = useCallback(async (file: ConfigFileEntry) => {
    setSelectedFile(file)
    setLoadingFile(true)
    setMessage(null)
    try {
      const result = await window.electronAPI.configReadFile({ filepath: file.path })
      if (result.success && result.data !== undefined) {
        setEditorContent(result.data)
        setOriginalContent(result.data)
      } else {
        setEditorContent('')
        setOriginalContent('')
        setMessage({ type: 'error', text: result.error || '读取文件失败' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    } finally {
      setLoadingFile(false)
    }
  }, [])

  const handleSave = async () => {
    if (!selectedFile) return
    setSaving(true)
    setMessage(null)
    try {
      const result = await window.electronAPI.configWriteFile({
        filepath: selectedFile.path,
        content: editorContent,
      })
      if (result.success) {
        setOriginalContent(editorContent)
        setMessage({ type: 'success', text: `已写入 ${selectedFile.path}` })
        // Refresh the file list to update size
        loadFiles()
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

  const handleBack = () => {
    setSelectedFile(null)
    setEditorContent('')
    setOriginalContent('')
    setMessage(null)
  }

  const hasChanges = editorContent !== originalContent

  // -------------------------------------------------------------------------
  // Editor view
  // -------------------------------------------------------------------------

  if (selectedFile) {
    return (
      // The page is a flex column filling the viewport, so the editor card can
      // take every pixel left over instead of a hardcoded 500px.
      <div
        className="page"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 76px)',
          minHeight: 380,
        }}
      >
        <header className="page-header" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <button className="btn-ghost btn-sm" onClick={handleBack} style={{ marginLeft: -8 }}>
              <Icon name="chevron-left" size={13} />
              返回文件列表
            </button>
            <h1 className="page-title truncate" style={{ marginTop: 4 }}>
              {selectedFile.name}
            </h1>
            <p className="page-subtitle mono truncate" title={selectedFile.path}>
              {selectedFile.path}
            </p>
            <p className="tiny muted" style={{ margin: '4px 0 0' }}>
              {hasChanges
                ? '有未保存的修改，保存前不会写入磁盘。'
                : '内容与磁盘一致，可直接编辑。'}
            </p>
          </div>

          <div className="row" style={{ flexShrink: 0 }}>
            <span className="badge badge-muted tnum">{formatSize(selectedFile.size)}</span>
            {hasChanges ? (
              <span className="badge badge-warn">
                <Icon name="alert" size={11} />
                已修改
              </span>
            ) : (
              <span className="badge badge-muted">
                <Icon name="check" size={11} />
                未修改
              </span>
            )}
            <button className="btn-primary" onClick={handleSave} disabled={saving || !hasChanges}>
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

        {/* Editor surface: bordered, rounded, and stretched to the leftover height */}
        <div
          className="card"
          style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}
        >
          {loadingFile ? (
            <p
              className="muted"
              style={{
                margin: 'auto',
                padding: '0 16px',
                textAlign: 'center',
                fontSize: 'var(--text-sm)',
              }}
            >
              加载文件中...
            </p>
          ) : (
            <Editor
              height="100%"
              language={detectLanguage(selectedFile.name)}
              value={editorContent}
              onChange={(val) => setEditorContent(val || '')}
              theme="vs-dark"
              options={EDITOR_OPTIONS}
              loading={<EditorLoading />}
            />
          )}
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // File list view
  // -------------------------------------------------------------------------

  const foundPaths = cliPaths.filter((e) => e.exists)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">配置文件</h1>
          <p className="page-subtitle">
            直接查看和编辑 <code>~/.claude/</code> 下的配置文件
          </p>
        </div>
        <button className="btn-secondary" onClick={loadFiles} disabled={loading}>
          <Icon name="refresh" size={13} className={loading ? 'spin' : undefined} />
          重新读取
        </button>
      </header>

      {message && message.type === 'error' && (
        <div className="callout callout-danger" style={{ marginBottom: 18 }}>
          <span className="callout-icon">
            <Icon name="alert" size={15} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="callout-title">读取失败</p>
            <p className="callout-body">{message.text}</p>
          </div>
          <button className="btn-secondary btn-sm" onClick={loadFiles}>
            重试
          </button>
        </div>
      )}

      {loading ? (
        <p className="muted" style={{ padding: '48px 0', textAlign: 'center' }}>
          加载中...
        </p>
      ) : (
        <>
          {/* ── CLI install locations ─────────────────────────────────── */}
          <section className="section">
            <h2 className="section-label">Claude Code 安装路径</h2>
            <div className="card card-pad">
              {foundPaths.length === 0 ? (
                <p className="field-hint" style={{ margin: 0 }}>
                  未在任何标准路径下找到 <code>claude</code> 可执行文件。
                  如果还没安装 Claude Code，请先运行安装向导；已经装在其他位置的话，本面板不受影响，
                  仍然可以编辑下表中的配置文件。
                </p>
              ) : (
                foundPaths.map((entry, idx) => (
                  <div className="kv" key={`${entry.location}-${idx}`}>
                    <span className="kv-label row" style={{ gap: 7 }}>
                      <Icon name="terminal" size={13} />
                      可执行文件
                    </span>
                    <span
                      className="kv-value row"
                      style={{ gap: 8, justifyContent: 'flex-end', minWidth: 0 }}
                    >
                      <span className="mono" style={{ wordBreak: 'break-all' }}>
                        {entry.location}
                      </span>
                      <span className="badge badge-ok" style={{ flexShrink: 0 }}>
                        <Icon name="check" size={11} />
                        已安装
                      </span>
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ── Config files ─────────────────────────────────────────── */}
          <section className="section">
            <h2 className="section-label">
              文件列表
              {files.length > 0 && ` · ${files.length} 个`}
            </h2>

            {files.length === 0 ? (
              <div className="card">
                <div className="empty">
                  <Icon name="file" size={22} />
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 'var(--text-md)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    ~/.claude/ 下还没有配置文件
                  </div>
                  <p style={{ maxWidth: 460, margin: '6px auto 0', lineHeight: 1.7 }}>
                    这里列出 Claude Code 的配置与会话文件，例如 <code>settings.json</code>（API
                    凭据、环境变量）和 <code>CLAUDE.md</code>（项目记忆）。它们会在 Claude Code
                    首次运行或本应用保存过配置之后出现。
                  </p>
                </div>
              </div>
            ) : (
              <div className="stack-2">
                {files.map((file) => (
                  <div
                    key={file.path}
                    className="card card-hover"
                    onClick={() => openFile(file)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openFile(file)
                      }
                    }}
                    style={{ cursor: 'pointer', padding: '12px 15px' }}
                  >
                    <div className="row-between">
                      <div className="row" style={{ flex: 1, minWidth: 0, gap: 10 }}>
                        <span className="badge badge-muted" style={{ flexShrink: 0 }}>
                          <Icon name={fileIcon(file.name)} size={12} />
                          {formatLabel(file.name)}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div className="truncate" style={{ fontWeight: 550 }}>
                            {file.name}
                          </div>
                          <div className="tiny muted mono truncate" title={file.path}>
                            {file.path}
                          </div>
                        </div>
                      </div>

                      <div className="row" style={{ flexShrink: 0 }}>
                        <span className="tiny muted tnum">{formatSize(file.size)}</span>
                        <Icon name="chevron-right" size={15} className="muted" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="field-hint">
              点击任意文件在编辑器中打开。保存会直接写回该路径的原始文件，没有自动备份，
              建议先确认内容再保存。
            </p>
          </section>
        </>
      )}
    </div>
  )
}
