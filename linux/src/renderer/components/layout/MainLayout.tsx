import { useState, useEffect, useRef } from 'react'
import { Sidebar } from './Sidebar'
import { Onboarding } from '../onboarding/Onboarding'
import type { GuidePanel } from '../onboarding/Onboarding'
import { EnvironmentPanel } from '../environment/EnvironmentPanel'
import { ApiConfigPanel } from '../api-config/ApiConfigPanel'
import { ModelManager } from '../model-manager/ModelManager'
import { GeneralSettings } from '../settings/GeneralSettings'
import { SkillsList } from '../skills-manager/SkillsList'
import { SkillEditor } from '../skills-manager/SkillEditor'
import { AgentsList } from '../agents-manager/AgentsList'
import { AgentEditor } from '../agents-manager/AgentEditor'
import { PluginsList } from '../plugins-manager/PluginsList'
import { PluginDetail } from '../plugins-manager/PluginDetail'
import { MarketplaceBrowser } from '../plugins-manager/MarketplaceBrowser'
import { HooksList } from '../hooks-manager/HooksList'
import { HookEditor } from '../hooks-manager/HookEditor'
import { McpServersList } from '../mcp-manager/McpServersList'
import { McpServerEditor } from '../mcp-manager/McpServerEditor'
import { ConfigFileEditor } from '../settings/ConfigFileEditor'
import { useAppStore } from '../../stores/appStore'

/**
 * Panels the sidebar can select.
 *
 * Used to validate a restored value: a state file written by an older build (or
 * hand-edited) could name a panel that no longer exists, which would render an
 * empty content area with no way to tell why.
 */
const PANEL_IDS = [
  'environment',
  'api',
  'models',
  'skills',
  'agents',
  'hooks',
  'mcp',
  'plugins',
  'settings',
  'config-files',
] as const

type PanelId = (typeof PANEL_IDS)[number]

const isPanelId = (value: unknown): value is PanelId =>
  typeof value === 'string' && (PANEL_IDS as readonly string[]).includes(value)

/** Distinguishes "user picked a panel" from "state finished loading". */
const NO_PANEL = '__none__'

