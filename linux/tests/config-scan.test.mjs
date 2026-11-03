/**
 * Tests for the existing-config scan and the shell-env adopt action.
 *
 * Both read the user's home directory, so each test builds a throwaway HOME and
 * imports the module *after* pointing `$HOME` at it — `utils/paths.ts` resolves
 * its constants at import time, which is also why this cannot use a static
 * import at the top of the file.
 */

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// os.homedir() reads USERPROFILE on Windows, so redirecting HOME only works
// on POSIX — and the module under test resolves its paths from homedir().
const homeSkip =
  process.platform === 'win32' ? 'HOME redirection is POSIX-only' : false

// A throwaway home, installed *before* the module under test is imported:
// `utils/paths.ts` resolves SETTINGS_PATH and friends at import time, so this is
// the only moment at which the location can be redirected. Top-level await is
// what makes that possible without a bundler-hostile dynamic import.
const home = mkdtempSync(join(tmpdir(), 'ccm-home-'))
const realHome = process.env.HOME
process.env.HOME = home

const { scanExistingConfig, adoptShellEnv } = await import(
  '../src/main/services/config-scan.ts'
)

function writeSettings(doc) {
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(doc, null, 2))
}

function readSettings() {
  return JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf-8'))
}

before(() => {
  mkdirSync(home, { recursive: true })
})

after(() => {
  process.env.HOME = realHome
  rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(join(home, '.claude'), { recursive: true, force: true })
  rmSync(join(home, '.bashrc'), { force: true })
})

describe('scanExistingConfig', { skip: homeSkip }, () => {
  test('reports a missing configuration rather than failing', async () => {
    
    const scan = await scanExistingConfig()

    assert.equal(scan.settings.apiKeyPresent, false)
    assert.equal(scan.settings.apiKeyMasked, null)
    const settingsFile = scan.files.find((f) => f.path.endsWith('.claude/settings.json'))
    assert.equal(settingsFile.exists, false)
    assert.deepEqual(scan.shellEnv, [])
  })

  test('summarises what settings.json holds, with the key masked', async () => {
    writeSettings({
      model: 'opus',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'sk-ant-api03-abcdefghijklmnop',
        ANTHROPIC_BASE_URL: 'https://proxy.example.com',
        ANTHROPIC_PROVIDER: 'custom',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-chat',
        ANTHROPIC_SELECTED_MODELS: 'deepseek-chat, deepseek-reasoner',
      },
      mcpServers: { fs: {}, git: {} },
      hooks: { PreToolUse: [] },
    })

    
    const scan = await scanExistingConfig()

    assert.equal(scan.settings.apiKeyPresent, true)
    assert.ok(!scan.settings.apiKeyMasked.includes('abcdefghij'), 'must not leak the key')
    assert.match(scan.settings.apiKeyMasked, /^sk-…/)
    assert.equal(scan.settings.baseUrl, 'https://proxy.example.com')
    assert.equal(scan.settings.defaultModel, 'opus')
    assert.deepEqual(scan.settings.tierModels, { haiku: 'deepseek-chat' })
    assert.deepEqual(scan.settings.selectedModels, ['deepseek-chat', 'deepseek-reasoner'])
    assert.equal(scan.settings.mcpServers, 2)
    assert.equal(scan.settings.hooks, 1)
  })

  test('flags a settings.json that cannot be parsed', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', 'settings.json'), '{ "env": ')

    
    const scan = await scanExistingConfig()

    const settingsFile = scan.files.find((f) => f.path.endsWith('.claude/settings.json'))
    assert.equal(settingsFile.exists, true)
    assert.match(settingsFile.error ?? '', /解析失败/)
  })

  test('finds ANTHROPIC_* exported from a shell rc, which settings.json cannot override', async () => {
    writeFileSync(
      join(home, '.bashrc'),
      [
        '# my notes about ANTHROPIC_BASE_URL',
        'export EDITOR=vim',
        'export ANTHROPIC_AUTH_TOKEN="sk-ant-SECRETMIDDLE-9f2c"',
        'ANTHROPIC_BASE_URL=https://from-bashrc.example.com',
        'export ANTHROPIC_AUTH_TOKEN="ignored-duplicate"',
      ].join('\n'),
    )

    const scan = await scanExistingConfig()

    const byName = Object.fromEntries(scan.shellEnv.map((f) => [f.name, f]))
    assert.deepEqual(Object.keys(byName).sort(), ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'])
    assert.equal(byName.ANTHROPIC_AUTH_TOKEN.file, '~/.bashrc')
    // Masking keeps the first three and last four characters — enough to
    // recognise a key, not enough to use it. The middle is what must not escape.
    assert.ok(
      !byName.ANTHROPIC_AUTH_TOKEN.masked.includes('SECRETMIDDLE'),
      'the middle of a secret must not be echoed back',
    )
    assert.ok(!('EDITOR' in byName), 'only endpoint variables are interesting')
  })
})

describe('adoptShellEnv', { skip: homeSkip }, () => {
  test(
    'copies the values into settings.json and keeps everything else',
    async () => {
      writeSettings({
        model: 'sonnet',
        env: { ANTHROPIC_SELECTED_MODELS: 'a,b' },
        mcpServers: { fs: {} },
      })
      writeFileSync(
        join(home, '.bashrc'),
        'export ANTHROPIC_AUTH_TOKEN=sk-real-value\n',
      )

      const result = adoptShellEnv(['ANTHROPIC_AUTH_TOKEN'])

      assert.deepEqual(result.adopted, ['ANTHROPIC_AUTH_TOKEN'])
      assert.deepEqual(result.skipped, [])

      const after = readSettings()
      assert.equal(after.env.ANTHROPIC_AUTH_TOKEN, 'sk-real-value')
      assert.equal(after.env.ANTHROPIC_SELECTED_MODELS, 'a,b', 'existing env survives')
      assert.equal(after.model, 'sonnet', 'unrelated keys survive')
      assert.deepEqual(after.mcpServers, { fs: {} })
    },
  )

  test('skips a variable that is not in any rc file', async () => {
    writeSettings({ env: {} })
    const result = adoptShellEnv(['ANTHROPIC_BASE_URL'])
    assert.deepEqual(result.adopted, [])
    assert.deepEqual(result.skipped, ['ANTHROPIC_BASE_URL'])
  })

  test('refuses to write a variable it does not manage', async () => {
    writeSettings({ env: {} })
    const result = adoptShellEnv(['LD_PRELOAD'])
    assert.deepEqual(result.adopted, [])
    assert.deepEqual(result.skipped, ['LD_PRELOAD'])
    assert.deepEqual(readSettings().env, {})
  })
})
