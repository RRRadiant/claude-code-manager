export interface Provider {
  id: string
  label: string
  baseUrl: string
  modelsEndpoint: string | null
  builtInModels: string[] | null
}

export const PROVIDERS: Record<string, Provider> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelsEndpoint: '/models',
    builtInModels: null,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    modelsEndpoint: null,
    builtInModels: [
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
      'claude-haiku-3-5-20250514',
    ],
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    // Official endpoint: https://api.deepseek.com/models
    // Returns { object: "list", data: [{ id: "...", object: "model", owned_by: "deepseek" }] }
    modelsEndpoint: '/models',
    builtInModels: null,
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    baseUrl: '',
    modelsEndpoint: '/v1/models',
    builtInModels: null,
  },
}

export function getModelsForProvider(providerId: string): string[] | null {
  const provider = PROVIDERS[providerId]
  if (!provider) return null
  return provider.builtInModels
}