export function MainLayout(): React.ReactElement {
  // The environment panel is the entry point for a fresh install: it is where
  // setup starts and the only panel that can make the rest of the app work.
  // A returning user gets whichever panel they were last on.
  const [activePanel, setActivePanel] = useState<PanelId>('environment')
  const [ready, setReady] = useState(false)

  const onboardingOpen = useAppStore((s) => s.onboardingOpen)
  const openOnboarding = useAppStore((s) => s.openOnboarding)
  const closeOnboarding = useAppStore((s) => s.closeOnboarding)
  const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted)

  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null)
  const [showMarketplace, setShowMarketplace] = useState(false)
  const [selectedHook, setSelectedHook] = useState<{ event: string; index: number | null } | null>(null)
  const [selectedMcpServer, setSelectedMcpServer] = useState<string | null>(null)

  // Tracks the last panel written to disk.
  //
  // Initialised to a sentinel so the *first* run of the persistence effect is a
  // no-op. Persisting on mount would immediately overwrite whatever panel the
  // state file already held with the hardcoded default — the restored value
  // would be written back over itself before it could ever be shown.
  const persistedPanel = useRef<string>(NO_PANEL)

  // Restore the panel and decide whether the guide runs.
  //
  // The app no longer routes through a blocking wizard: the interface is always
  // the interface, and the first-run guide is an overlay on top of it. Existing
  // installs recorded the old wizard's completion, which is taken as "already
  // guided" so an upgrade does not replay the tour.
  useEffect(() => {
    (async () => {
      try {
        const state = await window.electronAPI.getAppState()

        if (isPanelId(state?.activePanel)) {
          setActivePanel(state.activePanel)
          persistedPanel.current = state.activePanel
        }

        const guided = state?.onboardingCompleted === true || state?.wizardCompleted === true
        setOnboardingCompleted(guided)
        if (!guided) openOnboarding()
        else if (state?.onboardingCompleted !== true) {
          // Migrated from the old flag: record the new one so the answer is not
          // recomputed on every launch.
          void window.electronAPI.setAppState({ onboardingCompleted: true })
        }
      } catch {
        openOnboarding()
      }
      setReady(true)
    })()
  }, [openOnboarding, setOnboardingCompleted])

  // Persist the panel once the user actually chooses one.
  useEffect(() => {
    if (persistedPanel.current === NO_PANEL) return
    if (persistedPanel.current === activePanel) return
    persistedPanel.current = activePanel
    // Fire and forget: a failure here must not break navigation, and the next
    // selection will retry with the newer value.
    void window.electronAPI.setAppState({ activePanel }).catch(() => undefined)
  }, [activePanel])

  const handlePanelChange = (id: string) => {
    if (!isPanelId(id)) return
    setActivePanel(id)
    // Reset sub-navigation when switching panels
    if (id !== 'skills') setSelectedSkill(null)
    if (id !== 'agents') setSelectedAgent(null)
    if (id !== 'plugins') { setSelectedPlugin(null); setShowMarketplace(false) }
    if (id !== 'hooks') setSelectedHook(null)
    if (id !== 'mcp') setSelectedMcpServer(null)
  }

  const handleGuideNavigate = (panel: GuidePanel) => handlePanelChange(panel)

  const handleGuideClose = () => {
    closeOnboarding()
    if (!useAppStore.getState().onboardingCompleted) {
      setOnboardingCompleted(true)
      void window.electronAPI.setAppState({ onboardingCompleted: true })
    }
  }

  if (!ready) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--color-bg)',
        }}
      >
        <div
          className="spin"
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            border: '2px solid var(--color-accent)',
            borderTopColor: 'transparent',
          }}
        />
      </div>
    )
  }

  const panelContent = (
    <>
      {activePanel === 'environment' && <EnvironmentPanel />}
      {activePanel === 'api' && <ApiConfigPanel />}
      {activePanel === 'models' && <ModelManager />}
      {activePanel === 'settings' && <GeneralSettings />}
      {activePanel === 'config-files' && <ConfigFileEditor />}

      {activePanel === 'skills' &&
        (selectedSkill ? (
          <SkillEditor filename={selectedSkill} onBack={() => setSelectedSkill(null)} />
        ) : (
          <SkillsList onSelect={(f) => setSelectedSkill(f)} />
        ))}

      {activePanel === 'agents' &&
        (selectedAgent ? (
          <AgentEditor filename={selectedAgent} onBack={() => setSelectedAgent(null)} />
        ) : (
          <AgentsList onSelect={(f) => setSelectedAgent(f)} />
        ))}

      {activePanel === 'plugins' &&
        (showMarketplace ? (
          <MarketplaceBrowser onBack={() => setShowMarketplace(false)} />
        ) : selectedPlugin ? (
          <PluginDetail pluginId={selectedPlugin} onBack={() => setSelectedPlugin(null)} />
        ) : (
          <PluginsList
            onSelect={(id) => setSelectedPlugin(id)}
            onBrowseMarketplace={() => setShowMarketplace(true)}
          />
        ))}

      {activePanel === 'hooks' &&
        (selectedHook ? (
          <HookEditor
            event={selectedHook.event}
            index={selectedHook.index}
            onBack={() => setSelectedHook(null)}
          />
        ) : (
          <HooksList
            onSelect={(event, index) => setSelectedHook({ event, index: index === -1 ? null : index })}
          />
        ))}

      {activePanel === 'mcp' &&
        (selectedMcpServer ? (
          <McpServerEditor
            serverName={selectedMcpServer}
            onBack={() => setSelectedMcpServer(null)}
          />
        ) : (
          <McpServersList
            onSelect={(name) => setSelectedMcpServer(name)}
            onAdd={() => setSelectedMcpServer('__new__')}
          />
        ))}
    </>
  )

  return (
    <>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Sidebar activeId={activePanel} onSelect={handlePanelChange} />
        {/*
          Padding lives here, not in each panel.
          It used to be a `p-8` on <main>; an earlier revision of this refactor
          moved it onto a `.page` class that only the restyled Environment panel
          used, which left every other panel rendering flush against the window
          edge. Owning it in the layout keeps all ten panels consistent.
        */}
        <main style={{ flex: 1, overflowY: 'auto', background: 'var(--color-bg)' }}>
          <div style={{ padding: '26px 30px 44px' }}>{panelContent}</div>
        </main>
      </div>

      {onboardingOpen && (
        <Onboarding onNavigate={handleGuideNavigate} onClose={handleGuideClose} />
      )}
    </>
  )
}
