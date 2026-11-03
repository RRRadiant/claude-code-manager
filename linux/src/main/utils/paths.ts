import { homedir } from 'os'
import { join } from 'path'

/** Root Claude Code configuration directory */
export const CLAUDE_DIR = join(homedir(), '.claude')

/** Main settings file */
export const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json')

/** Local overrides (user-specific, not synced) */
export const SETTINGS_LOCAL_PATH = join(CLAUDE_DIR, 'settings.local.json')

/** Agent definitions directory */
export const AGENTS_DIR = join(CLAUDE_DIR, 'agents')

/** Commands / Skills directory */
export const COMMANDS_DIR = join(CLAUDE_DIR, 'commands')

/** Plugins directory */
export const PLUGINS_DIR = join(CLAUDE_DIR, 'plugins')

/** Installed plugins registry */
export const INSTALLED_PLUGINS_PATH = join(PLUGINS_DIR, 'installed_plugins.json')

/** Known marketplaces registry */
export const KNOWN_MARKETPLACES_PATH = join(PLUGINS_DIR, 'known_marketplaces.json')

/** Plugin catalog cache */
export const PLUGIN_CATALOG_CACHE_PATH = join(PLUGINS_DIR, 'plugin-catalog-cache.json')

/** Marketplace installs directory */
export const MARKETPLACES_DIR = join(PLUGINS_DIR, 'marketplaces')

/** Our app's own config */
export const APP_CONFIG_PATH = join(homedir(), '.claude-code-manager.json')
