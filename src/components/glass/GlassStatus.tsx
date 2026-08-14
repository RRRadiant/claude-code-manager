import { type ReactNode } from 'react'
import { LiquidGlass } from '@creativoma/liquid-glass'

type StatusVariant = 'ok' | 'warn' | 'err' | 'info'

interface GlassStatusProps {
  children: ReactNode
  variant?: StatusVariant
  className?: string
}

const variantColors: Record<StatusVariant, { tint: string; dot: string }> = {
  ok: { tint: 'rgba(48, 209, 88, 0.12)', dot: '#30d158' },
  warn: { tint: 'rgba(255, 159, 10, 0.12)', dot: '#ff9f0a' },
  err: { tint: 'rgba(255, 69, 58, 0.12)', dot: '#ff453a' },
  info: { tint: 'rgba(100, 210, 255, 0.12)', dot: '#64d2ff' },
}

export function GlassStatus({
  children,
  variant = 'info',
  className = '',
}: GlassStatusProps) {
  const color = variantColors[variant]

  return (
    <LiquidGlass
      backdropBlur={2}
      tintColor={color.tint}
      className={`rounded-lg border border-white/5 ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        fontSize: '13px',
      }}
    >
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: color.dot,
        display: 'inline-block',
        flexShrink: 0,
      }} />
      {children}
    </LiquidGlass>
  )
}
