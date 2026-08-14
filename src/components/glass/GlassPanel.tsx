import { type ReactNode } from 'react'
import { LiquidGlass } from '@creativoma/liquid-glass'

interface GlassPanelProps {
  children: ReactNode
  style?: React.CSSProperties
  blur?: number
  tint?: string
  compact?: boolean
}

export function GlassPanel({
  children, style, blur = 8, tint = 'rgba(255,255,255,0.06)', compact = false,
}: GlassPanelProps) {
  return (
    <LiquidGlass
      backdropBlur={blur} tintColor={tint}
      style={{
        width: '100%',
        borderRadius: 'var(--r4)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 4px 30px rgba(0,0,0,0.05)',
        padding: compact ? 0 : 'var(--s4)',
        ...style,
      }}
    >
      {children}
    </LiquidGlass>
  )
}
