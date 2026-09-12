# CONTEXT.md — 项目上下文速览

> 给新加入的贡献者 / AI 代理的快速导航文档。详细设计见 `docs/`。

## 项目是什么

**Claude Code Manager (CCM)** 是一个 Windows 桌面应用（Tauri 2 + React + Rust），
为 Claude Code 提供图形化管理界面，目标用户是不熟悉命令行的用户：

- 一键检测环境、安装 / 卸载 Claude Code
- 配置 API 服务商（Anthropic / DeepSeek / 自定义兼容接口）
- 模型检测与选择
- 可视化编辑配置文件（settings.json、CLAUDE.md、.mcp.json）
- MCP Server 管理、测试
- 故障诊断

## 领域术语

| 术语 | 含义 |
|------|------|
| Claude Code | Anthropic 的终端 AI 编程助手（本项目管理的对象） |
| MCP | Model Context Protocol，Claude Code 接入外部工具的协议 |
| Provider | API 服务商适配器（Anthropic / DeepSeek / 自定义） |
| Credential Manager | Windows 凭据管理器，用于安全存储 API Key |
| 便携版 (portable) | 免安装、直接运行的单个 `.exe` |
| 安装版 (setup) | NSIS / MSI 安装程序 |

## 架构分层

```
React 前端 (src/)          纯 UI，无系统权限
   │  Tauri IPC (invoke)
   ▼
Rust 后端 (src-tauri/src/)
   ├── commands/           薄命令分发层（校验 + 委托）
   └── 服务模块            环境检测 / 安装 / Provider / MCP / 凭据 / 诊断 / 日志脱敏
```

关键规则：
- 前端不执行任何系统命令，所有副作用走 Tauri IPC
- 命令是薄的：校验输入 → 委托服务 → 返回结果
- 服务层纯 Rust、可测试
- API Key 存 Windows Credential Manager（CCM 自己的副本），同时**必须**以明文写入
  `~/.claude/settings.json` 的 `env.ANTHROPIC_AUTH_TOKEN` —— Claude Code 只从该文件或
  环境变量按字面值读取 token，不认凭据引用。CCM 的 provider 配置里不存 key，并会把
  「已明文写入何处」明确回报给 UI。详见 `docs/security.md` 第 2 节。
- 日志经 `LogSanitizer` 脱敏（脱敏器已实现，正在接线到所有日志路径）

## 关键决策

| 决策 | 记录 |
|------|------|
| 自动更新暂缓接入（计划中） | `docs/adr/0001-auto-update-deferred.md` |
| MCP 测试命令安全校验（命令白名单） | `docs/adr/0002-mcp-command-allowlist.md` |

其余历史决策见 `docs/architecture.md` 第 11 节。

## 目录地图

```
README.md            项目说明
CHANGELOG.md         更新日志（Keep a Changelog）
CONTEXT.md           本文件
HANDBOOK.md          交接文档（快速了解项目状态）
SECURITY.md          安全漏洞报告策略
CODE_OF_CONDUCT.md   行为准则
CONTRIBUTING.md      贡献指南
docs/                架构 / 安全 / 参考 / ADR 文档
docs/adr/            架构决策记录
.github/workflows/   CI 与 Release 工作流
.github/dependabot.yml 依赖自动更新
src/                 React 前端（components/pages/stores/services/types）
src-tauri/           Rust 后端（src/ 下 commands/ 目录 + 若干模块文件）
package.json         npm 依赖与脚本
src-tauri/Cargo.toml Rust 依赖与元数据
```

## 常用命令

```bash
npm run dev            # Vite 开发服务器
npm run typecheck      # TypeScript 类型检查
npm run lint           # oxlint
npm run build          # 前端生产构建
npm run tauri dev      # 桌面应用（开发模式）
npm run tauri build    # 构建安装包
cd src-tauri && cargo test   # Rust 测试
```
