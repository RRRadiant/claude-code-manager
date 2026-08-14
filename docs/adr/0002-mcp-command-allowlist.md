# ADR-0002: MCP 测试命令安全校验（命令白名单）

- 状态：已接受
- 日期：2026-07-20

## 背景

MCP Server 支持 stdio 传输，测试时会启动配置中的 `command` 进程。其中
`test_raw_mcp_stdio` 命令直接接受前端传入的原始 `command` + `args`，是命令注入 /
任意执行的最高风险路径。此外，`list_servers` 发现的配置条目在测试时绕过了 IPC
入口校验，可能来自被篡改的 `.mcp.json`。

## 决策

**所有 MCP 测试命令在 spawn 前必须经过安全校验（命令白名单校验）：**

- `command` 经 `security::validate_mcp_command` 校验：
  拒绝路径穿越（`ParentDir` 组件）与 shell 元字符（`& | ; $ \` ' " ( ) { } < > \n \r`）。
- 每个 `arg` 经 `security::validate_shell_arg` 校验：
  拒绝空参数、超长（> 4096 字符）以及上述 shell 元字符。
- 校验同时作用于 `test_raw_mcp_stdio`（前端原始输入）与 `test_stdio_server`
  （配置条目测试，防绕过 IPC 层）。

当前实现为「字符级校验」：只放行不含危险字符、无路径穿越的合法命令，
是更严格静态白名单（固定允许命令集）的第一步。

## 后果

- 优点：阻断通过 MCP 配置或原始输入注入 shell 元字符、路径穿越的常见攻击。
- 代价：合法的复杂命令（含引号、管道等 shell 语法）会被拒绝；若未来需要支持
  这类命令，应引入显式命令白名单 + 参数模板，而非放宽字符校验。

## 关联

- 实现：`src-tauri/src/security.rs`（`validate_mcp_command` / `validate_shell_arg`）
- 调用点：`src-tauri/src/commands/mcp.rs`、`src-tauri/src/mcp.rs`
