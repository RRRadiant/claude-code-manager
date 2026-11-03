import { ipcMain } from 'electron'
import { spawn } from 'child_process'

import { detectClaudeCode } from '../services/cli-detector'
import type { CliStatus } from '../services/cli-detector'
import { checkDependencies } from '../services/dependency-checker'
import type { DepCheckResult } from '../services/dependency-checker'
import {
  buildDependencyInstallPlan,
  renderInstallScript,
} from '../services/dependency-installer'
import { launchScriptInTerminal, writeTempScript } from '../utils/terminal'

export type { CliStatus, DepCheckResult }

/** How `deps:install-missing` answered: see the handler for why it is not a boolean. */
export interface DependencyInstallResult {
  success: boolean
  mode: 'terminal' | 'nothing-to-do' | 'manual'
  /** The apt command, so the UI can show it even when it ran in a terminal. */
  command: string | null
  terminal: string | null
  error?: string
}

function execShell(command: string, timeoutMs = 120_000): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ success: false, error: `安装超时 (${timeoutMs / 1000}s)` })
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ success: true })
      else resolve({ success: false, error: stderr || stdout || `退出码 ${code}` })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ success: false, error: err.message })
    })
  })
}

export function registerCliIpcHandlers(): void {
  ipcMain.handle('cli:status', async (): Promise<CliStatus> => {
    return detectClaudeCode()
  })

  // ---- System dependency check ----
  ipcMain.handle('deps:check', async (): Promise<DepCheckResult> => {
    return checkDependencies()
  })

  // ---- One-click install missing dependencies ----
  //
  // This runs in a terminal window, not here. `sudo` will not read a password
  // without a terminal, and the main process has none: the earlier version
  // piped stdio and got "no tty present and no askpass program specified" while
  // the UI promised a password box. Handing the work to a terminal also means
  // the user can see what apt is doing, and can copy the command if they would
  // rather run it themselves.
  //
  // The trade-off is that this cannot report completion — the install outlives
  // the call. The UI says so and offers a re-check instead of claiming success.
  ipcMain.handle('deps:install-missing', async (): Promise<DependencyInstallResult> => {
    const result = checkDependencies()
    const missing = result.checks.filter((c) => !c.installed).map((c) => c.name)
    if (missing.length === 0) {
      return { success: true, mode: 'nothing-to-do', command: null, terminal: null }
    }

    let plan
    try {
      plan = buildDependencyInstallPlan(missing)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        mode: 'manual',
        command: null,
        terminal: null,
        error: message,
      }
    }
    const script = writeTempScript('install-deps', renderInstallScript(plan))
    const launch = await launchScriptInTerminal(script)

    if (!launch.ok) {
      return {
        success: false,
        mode: 'manual',
        command: plan.command,
        terminal: null,
        error: `${launch.error ?? '无法打开终端'}。请手动执行：${plan.command}`,
      }
    }

    return {
      success: true,
      mode: 'terminal',
      command: plan.command,
      terminal: launch.terminal,
    }
  })

  // ---- Unified install with method selection ----
  ipcMain.handle(
    'cli:install',
    async (
      _event,
      opts?: { method?: 'curl' | 'npm' | 'github-release' },
    ): Promise<{ success: boolean; error?: string }> => {
      const method = opts?.method || 'curl'

      switch (method) {
        // Primary: official native installer (may be blocked in some regions)
        case 'curl':
          return execShell('curl -fsSL https://claude.ai/install.sh | bash')

        // Fallback 1: npm global install to user-owned prefix (no sudo needed)
        case 'npm':
          return execShell(
            [
              'mkdir -p ~/.npm-global',
              'npm config set prefix ~/.npm-global',
              'npm install -g @anthropic-ai/claude-code',
              'export PATH="$HOME/.npm-global/bin:$PATH"',
              'grep -q ".npm-global/bin" ~/.bashrc 2>/dev/null || echo \'export PATH="$HOME/.npm-global/bin:$PATH"\' >> ~/.bashrc',
            ].join(' && '),
            180_000,
          )

        // Fallback 2: GitHub Releases binary (works everywhere)
        case 'github-release': {
          // Download the latest Linux x64 binary from GitHub
          const installCmd = [
            'CLAUDE_VER=$(curl -fsSL https://api.github.com/repos/anthropics/claude-code/releases/latest 2>/dev/null | grep tag_name | head -1 | cut -d\'"\' -f4)',
            '[ -z "$CLAUDE_VER" ] && echo "ERROR: cannot reach GitHub API" && exit 1',
            'echo "Downloading Claude Code $CLAUDE_VER..."',
            'curl -fsSL "https://github.com/anthropics/claude-code/releases/download/$CLAUDE_VER/claude-code-linux-x64.tar.gz" -o /tmp/claude-code.tar.gz',
            'mkdir -p "$HOME/.local/bin"',
            'tar -xzf /tmp/claude-code.tar.gz -C "$HOME/.local/bin"',
            'chmod +x "$HOME/.local/bin/claude"',
            'rm /tmp/claude-code.tar.gz',
            'echo "Claude Code installed to ~/.local/bin/claude"',
            'echo \'export PATH="$HOME/.local/bin:$PATH"\' >> "$HOME/.bashrc" 2>/dev/null || true',
          ].join(' && ')

          return execShell(installCmd, 180_000)
        }

        default:
          return { success: false, error: `未知安装方式: ${method}` }
      }
    },
  )
}
