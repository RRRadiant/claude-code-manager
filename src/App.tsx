import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
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
import { restartApp } from './services/tauri'

type PageId = 'home' | 'environment' | 'providers' | 'config' | 'mcp' | 'diagnostics' | 'updates' | 'settings' | 'about'

function App() {
  const { effectiveTheme, reducedMotion, reducedGlass, onboardingCompleted } = useAppStore(
    useShallow((s) => ({
      effectiveTheme: s.effectiveTheme,
      reducedMotion: s.reducedMotion,
      reducedGlass: s.reducedGlass,
      onboardingCompleted: s.onboardingCompleted,
    })),
  )
  const detect = useEnvironmentStore((s) => s.detect)
  const consoleAdd = useConsoleStore((s) => s.add)
  const setActiveTask = useConsoleStore((s) => s.setActiveTask)
  const setDownload = useConsoleStore((s) => s.setDownload)
  const [currentPage, setCurrentPage] = useState<PageId>('home')
  const [restartPrompt, setRestartPrompt] = useState(false)
  const [restartStage, setRestartStage] = useState<'base_environment' | 'claude_code'>('base_environment')
  const restartDialogRef = useRef<HTMLDivElement>(null)

  // Sync document attributes from global preferences.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effectiveTheme)
  }, [effectiveTheme])

  useEffect(() => {
    if (reducedMotion) document.documentElement.setAttribute('data-reduced-motion', 'true')
    else document.documentElement.removeAttribute('data-reduced-motion')
  }, [reducedMotion])

  useEffect(() => {
    if (reducedGlass) document.documentElement.setAttribute('data-reduced-glass', 'true')
    else document.documentElement.removeAttribute('data-reduced-glass')
  }, [reducedGlass])

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.slice(1) || 'home'
      if (isValidPage(hash)) setCurrentPage(hash as PageId)
    }
    handleHash()
    window.addEventListener('hashchange', handleHash)
    detect()

    // Subscribe to Tauri task events for the console panel + progress
    const timers: ReturnType<typeof setTimeout>[] = []
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
        setDownload(null)
        timers.push(setTimeout(() => setActiveTask(null), 3000))
      }
      if (p.status === 'Failed') {
        consoleAdd(`[${p.title}] ✗ 失败`, 'error')
        setActiveTask({ id: '', title: '', step: '', progress: 0, status: 'failed' })
        setDownload(null)
      }
    }).then(u => unsubs.push(u))

    // Listen for environment changes (after install completes)
    listen<void>('environment-changed', () => {
      consoleAdd('环境已变更，自动重新检测...', 'info')
      detect()
    }).then(u => unsubs.push(u))

    // Fine-grained download progress. Only the primary download (Node.js) is
    // shown: Node.js and Git run in parallel, and tracking both would make the
    // percentage oscillate. Cleared when the task leaves the running state.
    listen<{
      component: string; primary: boolean; percent: number
      speed_bytes_per_sec: number; downloaded_bytes: number; total_bytes: number
    }>('download-progress', e => {
      const p = e.payload
      if (!p.primary) return
      setDownload({
        component: p.component,
        percent: p.percent,
        speedBytesPerSec: p.speed_bytes_per_sec,
        downloadedBytes: p.downloaded_bytes,
        totalBytes: p.total_bytes,
      })
    }).then(u => unsubs.push(u))

    // Listen for restart-required. The backend tells us *why*, because the two
    // cases need different wording: the base environment is only half the job,
    // while a finished Claude Code install just is not visible to this process.
    listen<{ stage: 'base_environment' | 'claude_code' }>('restart-required', e => {
      const stage = e.payload?.stage ?? 'base_environment'
      setRestartStage(stage)
      consoleAdd(
        stage === 'claude_code'
          ? 'Claude Code 安装完成，需重启应用后才能检测到它'
          : 'Node.js 和 Git 安装完成，需重启应用后再安装 Claude Code',
        'success',
      )
      setRestartPrompt(true)
    }).then(u => unsubs.push(u))

    return () => {
      window.removeEventListener('hashchange', handleHash)
      timers.forEach(clearTimeout)
      unsubs.forEach(fn => fn())
    }
  }, [detect, consoleAdd, setActiveTask, setDownload])

  // Restart dialog: Esc close + initial focus.
  useEffect(() => {
    if (!restartPrompt) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRestartPrompt(false)
    }
    document.addEventListener('keydown', handleKey)
    restartDialogRef.current?.focus()
    return () => document.removeEventListener('keydown', handleKey)
  }, [restartPrompt])

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
        <div
          ref={restartDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="重启提示"
          tabIndex={-1}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
            outline: 'none',
          }}
        >
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 'var(--r3)',
            padding: 'var(--s5)', maxWidth: 400, width: '90%',
            boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
            textAlign: 'center',
          }}>
            <h3 style={{ marginBottom: 'var(--s2)' }}>
              {restartStage === 'claude_code' ? 'Claude Code 安装完成' : '基础环境安装完成'}
            </h3>
            {restartStage === 'claude_code' ? (
              <>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--s2)', lineHeight: 1.6 }}>
                  Claude Code 已安装成功。<br />
                  但当前进程仍无法检测到它，重启应用后即可识别。
                </p>
                <p style={{
                  fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
                  marginBottom: 'var(--s4)', lineHeight: 1.6,
                  padding: 'var(--s1)', borderRadius: 'var(--r2)',
                  background: 'rgba(10,132,255,0.06)',
                }}>
                  安装程序把 <code>claude</code> 命令写入了用户 PATH，而本应用使用的是启动时
                  继承的 PATH，无法自行更新。重启后「环境」页面即可正常显示 Claude Code。
                </p>
              </>
            ) : (
              <>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--s2)', lineHeight: 1.6 }}>
                  Node.js 和 Git 已成功安装。<br />
                  需要重启应用以加载新的环境变量，然后继续安装 Claude Code。
                </p>
                <p style={{
                  fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
                  marginBottom: 'var(--s4)', lineHeight: 1.6,
                  padding: 'var(--s1)', borderRadius: 'var(--r2)',
                  background: 'rgba(10,132,255,0.06)',
                }}>
                  重启后回到「环境」页面再点一次安装即可：Node.js 与 Git 会被自动跳过，
                  只完成 Claude Code。
                </p>
              </>
            )}
            <div style={{ display: 'flex', gap: 'var(--s1)', justifyContent: 'center' }}>
              <button className="btn" onClick={() => setRestartPrompt(false)} style={{ fontSize: 'var(--text-sm)' }}>
                稍后重启
              </button>
              <button className="btn btn-primary" onClick={async () => {
                setRestartPrompt(false)
                consoleAdd('正在重启应用...', 'info')
                try {
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
