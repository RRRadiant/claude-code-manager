/**
 * The desktop launcher.
 *
 * The .deb's postinst creates this at install time, but postinst runs as root
 * and has to work out which user asked for the install. When that guess fails —
 * a GUI front-end, a root shell, a provisioning script — the user is left with
 * no icon and no explanation.
 *
 * The app has none of those problems: it runs as the user who wants the icon and
 * can ask the session where the desktop actually is. So it creates the same icon
 * on first run when it is missing, which makes the outcome independent of how
 * the package was installed.
 *
 * Once only, recorded in the app state: somebody who deletes the icon on purpose
 * should not find it back on every launch. The button in the environment panel
 * remains for putting it back deliberately.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

import { runCapture, runForOutput, which } from '../installer/env'
import { APP_CONFIG_PATH } from '../utils/paths'

export interface DesktopShortcutStatus {
  /** False when the machine has no desktop directory to write into. */
  available: boolean
  path: string | null
  exists: boolean
  /** Every desktop directory found, and whether the launcher is in it. */
  locations: Array<{ path: string; exists: boolean }>
}

export interface DesktopShortcutResult {
  path: string
  trusted: boolean
  /**
   * True when the icon was written but could not be marked trusted. GNOME and a
   * few other file managers refuse to launch an untrusted .desktop file, and the
   * failure is silent — the icon is there but double-clicking does nothing — so
   * the UI needs to be able to say so.
   */
  needsTrust: boolean
  /** Every file written; usually one, two when the desktop directories disagree. */
  paths: string[]
}

/**
 * Resolve the user's desktop directory.
 *
 * Linux only: a launcher here is a `.desktop` file, and the same logic on
 * Windows would drop a file nothing can run into the user's Desktop folder. The
 * null return is what hides the button on other platforms.
 *
 * Checked in order because each source covers a case the others miss:
 * `xdg-user-dir` is authoritative but only installed with xdg-user-dirs; the
 * English and Chinese names cover minimal and localised setups. Presence on disk
 * is the final arbiter — writing an icon into a directory the desktop does not
 * read would silently do nothing.
 */
/**
 * Choose between the answers the sources gave.
 *
 * Pure, so the rules can be tested without a session: which source wins, when
 * the locale decides between `Desktop` and `桌面`, and — the important one —
 * that having nothing to go on returns null instead of a guess.
 */
export function chooseDesktopDir(input: {
  /** Answers in priority order: xdg-user-dir, user-dirs.dirs, $XDG_DESKTOP_DIR. */
  configured: Array<string | null>
  /** Which of `~/Desktop` and `~/桌面` actually exist. */
  existingStandard: string[]
  /** LANG or LC_ALL, for the tie-break. */
  locale: string
}): string | null {
  for (const candidate of input.configured) {
    const trimmed = candidate?.trim()
    if (trimmed && input.existingStandard.includes(trimmed)) return trimmed
    if (trimmed && !input.existingStandard.includes(trimmed) && looksUsable(trimmed)) {
      return trimmed
    }
  }

  if (input.existingStandard.length === 1) return input.existingStandard[0]!
  if (input.existingStandard.length > 1) {
    // Both exist, so one of them is the leftover of a locale change. The locale
    // is what decides which one a session would show.
    const chinese = /^zh/i.test(input.locale)
    return input.existingStandard.find((d) => (chinese ? d.endsWith('桌面') : d.endsWith('Desktop'))) ?? null
  }

  // Nothing to go on. Returning `~/Desktop` here would write the launcher into a
  // directory the session may never show — and that looks exactly like success
  // from inside the app.
  return null
}

