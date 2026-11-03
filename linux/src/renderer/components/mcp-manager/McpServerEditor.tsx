import { useEffect, useState } from 'react'

import { Icon } from '../shared/Icon'

interface Props {
  serverName: string | null
  onBack: () => void
}

/**
 * `.seg-item` is a plain text button; these two carry an icon, so they centre
 * their contents. Kept here rather than in the stylesheet because only this
 * panel's transport selector uses an icon inside a segment.
 */
const SEG_ITEM_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
}

/**
 * MCP server editor — reached from the MCP list, either for an existing server
 * (`serverName`) or for a new one (the list passes `__new__`).
 *
 * Restyled onto the shared panel system: an explicit back control, a title that
 * names the server being edited, the transport choice as a `.seg` selector, and
 * a separate section per transport so switching stdio ⟷ sse visibly swaps the
 * fields. Transport is stated in words, not only by colour.
 *
 * Behaviour preserved: `mcp:list` on open, `mcp:add` / `mcp:update` on save
 * (same option shape, same comma-splitting of args), the name-required guard,
 * and the 500 ms `onBack()` after a successful save.
 *
 * Three bugs are fixed here (see the panel report): a server whose `type` is
 * absent fell through to the SSE branch on save and was rewritten as an SSE
 * entry with no URL; the name field was editable although `mcp:update` looks the
 * entry up by the *new* name, so every rename failed with "not found"; and a
 * server that had vanished from settings.json left an empty form with no
 * explanation.
 */
