/**
 * Tests for where the desktop launcher goes.
 *
 * The bug these exist for: when none of the sources answered, the resolver
 * invented `~/Desktop`. On a Chinese session the visible desktop is `~/桌面`, so
 * the launcher landed in a folder nobody looks at — while the app happily
 * reported 桌面图标已就绪, and the next run preferred `Desktop` again because it
 * now existed. A wrong answer that looks like success is worse than no answer.
 */

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  chooseDesktopDir,
  createShortcut,
  desktopDirs,
  parseUserDirsDesktop,
} from '../src/main/services/desktop-shortcut.ts'

const HOME = '/home/kali'
const homeSkip = process.platform === 'win32' ? 'HOME redirection is POSIX-only' : false

describe('chooseDesktopDir', () => {
  test('uses the configured answer when it exists', () => {
    assert.equal(
      chooseDesktopDir({
        configured: ['/home/kali/桌面', null, null],
        existingStandard: [`${HOME}/桌面`],
        locale: 'zh_CN.UTF-8',
      }),
      `${HOME}/桌面`,
    )
  })

  test('falls through a configured answer that does not exist', () => {
    // xdg-user-dir prints $HOME/Desktop when no config exists, which is not an
    // answer if that directory has never been created.
    //
    // The absent path is deliberately one that cannot exist anywhere. An earlier
    // version of this test used `${HOME}/Desktop` — true on a developer's Windows
    // box, but false on the packaging machine, where running the postinst tests
    // creates a real `/home/kali/Desktop`. `chooseDesktopDir` consults the disk
    // through `looksUsable`, so the literal won and the assertion flipped. A test
    // that depends on which directories happen to exist on the machine running it
    // is not a test; this one now stands on its own.
    assert.equal(
      chooseDesktopDir({
        configured: ['/ccm-no-such-user/Desktop', `${HOME}/桌面`, null],
        existingStandard: [`${HOME}/桌面`],
        locale: 'zh_CN.UTF-8',
      }),
      `${HOME}/桌面`,
    )
  })

  test('needs no guessing when only one standard directory exists', () => {
    assert.equal(
      chooseDesktopDir({ configured: [null], existingStandard: [`${HOME}/Desktop`], locale: 'en_US.UTF-8' }),
      `${HOME}/Desktop`,
    )
    assert.equal(
      chooseDesktopDir({ configured: [null], existingStandard: [`${HOME}/桌面`], locale: 'en_US.UTF-8' }),
      `${HOME}/桌面`,
    )
  })

  test('lets the locale break a tie between both standard directories', () => {
    const both = [`${HOME}/Desktop`, `${HOME}/桌面`]
    assert.equal(
      chooseDesktopDir({ configured: [null], existingStandard: both, locale: 'zh_CN.UTF-8' }),
      `${HOME}/桌面`,
    )
    assert.equal(
      chooseDesktopDir({ configured: [null], existingStandard: both, locale: 'en_US.UTF-8' }),
      `${HOME}/Desktop`,
    )
  })

  test('returns nothing rather than inventing ~/Desktop', () => {
    // This is the regression: a guess here is invisible to the session and the
    // app reports success forever.
    assert.equal(
      chooseDesktopDir({ configured: [null, null, null], existingStandard: [], locale: 'zh_CN.UTF-8' }),
      null,
    )
    assert.equal(
      chooseDesktopDir({ configured: ['   '], existingStandard: [], locale: 'en_US.UTF-8' }),
      null,
    )
  })

  test('ignores an empty or whitespace answer from a source', () => {
    assert.equal(
      chooseDesktopDir({ configured: ['', '  ', null], existingStandard: [`${HOME}/Desktop`], locale: 'C' }),
      `${HOME}/Desktop`,
    )
  })
})

