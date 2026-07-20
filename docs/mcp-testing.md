# MCP Testing Guide

## Overview

MCP (Model Context Protocol) testing validates that a configured MCP server can successfully connect, initialize, and advertise its tools.

## Stdio MCP Test Flow

For local process-based MCP servers:

1. **Start Process**: Launch the configured command with args and env vars
2. **Wait for Ready**: Wait for process to start (with configurable timeout)
3. **Initialize**: Send JSON-RPC initialize request
4. **Verify Protocol**: Check that server responds with valid MCP protocol version
5. **Get Server Info**: Extract server name and version from initialize response
6. **List Tools**: Request available tools list
7. **Cleanup**: Send shutdown notification, then terminate process

## HTTP MCP Test Flow

For remote HTTP MCP servers:

1. **DNS Resolution**: Verify hostname resolves
2. **TLS Check**: Verify TLS certificate validity
3. **HTTP Connectivity**: Send OPTIONS or GET to base URL
4. **Initialize**: POST JSON-RPC initialize request
5. **Verify Protocol**: Check response protocol version
6. **Report**: Show response time, server info, and errors

## Test Result

```typescript
interface McpTestResult {
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
```

## Safety

- Tests only perform initialization and tool listing
- No tools are called — listing only
- Timeout enforced at every step
- Process cleanup guaranteed (kill_on_drop)
- Zombie process prevention via timeout + force kill
