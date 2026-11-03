/**
 * Writing `~/.claude/settings.json`.
 *
 * Extracted from the IPC layer so the rules can be tested directly: which keys
 * a write may touch, what happens to a cleared value, and — the reason this
 * module exists at all — that a machine which has never run Claude Code has no
 * `~/.claude` directory to write into.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

import { CLAUDE_DIR, SETTINGS_LOCAL_PATH, SETTINGS_PATH } from '../utils/paths'

export interface ClaudeSettings {
  [key: string]: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }

  for (const key of Object.keys(source)) {
    if (isPlainObject(source[key]) && isPlainObject(result[key])) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      )
    } else {
      result[key] = source[key]
    }
  }

  return result
}

/**
 * Make sure `~/.claude` exists before writing into it.
 *
 * Claude Code creates that directory the first time it runs, so a machine that
 * has never run it — or a user who deleted it — has no `~/.claude` at all, and
 * every write here used to fail with a bare ENOENT. The panels that write
 * (API 配置, 模型管理) are exactly the ones a new user reaches first.
 */
function ensureClaudeDir(): void {
  mkdirSync(CLAUDE_DIR, { recursive: true })
}

export function readSettingsFile(path: string = SETTINGS_PATH): ClaudeSettings {
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, 'utf-8')
  return JSON.parse(raw) as ClaudeSettings
}

/** Merge `partial` into settings.json, keeping everything else. */
export function mergeSettings(
  partial: ClaudeSettings,
  path: string = SETTINGS_PATH,
): ClaudeSettings {
  ensureClaudeDir()
  const merged = deepMerge(readSettingsFile(path), partial)
  writeFileSync(path, JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

/** Write the local-override file the same way. */
export function mergeLocalSettings(partial: ClaudeSettings): ClaudeSettings {
  ensureClaudeDir()
  const merged = deepMerge(readSettingsFile(SETTINGS_LOCAL_PATH), partial)
  writeFileSync(SETTINGS_LOCAL_PATH, JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

/**
 * Write the per-tier model mapping.
 *
 * Separate from `mergeSettings` because clearing a tier has to *delete* its key:
 * merging would leave `ANTHROPIC_DEFAULT_OPUS_MODEL: ""` behind, which points
 * Claude Code at a model with an empty name instead of letting the endpoint's
 * own default apply.
 *
 * Only `ANTHROPIC_DEFAULT_*` keys are accepted — the renderer sends a map, and a
 * renderer that sent something else should not be able to write arbitrary
 * variables into the user's settings.
 */
export function writeTierModels(args: {
  tiers?: Record<string, string>
  defaultTier?: string
}): ClaudeSettings {
  ensureClaudeDir()

  const current = readSettingsFile()
  const env: Record<string, unknown> = {
    ...((current.env as Record<string, unknown> | undefined) ?? {}),
  }

  for (const [key, value] of Object.entries(args?.tiers ?? {})) {
    if (!key.startsWith('ANTHROPIC_DEFAULT_')) continue
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (trimmed) env[key] = trimmed
    else delete env[key]
  }

  const next: ClaudeSettings = { ...current, env }
  if (args?.defaultTier) next.model = args.defaultTier

  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf-8')
  return next
}
