import { useEffect, useRef, useState } from 'react'

import { Icon } from '../shared/Icon'

const COUNTDOWN_SECONDS = 12

/**
 * Restart the app once an install has changed PATH.
 *
 * A restart is not strictly required to *find* the new Claude Code — the
 * installer refreshes this process's PATH in place, which is why the panels
 * update immediately — but it is what a user expects after an install, and it is
 * the only way the shell rc, the panels and any terminal opened afterwards agree
 * on the same environment.
 *
 * Counted down rather than immediate: the install just finished, and yanking the
 * window away while somebody is reading the result is worse than waiting twelve
 * seconds. Cancelling leaves the manual button behind.
 */
export function RestartPrompt({
  visible,
  rcFiles = [],
}: {
  visible: boolean
  /** Shell rc files the installer rewrote, shown so the change is not invisible. */
  rcFiles?: string[]
}): React.ReactElement | null {
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS)
  const [cancelled, setCancelled] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!visible) {
      setRemaining(COUNTDOWN_SECONDS)
      setCancelled(false)
      return
    }
    if (cancelled) return

    timer.current = setInterval(() => {
      setRemaining((s) => {
        if (s <= 1) {
          if (timer.current) clearInterval(timer.current)
          void window.electronAPI.appRelaunch()
          return 0
        }
        return s - 1
      })
    }, 1000)

    return () => {
      if (timer.current) clearInterval(timer.current)
    }
    // `cancelled` is a dependency on purpose: cancelling must stop the interval
    // that is already running, not just the next one.
  }, [visible, cancelled])

  if (!visible) return null

  const restartNow = async () => {
    if (timer.current) clearInterval(timer.current)
    setRestarting(true)
    await window.electronAPI.appRelaunch()
  }

  return (
    <div className="callout callout-info" style={{ marginBottom: 18 }}>
      <span className="callout-icon">
        <Icon name="refresh" size={15} className={restarting ? 'spin' : undefined} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p className="callout-title">
          {cancelled || restarting ? '安装完成，可以重启了' : `安装完成，${remaining} 秒后自动重启`}
        </p>
        <p className="callout-body">
          安装目录已加入 PATH。重启本程序会让所有面板、以及之后打开的终端都用上刚装好的版本；
          <strong style={{ color: 'var(--color-text-primary)' }}>已经打开的终端不会自动更新</strong>
          ，需要新开一个。
        </p>
        {rcFiles.length > 0 && (
          <p className="tiny muted" style={{ margin: '5px 0 0' }}>
            已更新：{rcFiles.join('、')}
          </p>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn-secondary btn-sm" onClick={restartNow} disabled={restarting}>
            <Icon name="refresh" size={13} />
            {restarting ? '正在重启' : '立即重启'}
          </button>
          {!cancelled && !restarting && (
            <button className="btn-ghost btn-sm" onClick={() => setCancelled(true)}>
              稍后自己重启
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
