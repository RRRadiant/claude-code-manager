/**
 * Tests for the settings writes.
 *
 * The interesting cases are the ones a UI test cannot reach reliably: a machine
 * with no `~/.claude` at all, a cleared tier, and a renderer that sends a key it
 * has no business writing.
 *
 * HOME is redirected before the module is imported because `utils/paths.ts`
 * resolves SETTINGS_PATH at import time — hence the top-level await and the
 * POSIX-only skip (Windows `os.homedir()` reads USERPROFILE).
 */

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const homeSkip =
  process.platform === 'win32' ? 'HOME redirection is POSIX-only' : false

const home = mkdtempSync(join(tmpdir(), 'ccm-settings-'))
const realHome = process.env.HOME
process.env.HOME = home

const { mergeSettings, mergeLocalSettings, writeTierModels, readSettingsFile } = await import(
  '../src/main/services/settings-write.ts'
)

const SETTINGS = join(home, '.claude', 'settings.json')
const LOCAL = join(home, '.claude', 'settings.local.json')

const read = () => JSON.parse(readFileSync(SETTINGS, 'utf-8'))

before(() => {
  mkdirSync(home, { recursive: true })
})

after(() => {
  process.env.HOME = realHome
  rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(join(home, '.claude'), { recursive: true, force: true })
})

describe('settings writes', { skip: homeSkip }, () => {
  test('creates ~/.claude when the machine has never run Claude Code', () => {
    // The directory is created by Claude Code on first run, so a fresh machine
    // has none — and every write used to fail with a bare ENOENT.
    assert.equal(existsSync(join(home, '.claude')), false)

    writeTierModels({ tiers: { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-chat' } })

    assert.equal(existsSync(join(home, '.claude')), true)
    assert.equal(read().env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-chat')
  })

  test('mergeSettings creates the directory too', () => {
    mergeSettings({ env: { ANTHROPIC_BASE_URL: 'https://x.example.com' } })
    assert.equal(read().env.ANTHROPIC_BASE_URL, 'https://x.example.com')
  })

  test('clearing a tier deletes the key rather than storing an empty model', () => {
    writeTierModels({
      tiers: {
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-chat',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-reasoner',
      },
    })
    assert.deepEqual(Object.keys(read().env).sort(), [
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
    ])

    writeTierModels({
      tiers: {
        ANTHROPIC_DEFAULT_HAIKU_MODEL: '   ',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-reasoner',
      },
    })

    const env = read().env
    assert.equal('ANTHROPIC_DEFAULT_HAIKU_MODEL' in env, false)
    assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'deepseek-reasoner')
  })

  test('keeps every unrelated key', () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(
      SETTINGS,
      JSON.stringify({
        model: 'sonnet',
        env: { ANTHROPIC_AUTH_TOKEN: 'sk-keep', ANTHROPIC_BASE_URL: 'https://keep' },
        mcpServers: { fs: { command: 'npx' } },
        permissions: { allow: ['Bash'] },
      }),
      'utf-8',
    )

    writeTierModels({
      tiers: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-chat' },
      defaultTier: 'opus',
    })

    const after = read()
    assert.equal(after.env.ANTHROPIC_AUTH_TOKEN, 'sk-keep')
    assert.equal(after.env.ANTHROPIC_BASE_URL, 'https://keep')
    assert.equal(after.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'deepseek-chat')
    assert.equal(after.model, 'opus')
    assert.deepEqual(after.mcpServers, { fs: { command: 'npx' } })
    assert.deepEqual(after.permissions, { allow: ['Bash'] })
  })

  test('refuses to write a variable it does not own', () => {
    writeTierModels({
      tiers: {
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'ok',
        LD_PRELOAD: '/tmp/evil.so',
        ANTHROPIC_AUTH_TOKEN: 'sk-injected',
      },
    })

    const env = read().env
    assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'ok')
    assert.equal('LD_PRELOAD' in env, false)
    // The token is not a tier key; the tier writer must not touch credentials.
    assert.equal('ANTHROPIC_AUTH_TOKEN' in env, false)
  })

  test('trims the value it stores', () => {
    writeTierModels({ tiers: { ANTHROPIC_DEFAULT_HAIKU_MODEL: '  spaced-model  ' } })
    assert.equal(read().env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'spaced-model')
  })

  test('writes the local override file to its own path', () => {
    mergeLocalSettings({ env: { API_TIMEOUT_MS: '600000' } })
    const local = JSON.parse(readFileSync(LOCAL, 'utf-8'))
    assert.equal(local.env.API_TIMEOUT_MS, '600000')
    assert.equal(existsSync(SETTINGS), false, 'the main file is untouched')
  })

  test('readSettingsFile returns empty for a missing file and throws on junk', () => {
    assert.deepEqual(readSettingsFile(), {})
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(SETTINGS, '{ "env": ', 'utf-8')
    assert.throws(() => readSettingsFile(), /JSON/)
  })
})
