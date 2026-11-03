import { useEffect, useRef, useState } from 'react'

import { Icon, type IconName } from '../shared/Icon'
import { useEnvironmentStore } from '../../stores/environmentStore'

export type GuidePanel = 'environment' | 'api' | 'models' | 'mcp'

interface Step {
  icon: IconName
  title: string
  desc: string
  action: string
  /**
   * Panel this step sends the user to. When set, the action navigates and closes
   * the guide: the work itself belongs to that panel, which already knows how to
   * do it (and how to report progress), rather than being reimplemented here.
   */
  panel?: GuidePanel
  /** Runs real work in place of navigating, then advances. */
  work?: 'detect'
}

const STEPS: Step[] = [
  {
    icon: 'bolt',
    title: '欢迎使用 Claude Code Manager',
    desc: '这个程序负责两件事：把 Claude Code 装好，以及管理它的配置 —— API、模型、Skills、Agents、Hooks、MCP。六步走完就能用。',
    action: '开始',
  },
  {
    icon: 'settings',
    title: '检测系统环境',
    desc: '检查系统依赖、Node.js、Git 与 Claude Code 的安装情况，并把结果放到「环境」面板。',
    action: '开始检测',
    work: 'detect',
  },
  {
    icon: 'download',
    title: '安装 Claude Code',
    desc: '在「环境」面板点「一键安装」：自动选镜像下载 Node.js、校验 SHA256、解压到 ~/.local/share/claude-code-manager，再装 Claude Code。',
    action: '前往安装',
    panel: 'environment',
  },
  {
    icon: 'key',
    title: '配置 API',
    desc: '填入 API Key 和 Base URL（官方或兼容服务），点「检测模型」拉取该端点上可用的模型列表。',
    action: '去配置',
    panel: 'api',
  },
  {
    icon: 'brain',
    title: '给三个层级选模型',
    desc: 'Claude Code 分 Haiku / Sonnet / Opus 三个层级。检测到模型后，在「模型管理」里指定每个层级实际用哪个模型 ID。',
    action: '去设置',
    panel: 'models',
  },
  {
    icon: 'check',
    title: '可以开始用了',
    desc: '配置都在 ~/.claude/settings.json，Claude Code 直接读它。想看这份向导，可以在「通用设置」里再打开。',
    action: '开始使用',
  },
]

interface OnboardingProps {
  onNavigate: (panel: GuidePanel) => void
  onClose: () => void
}

/**
 * First-run guide, modelled on the Windows build's onboarding: an overlay on top
 * of the normal interface, not a gate in front of it.
 *
 * The wizard this replaces took over the whole window and would not let go until
 * the user had walked every step — including installing Claude Code, which can
 * fail, needs a terminal, and is not something to force before the user has even
 * seen the app. Here the guide sits on top of the real interface, every step can
 * be skipped, and the two steps that do work (detect, install) hand off to the
 * panels that own them.
 */
export function Onboarding({ onNavigate, onClose }: OnboardingProps): React.ReactElement {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  /** Set once the detect step has run, so it can show its result before moving on. */
  const [detected, setDetected] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  const detect = useEnvironmentStore((s) => s.detect)
  const checkDeps = useEnvironmentStore((s) => s.checkDeps)
  const deps = useEnvironmentStore((s) => s.deps)

  const current = STEPS[step]!

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))

  const run = async () => {
    if (current.work === 'detect') {
      // Stay on the step after detecting: the whole point of running it is the
      // answer, and advancing straight past it would hide the only number the
      // guide produces.
      if (!detected) {
        setBusy(true)
        try {
          await Promise.all([detect(), checkDeps()])
        } finally {
          setBusy(false)
          setDetected(true)
        }
        return
      }
      next()
      return
    }
    if (current.panel) {
      onNavigate(current.panel)
      onClose()
      return
    }
    if (step === STEPS.length - 1) onClose()
    else next()
  }

  const missing = (deps ?? []).filter((d) => !d.installed).length
  const actionLabel = current.work === 'detect' && detected ? '下一步' : current.action

  return (
    <div
      className="guide"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="使用向导"
      tabIndex={-1}
    >
      <div className="guide-card">
        <button className="guide-close" onClick={onClose} aria-label="关闭向导">
          <Icon name="x" size={16} />
        </button>

        <div className="guide-dots">
          {STEPS.map((s, i) => (
            <span
              key={s.title}
              className={`guide-dot${i === step ? ' is-current' : ''}${i < step ? ' is-done' : ''}`}
            />
          ))}
        </div>

        <span className="guide-mark">
          <Icon name={current.icon} size={24} />
        </span>

        <h2 className="guide-title">{current.title}</h2>
        <p className="guide-lede">{current.desc}</p>

        {/* The only step that produces a number worth showing. */}
        {detected && current.work === 'detect' && (
          <p className="guide-result">
            {missing === 0 ? '系统依赖齐全' : `检测到 ${missing} 项系统依赖缺失，可在「环境」面板安装`}
          </p>
        )}

        <div className="guide-actions">
          <button className="btn-primary btn-lg" onClick={run} disabled={busy}>
            {busy ? '检测中...' : actionLabel}
          </button>
          <button className="btn-ghost btn-sm" onClick={onClose}>
            跳过向导
          </button>
        </div>
      </div>
    </div>
  )
}
