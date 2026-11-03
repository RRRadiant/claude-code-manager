/**
 * What this machine already has.
 *
 * A user arriving at this app usually already has Claude Code configured — a key
 * exported from their shell rc, a settings.json written by hand, MCP servers,
 * skills. The panels read `~/.claude/settings.json` directly, so most of that is
 * already visible. What is *not* visible is everything outside that one file: an
 * `ANTHROPIC_AUTH_TOKEN` exported in `~/.bashrc` wins over settings.json without
 * appearing anywhere in the UI, and the user is left wondering why the key they
 * can see in the panel is not the key in use.
 *
 * So this walks the known locations, reports what is there, and says which parts
 * the app cannot manage yet.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

import { detectSystem } from '../installer'
import type { ClaudeDetection } from '../installer/env'
import { shortcutStatus } from './desktop-shortcut'
import {
  AGENTS_DIR,
  CLAUDE_DIR,
  INSTALLED_PLUGINS_PATH,
  SETTINGS_LOCAL_PATH,
  SETTINGS_PATH,
} from '../utils/paths'

/** Claude Code's own state file: onboarding flag, project history, oauth. */
const CLAUDE_STATE_PATH = join(homedir(), '.claude.json')

/** Shell rc files worth reading, in the order a login shell would apply them. */
const RC_FILES = ['.bashrc', '.zshrc', '.profile', join('.config', 'fish', 'config.fish')]

/** Env vars that change how Claude Code talks to an endpoint. */
const INTERESTING_ENV = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
]

export interface ScannedFile {
  path: string
  role: string
  exists: boolean
  /** Human-readable one-liner about the contents, or null when absent. */
  summary: string | null
  /** Set when the file exists but could not be parsed. */
  error: string | null
}

export interface SettingsSummary {
  apiKeyPresent: boolean
  /** e.g. "sk-…9f2c" — never the whole value. */
  apiKeyMasked: string | null
  baseUrl: string | null
  provider: string | null
  defaultModel: string | null
  /** tier id -> model id, only for tiers that are set. */
  tierModels: Record<string, string>
  mcpServers: number
  hooks: number
  /** Value of env.ANTHROPIC_SELECTED_MODELS, as a list. */
  selectedModels: string[]
}

export interface ShellEnvFinding {
  name: string
  file: string
  masked: string
  /**
   * True when the rc line computes its value (`$(pass show …)`, `` `cmd` ``).
   * The literal text is not the value, so it is reported but never adopted.
   */
  dynamic: boolean
}

export interface ConfigScan {
  files: ScannedFile[]
  settings: SettingsSummary
  /** Vars exported from a shell rc, which settings.json cannot override. */
  shellEnv: ShellEnvFinding[]
  cli: ClaudeDetection
  counts: { skills: number; agents: number; plugins: number }
  /**
   * Where the desktop launcher is (or would be). Reported here so "there is no
   * icon on my desktop" can be answered without guessing: the path says whether
   * it went somewhere the session does not show, or was never written at all.
   */
  desktop: { available: boolean; path: string | null; exists: boolean }
}

/**
 * Show enough of a secret to recognise it, never enough to use it.
 *
 * The UI has no reason to display a key in full, and a scan result is exactly
 * the sort of thing that ends up in a screenshot or a bug report.
 */
