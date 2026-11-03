/**
 * Running a script in a terminal emulator.
 *
 * Two features need a real terminal window: launching Claude Code, which is a
 * full-screen TUI, and installing the system packages the app depends on, where
 * `sudo` refuses to read a password without one.
 *
 * The emulators disagree about how `-e` is spelled. Some take a single string
 * and split it shell-style (xfce4-terminal), some take the program and its
 * arguments as separate argv entries (xterm, konsole), and gnome-terminal wants
 * everything after `--`. Passing a bare executable path — no arguments at all —
 * sidesteps the disagreement: there is nothing to split, so every convention
 * gets the same single token and runs the same file.
 *
 * That is why callers hand in a script the helper can execute directly rather
 * than a command line, and why the script decides for itself when its window may
 * close: there is no hold flag common to all of them either.
 */

import { spawn } from 'child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

import { APP_DATA_DIR } from '../installer/components'
import { which } from '../installer/env'

export interface TerminalLaunch {
  ok: boolean
  /** The emulator that took the launch, when one did. */
  terminal: string | null
  /** Set when no emulator was found, with the reason to show the user. */
  error: string | null
}

interface Emulator {
  program: string
  /** Arguments that run `scriptPath`, which must be executable. */
  args: (scriptPath: string) => string[]
}

/**
 * Ordered by how likely each is to be the right one on a Debian desktop.
 * `x-terminal-emulator` is the alternatives symlink Debian and Kali both
 * maintain, so it resolves to whatever the user's desktop actually ships —
 * Kali's default XFCE session ends up at xfce4-terminal.
 */
const EMULATORS: Emulator[] = [
  { program: 'x-terminal-emulator', args: (s) => ['-e', s] },
  { program: 'xfce4-terminal', args: (s) => ['-e', s] },
  { program: 'qterminal', args: (s) => ['-e', s] },
  { program: 'konsole', args: (s) => ['-e', s] },
  { program: 'alacritty', args: (s) => ['-e', s] },
  { program: 'mate-terminal', args: (s) => ['--', s] },
  { program: 'gnome-terminal', args: (s) => ['--', s] },
  { program: 'xterm', args: (s) => ['-e', s] },
]

/** The emulator table, exported so a test can assert the argv it produces. */
export function emulatorArgv(program: string, scriptPath: string): string[] | null {
  const emulator = EMULATORS.find((e) => e.program === program)
  return emulator ? emulator.args(scriptPath) : null
}

/**
 * Write an executable script.
 *
 * Under the app's own data directory rather than the system temp directory,
 * because the script is executed rather than read by an interpreter: a `/tmp`
 * mounted `noexec` — not unusual on a hardened machine — would fail with
 * "Permission denied" and no explanation. The app already runs binaries from
 * this directory, so it is known to be executable.
 *
 * Exception: when the home directory contains a space. The emulators that
 * shell-split their `-e` argument (xfce4-terminal, qterminal) would cut the path
 * in half, and no single quoting style satisfies both those and the ones that
 * take argv directly. `XDG_RUNTIME_DIR` is a per-user tmpfs with a guaranteed
 * space-free path, which sidesteps the disagreement entirely.
 *
 * The mode is 0700: the script may end up running apt as root, and nobody else
 * on the machine should be able to read or edit it in between.
 */
export function writeTempScript(name: string, content: string): string {
  const preferred = join(APP_DATA_DIR, 'scripts')
  const runtimeDir = process.env.XDG_RUNTIME_DIR
  const dir =
    preferred.includes(' ') && runtimeDir && !runtimeDir.includes(' ')
      ? join(runtimeDir, 'claude-code-manager')
      : preferred

  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, `${name}-${process.pid}.sh`)
  writeFileSync(file, content, { encoding: 'utf-8', mode: 0o700 })
  chmodSync(file, 0o700)
  return file
}

/**
 * Open `scriptPath` in the first available terminal emulator.
 *
 * Detached on purpose: the app must not wait for, or die with, the window it
 * opened. `env` is merged over the current environment, which is how the
 * managed bin directories reach the terminal's shell.
 */
export async function launchScriptInTerminal(
  scriptPath: string,
  env?: NodeJS.ProcessEnv,
): Promise<TerminalLaunch> {
  for (const emulator of EMULATORS) {
    const resolved = await which(emulator.program)
    if (!resolved) continue

    const child = spawn(resolved, emulator.args(scriptPath), {
      detached: true,
      stdio: 'ignore',
      env: env ? { ...process.env, ...env } : process.env,
    })
    child.unref()
    return { ok: true, terminal: emulator.program, error: null }
  }

  return {
    ok: false,
    terminal: null,
    error: '未找到可用的终端模拟器（x-terminal-emulator / xfce4-terminal / …）',
  }
}
