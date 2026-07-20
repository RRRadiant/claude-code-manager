// Claude Code Manager - Main application shell with routing
import { useEffect, useState } from 'react'
import { useAppStore } from './stores/appStore'
import { useEnvironmentStore } from './stores/environmentStore'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
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

type PageId = 'home' | 'environment' | 'providers' | 'config' | 'mcp' | 'diagnostics' | 'updates' | 'settings' | 'about'

function App() {
  const { effectiveTheme, reducedMotion, reducedGlass, onboardingCompleted } = useAppStore()
  const { detect } = useEnvironmentStore()
  const [currentPage, setCurrentPage] = useState<PageId>('home')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effectiveTheme)
    if (reducedMotion) document.documentElement.setAttribute('data-reduced-motion', 'true')
    if (reducedGlass) document.documentElement.setAttribute('data-reduced-glass', 'true')

    // Handle hash-based routing
    const handleHash = () => {
      const hash = window.location.hash.slice(1) || 'home'
      if (isValidPage(hash)) setCurrentPage(hash as PageId)
    }
    handleHash()
    window.addEventListener('hashchange', handleHash)
    detect()
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  return (
    <>
      {!onboardingCompleted && <Onboarding />}
      <div className="app-shell">
      <Sidebar currentPage={currentPage} />
      <main className="main-content">
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
      </main>
      <StatusBar />
      </div>
    </>
  )
}

function isValidPage(s: string): s is PageId {
  return ['home','environment','providers','config','mcp','diagnostics','updates','settings','about'].includes(s)
}

export default App