function mask(value: string): string {
  const trimmed = value.trim().replace(/^["']|["']$/g, '')
  if (trimmed.length <= 8) return '****'
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function countEntries(dir: string): number {
  try {
    return readdirSync(dir).filter((name) => !name.startsWith('.')).length
  } catch {
    return 0
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function summarizeSettings(doc: Record<string, unknown> | null): SettingsSummary {
  const env = asRecord(doc?.env)
  const key = asString(env.ANTHROPIC_AUTH_TOKEN) ?? asString(env.ANTHROPIC_API_KEY)

  const tierModels: Record<string, string> = {}
  for (const [tier, envKey] of [
    ['haiku', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'],
    ['sonnet', 'ANTHROPIC_DEFAULT_SONNET_MODEL'],
    ['opus', 'ANTHROPIC_DEFAULT_OPUS_MODEL'],
  ] as const) {
    const value = asString(env[envKey])
    if (value) tierModels[tier] = value
  }

  return {
    apiKeyPresent: key !== null,
    apiKeyMasked: key ? mask(key) : null,
    baseUrl: asString(env.ANTHROPIC_BASE_URL),
    provider: asString(env.ANTHROPIC_PROVIDER),
    defaultModel: asString(doc?.model),
    tierModels,
    mcpServers: Object.keys(asRecord(doc?.mcpServers)).length,
    hooks: Object.keys(asRecord(doc?.hooks)).length,
    selectedModels: (asString(env.ANTHROPIC_SELECTED_MODELS) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }
}

/**
 * `export NAME=value` lines from the shell rc files.
 *
 * Only the first hit per variable is kept: a later duplicate is usually a
 * commented-out line or an override the user forgot about, and reporting one
 * value per name is what makes the result actionable.
 *
 * A line whose value is computed — `$(pass show …)`, `` `cmd` `` — is reported
 * with `dynamic: true` and never adopted: the text after `=` is a command, not
 * the secret, and copying it into settings.json would write the command itself
 * as the API key.
 */
function readShellEnv(): Array<{ name: string; file: string; raw: string; dynamic: boolean }> {
  const found = new Map<
    string,
    { name: string; file: string; raw: string; dynamic: boolean }
  >()

  for (const rel of RC_FILES) {
    const full = join(homedir(), rel)
    if (!existsSync(full)) continue

    let content: string
    try {
      content = readFileSync(full, 'utf-8')
    } catch {
      continue
    }

    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('#')) continue
      const match = /^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.+)$/.exec(trimmed)
      const name = match?.[1]
      const raw = match?.[2]
      if (!name || !raw) continue
      if (!INTERESTING_ENV.includes(name)) continue
      if (found.has(name)) continue

      const value = raw.trim().replace(/^["']|["']$/g, '')
      found.set(name, {
        name,
        file: `~/${rel}`,
        raw: value,
        dynamic: /[$`]/.test(value),
      })
    }
  }

  return [...found.values()]
}

/**
 * How many plugins are actually installed.
 *
 * Counted from the registry, not by listing `~/.claude/plugins`: that directory
 * also holds the registry itself, the marketplace cache and the cloned
 * repositories, so a directory count reports internal bookkeeping as plugins.
 */
function countPlugins(registryPath: string): number {
  const doc = readJson(registryPath)
  const plugins = doc?.plugins
  if (typeof plugins !== 'object' || plugins === null) return 0
  return Object.values(plugins as Record<string, unknown>).reduce<number>(
    (total, entries) => total + (Array.isArray(entries) ? entries.length : 0),
    0,
  )
}

export async function scanExistingConfig(): Promise<ConfigScan> {
  const settingsExists = existsSync(SETTINGS_PATH)
  const settingsDoc = settingsExists ? readJson(SETTINGS_PATH) : null

  const localExists = existsSync(SETTINGS_LOCAL_PATH)
  const localDoc = localExists ? readJson(SETTINGS_LOCAL_PATH) : null
  const stateExists = existsSync(CLAUDE_STATE_PATH)

  let stateSize: number | null = null
  if (stateExists) {
    try {
      stateSize = statSync(CLAUDE_STATE_PATH).size
    } catch {
      stateSize = null
    }
  }

  const files: ScannedFile[] = [
    {
      path: SETTINGS_PATH,
      role: '主配置 —— 本程序编辑的就是它，Claude Code 直接读',
      exists: settingsExists,
      summary: settingsExists ? (settingsDoc ? '已读取' : null) : null,
      error: settingsExists && !settingsDoc ? 'JSON 解析失败，文件可能被截断' : null,
    },
    {
      path: SETTINGS_LOCAL_PATH,
      role: '本地覆盖 —— 优先级高于主配置，不进版本库',
      exists: localExists,
      summary: localExists ? (localDoc ? '已读取' : null) : null,
      error: localExists && !localDoc ? 'JSON 解析失败' : null,
    },
    {
      path: CLAUDE_STATE_PATH,
      role: 'Claude Code 自身状态（登录、项目历史）—— 本程序不修改',
      exists: stateExists,
      summary: stateSize !== null ? `${(stateSize / 1024).toFixed(0)} KB` : null,
      error: null,
    },
    {
      path: INSTALLED_PLUGINS_PATH,
      role: '已安装插件登记表',
      exists: existsSync(INSTALLED_PLUGINS_PATH),
      summary: existsSync(INSTALLED_PLUGINS_PATH) ? '存在' : null,
      error: null,
    },
    {
      path: CLAUDE_DIR,
      role: '配置根目录（skills / agents / plugins 都在这里）',
      exists: existsSync(CLAUDE_DIR),
      summary: existsSync(CLAUDE_DIR) ? '存在' : null,
      error: null,
    },
  ]

  const system = await detectSystem()

  return {
    files,
    settings: summarizeSettings(settingsDoc),
    shellEnv: readShellEnv().map(({ name, file, raw, dynamic }) => ({
      name,
      file,
      masked: dynamic ? '（命令生成，未读取）' : mask(raw),
      dynamic,
    })),
    cli: system.claude,
    counts: {
      skills: countEntries(join(CLAUDE_DIR, 'commands')),
      agents: countEntries(AGENTS_DIR),
      plugins: countPlugins(INSTALLED_PLUGINS_PATH),
    },
    desktop: await shortcutStatus(),
  }
}

/**
 * Copy shell-rc environment variables into settings.json.
 *
 * The point is not to move them — the rc export stays where it is, and the user
 * can remove it themselves — but to make the app's view match what Claude Code
 * actually uses. Without this, a key exported in .bashrc is invisible here while
 * silently overriding whatever the API panel writes.
 *
 * Values are re-read from the rc file at adopt time rather than accepted from
 * the renderer, so only what is genuinely in the file gets written, and no
 * secret travels through the UI layer.
 */
export function adoptShellEnv(names: string[]): { adopted: string[]; skipped: string[] } {
  const byName = new Map(readShellEnv().map((f) => [f.name, f]))
  const adopted: string[] = []
  const skipped: string[] = []

  const doc = existsSync(SETTINGS_PATH) ? (readJson(SETTINGS_PATH) ?? {}) : {}
  const env = { ...asRecord(doc.env) }

  for (const name of names) {
    const finding = byName.get(name)
    // A command-generated value has no literal to copy; writing `$(pass show …)`
    // into settings.json would hand Claude Code the command as its API key.
    if (!finding || finding.dynamic) {
      skipped.push(name)
      continue
    }
    env[name] = finding.raw
    adopted.push(name)
  }

  if (adopted.length > 0) {
    // Claude Code creates ~/.claude on first run, so on a machine that has never
    // run it there is no directory to write into.
    mkdirSync(CLAUDE_DIR, { recursive: true })
    writeFileSync(SETTINGS_PATH, JSON.stringify({ ...doc, env }, null, 2), 'utf-8')
  }

  return { adopted, skipped }
}
