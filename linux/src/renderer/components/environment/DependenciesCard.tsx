import { useEffect } from 'react'

import { Icon } from '../shared/Icon'
import { useEnvironmentStore } from '../../stores/environmentStore'

/**
 * System packages the rest of the app leans on.
 *
 * This used to be step 2 of a blocking first-run wizard. The list itself has
 * nothing to do with setup order — it is a property of the machine that can
 * change at any time (a distro upgrade drops libfuse2, someone removes npm) — so
 * it belongs on the environment panel next to the other system facts, where it
 * can be re-checked whenever the user wonders.
 */
export function DependenciesCard(): React.ReactElement {
  const deps = useEnvironmentStore((s) => s.deps)
  const checking = useEnvironmentStore((s) => s.depsChecking)
  const installing = useEnvironmentStore((s) => s.depsInstalling)
  const outcome = useEnvironmentStore((s) => s.depsOutcome)
  const checkDeps = useEnvironmentStore((s) => s.checkDeps)
  const installMissingDeps = useEnvironmentStore((s) => s.installMissingDeps)

  useEffect(() => {
    if (!deps && !checking) void checkDeps()
    // Once, on mount: the button re-checks after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const missing = (deps ?? []).filter((d) => !d.installed)
  const allOk = deps !== null && missing.length === 0

  return (
    <section className="section">
      <h2 className="section-label">系统依赖</h2>

      <div className="card card-pad">
        {checking && !deps ? (
          <p className="muted tiny" style={{ margin: 0 }}>
            正在检查...
          </p>
        ) : (
          <>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <span className="tiny muted">
                {allOk
                  ? '全部已安装'
                  : `${missing.length} 项缺失 · 只影响对应的安装方式，不装也能继续`}
              </span>
              <button className="btn-ghost btn-sm" onClick={checkDeps} disabled={checking}>
                <Icon name="refresh" size={13} className={checking ? 'spin' : undefined} />
                重新检测
              </button>
            </div>

            <div className="dep-list">
              {(deps ?? []).map((dep) => (
                <div className="dep-row" key={dep.name}>
                  <div className="dep-body">
                    <span className="dep-name">{dep.description}</span>
                    <span className="dep-id">{dep.name}</span>
                  </div>
                  <span className={dep.installed ? 'badge badge-ok' : 'badge badge-bad'}>
                    {dep.installed ? (
                      <>
                        <Icon name="check" size={11} strokeWidth={2.4} />
                        已安装
                      </>
                    ) : (
                      <>
                        <Icon name="x" size={11} strokeWidth={2.4} />
                        缺失
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {missing.length > 0 && (
              <div className="stack-2" style={{ marginTop: 14 }}>
                <button
                  className="btn-primary btn-block"
                  onClick={installMissingDeps}
                  disabled={installing}
                >
                  {installing
                    ? '正在打开终端...'
                    : `一键安装缺失依赖（${missing.length} 项）`}
                </button>
                {!outcome && (
                  <p className="form-note">
                    会在新开的终端窗口里执行 apt，密码在那里输入。
                  </p>
                )}
              </div>
            )}

            {outcome?.mode === 'terminal' && (
              <div className="callout callout-info" style={{ marginTop: 14 }}>
                <span className="callout-icon">
                  <Icon name="info" size={16} />
                </span>
                <div>
                  <p className="callout-title">
                    已打开终端{outcome.terminal ? `（${outcome.terminal}）` : ''}
                  </p>
                  <p className="callout-body">
                    请在那个窗口里输入系统密码 —— 输入时屏幕上不会显示。
                    装完后回到这里点「重新检测」。
                  </p>
                  {outcome.command && (
                    <pre className="code-block" style={{ marginTop: 8 }}>
                      {outcome.command}
                    </pre>
                  )}
                </div>
              </div>
            )}

            {outcome?.mode === 'manual' && (
              <div className="callout callout-danger" style={{ marginTop: 14 }}>
                <span className="callout-icon">
                  <Icon name="alert" size={16} />
                </span>
                <div>
                  <p className="callout-title">没能自动打开终端</p>
                  <p className="callout-body">{outcome.error}</p>
                  {outcome.command && (
                    <pre className="code-block" style={{ marginTop: 8 }}>
                      {outcome.command}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
