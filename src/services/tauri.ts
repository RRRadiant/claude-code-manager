import { invoke } from '@tauri-apps/api/core';
import type {
  AppError, EnvironmentStatus, PathCheck,
  ConfigFileInfo, ConfigContent, ConfigScope,
  DiagnosticReport, McpServerDef, McpTestResult,
  ModelInfo, ProviderConfigDraft, InstallStepResult,
  DetectedClaudeConfig, ImportResult,
} from '../types';

/**
 * Extract a human-readable message from a thrown value.
 *
 * Tauri commands returning `Result<T, AppError>` reject with the serialized
 * AppError object on failure, so we prefer `.message` over the default
 * `[object Object]` that `String(e)` would produce.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = (e as AppError).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return String(e);
}

// ===== Environment =====
export async function detectEnvironment(): Promise<EnvironmentStatus> {
  return invoke<EnvironmentStatus>('detect_environment');
}
export async function refreshEnvironment(): Promise<PathCheck> {
  return invoke<PathCheck>('refresh_environment');
}

// ===== Config =====
export async function listConfigFiles(): Promise<ConfigFileInfo[]> {
  return invoke<ConfigFileInfo[]>('list_config_files');
}
export async function readConfigFile(scope: ConfigScope): Promise<ConfigContent | null> {
  return invoke<ConfigContent | null>('read_config_file', { scope });
}
export async function writeConfigFile(scope: ConfigScope, content: string): Promise<void> {
  return invoke<void>('write_config_file', { scope, content });
}

// ===== Providers =====
export async function testProviderConnection(
  provider_type: string, api_key: string,
  base_url?: string, model?: string, timeout_secs?: number
): Promise<{ success: boolean; message: string; response_time_ms: number | null; error_code: string | null }> {
  return invoke('test_provider_connection', { providerType: provider_type, apiKey: api_key, baseUrl: base_url, model, timeoutSecs: timeout_secs });
}
export async function detectProviderModels(
  provider_type: string, api_key: string, base_url?: string
): Promise<{ models: ModelInfo[]; count: number }> {
  return invoke('detect_provider_models', { providerType: provider_type, apiKey: api_key, baseUrl: base_url });
}
export async function getProviderCredential(provider_type: string): Promise<{ exists: boolean; masked: string | null; api_key: string | null }> {
  return invoke('get_provider_credential', { providerType: provider_type });
}
export async function saveProviderConfig(
  providerType: string, name: string,
  baseUrl?: string, defaultModel?: string,
  fastModel?: string, highCapabilityModel?: string,
  timeoutSecs?: number, customHeaders?: string,
  apiKey?: string
): Promise<{ success: boolean; storage: 'plaintext_in_settings' | 'preserved_existing'; message: string }> {
  return invoke('save_provider_config', { providerType, name, baseUrl, defaultModel, fastModel, highCapabilityModel, timeoutSecs, customHeaders, apiKey });
}
export async function loadProviderConfig(provider_type: string): Promise<Partial<ProviderConfigDraft>> {
  return invoke('load_provider_config', { providerType: provider_type });
}
export async function detectExistingClaudeConfig(): Promise<DetectedClaudeConfig> {
  return invoke<DetectedClaudeConfig>('detect_existing_claude_config');
}
export async function importExistingClaudeConfig(providerType: string): Promise<ImportResult> {
  return invoke<ImportResult>('import_existing_claude_config', { providerType });
}

// ===== MCP =====
export async function listMcpServers(): Promise<McpServerDef[]> {
  return invoke<McpServerDef[]>('list_mcp_servers');
}
export async function testMcpServer(name: string): Promise<McpTestResult> {
  return invoke<McpTestResult>('test_mcp_server', { name });
}
export async function updateMcpServer(
  name: string, configJson: string, sourceFile: string,
  originalName?: string
): Promise<void> {
  return invoke<void>('update_mcp_server', { name, configJson, sourceFile, originalName });
}

// ===== Diagnostics =====
export async function runDiagnostics(): Promise<DiagnosticReport> {
  return invoke<DiagnosticReport>('run_diagnostics');
}

// ===== Installer =====
export async function generateInstallPlan(): Promise<InstallStepResult[]> {
  return invoke<InstallStepResult[]>('generate_install_plan');
}
export async function detectNodeJs(): Promise<{ node: string | null; npm: string | null }> {
  return invoke('detect_node_js');
}
export async function installClaudeCode(): Promise<string> {
  return invoke<string>('install_claude_code');
}
export async function installFullEnvironment(): Promise<string> {
  return invoke<string>('install_full_environment');
}
export async function restartApp(): Promise<void> {
  await invoke('restart_app');
}
export async function runClaude(): Promise<string> {
  return invoke<string>('run_claude');
}
