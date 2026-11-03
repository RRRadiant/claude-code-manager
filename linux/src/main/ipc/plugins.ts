import { ipcMain } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'

import {
  INSTALLED_PLUGINS_PATH,
  KNOWN_MARKETPLACES_PATH,
  PLUGIN_CATALOG_CACHE_PATH,
  SETTINGS_PATH,
} from '../utils/paths'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single installation record for a plugin (v2 schema). */
interface InstalledPluginEntry {
  scope: string
  installPath: string
  version: string
  installedAt: string
  lastUpdated?: string
  gitCommitSha?: string
}

/** Shape of installed_plugins.json (version 2). */
interface InstalledPluginsFile {
  version: number
  plugins: Record<string, InstalledPluginEntry[]>
}

/** The shape returned by `plugins:list` for each plugin. */
interface PluginListItem {
  id: string
  name: string
  marketplace: string
  version: string
  scope: string
  enabled: boolean
  installPath: string
  installedAt: string
}

/** A registered marketplace entry. */
interface KnownMarketplace {
  name: string
  source: Record<string, unknown>
}

/** A plugin from the catalog cache. */
interface CatalogPlugin {
  name: string
  marketplace: string
  description: string
  version: string
  category?: string
  tags?: string[]
  author?: Record<string, unknown>
}

/** Marketplace source descriptor stored in settings.json. */
interface MarketplaceSourceEntry {
  source: {
    source: string
    repo: string
  }
}

