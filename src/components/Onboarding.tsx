import { useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { useEnvironmentStore } from '../stores/environmentStore'

const STEPS = [
  { icon: '👋', title: '欢迎使用 Claude Code Manager', desc: '本向导将帮助你快速完成初始配置。', action: '开始' },
  { icon: '🔧', title: '检测系统环境', desc: '检查 Windows 版本、PowerShell 和 WebView2 运行时。', action: '检测环境' },
  { icon: '📦', title: '安装 Claude Code', desc: '前往环境页面一键安装 Node.js、Git 与 Claude Code。', action: '前往安装' },
  { icon: '🔌', title: '配置 API 服务商', desc: '选择 Anthropic、DeepSeek 或自定义 API。', action: '配置 API' },
  { icon: '🤖', title: '检测可用模型', desc: '连接 API 后检测可用模型。', action: '检测模型' },
  { icon: '🔗', title: '配置 MCP（可选）', desc: '前往 MCP 页面管理 MCP Server。可稍后配置。', action: '前往 MCP' },
  { icon: '✅', title: '完成！', desc: '所有基础配置已完成。', action: '开始使用' },
] as const

export default function Onboarding() {
  const { setOnboardingCompleted, setOnboardingStep, onboardingStep } = useAppStore()
  const { detect } = useEnvironmentStore()
  const [step, setStep] = useState(onboardingStep)
  const [busy, setBusy] = useState(false)
  const current = STEPS[step]!

  const goNext = () => {
    if (step < STEPS.length - 1) {
      const nextStep = step + 1
      setStep(nextStep)
      setOnboardingStep(nextStep)
    } else {
      setOnboardingCompleted(true)
    }
  }

  // Each step's action: perform real work (or navigate), then advance.
  const handleAction = async () => {
    setBusy(true)
    try {
      if (step === 1) {
        // 检测环境 — actually run detection, then advance
        await detect()
        goNext()
      } else if (step === 2) {
        // 安装 — navigate to environment page for the user to trigger install
        // (install is long-running + may require restart; the env page has the button + progress)
        window.location.hash = 'environment'
        setOnboardingCompleted(true)
      } else if (step === 3) {
        // 配置 API — navigate to providers page
        window.location.hash = 'providers'
        setOnboardingCompleted(true)
      } else if (step === 4) {
        // 检测模型 — providers page has the "检测模型" button
        window.location.hash = 'providers'
        setOnboardingCompleted(true)
      } else if (step === 5) {
        // MCP — navigate to mcp page
        window.location.hash = 'mcp'
        setOnboardingCompleted(true)
      } else {
        goNext()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
    }}>
      <div className="glass" style={{
        width: '90%', maxWidth: 440, textAlign: 'center',
        padding: '48px 40px', borderRadius: 'var(--r4)', position: 'relative',
      }}>
        <button onClick={() => setOnboardingCompleted(true)} style={{
          position: 'absolute', top: 16, right: 16,
          width: 32, height: 32, borderRadius: 'var(--r-pill)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-secondary)', fontSize: 18,
        }}>✕</button>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 32 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 24 : 8, height: 8,
              borderRadius: i === step ? 4 : 4,
              background: i === step ? 'var(--accent)' : i < step ? 'var(--success)' : 'var(--border-primary)',
              transition: 'all var(--ease-out)',
            }} />
          ))}
        </div>
        <div style={{ fontSize: 48, marginBottom: 20 }}>{current.icon}</div>
        <h2 style={{ marginBottom: 12, fontSize: 'var(--text-xl)' }}>{current.title}</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-md)', lineHeight: 1.6, marginBottom: 32 }}>
          {current.desc}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          {step === 0 ? (
            <button className="btn btn-primary" onClick={goNext} style={{ minWidth: 200 }}>
              开始
            </button>
          ) : step === STEPS.length - 1 ? (
            <button className="btn btn-primary" onClick={goNext} style={{ minWidth: 200 }}>
              {current.action}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleAction} disabled={busy} style={{ minWidth: 200 }}>
              {busy ? '处理中...' : current.action}
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => setOnboardingCompleted(true)}>跳过向导</button>
        </div>
      </div>
    </div>
  )
}
