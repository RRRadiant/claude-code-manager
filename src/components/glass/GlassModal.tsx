import { type ReactNode, type CSSProperties, useEffect } from 'react'
import { LiquidGlass } from '@creativoma/liquid-glass'

interface GlassModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  className?: string
  style?: CSSProperties
  backdropBlur?: number
}

export function GlassModal({
  open,
  onClose,
  children,
  title,
  className = '',
  style,
  backdropBlur = 8,
}: GlassModalProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) {
      document.addEventListener('keydown', handleEsc)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <LiquidGlass
        backdropBlur={backdropBlur}
        tintColor="rgba(255, 255, 255, 0.15)"
        className={`rounded-2xl border border-white/10 shadow-2xl ${className}`}
        style={{
          minWidth: '400px',
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflow: 'auto',
          padding: '28px',
          ...style,
        }}
      >
        {title && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '20px',
          }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{title}</h2>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                padding: '4px 8px',
                borderRadius: 'var(--r2)',
              }}
            >
              ✕
            </button>
          </div>
        )}
        {children}
      </LiquidGlass>
    </div>
  )
}