/** Subset of settings.json fields this module touches. */
interface ClaudeSettings {
  [key: string]: unknown
  enabledPlugins?: Record<string, boolean>
  extraKnownMarketplaces?: Record<string, MarketplaceSourceEntry>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a plugin id of the form "name@marketplace" into its components.
 * Uses the *last* '@' as the delimiter so plugin names may safely contain '@'.
 */
function parsePluginId(pluginId: string): { name: string; marketplace: string } {
  const atIndex = pluginId.lastIndexOf('@')
  if (atIndex === -1) {
    return { name: pluginId, marketplace: '' }
  }
  return {
    name: pluginId.slice(0, atIndex),
    marketplace: pluginId.slice(atIndex + 1),
  }
}

function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

function readJsonOrNull<T = unknown>(path: string): T | null {
  if (!existsSync(path)) return null
  return readJson<T>(path)
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

/**
 * Register all plugin-related IPC handlers under the `plugins:` and
 * `marketplace:` channels.
 */
export function registerPluginsIpcHandlers(): void {
  // -----------------------------------------------------------------------
  // plugins:list
  // -----------------------------------------------------------------------
  ipcMain.handle('plugins:list', async (): Promise<{
    success: boolean
    data?: PluginListItem[]
    error?: string
  }> => {
    try {
      const installed: InstalledPluginsFile = readJsonOrNull<InstalledPluginsFile>(
        INSTALLED_PLUGINS_PATH,
      ) ?? { version: 2, plugins: {} }

      const settings: ClaudeSettings =
        readJsonOrNull<ClaudeSettings>(SETTINGS_PATH) ?? {}

      const enabledPlugins = settings.enabledPlugins ?? {}
      const result: PluginListItem[] = []

      for (const [pluginId, entries] of Object.entries(installed.plugins)) {
        const { name, marketplace } = parsePluginId(pluginId)
        for (const entry of entries) {
          result.push({
            id: pluginId,
            name,
            marketplace,
            version: entry.version,
            scope: entry.scope,
            enabled: enabledPlugins[pluginId] === true,
            installPath: entry.installPath,
            installedAt: entry.installedAt,
          })
        }
      }

      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // -----------------------------------------------------------------------
  // plugins:toggle
  // -----------------------------------------------------------------------
  ipcMain.handle(
    'plugins:toggle',
    async (
      _event,
      { pluginId, enabled }: { pluginId: string; enabled: boolean },
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const settings: ClaudeSettings =
          readJsonOrNull<ClaudeSettings>(SETTINGS_PATH) ?? {}

        if (!settings.enabledPlugins) {
          settings.enabledPlugins = {}
        }

        if (enabled) {
          settings.enabledPlugins[pluginId] = true
        } else {
          delete settings.enabledPlugins[pluginId]
        }

        writeJson(SETTINGS_PATH, settings)
        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  // -----------------------------------------------------------------------
  // plugins:uninstall
  // -----------------------------------------------------------------------
  ipcMain.handle(
    'plugins:uninstall',
    async (
      _event,
      { pluginId }: { pluginId: string },
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        // Remove from installed_plugins.json
        const installed = readJsonOrNull<InstalledPluginsFile>(INSTALLED_PLUGINS_PATH)
        if (installed && installed.plugins) {
          if (installed.plugins[pluginId]) {
            delete installed.plugins[pluginId]
          }
          writeJson(INSTALLED_PLUGINS_PATH, installed)
        }

        // Remove from enabledPlugins in settings.json
        const settings = readJsonOrNull<ClaudeSettings>(SETTINGS_PATH)
        if (settings?.enabledPlugins) {
          if (settings.enabledPlugins[pluginId]) {
            delete settings.enabledPlugins[pluginId]
          }
          writeJson(SETTINGS_PATH, settings)
        }

        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  // -----------------------------------------------------------------------
  // marketplace:list
  // -----------------------------------------------------------------------
  ipcMain.handle('marketplace:list', async (): Promise<{
    success: boolean
    data?: {
      marketplaces: KnownMarketplace[]
      plugins: CatalogPlugin[]
    }
    error?: string
  }> => {
    try {
      // Read known marketplaces
      let marketplaces: KnownMarketplace[] = []
      const rawMarketplaces = readJsonOrNull<unknown>(KNOWN_MARKETPLACES_PATH)
      if (Array.isArray(rawMarketplaces)) {
        marketplaces = rawMarketplaces as KnownMarketplace[]
      } else if (rawMarketplaces && typeof rawMarketplaces === 'object') {
        marketplaces = Object.entries(
          rawMarketplaces as Record<string, unknown>,
        ).map(([name, source]) => ({ name, source: source as Record<string, unknown> }))
      }

      // Read plugin catalog cache
      let catalogPlugins: CatalogPlugin[] = []
      const rawCatalog = readJsonOrNull<unknown>(PLUGIN_CATALOG_CACHE_PATH)
      if (Array.isArray(rawCatalog)) {
        catalogPlugins = rawCatalog as CatalogPlugin[]
      } else if (rawCatalog && typeof rawCatalog === 'object') {
        const obj = rawCatalog as Record<string, unknown>
        if (Array.isArray(obj.plugins)) {
          catalogPlugins = obj.plugins as CatalogPlugin[]
        }
      }

      return {
        success: true,
        data: { marketplaces, plugins: catalogPlugins },
      }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // -----------------------------------------------------------------------
  // marketplace:add-source
  // -----------------------------------------------------------------------
  ipcMain.handle(
    'marketplace:add-source',
    async (
      _event,
      { name, repo }: { name: string; repo: string },
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const settings: ClaudeSettings =
          readJsonOrNull<ClaudeSettings>(SETTINGS_PATH) ?? {}

        if (!settings.extraKnownMarketplaces) {
          settings.extraKnownMarketplaces = {}
        }

        settings.extraKnownMarketplaces[name] = {
          source: {
            source: 'github',
            repo,
          },
        }

        writeJson(SETTINGS_PATH, settings)
        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  // -----------------------------------------------------------------------
  // marketplace:remove-source
  // -----------------------------------------------------------------------
  ipcMain.handle(
    'marketplace:remove-source',
    async (
      _event,
      { name }: { name: string },
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const settings = readJsonOrNull<ClaudeSettings>(SETTINGS_PATH)
        if (settings?.extraKnownMarketplaces?.[name]) {
          delete settings.extraKnownMarketplaces[name]
          writeJson(SETTINGS_PATH, settings)
        }

        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )
}
