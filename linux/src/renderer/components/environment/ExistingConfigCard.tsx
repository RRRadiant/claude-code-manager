import { useCallback, useEffect, useState } from 'react'

import { Icon } from '../shared/Icon'

/**
 * What Claude Code configuration already exists on this machine.
 *
 * The panels read `~/.claude/settings.json`, so anything in that one file is
 * already visible elsewhere. This is for everything else: which files exist,
 * whether the main one parses, how much is inside it (MCP servers, hooks,
 * skills), where Claude Code itself came from — and, the reason it exists,
 * `ANTHROPIC_*` variables exported from a shell rc. Those silently override
 * settings.json without appearing anywhere in the UI, so a user who set their
 * key up in `.bashrc` months ago sees an empty API panel and cannot tell why.
 */
export function ExistingConfigCard(): React.ReactElement {
  const [scan, setScan] = useState<ConfigScan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const run = useCallback(async () => {
    setScanning(true)
    try {
      const result = await window.electronAPI.configScan()
      if (result.success && result.data) setScan(result.data)
      else setMessage(result.error || '扫描失败')
    } catch (e) {
      setMessage(String(e))
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    void run()
  }, [run])

  const adopt = useCallback(
    async (names: string[]) => {
      const result = await window.electronAPI.configAdoptShellEnv({ names })
      if (result.success && result.data) {
        setMessage(
          `已写入 settings.json：${result.data.adopted.join('、') || '无'}` +
            (result.data.skipped.length > 0 ? `；跳过：${result.data.skipped.join('、')}` : ''),
        )
        await run()
      } else {
        setMessage(result.error || '写入失败')
      }
    },
    [run],
  )

  const settings = scan?.settings
  const overrides = scan?.shellEnv ?? []

  return (
    <section className="section">
      <h2 className="section-label">已有配置</h2>

      <div className="card card-pad">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <span className="tiny muted">
            {scanning
              ? '正在扫描...'
              : scan
                ? `Claude Code ${scan.cli.installed ? scan.cli.version ?? '已安装' : '未安装'} · ` +
                  `${scan.counts.skills} skills · ${scan.counts.agents} agents · ${scan.counts.plugins} plugins`
                : '尚未扫描'}
          </span>
          <button className="btn-ghost btn-sm" onClick={run} disabled={scanning}>
            <Icon name="refresh" size={13} className={scanning ? 'spin' : undefined} />
            重新扫描
          </button>
        </div>

        {/* Shell overrides first: they are the finding that changes behaviour
            without being visible anywhere else in the app. */}
        {overrides.length > 0 && (
          <div className="callout callout-warn" style={{ marginBottom: 12 }}>
            <span className="callout-icon">
              <Icon name="alert" size={16} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p className="callout-title">
                有 {overrides.length} 项变量写在了 shell 启动文件里
              </p>
              <p className="callout-body">
                它们在每次开终端时覆盖 settings.json，本程序的面板看不到，也无法修改。
                复制到 settings.json 之后，两边就一致了（shell 里那几行仍然有效，
                想彻底交给本程序管理就自己删掉）。
              </p>
              <div className="stack-1" style={{ marginTop: 9 }}>
                {overrides.map((item) => (
                  <div className="row" key={item.name} style={{ gap: 8 }}>
                    <code className="tiny" style={{ color: 'var(--color-text-primary)' }}>
                      {item.name}
                    </code>
                    <span className="tiny muted">{item.masked}</span>
                    <span className="tiny muted" style={{ marginLeft: 'auto' }}>
                      {item.file}
                    </span>
                  </div>
                ))}
              </div>
              {overrides.some((o) => o.dynamic) && (
                <p className="callout-body" style={{ marginTop: 8 }}>
                  标了「命令生成」的那几行是 <code>$(…)</code> 之类的动态值，本程序读不到真实内容，
                  也不会替你写进 settings.json —— 请手动填。
                </p>
              )}
              <button
                className="btn-secondary btn-sm"
                style={{ marginTop: 10 }}
                onClick={() => adopt(overrides.filter((o) => !o.dynamic).map((o) => o.name))}
                disabled={overrides.every((o) => o.dynamic)}
              >
                复制到 settings.json
              </button>
            </div>
          </div>
        )}

        {message && (
          <p className="field-hint" style={{ marginBottom: 10 }}>
            {message}
          </p>
        )}

        {/* ── Files ────────────────────────────────────────────────────── */}
        <div className="dep-list">
          {(scan?.files ?? []).map((file) => (
            <div className="dep-row" key={file.path}>
              <span className={`stat-dot ${file.error ? 'is-bad' : file.exists ? 'is-ok' : ''}`} />
              <div className="dep-body">
                <span className="dep-name">{file.role}</span>
                <div className="tiny muted truncate" style={{ marginTop: 2 }}>
                  <code>{file.path}</code>
                </div>
              </div>
              <span
                className={
                  file.error ? 'badge badge-bad' : file.exists ? 'badge badge-ok' : 'badge badge-muted'
                }
              >
                {file.error ? '有问题' : file.exists ? file.summary || '存在' : '不存在'}
              </span>
            </div>
          ))}
        </div>

        {/* ── What is configured ───────────────────────────────────────── */}
        {settings && (
          <div style={{ marginTop: 14 }}>
            <div className="kv">
              <span className="kv-label">API Key</span>
              <span className="kv-value">
                {settings.apiKeyPresent ? (
                  <code className="tiny">{settings.apiKeyMasked}</code>
                ) : (
                  <span className="badge badge-warn">未配置</span>
                )}
              </span>
            </div>
            <div className="kv">
              <span className="kv-label">Base URL</span>
              <span className="kv-value is-mono">{settings.baseUrl || '未配置'}</span>
            </div>
            <div className="kv">
              <span className="kv-label">层级映射</span>
              <span className="kv-value">
                {Object.keys(settings.tierModels).length === 0
                  ? '未映射'
                  : Object.entries(settings.tierModels)
                      .map(([tier, model]) => `${tier} → ${model}`)
                      .join(' · ')}
              </span>
            </div>
            <div className="kv">
              <span className="kv-label">默认层级</span>
              <span className="kv-value">{settings.defaultModel || '未设置'}</span>
            </div>
            <div className="kv">
              <span className="kv-label">MCP / Hooks</span>
              <span className="kv-value">
                {settings.mcpServers} 个 MCP · {settings.hooks} 组 Hooks
              </span>
            </div>
            <div className="kv">
              <span className="kv-label">桌面图标</span>
              <span className="kv-value is-mono">
                {!scan.desktop.available ? (
                  <span className="badge badge-warn">没找到桌面目录</span>
                ) : (
                  (scan.desktop.locations ?? []).map((loc) => (
                    <div key={loc.path}>
                      {loc.exists ? (
                        loc.path
                      ) : (
                        <span className="badge badge-warn">还没创建（{loc.path}）</span>
                      )}
                    </div>
                  ))
                )}
              </span>
            </div>
            {scan.desktop.available && (scan.desktop.locations?.length ?? 0) > 1 && (
              <p className="field-hint" style={{ marginTop: 6 }}>
                检测到两个桌面目录。会话只在登录时读一次 <code>user-dirs.dirs</code>，
                所以换过语言或改过配置之后，屏幕上显示的可能仍是另一个目录 —— 两个都放一份，
                登录之后其中一个就会显示出来。改过配置的话注销重登即可。
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
