import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  EnvironmentStatus, PathCheck, TaskState,
  ConfigFileInfo, ConfigContent,
  DiagnosticReport, McpServerDef, McpTestResult,
} from '../types';

// ===== Environment =====
export async function detectEnvironment(): Promise<EnvironmentStatus> {
  return invoke<EnvironmentStatus>('detect_environment');
}
export async function checkPath(): Promise<PathCheck> {
  return invoke<PathCheck>('check_path');
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
  return invoke('test_provider_connection', { provider_type, apiKey: api_key, baseUrl: base_url, model, timeoutSecs: timeout_secs });
}
export async function detectProviderModels(
  provider_type: string, api_key: string, base_url?: string
): Promise<{ models: any[]; count: number }> {
  return invoke('detect_provider_models', { provider_type, apiKey: api_key, baseUrl: base_url });
}

// ===== MCP =====
export async function listMcpServers(): Promise<McpServerDef[]> {
  return invoke<McpServerDef[]>('list_mcp_servers');
}
export async function testMcpServer(name: string, scope: string): Promise<McpTestResult> {
  return invoke<McpTestResult>('test_mcp_server', { name, scope });
}
export async function testRawMcpStdio(command: string, args: string[]): Promise<McpTestResult> {
  return invoke<McpTestResult>('test_raw_mcp_stdio', { command, args });
}

// ===== Diagnostics =====
export async function runDiagnostics(): Promise<DiagnosticReport> {
  return invoke<DiagnosticReport>('run_diagnostics');
}

// ===== Installer =====
export async function installClaudeCode(): Promise<string> {
  return invoke<string>('install_claude_code');
}
export async function uninstallClaudeCode(): Promise<string> {
  return invoke<string>('uninstall_claude_code');
}

// ===== Events =====
export async function onTaskUpdated(callback: (task: TaskState) => void): Promise<UnlistenFn> {
  return listen<TaskState>('task-updated', (e) => callback(e.payload));
}
export async function onTaskCompleted(callback: (task: TaskState) => void): Promise<UnlistenFn> {
  return listen<TaskState>('task-completed', (e) => callback(e.payload));
}
