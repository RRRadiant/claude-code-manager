import { useEffect, useState } from 'react'
import { useAppStore } from './stores/appStore'
import { useEnvironmentStore } from './stores/environmentStore'
import { useConsoleStore } from './stores/consoleStore'
import { GlassLayout } from './components/glass'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import ConsolePanel from './components/ConsolePanel'
import Onboarding from './components/Onboarding'
import HomePage from './pages/HomePage'
import EnvironmentPage from './pages/EnvironmentPage'
import ProvidersPage from './pages/ProvidersPage'
import ConfigPage from './pages/ConfigPage'
import McpPage from './pages/McpPage'
import DiagnosticsPage from './pages/DiagnosticsPage'
import UpdatesPage from './pages/UpdatesPage'
import SettingsPage from './pages/SettingsPage'
import AboutPage from './pages/AboutPage'
import { listen } from '@tauri-apps/api/event'

type PageId = 'home' | 'environment' | 'providers' | 'config' | 'mcp' | 'diagnostics' | 'updates' | 'settings' | 'about'

function App() {
  const { effectiveTheme, reducedMotion, reducedGlass, onboardingCompleted } = useAppStore()
  const { detect } = useEnvironmentStore()
  const { add: consoleAdd, setActiveTask } = useConsoleStore()
  const [currentPage, setCurrentPage] = useState<PageId>('home')
  const [restartPrompt, setRestartPrompt] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effectiveTheme)
    if (reducedMotion) document.documentElement.setAttribute('data-reduced-motion', 'true')
    if (reducedGlass) document.documentElement.setAttribute('data-reduced-glass', 'true')

    const handleHash = () => {
      const hash = window.location.hash.slice(1) || 'home'
      if (isValidPage(hash)) setCurrentPage(hash as PageId)
    }
    handleHash()
    window.addEventListener('hashchange', handleHash)
    detect()

    // Subscribe to Tauri task events for the console panel + progress
    const unsubs: (() => void)[] = []
    listen<{ id: string; status: string; title: string; current_step?: string; progress?: number }>('task-updated', e => {
      const p = e.payload
      if (p.current_step) consoleAdd(p.current_step, 'progress')

      if (p.status === 'Queued' || p.status === 'Running') {
        setActiveTask({
          id: p.id, title: p.title,
          step: p.current_step || '进行中...',
          progress: p.progress ?? 0,
          status: p.status === 'Running' ? 'running' : 'queued',
        })
      }

      if (p.status === 'Running') consoleAdd(`[${p.title}] 进行中...`, 'info')
      if (p.status === 'Success') {
        consoleAdd(`[${p.title}] ✓ 完成`, 'success')
        setActiveTask({ id: '', title: '', step: '', progress: 100, status: 'success' })
        setTimeout(() => setActiveTask(null), 3000)
      }
      if (p.status === 'Failed') {
        consoleAdd(`[${p.title}] ✗ 失败`, 'error')
        setActiveTask({ id: '', title: '', step: '', progress: 0, status: 'failed' })
      }
    }).then(u => unsubs.push(u))

    // Listen for environment changes (after install completes)
    listen<boolean>('environment-changed', () => {
      consoleAdd('环境已变更，自动重新检测...', 'info')
      detect()
    }).then(u => unsubs.push(u))

    // Listen for restart-required (base env installed, need restart for Claude Code)
    listen<boolean>('restart-required', () => {
      consoleAdd('Node.js 和 Git 安装完成，需要重启以继续安装 Claude Code', 'info')
      setRestartPrompt(true)
    }).then(u => unsubs.push(u))

    return () => {
      window.removeEventListener('hashchange', handleHash)
      unsubs.forEach(fn => fn())
    }
  }, [])

  return (
    <>
      {!onboardingCompleted && <Onboarding />}
      <GlassLayout
        sidebar={<Sidebar currentPage={currentPage} />}
        statusBar={<StatusBar />}
        consolePanel={<ConsolePanel />}
      >
        <div className="content-area">
          {currentPage === 'home' && <HomePage />}
          {currentPage === 'environment' && <EnvironmentPage />}
          {currentPage === 'providers' && <ProvidersPage />}
          {currentPage === 'config' && <ConfigPage />}
          {currentPage === 'mcp' && <McpPage />}
          {currentPage === 'diagnostics' && <DiagnosticsPage />}
          {currentPage === 'updates' && <UpdatesPage />}
          {currentPage === 'settings' && <SettingsPage />}
          {currentPage === 'about' && <AboutPage />}
        </div>
      </GlassLayout>

      {/* Restart dialog */}
      {restartPrompt && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 'var(--r3)',
            padding: 'var(--s5)', maxWidth: 400, width: '90%',
            boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
            textAlign: 'center',
          }}>
            <h3 style={{ marginBottom: 'var(--s2)' }}>基础环境安装完成</h3>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--s4)', lineHeight: 1.6 }}>
              Node.js 和 Git 已成功安装。<br />
              需要重启应用以加载最新环境变量，然后继续安装 Claude Code。
            </p>
            <div style={{ display: 'flex', gap: 'var(--s1)', justifyContent: 'center' }}>
              <button className="btn" onClick={() => setRestartPrompt(false)} style={{ fontSize: 'var(--text-sm)' }}>
                稍后重启
              </button>
              <button className="btn btn-primary" onClick={async () => {
                setRestartPrompt(false)
                consoleAdd('正在重启应用...', 'info')
                try {
                  const { restartApp } = await import('./services/tauri')
                  await restartApp()
                } catch { /* restart will close the app */ }
              }} style={{ fontSize: 'var(--text-sm)' }}>
                立即重启
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function isValidPage(s: string): s is PageId {
  return ['home','environment','providers','config','mcp','diagnostics','updates','settings','about'].includes(s)
}

export default App
