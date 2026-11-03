import { ipcMain } from 'electron'
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import matter from 'gray-matter'
import { AGENTS_DIR } from '../utils/paths'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentEntry {
  filename: string
  name: string
  description: string
  tools?: string[]
  model?: string
  body: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureAgentsDir(): void {
  if (!existsSync(AGENTS_DIR)) {
    mkdirSync(AGENTS_DIR, { recursive: true })
  }
}

/**
 * Sanitize a string to kebab-case for use as a filename.
 * Lowercases, replaces runs of non-alphanumeric characters with a single dash,
 * and strips leading/trailing dashes.
 */
function toKebabCase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function registerAgentsIpcHandlers(): void {
  ensureAgentsDir()

  // -------------------------------------------------------------------------
  // agents:list
  // -------------------------------------------------------------------------
  ipcMain.handle('agents:list', async () => {
    try {
      const entries = readdirSync(AGENTS_DIR)
      const results: AgentEntry[] = []

      for (const entry of entries) {
        // Only .md files, skip internal/scope-guard files starting with '_'
        if (extname(entry).toLowerCase() !== '.md') continue
        if (entry.startsWith('_')) continue

        const filePath = join(AGENTS_DIR, entry)
        try {
          const raw = readFileSync(filePath, 'utf-8')
          const { data, content } = matter(raw)

          // Build the agent entry from frontmatter + body
          const agent: AgentEntry = {
            filename: entry,
            name: typeof data.name === 'string' ? data.name : entry.replace(/\.md$/i, ''),
            description: typeof data.description === 'string' ? data.description : '',
            body: content.trim(),
          }

          // Optional tools array
          if (Array.isArray(data.tools)) {
            agent.tools = data.tools.map(String)
          }

          // Optional model string (haiku | sonnet | opus)
          if (typeof data.model === 'string') {
            agent.model = data.model
          }

          results.push(agent)
        } catch {
          // Skip files we cannot read or parse
          continue
        }
      }

      return { success: true, data: results }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // -------------------------------------------------------------------------
  // agents:read
  // -------------------------------------------------------------------------
  ipcMain.handle('agents:read', async (_event, args: { filename: string }) => {
    try {
      const filePath = join(AGENTS_DIR, args.filename)

      if (!existsSync(filePath)) {
        return { success: false, error: `File not found: ${args.filename}` }
      }

      const raw = readFileSync(filePath, 'utf-8')
      const { data: frontmatter, content: body } = matter(raw)

      return {
        success: true,
        data: {
          frontmatter,
          body: body.trim(),
          raw,
        },
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // -------------------------------------------------------------------------
  // agents:write
  // -------------------------------------------------------------------------
  ipcMain.handle(
    'agents:write',
    async (
      _event,
      args: { filename: string; frontmatter: Record<string, unknown>; body: string },
    ) => {
      try {
        ensureAgentsDir()

        // Sanitize filename to kebab-case if the name contains spaces/special chars
        let filename = args.filename

        // Use the frontmatter `name` for filename derivation when available
        const displayName =
          typeof args.frontmatter.name === 'string' ? args.frontmatter.name : filename
        const kebabName = toKebabCase(displayName)

        // If the sanitized name differs from the current stem, use it
        const currentStem = filename.replace(/\.md$/i, '')
        if (kebabName && kebabName !== currentStem.toLowerCase()) {
          filename = kebabName + '.md'
        }

        // Ensure the filename ends with .md
        if (!filename.toLowerCase().endsWith('.md')) {
          filename = filename + '.md'
        }

        // Build YAML frontmatter block
        const yamlLines: string[] = []
        for (const [key, value] of Object.entries(args.frontmatter)) {
          if (value === undefined || value === null) continue

          if (Array.isArray(value)) {
            // Render array as YAML list: key:\n  - item1\n  - item2
            if (value.length === 0) {
              yamlLines.push(`${key}: []`)
            } else {
              yamlLines.push(`${key}:`)
              for (const item of value) {
                yamlLines.push(`  - ${String(item)}`)
              }
            }
          } else if (typeof value === 'string') {
            // Quote strings that contain special YAML characters or look like booleans/numbers/nulls
            const needsQuoting =
              /[:{}[\]&*#?|>!%@`]/.test(value) ||
              value === '' ||
              /^(true|false|yes|no|on|off|null|~)$/i.test(value) ||
              /^\d/.test(value) // strings starting with a digit can be ambiguous
            if (needsQuoting) {
              yamlLines.push(`${key}: "${value.replace(/"/g, '\\"')}"`)
            } else {
              yamlLines.push(`${key}: ${value}`)
            }
          } else {
            // Numbers, booleans, etc. — emit as-is
            yamlLines.push(`${key}: ${String(value)}`)
          }
        }

        const frontmatterBlock = ['---', ...yamlLines, '---'].join('\n')
        const markdown = frontmatterBlock + '\n\n' + args.body.trimEnd() + '\n'

        const filePath = join(AGENTS_DIR, filename)
        writeFileSync(filePath, markdown, 'utf-8')

        return { success: true, data: { filename } }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  // -------------------------------------------------------------------------
  // agents:delete
  // -------------------------------------------------------------------------
  ipcMain.handle('agents:delete', async (_event, args: { filename: string }) => {
    try {
      const filePath = join(AGENTS_DIR, args.filename)

      if (!existsSync(filePath)) {
        return { success: false, error: `File not found: ${args.filename}` }
      }

      unlinkSync(filePath)
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })
}