/** True when the path exists and is a directory. */
function looksUsable(dir: string): boolean {
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/** Read `XDG_DESKTOP_DIR` out of a `user-dirs.dirs`, expanding `$HOME`. */
export function parseUserDirsDesktop(file: string, home: string): string | null {
  try {
    const text = readFileSync(file, 'utf-8')
    const match = /^[ \t]*XDG_DESKTOP_DIR[ \t]*=[ \t]*"(.*)"[ \t]*$/m.exec(text)
    const raw = match?.[1]?.trim()
    if (!raw) return null
    return raw
      .replace(/^\$\{HOME\}/, home)
      .replace(/^\$HOME/, home)
      .replace(/^~/, home)
  } catch {
    return null
  }
}

/**
 * Every directory the launcher should be written to.
 *
 * More than one is normal, and writing to all of them is deliberate. A session
 * reads `user-dirs.dirs` once at login; change that file, or move the user to a
 * different locale, and the running desktop keeps showing the *old* folder until
 * the next login. A launcher written only to the configured directory is then
 * invisible with no way for the app to tell — the file exists, the panel says
 * 已就绪, and the user stares at an empty desktop.
 *
 * Writing to every candidate that exists costs one extra small file in a folder
 * the session may not be showing, and removes the guess entirely: whichever
 * folder the desktop turns out to display, the launcher is already in it.
 * `postrm` removes it from all of them for the same reason.
 */
export async function desktopDirs(): Promise<string[]> {
  if (process.platform !== 'linux') return []

  const configured: Array<string | null> = []
  if (await which('xdg-user-dir')) {
    configured.push(await runForOutput('xdg-user-dir', ['DESKTOP']))
  }
  configured.push(parseUserDirsDesktop(join(homedir(), '.config', 'user-dirs.dirs'), homedir()))
  configured.push(process.env.XDG_DESKTOP_DIR ?? null)

  const existingStandard = ['Desktop', '桌面']
    .map((name) => join(homedir(), name))
    .filter(looksUsable)

  const dirs: string[] = []
  for (const candidate of configured) {
    const trimmed = candidate?.trim()
    if (trimmed && looksUsable(trimmed) && !dirs.includes(trimmed)) dirs.push(trimmed)
  }
  for (const dir of existingStandard) {
    if (!dirs.includes(dir)) dirs.push(dir)
  }
  return dirs
}

/**
 * The directory the session *should* be showing.
 *
 * Used for reporting, not for writing: `desktopDirs()` is what the launcher is
 * written to. Null here with a non-empty `desktopDirs()` means the sources
 * disagree with what is on disk, which is exactly the state worth telling the
 * user about.
 */
export async function desktopDir(): Promise<string | null> {
  if (process.platform !== 'linux') return null

  const configured: Array<string | null> = []
  if (await which('xdg-user-dir')) {
    configured.push(await runForOutput('xdg-user-dir', ['DESKTOP']))
  }
  configured.push(parseUserDirsDesktop(join(homedir(), '.config', 'user-dirs.dirs'), homedir()))
  configured.push(process.env.XDG_DESKTOP_DIR ?? null)

  const existingStandard = ['Desktop', '桌面']
    .map((name) => join(homedir(), name))
    .filter(looksUsable)

  return chooseDesktopDir({
    configured,
    existingStandard,
    locale: process.env.LC_ALL || process.env.LANG || '',
  })
}

export async function shortcutStatus(): Promise<DesktopShortcutStatus> {
  const dirs = await desktopDirs()
  const paths = dirs.map((dir) => join(dir, 'claude-code-manager.desktop'))

  return {
    available: dirs.length > 0,
    // The configured directory first, so the reported path is the one the
    // session would show if it were up to date.
    path: paths[0] ?? null,
    exists: paths.some((p) => existsSync(p)),
    /** Every desktop directory found, and whether the launcher is in it. */
    locations: paths.map((path) => ({ path, exists: existsSync(path) })),
  }
}

export async function createShortcut(): Promise<DesktopShortcutResult> {
  const dirs = await desktopDirs()
  if (dirs.length === 0) {
    throw new Error(
      '没找到桌面目录：既没有 xdg-user-dirs 的配置，~/Desktop 与 ~/桌面 也都不存在。' +
        '请先创建其中之一，或从应用菜单启动。',
    )
  }

  const source = '/usr/share/applications/claude-code-manager.desktop'
  let content: string

  if (existsSync(source)) {
    // Installed from the .deb: adapt the packaged entry rather than writing a
    // second copy, so icon path and Exec stay in sync with the package.
    content = readFileSync(source, 'utf-8')
  } else {
    // Running from an AppImage or a source checkout: synthesise an entry that
    // points at whatever is running now.
    const exe = process.env.APPIMAGE || process.execPath
    content = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Claude Code Manager',
      'Comment=一键安装与管理 Claude Code',
      `Exec="${exe}"`,
      'Icon=utilities-terminal',
      'Terminal=false',
      'Categories=Development;',
      'StartupWMClass=Claude Code Manager',
      '',
    ].join('\n')
  }

  const written: string[] = []
  let trusted = false

  // Every candidate directory, not just the configured one: see desktopDirs().
  for (const dir of dirs) {
    const target = join(dir, 'claude-code-manager.desktop')
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(target, content, 'utf-8')
      chmodSync(target, 0o755)
      written.push(target)
    } catch (e) {
      console.warn(`[desktop] could not write ${target}:`, e)
    }
  }

  if (written.length === 0) throw new Error('桌面目录不可写，创建图标失败。')

  // Best effort only: on desktops without gio the file still works, and a
  // missing trust flag is not worth failing the whole operation over.
  if (await which('gio')) {
    const results = await Promise.all(
      written.map((target) =>
        runCapture('gio', ['set', target, 'metadata::trusted', 'true'], { timeoutMs: 10_000 }),
      ),
    )
    trusted = results.every((r) => r.code === 0)
  }

  return { path: written[0]!, trusted, needsTrust: !trusted, paths: written }
}

