import { type ReactNode, type CSSProperties, type ElementType } from 'react'
import { LiquidGlass } from '@creativoma/liquid-glass'

interface GlassToolbarProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  as?: ElementType
  backdropBlur?: number
}

export function GlassToolbar({
  children,
  className = '',
  style,
  as = 'div',
  backdropBlur = 4,
}: GlassToolbarProps) {
  return (
    <LiquidGlass
      as={as}
      backdropBlur={backdropBlur}
      tintColor="rgba(255, 255, 255, 0.06)"
      className={`border-b border-white/5 ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 16px',
        ...style,
      }}
    >
      {children}
    </LiquidGlass>
  )
}