describe('parseUserDirsDesktop', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-userdirs-'))

  const write = (content) => {
    const file = join(dir, 'user-dirs.dirs')
    writeFileSync(file, content, 'utf-8')
    return file
  }

  test('expands $HOME and ${HOME}', () => {
    assert.equal(
      parseUserDirsDesktop(write('XDG_DESKTOP_DIR="$HOME/桌面"\n'), HOME),
      `${HOME}/桌面`,
    )
    assert.equal(
      parseUserDirsDesktop(write('XDG_DESKTOP_DIR="${HOME}/Desktop"\n'), HOME),
      `${HOME}/Desktop`,
    )
  })

  test('tolerates the spacing and comments of a real file', () => {
    const file = write(
      ['# Written by xdg-user-dirs-update', 'XDG_DESKTOP_DIR = "$HOME/桌面"', 'XDG_DOWNLOAD_DIR="$HOME/下载"'].join('\n'),
    )
    assert.equal(parseUserDirsDesktop(file, HOME), `${HOME}/桌面`)
  })

  test('returns null when the variable or the file is missing', () => {
    assert.equal(parseUserDirsDesktop(write('XDG_DOWNLOAD_DIR="$HOME/下载"\n'), HOME), null)
    assert.equal(parseUserDirsDesktop(join(dir, 'nope.dirs'), HOME), null)
  })

  test('does not expand a variable it does not understand', () => {
    // Better a path that fails the existence check than one that silently
    // points somewhere else.
    const file = write('XDG_DESKTOP_DIR="$XDG_DATA_HOME/桌面"\n')
    assert.equal(parseUserDirsDesktop(file, HOME), '$XDG_DATA_HOME/桌面')
  })

  // Registered as a hook: a bare call here would run while the file is being
  // collected, deleting the directory before the first test needs it.
  after(() => rmSync(dir, { recursive: true, force: true }))
})

describe('desktopDirs', { skip: homeSkip }, () => {
  /** A throwaway home with whichever desktop directories the case needs. */
  const withHome = async (dirs, userDirsContent, fn) => {
    const fake = mkdtempSync(join(tmpdir(), 'ccm-desktop-'))
    for (const name of dirs) mkdirSync(join(fake, name), { recursive: true })
    if (userDirsContent) {
      mkdirSync(join(fake, '.config'), { recursive: true })
      writeFileSync(join(fake, '.config', 'user-dirs.dirs'), userDirsContent, 'utf-8')
    }

    const previous = process.env.HOME
    const previousXdg = process.env.XDG_DESKTOP_DIR
    process.env.HOME = fake
    delete process.env.XDG_DESKTOP_DIR
    try {
      return await fn(fake)
    } finally {
      process.env.HOME = previous
      if (previousXdg !== undefined) process.env.XDG_DESKTOP_DIR = previousXdg
      rmSync(fake, { recursive: true, force: true })
    }
  }

  test('lists both directories, the configured one first', async () => {
    // A session reads user-dirs.dirs once at login, so after a locale change the
    // configured directory and the one on screen are different — and the app
    // cannot tell which. Writing to both is what removes the guess.
    await withHome(['Desktop', '桌面'], 'XDG_DESKTOP_DIR="$HOME/桌面"\n', async (fake) => {
      assert.deepEqual(await desktopDirs(), [join(fake, '桌面'), join(fake, 'Desktop')])
    })
  })

  test('skips a configured directory that does not exist', async () => {
    await withHome(['Desktop'], 'XDG_DESKTOP_DIR="$HOME/桌面"\n', async (fake) => {
      assert.deepEqual(await desktopDirs(), [join(fake, 'Desktop')])
    })
  })

  test('returns nothing when there is no desktop directory at all', async () => {
    await withHome([], null, async () => {
      assert.deepEqual(await desktopDirs(), [])
    })
  })

  test('createShortcut writes into every one of them', async () => {
    await withHome(['Desktop', '桌面'], 'XDG_DESKTOP_DIR="$HOME/桌面"\n', async (fake) => {
      const result = await createShortcut()

      assert.equal(result.paths.length, 2)
      for (const name of ['桌面', 'Desktop']) {
        const file = join(fake, name, 'claude-code-manager.desktop')
        assert.ok(existsSync(file), `${name} should have the launcher`)
        assert.match(readFileSync(file, 'utf-8'), /\[Desktop Entry\]/)
      }
    })
  })
})
