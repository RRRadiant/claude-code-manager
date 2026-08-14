import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AppError, EnvironmentStatus, PathCheck, TaskState,
  ConfigFileInfo, ConfigContent,
  DiagnosticReport, McpServerDef, McpTestResult,
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
export async function checkPath(): Promise<PathCheck> {
  return invoke<PathCheck>('check_path');
}
export async function refreshEnvironment(): Promise<PathCheck> {
  return invoke<PathCheck>('refresh_environment');
}
export async function detectNodeDetailed(): Promise<any> {
  return invoke<any>('detect_node_detailed');
}

// ===== Tasks =====
export async function getTasks(): Promise<TaskState[]> {
  return invoke<TaskState[]>('get_tasks');
}
export async function cancelTask(id: string): Promise<boolean> {
  return invoke<boolean>('cancel_task', { id });
}
export async function clearTasks(): Promise<void> {
  return invoke<void>('clear_tasks');
}

// ===== Config =====
export async function listConfigFiles(): Promise<ConfigFileInfo[]> {
  return invoke<ConfigFileInfo[]>('list_config_files');
}
export async function readConfigFile(scope: string): Promise<ConfigContent | null> {
  return invoke<ConfigContent | null>('read_config_file', { scope });
}
export async function writeConfigFile(scope: string, content: string): Promise<void> {
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
): Promise<{ models: any[]; count: number }> {
  return invoke('detect_provider_models', { providerType: provider_type, apiKey: api_key, baseUrl: base_url });
}
export async function saveProviderCredential(provider_type: string, api_key: string): Promise<boolean> {
  return invoke('save_provider_credential', { providerType: provider_type, apiKey: api_key });
}
export async function getProviderCredential(provider_type: string): Promise<{ exists: boolean; masked: string | null; api_key: string | null }> {
  return invoke('get_provider_credential', { providerType: provider_type });
}
export async function deleteProviderCredential(provider_type: string): Promise<boolean> {
  return invoke('delete_provider_credential', { providerType: provider_type });
}
export async function saveProviderConfig(
  providerType: string, name: string,
  baseUrl?: string, defaultModel?: string,
  fastModel?: string, highCapabilityModel?: string,
  timeoutSecs?: number, customHeaders?: string,
  apiKey?: string
): Promise<boolean> {
  return invoke('save_provider_config', { providerType, name, baseUrl, defaultModel, fastModel, highCapabilityModel, timeoutSecs, customHeaders, apiKey });
}
export async function loadProviderConfig(provider_type: string): Promise<any> {
  return invoke('load_provider_config', { providerType: provider_type });
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
export async function deleteMcpServer(name: string, sourceFile: string): Promise<void> {
  return invoke<void>('delete_mcp_server', { name, sourceFile });
}
export async function testRawMcpStdio(command: string, args: string[]): Promise<McpTestResult> {
  return invoke<McpTestResult>('test_raw_mcp_stdio', { command, args });
}

// ===== Diagnostics =====
export async function runDiagnostics(): Promise<DiagnosticReport> {
  return invoke<DiagnosticReport>('run_diagnostics');
}

import type { InstallStepResult } from '../types'

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
export async function uninstallClaudeCode(): Promise<string> {
  return invoke<string>('uninstall_claude_code');
}
export async function restartApp(): Promise<void> {
  await invoke('restart_app');
}
export async function runClaude(): Promise<string> {
  return invoke<string>('run_claude');
}

// ===== Events =====
export async function onTaskUpdated(callback: (task: TaskState) => void): Promise<UnlistenFn> {
  return listen<TaskState>('task-updated', (e) => callback(e.payload));
}
export async function onTaskCompleted(callback: (task: TaskState) => void): Promise<UnlistenFn> {
  return listen<TaskState>('task-completed', (e) => callback(e.payload));
}
