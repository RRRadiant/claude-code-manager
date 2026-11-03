/**
 * Tests for the dependency installer.
 *
 * These cover the two things that were wrong in the shipped build: the command
 * it asked the user to trust (it piped a NodeSource setup script through sudo,
 * which needs a terminal of its own), and the fact that it ran at all in a
 * process with no terminal for sudo to prompt on.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildDependencyInstallPlan,
  renderInstallScript,
} from '../src/main/services/dependency-installer.ts'
import {
  emulatorArgv,
  launchScriptInTerminal,
  writeTempScript,
} from '../src/main/utils/terminal.ts'

const noBash = process.platform === 'win32'

// ---------------------------------------------------------------------------
// Building the command
// ---------------------------------------------------------------------------

describe('buildDependencyInstallPlan', () => {
  test('does nothing when nothing is missing', () => {
    const plan = buildDependencyInstallPlan([])
    assert.deepEqual(plan.packages, [])
    assert.equal(plan.command, null)
  })

  test('installs every missing package in one apt call', () => {
    const plan = buildDependencyInstallPlan(['git', 'npm'])
    assert.deepEqual(plan.packages, ['git', 'npm'])
    assert.equal(plan.command, 'sudo apt-get update && sudo apt-get install -y git npm')
  })

  test('deduplicates and sorts, so the same set always reads the same', () => {
    const plan = buildDependencyInstallPlan(['npm', 'git', 'npm', 'curl'])
    assert.deepEqual(plan.packages, ['curl', 'git', 'npm'])
  })

  test('ignores blank entries rather than passing them to apt', () => {
    const plan = buildDependencyInstallPlan(['git', '', '  '])
    assert.deepEqual(plan.packages, ['git'])
    assert.equal(plan.command, 'sudo apt-get update && sudo apt-get install -y git')
  })

  test('installs npm from the distribution, not from NodeSource', () => {
    // The previous version ran `curl … | sudo -E bash -` to add NodeSource's
    // repository. That needs a terminal to prompt on, adds a third-party apt
    // source to the user's machine, and is unnecessary: Kali's own npm is
    // current. Keep the command something the user can read and re-run.
    const plan = buildDependencyInstallPlan(['npm'])
    assert.equal(plan.command, 'sudo apt-get update && sudo apt-get install -y npm')
    assert.ok(!plan.command?.includes('nodesource'), 'must not reach for NodeSource')
    assert.ok(!plan.command?.includes('|'), 'must not pipe anything into a shell')
  })

  test('needs sudo only where a password is genuinely required', () => {
    const command = buildDependencyInstallPlan(['git']).command ?? ''
    assert.equal(command.match(/sudo/g)?.length, 2, 'apt-get update and install')
  })
})

// ---------------------------------------------------------------------------
// The script the terminal runs
// ---------------------------------------------------------------------------

describe('renderInstallScript', () => {
  test('lists the packages and the command it will run', () => {
    const plan = buildDependencyInstallPlan(['git', 'npm'])
    const script = renderInstallScript(plan)
    assert.ok(script.includes('git npm'), 'names the packages')
    assert.ok(script.includes(plan.command ?? ''), 'embeds the command verbatim')
  })

  test('holds the window open, because emulators share no hold flag', () => {
    const script = renderInstallScript(buildDependencyInstallPlan(['git']))
    assert.match(script.trimEnd(), /read -n 1 .*按任意键关闭此窗口/)
  })

  test('tells the user the password is not echoed', () => {
    const script = renderInstallScript(buildDependencyInstallPlan(['git']))
    assert.ok(script.includes('不会显示'))
  })

  test('points back at the app once it is done', () => {
    const script = renderInstallScript(buildDependencyInstallPlan(['git']))
    assert.ok(script.includes('重新检测'))
  })

  test('is valid bash', { skip: noBash ? 'bash is not available on Windows' : false }, () => {
    const cases = [
      buildDependencyInstallPlan(['git', 'npm', 'libfuse2']),
      buildDependencyInstallPlan([]),
    ]
    for (const plan of cases) {
      const result = spawnSync('bash', ['-n'], {
        input: renderInstallScript(plan),
        encoding: 'utf-8',
      })
      assert.equal(result.status, 0, `bash -n rejected the script: ${result.stderr}`)
    }
  })
})

// ---------------------------------------------------------------------------
// How the terminal is invoked
// ---------------------------------------------------------------------------

describe('emulatorArgv', () => {
  const KNOWN = [
    'x-terminal-emulator',
    'xfce4-terminal',
    'qterminal',
    'konsole',
    'mate-terminal',
    'gnome-terminal',
    'alacritty',
    'xterm',
  ]

  test('hands every emulator the script as a single token', () => {
    // One token means there is nothing for an emulator to split differently:
    // some shell-parse `-e`, some take argv, and the script path survives both.
    for (const program of KNOWN) {
      const argv = emulatorArgv(program, '/home/u/.local/share/x.sh')
      assert.ok(argv, `${program} must be in the table`)
      assert.equal(argv.length, 2, `${program} must receive exactly one argument`)
      assert.equal(argv[1], '/home/u/.local/share/x.sh')
    }
  })

  test('the script is the program, not an argument to one', () => {
    // `bash <path>` would need quoting for the emulators that split `-e`
    // themselves, and would break for the ones that do not split it at all.
    for (const program of KNOWN) {
      const argv = emulatorArgv(program, '/tmp/x.sh')
      assert.ok(!argv?.includes('bash'), `${program} must exec the script directly`)
      assert.ok(!argv?.includes('-lc'), `${program} must not need a shell wrapper`)
    }
  })

  test('returns null for an emulator it does not know', () => {
    assert.equal(emulatorArgv('not-a-terminal', '/tmp/x.sh'), null)
  })
})

describe('writeTempScript', () => {
  test(
    'writes an executable script that survives bash -n',
    { skip: noBash ? 'needs POSIX permissions' : false },
    () => {
      const content = renderInstallScript(buildDependencyInstallPlan(['git']))
      const file = writeTempScript('test-script', content)
      try {
        const mode = statSync(file).mode & 0o777
        // 0700, not 0755: the script is executed by its owner and may run apt as
        // root, so nobody else needs to read it.
        assert.equal(mode, 0o700, 'owner-executable, nothing more')
        assert.equal(readFileSync(file, 'utf-8'), content)
        assert.equal(spawnSync('bash', ['-n', file]).status, 0)
        assert.equal(spawnSync(file).status, 0, 'it must actually run')
      } finally {
        rmSync(file, { force: true })
      }
    },
  )
})

describe('launchScriptInTerminal', () => {
  let dir = ''
  const realPath = process.env.PATH

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ccm-terminal-test-'))
  })

  after(() => {
    process.env.PATH = realPath
    rmSync(dir, { recursive: true, force: true })
  })

  test(
    'starts the first emulator on PATH with the script',
    { skip: noBash ? 'needs a POSIX shell to fake an emulator' : false },
    async () => {
      const record = join(dir, 'argv.txt')
      // A stand-in for x-terminal-emulator that just records how it was called.
      const fake = join(dir, 'x-terminal-emulator')
      writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > ${record}\n`)
      chmodSync(fake, 0o755)
      process.env.PATH = `${dir}:${realPath}`

      const result = await launchScriptInTerminal('/tmp/ccm/x.sh')
      assert.equal(result.ok, true)
      assert.equal(result.terminal, 'x-terminal-emulator')

      // The spawn is detached, so give the child a moment to write.
      let argv = ''
      for (let i = 0; i < 40 && !argv; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        try {
          argv = readFileSync(record, 'utf-8')
        } catch {
          // not written yet
        }
      }
      assert.equal(argv.trim(), '-e\n/tmp/ccm/x.sh')
    },
  )
})
