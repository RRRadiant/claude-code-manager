/**
 * Log sanitizer.
 *
 * Ported from `logging.rs` in the Windows build. Install steps embed command
 * output and URLs, and npm can echo back a registry URL carrying a token, so
 * every string that reaches a log line, a task step, or an IPC payload goes
 * through here first.
 */

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Bearer / Authorization headers
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]'],
  [/\b(Authorization\s*[:=]\s*)\S+/gi, '$1[REDACTED]'],
  // Anthropic / OpenAI / DeepSeek style keys, and the generic sk- family
  [/\bsk-[A-Za-z0-9._-]{8,}/g, '[REDACTED_KEY]'],
  [/\bsk-ant-[A-Za-z0-9._-]{8,}/g, '[REDACTED_KEY]'],
  // Explicit assignments in JSON or env dumps
  [
    /("?(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|API_KEY|AUTH_TOKEN|PASSWORD|TOKEN|SECRET)"?\s*[:=]\s*"?)([^"\s,}]+)/gi,
    '$1[REDACTED]',
  ],
  // Secrets carried in a URL query string
  [/([?&](?:api[_-]?key|token|access[_-]?token|password)=)[^&\s]+/gi, '$1[REDACTED]'],
  // user:password@host in a URL
  [/(\/\/[^/\s:@]+:)[^@\s/]+(@)/g, '$1[REDACTED]$2'],
]

export class LogSanitizer {
  /** Replace every recognized secret shape with a stable placeholder. */
  sanitize(input: string): string {
    let out = input
    for (const [pattern, replacement] of SECRET_PATTERNS) {
      out = out.replace(pattern, replacement)
    }
    return out
  }

  /** Summarize a key for display: type + first 3 chars + length, never the value. */
  static summarizeKey(key: string): string {
    if (!key) return '(未配置)'
    const prefix = key.slice(0, 3)
    return `${prefix}…(${key.length} 字符)`
  }
}

export const logSanitizer = new LogSanitizer()
