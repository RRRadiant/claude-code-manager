import { type ReactNode, type CSSProperties } from 'react'
import { LiquidGlass } from '@creativoma/liquid-glass'

interface GlassButtonProps {
  children: ReactNode
  onClick?: () => void
  className?: string
  style?: CSSProperties
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  backdropBlur?: number
}

const sizeStyles: Record<string, CSSProperties> = {
  sm: { padding: '4px 10px', fontSize: '13px' },
  md: { padding: '8px 16px', fontSize: '14px' },
  lg: { padding: '12px 24px', fontSize: '16px' },
}

const variantTints: Record<string, string> = {
  primary: 'rgba(0, 113, 227, 0.35)',
  secondary: 'rgba(255, 255, 255, 0.12)',
  ghost: 'rgba(255, 255, 255, 0.05)',
}

export function GlassButton({
  children,
  onClick,
  className = '',
  style,
  disabled = false,
  variant = 'secondary',
  size = 'md',
  backdropBlur = 2,
}: GlassButtonProps) {
  return (
    <LiquidGlass
      as="button"
      backdropBlur={backdropBlur}
      tintColor={variantTints[variant]}
      className={`
        rounded-lg font-medium border border-white/10
        transition-all duration-150
        hover:brightness-110 active:scale-95
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
        ${variant === 'primary' ? 'text-white' : 'text-[var(--text-primary)]'}
        ${className}
      `}
      style={{
        ...sizeStyles[size],
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
        // Pass button-specific aria attribute for disabled state
        opacity: disabled ? 0.5 : undefined,
        pointerEvents: disabled ? 'none' : undefined,
      } as CSSProperties}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </LiquidGlass>
  )
}
