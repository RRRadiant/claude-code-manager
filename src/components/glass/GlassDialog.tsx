import { type ReactNode } from 'react'
import { LiquidGlass } from '@creativoma/liquid-glass'
import { GlassButton } from './GlassButton'

interface GlassDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  children: ReactNode
  confirmText?: string
  cancelText?: string
  variant?: 'default' | 'destructive'
}

export function GlassDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'default',
}: GlassDialogProps) {
  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <LiquidGlass
        backdropBlur={10}
        tintColor="rgba(255, 255, 255, 0.18)"
        className="rounded-2xl border border-white/10 shadow-2xl"
        style={{
          minWidth: '360px',
          maxWidth: '480px',
          padding: '24px',
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: '18px', fontWeight: 600 }}>{title}</h3>
        <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '24px' }}>
          {children}
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <GlassButton variant="ghost" onClick={onClose} size="sm">{cancelText}</GlassButton>
          <GlassButton
            variant={variant === 'destructive' ? 'primary' : 'primary'}
            onClick={onConfirm}
            size="sm"
            style={{
              ...(variant === 'destructive' ? { background: 'rgba(255, 69, 58, 0.35)' } : {}),
            }}
          >
            {confirmText}
          </GlassButton>
        </div>
      </LiquidGlass>
    </div>
  )
}
