import { ipcMain } from 'electron'
import https from 'https'
import { PROVIDERS } from '../services/providers'
import type { Provider } from '../services/providers'

interface DetectModelsRequest {
  provider: string
  apiKey: string
  baseUrl?: string
}

interface DetectModelsResponse {
  success: boolean
  data?: string[]
  error?: string
}

const TIMEOUT_MS = 10_000

function httpsGetJson(url: string, apiKey: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let body = ''
        res.on('data', (chunk: Buffer) => { body += chunk.toString() })
        res.on('end', () => {
          try { resolve(JSON.parse(body)) }
          catch { reject(new Error(`Invalid JSON response: ${body.slice(0, 200)}`)) }
        })
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error(`Request timed out after ${TIMEOUT_MS}ms`)) })
  })
}

function extractModels(body: unknown): string[] {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    // DeepSeek official: { object: "list", data: [{ id: "deepseek-chat", object: "model", owned_by: "deepseek" }] }
    // OpenAI:           { object: "list", data: [{ id: "gpt-4", ... }] }
    if ('data' in obj && Array.isArray(obj.data)) {
      return (obj.data as Array<Record<string, unknown>>)
        .map((m) => { if (typeof m.id === 'string') return m.id; return null })
        .filter((id): id is string => id !== null)
    }
    // Generic fallback: { models: [...] }
    if ('models' in obj && Array.isArray(obj.models)) {
      return (obj.models as Array<Record<string, unknown>>)
        .map((m) => { if (typeof m.id === 'string') return m.id; if (typeof m.name === 'string') return m.name; return null })
        .filter((id): id is string => id !== null)
    }
  }
  return []
}

/**
 * Try to detect models by stripping user-added suffixes (like /anthropic, /v1)
 * and trying the clean root URL with known model endpoints.
 */
async function detectModels(request: DetectModelsRequest): Promise<DetectModelsResponse> {
  const provider = PROVIDERS[request.provider]
  if (!provider) {
    return { success: false, error: `Unknown provider: ${request.provider}` }
  }

  // Anthropic — built-in list
  if (provider.id === 'anthropic') {
    return { success: true, data: provider.builtInModels ?? [] }
  }

  // Build candidate URLs to try
  const userBase = (request.baseUrl || '').replace(/\/+$/, '')
  const candidates: string[] = []

  // Helper: strip known suffixes to get root URL for model detection
  const suffixPatterns = ['/anthropic', '/v1']
  const rootFrom = (url: string): string => {
    let r = url.replace(/\/+$/, '')
    for (const s of suffixPatterns) { if (r.endsWith(s)) { r = r.slice(0, -s.length); break } }
    return r
  }

  // If user provided a URL, try it first with the provider's modelsEndpoint
  if (userBase) {
    if (provider.modelsEndpoint) {
      candidates.push(`${userBase}${provider.modelsEndpoint}`)
      // Also try at the stripped root
      const root = rootFrom(userBase)
      if (root !== userBase) candidates.push(`${root}${provider.modelsEndpoint}`)
    }
    // Also try /models if not already covered
    if (provider.modelsEndpoint !== '/models') candidates.push(`${rootFrom(userBase)}/models`)
  }

  // If provider has a default, also try it
  if (provider.baseUrl && (!userBase || userBase !== provider.baseUrl)) {
    const defRoot = rootFrom(provider.baseUrl)
    if (provider.modelsEndpoint) {
      const u = `${defRoot}${provider.modelsEndpoint}`
      if (!candidates.includes(u)) candidates.push(u)
    }
  }

  // Deduplicate
  const urls = [...new Set(candidates)]
  if (urls.length === 0) {
    return { success: false, error: 'No URL to try for model detection' }
  }

  const errors: string[] = []
  for (const url of urls) {
    try {
      const body = await httpsGetJson(url, request.apiKey)
      const models = extractModels(body)
      if (models.length > 0) return { success: true, data: models }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${url}: ${msg}`)
    }
  }

  return {
    success: false,
    error: `Model detection failed. Tried:\n${errors.join('\n')}`,
  }
}

export function registerApiDetectorIpc(): void {
  ipcMain.handle('api:detect-models', async (_event, request: DetectModelsRequest): Promise<DetectModelsResponse> => {
    try {
      return await detectModels(request)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })
}
