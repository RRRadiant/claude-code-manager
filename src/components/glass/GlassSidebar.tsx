import { type ReactNode } from 'react'
import { LiquidGlass } from '@creativoma/liquid-glass'

interface GlassSidebarProps {
  children: ReactNode
  collapsed?: boolean
  width?: number
  collapsedWidth?: number
}

export function GlassSidebar({
  children, collapsed = false, width = 220, collapsedWidth = 56,
}: GlassSidebarProps) {
  return (
    <LiquidGlass
      as="nav"
      backdropBlur={10}
      tintColor="rgba(255,255,255,0.05)"
      className="liquid-glass"
      style={{
        width: collapsed ? collapsedWidth : width,
        height: '100%',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        borderRight: '1px solid rgba(255,255,255,0.04)',
        transition: 'width 0.2s ease',
        borderRadius: 0,
        clipPath: 'inset(0)',
      }}
    >
      {children}
    </LiquidGlass>
  )
}
