import { type ReactNode, type CSSProperties } from 'react'
import { LiquidGlass } from '@creativoma/liquid-glass'

interface GlassCardProps {
  children: ReactNode
  style?: CSSProperties
  onClick?: () => void
  /** 玻璃模糊强度 1-20，默认 6 */
  blur?: number
  /** 色调透明度，默认 0.12 偏白 */
  tint?: string
  as?: 'div' | 'section' | 'article' | 'a' | 'button'
  hover?: boolean
  /** 无内边距 */
  compact?: boolean
}

export function GlassCard({
  children, style, onClick, blur = 6, tint = 'rgba(255,255,255,0.10)',
  as = 'div', hover = false, compact = false,
}: GlassCardProps) {
  return (
    <LiquidGlass
      as={as} backdropBlur={blur} tintColor={tint}
      style={{
        position: 'relative',
        borderRadius: 'var(--r3)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 2px 20px rgba(0,0,0,0.04), 0 1px 4px rgba(0,0,0,0.02)',
        padding: compact ? '0' : 'var(--s3)',
        transition: 'all 0.2s ease',
        cursor: hover ? 'pointer' : undefined,
        ...style,
      }}
      onClick={onClick}
    >
      {children}
    </LiquidGlass>
  )
}