export function McpServerEditor({ serverName, onBack }: Props): React.ReactElement {
  const isNew = serverName === '__new__' || serverName === null

  const [name, setName] = useState(serverName === '__new__' || serverName === null ? '' : serverName)
  const [srvType, setSrvType] = useState<'stdio' | 'sse'>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!isNew && serverName) {
      loadServer()
    }
  }, [])

  const loadServer = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.mcpList()
      if (result.success && result.data) {
        const found = (
          result.data as Array<{
            name: string
            type: string
            command?: string
            args?: string[]
            url?: string
          }>
        ).find((s) => s.name === serverName)
        if (found) {
          // `type` is optional in settings.json; Claude Code treats a missing
          // type as stdio. Without this default the save path below fell through
          // to the SSE branch and rewrote the entry with an empty URL.
          setSrvType(found.type === 'sse' ? 'sse' : 'stdio')
          setCommand(found.command || '')
          setArgs((found.args || []).join(', '))
          setUrl(found.url || '')
        } else {
          setMessage({
            type: 'error',
            text: `未找到 MCP 服务器「${serverName}」：它可能已在 settings.json 中被删除或改名。请返回列表后重试。`,
          })
        }
      }
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setMessage({ type: 'error', text: '请先填写服务器名称' })
      return
    }

    setSaving(true)
    setMessage(null)

    const opts: {
      name: string
      type: 'stdio' | 'sse'
      command?: string
      args?: string[]
      url?: string
    } = {
      name: name.trim(),
      type: srvType,
    }

    if (srvType === 'stdio') {
      opts.command = command.trim() || undefined
      opts.args = args
        ? args
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined
    } else {
      opts.url = url.trim() || undefined
    }

    try {
      const result = isNew
        ? await window.electronAPI.mcpAdd(opts)
        : await window.electronAPI.mcpUpdate(opts)
      if (result.success) {
        setMessage({ type: 'success', text: '已保存' })
        setTimeout(() => onBack(), 500)
      } else {
        setMessage({ type: 'error', text: result.error || '保存失败' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    } finally {
      setSaving(false)
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
    <div className="page">
      <header className="page-header">
        <div style={{ minWidth: 0 }}>
          <button
            className="btn-ghost btn-sm"
            onClick={onBack}
            style={{ marginBottom: 8, marginLeft: -10 }}
          >
            <Icon name="chevron-left" size={14} />
            返回 MCP 列表
          </button>
          <h1 className="page-title">
            {isNew ? '添加 MCP 服务器' : `编辑 MCP 服务器 · ${serverName}`}
          </h1>
          <p className="page-subtitle">
            {isNew
              ? '填写名称与连接方式，保存后写入 ~/.claude/settings.json 的 mcpServers'
              : '修改这个服务器的连接方式与启动参数'}
          </p>
        </div>
      </header>

      {!isNew && (
        <div className="callout callout-warn" style={{ marginBottom: 18 }}>
          <span className="callout-icon">
            <Icon name="alert" size={15} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="callout-title">保存会整体重写这个服务器条目</p>
            <p className="callout-body">
              本面板只读写 <code>type</code>、<code>command</code>、<code>args</code>、<code>url</code>。原条目里的 <code>env</code>{' '}
              等其它字段不会被读入，保存时会随条目一起被覆盖掉。改动前请先确认配置，或直接编辑{' '}
              <code>settings.json</code>。
            </p>
          </div>
        </div>
      )}

      {/* ── 基本信息 ───────────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">基本信息</h2>
        <div className="card card-pad">
          <div className="field">
            <label className="field-label" htmlFor="mcp-name">
              名称
            </label>
            <input
              id="mcp-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="form-input"
              style={
                isNew
                  ? { maxWidth: 360 }
                  : {
                      maxWidth: 360,
                      background: 'var(--color-surface-3)',
                      color: 'var(--color-text-secondary)',
                    }
              }
              placeholder="my-mcp-server"
              readOnly={!isNew}
              spellCheck={false}
              autoComplete="off"
              required
            />
            <p className="field-hint">
              {isNew
                ? '名称是 settings.json 中 mcpServers 的键，保存后不可在本面板重命名。'
                : '名称是 settings.json 中 mcpServers 的键，本面板不支持重命名；需要改名请删除后重建。'}
            </p>
          </div>

          <div className="field">
            <span className="field-label" id="mcp-type-label">
              连接方式
            </span>
            <div
              className="seg"
              role="group"
              aria-labelledby="mcp-type-label"
              style={{ maxWidth: 360 }}
            >
              <button
                className={`seg-item ${srvType === 'stdio' ? 'is-on' : ''}`}
                onClick={() => setSrvType('stdio')}
                aria-pressed={srvType === 'stdio'}
                style={SEG_ITEM_STYLE}
              >
                <Icon name="terminal" size={13} />
                stdio
              </button>
              <button
                className={`seg-item ${srvType === 'sse' ? 'is-on' : ''}`}
                onClick={() => setSrvType('sse')}
                aria-pressed={srvType === 'sse'}
                style={SEG_ITEM_STYLE}
              >
                <Icon name="external" size={13} />
                sse
              </button>
            </div>
            <p className="field-hint">
              <code>stdio</code> 在本机启动一个进程（填写命令与参数）；<code>sse</code>{' '}
              连接远程 HTTP 端点（填写 URL）。切换后下方的字段会随之更换。
            </p>
          </div>
        </div>
      </section>

      {/* ── 连接 / 启动参数 ────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-label">
          {srvType === 'stdio' ? '启动方式 · stdio' : '连接方式 · sse'}
        </h2>
        <div className="card card-pad">
          {srvType === 'stdio' ? (
            <>
              <div className="field">
                <label className="field-label" htmlFor="mcp-command">
                  Command
                </label>
                <input
                  id="mcp-command"
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  className="form-input"
                  placeholder="npx"
                  spellCheck={false}
                  autoComplete="off"
                />
                <p className="field-hint">
                  要启动的可执行文件，例如 <code>npx</code>、<code>uvx</code> 或某个绝对路径。
                </p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="mcp-args">
                  Args（可选）
                </label>
                <input
                  id="mcp-args"
                  type="text"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  className="form-input"
                  placeholder="-y, @modelcontextprotocol/server-filesystem, /tmp"
                  spellCheck={false}
                  autoComplete="off"
                />
                <p className="field-hint">
                  多个参数用英文逗号分隔，保存时按逗号拆成数组。参数内部若含有逗号，请在
                  settings.json 中直接编辑。
                </p>
              </div>
            </>
          ) : (
            <div className="field">
              <label className="field-label" htmlFor="mcp-url">
                URL
              </label>
              <input
                id="mcp-url"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="form-input"
                placeholder="https://mcp.example.com/sse"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="field-hint">MCP 服务器的 SSE 端点地址，需以 https:// 或 http:// 开头。</p>
            </div>
          )}
        </div>
      </section>

      {/* ── 保存 ───────────────────────────────────────────────────────── */}
      <div className="actions">
        <button className="btn-primary" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? '保存中...' : isNew ? '添加服务器' : '保存修改'}
        </button>
        <button className="btn-ghost" onClick={onBack}>
          取消
        </button>
        {message && (
          <span
            className="row"
            style={{
              fontSize: 'var(--text-sm)',
              color: message.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
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
