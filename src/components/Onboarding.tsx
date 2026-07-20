import { useState } from 'react'
import { useAppStore } from '../stores/appStore'

const STEPS = [
  { icon: '👋', title: '欢迎使用 Claude Code Manager', desc: '本向导将帮助你快速完成初始配置，只需几步即可开始使用 Claude Code。' },
  { icon: '🔧', title: '检测系统环境', desc: '我们将检查你的 Windows 版本、PowerShell 和 WebView2 运行时。', action: '检测环境' },
  { icon: '📦', title: '安装 Claude Code', desc: '一键安装 Claude Code 原生 Windows 版本，无需手动输入命令。', action: '安装' },
  { icon: '🔌', title: '配置 API 服务商', desc: '选择 Anthropic、DeepSeek 或自定义 API 服务商，安全存储 API Key。', action: '配置' },
  { icon: '🤖', title: '检测可用模型', desc: '连接 API 后检测可用模型，选择适合你的模型。', action: '检测' },
  { icon: '🔗', title: '配置 MCP（可选）', desc: '添加 MCP Server 扩展 Claude Code 的能力。可以稍后配置。', action: '跳过' },
  { icon: '✅', title: '完成！', desc: '所有基础配置已完成，开始使用 Claude Code Manager 吧。', action: '开始使用' },
]

export default function Onboarding() {
  const { setOnboardingCompleted, setOnboardingStep, onboardingStep } = useAppStore()
  const [step, setStep] = useState(onboardingStep)
  const current = STEPS[step]

  const next = () => {
    if (step < STEPS.length - 1) {
      const nextStep = step + 1
      setStep(nextStep)
      setOnboardingStep(nextStep)
    } else {
      setOnboardingCompleted(true)
    }
  }

  const skip = () => {
    setOnboardingCompleted(true)
  }

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card glass">
        <button className="onboarding-close" onClick={skip}>✕</button>
        <div className="onboarding-steps">
          {STEPS.map((_, i) => (
            <div key={i} className={`onboarding-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} />
          ))}
        </div>
        <div className="onboarding-icon">{current.icon}</div>
        <h2 className="onboarding-title">{current.title}</h2>
        <p className="onboarding-desc">{current.desc}</p>
        <div className="onboarding-actions">
          <button className="btn btn-primary" onClick={next}>
            {current.action || '下一步'}
          </button>
          <button className="btn btn-ghost" onClick={skip}>跳过向导</button>
        </div>
      </div>
    </div>
  )
}