function readEnsuredFlag(): boolean {
  try {
    const state = JSON.parse(readFileSync(APP_CONFIG_PATH, 'utf-8')) as Record<string, unknown>
    return state?.desktopShortcutEnsured === true
  } catch {
    return false
  }
}

/**
 * Write the flag without dropping whatever else the renderer has stored.
 *
 * Read-modify-write on purpose: this runs at startup, where the renderer reads
 * the same file, so clobbering it would lose the remembered panel.
 */
function writeEnsuredFlag(): void {
  let state: Record<string, unknown> = {}
  try {
    state = JSON.parse(readFileSync(APP_CONFIG_PATH, 'utf-8')) as Record<string, unknown>
  } catch {
    // No state file yet, or an unreadable one: start from empty.
  }
  state.desktopShortcutEnsured = true
  writeFileSync(APP_CONFIG_PATH, JSON.stringify(state, null, 2), 'utf-8')
}

/**
 * Create the desktop icon if this is the first run and there is not one already.
 *
 * Never throws: a missing icon is cosmetic, and this runs before the window is
 * shown, where an exception would cost the user the whole app.
 */
export async function ensureShortcutOnce(): Promise<void> {
  try {
    if (readEnsuredFlag()) return

    const status = await shortcutStatus()
    if (status.exists) {
      writeEnsuredFlag()
      return
    }
    if (!status.available) {
      // No desktop directory to write to. Leave the flag unset: the environment
      // panel offers the button either way, and a machine that gains a desktop
      // later (or a user who creates one) should get the icon without having to
      // know about a flag.
      console.warn('[desktop] no desktop directory found; not creating a shortcut')
      return
    }

    await createShortcut()
    // Only now: a flag written after a failure is how the icon stayed missing
    // for a whole release — the app decided it had "tried" and never looked
    // again, while the user saw an empty desktop.
    writeEnsuredFlag()
    console.log('[desktop] created the desktop shortcut on first run')
  } catch (e) {
    console.warn('[desktop] could not create the desktop shortcut:', e)
  }
}
