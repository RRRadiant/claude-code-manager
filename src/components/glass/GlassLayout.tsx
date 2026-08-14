import { type ReactNode } from 'react'
import { LiquidGlass } from '@creativoma/liquid-glass'

interface GlassLayoutProps {
  children: ReactNode
  sidebar?: ReactNode
  sidebarWidth?: number
  statusBar?: ReactNode
  consolePanel?: ReactNode
}

export function GlassLayout({
  children, sidebar, sidebarWidth = 220, statusBar, consolePanel,
}: GlassLayoutProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `${sidebarWidth}px 1fr`,
      gridTemplateRows: '1fr auto auto',  // main, console, status
      height: '100vh', width: '100vw',
      overflow: 'hidden',
    }}>
      {sidebar}
      <LiquidGlass
        as="main"
        backdropBlur={2}
        tintColor="rgba(255,255,255,0.03)"
        className="liquid-glass"
        style={{
          overflow: 'auto', padding: 'var(--s5)',
          borderRadius: 0, clipPath: 'inset(0)',
        }}
      >
        {children}
      </LiquidGlass>
      <div />
      {consolePanel}
      {statusBar}
    </div>
  )
}
