// Claude Code Manager - Frontend type definitions (mirrors Rust backend types)

// ===== Installer Types =====

export interface InstallStepResult {
  component: string;
  success: boolean;
  version: string | null;
  message: string;
}

// ===== Environment Types =====

export type Architecture = 'x86' | 'arm' | 'unknown'

export interface SystemInfo {
  os: 'windows' | 'macos' | 'linux'
  version: string
  displayName: string
  architecture: Architecture
}

export interface WindowsInfo {
  version: string;
  display_version: string;
  architecture: string;
  display_architecture: Architecture;
  is_arm64: boolean;
  is_elevated: boolean;
}

export interface NodeInfo {
  node_version: string | null;
  npm_version: string | null;
  detection_method?: string;
  resolved_path?: string | null;
}

export interface PowerShellInfo {
  available: boolean;
  version: string | null;
  path: string | null;
}

export interface GitInfo {
  installed: boolean;
  version: string | null;
  path: string | null;
}

export interface ClaudeCodeInfo {
  installed: boolean;
  version: string | null;
  path: string | null;
  install_source: string | null;
  install_method: string | null;
  config_path: string | null;
  health: string | null;
  details: string[];
}

export interface PathCheck {
  claude_bin_in_path: boolean;
  claude_bin_path: string | null;
  path_directories: string[];
}

export interface WebView2Info {
  installed: boolean;
  version: string | null;
}

export interface EnvironmentStatus {
  node: NodeInfo;
  windows: WindowsInfo;
  powershell: PowerShellInfo;
  git: GitInfo;
  path: PathCheck;
  claude_code: ClaudeCodeInfo;
  webview2: WebView2Info;
  network_reachable: boolean | null;
  errors: AppError[];
  warnings: string[];
}

// ===== Error Types =====

export interface AppError {
  code: string;
  title: string;
  message: string;
  technical_details: string | null;
  suggestions: string[];
  retryable: boolean;
}

// ===== Task Types =====

export type TaskStatus = 'Queued' | 'Running' | 'Success' | 'Failed' | 'Cancelled';

export interface TaskState {
  id: string;
  type_: string;
  status: TaskStatus;
  title: string;
  current_step: string | null;
  progress: number | null;
  started_at: string | null;
  finished_at: string | null;
  cancellable: boolean;
  error: string | null;
}

// ===== Provider Types =====

export type ProviderType = 'anthropic' | 'deepseek' | 'custom';

export interface ProviderConfig {
  provider_type: ProviderType;
  name: string;
  base_url: string;
  default_model: string | null;
  fast_model: string | null;
  high_capability_model: string | null;
  timeout_secs: number;
  credential_id: string | null;
  custom_headers: [string, string][] | null;
}

export interface ModelInfo {
  id: string;
  display_name: string | null;
  provider: string;
  available: boolean;
  response_time_ms: number | null;
  capabilities: CapabilityFlags;
  detected_at: string;
}

export interface CapabilityFlags {
  supports_thinking: boolean | null;
  supports_tool_use: boolean | null;
  supports_image_input: boolean | null;
  supports_streaming: boolean | null;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  response_time_ms: number | null;
  error_code: string | null;
}

// ===== Config Types =====

export type ConfigScope = 'user' | 'project' | 'local' | 'managed';

export interface ConfigFileInfo {
  name: string;
  scope: string;
  path: string;
  exists: boolean;
  last_modified: string | null;
  is_valid: boolean | null;
  has_sensitive_fields: boolean;
}

export interface ConfigContent {
  path: string;
  content: string;
  format: string;
}

// ===== MCP Types =====

export type McpTransportType = 'Stdio' | 'Http';
export type McpScope = 'Local' | 'Project' | 'User';

export interface HttpHeader {
  key: string;
  value: string;
  sensitive: boolean;
}

export interface EnvVar {
  key: string;
  value: string;
  sensitive: boolean;
}

export interface McpServerDef {
  name: string;
  type_: McpTransportType;
  command: string | null;
  args: string[] | null;
  url: string | null;
  headers: HttpHeader[] | null;
  env: EnvVar[] | null;
  cwd: string | null;
  timeout_ms: number | null;
  tool_timeout_ms: number | null;
  scope: McpScope;
  enabled: boolean;
  source_file: string | null;
}

export interface McpTestResult {
  success: boolean;
  protocol_version: string | null;
  server_name: string | null;
  server_version: string | null;
  tool_count: number | null;
  tool_names: string[];
  response_time_ms: number;
  stdout_summary: string | null;
  stderr_summary: string | null;
  suggestions: string[];
}

// ===== Diagnostic Types =====

export type DiagStatus = 'Pass' | 'Warning' | 'Error' | 'Skipped';

export interface DiagCheckResult {
  name: string;
  category: string;
  status: DiagStatus;
  message: string;
  details: string | null;
  fix_suggestion: string | null;
}

export interface DiagnosticReport {
  timestamp: string;
  total_checks: number;
  passed: number;
  warnings: number;
  errors: number;
  checks: DiagCheckResult[];
  system_info: string;
}
