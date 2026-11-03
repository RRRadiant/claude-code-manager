import { ipcMain } from 'electron'
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import matter from 'gray-matter'
import { COMMANDS_DIR } from '../utils/paths'

/** Shape of a parsed command entry returned to the renderer */
export interface CommandEntry {
  filename: string
  name: string
  description: string
  format: 'json' | 'markdown'
  content: string
  frontmatter?: Record<string, string>
}

function ensureCommandsDir(): void {
  if (!existsSync(COMMANDS_DIR)) {
    mkdirSync(COMMANDS_DIR, { recursive: true })
  }
}

function parseCommandFile(filename: string, raw: string): CommandEntry {
  const ext = extname(filename).toLowerCase()

  if (ext === '.json') {
    const parsed = JSON.parse(raw)
    return {
      filename,
      name: parsed.name ?? filename.replace(/\.json$/i, ''),
      description: parsed.description ?? '',
      format: 'json',
      content: parsed.prompt ?? raw,
    }
  }

  // Markdown file – use gray-matter for frontmatter extraction
  const { data, content } = matter(raw)
  // Build a plain Record<string,string> from frontmatter (gray-matter data can hold any value)
  const frontmatter: Record<string, string> = {}
  for (const [key, value] of Object.entries(data)) {
    frontmatter[key] = String(value ?? '')
  }

  return {
    filename,
    name: filename.replace(/\.md$/i, ''),
    description: frontmatter.description ?? '',
    format: 'markdown',
    content: content.trim(),
    frontmatter,
  }
}

export function registerCommandsIpcHandlers(): void {
  ensureCommandsDir()

  // ---------------------------------------------------------------------------
  // commands:list
  // ---------------------------------------------------------------------------
  ipcMain.handle('commands:list', async () => {
    try {
      const entries = readdirSync(COMMANDS_DIR)
      const results: CommandEntry[] = []

      for (const entry of entries) {
        const ext = extname(entry).toLowerCase()
        if (ext !== '.json' && ext !== '.md') continue

        const filePath = join(COMMANDS_DIR, entry)
        try {
          const raw = readFileSync(filePath, 'utf-8')
          results.push(parseCommandFile(entry, raw))
        } catch {
          // Skip files we cannot read/parse
          continue
        }
      }

      return { success: true, data: results }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // ---------------------------------------------------------------------------
  // commands:read
  // ---------------------------------------------------------------------------
  ipcMain.handle('commands:read', async (_event, args: { filename: string }) => {
    try {
      const filePath = join(COMMANDS_DIR, args.filename)

      if (!existsSync(filePath)) {
        return { success: false, error: `File not found: ${args.filename}` }
      }

      const raw = readFileSync(filePath, 'utf-8')
      const parsed = parseCommandFile(args.filename, raw)

      return { success: true, data: parsed }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // ---------------------------------------------------------------------------
  // commands:write
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    'commands:write',
    async (_event, args: { filename: string; content: string; format: 'json' | 'markdown' }) => {
      try {
        ensureCommandsDir()
        const filePath = join(COMMANDS_DIR, args.filename)
        writeFileSync(filePath, args.content, 'utf-8')
        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  // ---------------------------------------------------------------------------
  // commands:delete
  // ---------------------------------------------------------------------------
  ipcMain.handle('commands:delete', async (_event, args: { filename: string }) => {
    try {
      const filePath = join(COMMANDS_DIR, args.filename)

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
