# Claude Code Manager

> Windows 上给 Claude Code 用的图形化管理器 —— 不用敲命令行

[![CI](https://github.com/RRRadiant/claude-code-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/RRRadiant/claude-code-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue)
![Arch](https://img.shields.io/badge/Arch-x64-lightgrey)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB)

---

## 这是什么

**Claude Code Manager (CCM)** 是一个 Windows 桌面应用，把 Claude Code 的安装和配置过程做成图形界面。

面向三类人：

- 第一次接触 Claude Code / AI Agent，不熟悉终端
- 不想手动配环境变量、翻 JSON 配置文件
- 想用图形界面管理 MCP Server 和 API 服务商

## 功能

### 环境安装

- **一键安装** —— 自动检测并安装 Node.js、Git、Claude Code
- **国内可用** —— 内置多个镜像源，下载前**并发测速**取最快的一个
- **完整性校验** —— Node.js 与 Git 安装包都做 SHA256 校验后才安装
- **断点续传** —— 下载中断可续传，支持中途取消
- **实时进度** —— 显示下载百分比、速度、已传输字节
- **重启引导** —— 需要重启才能让新环境生效时弹窗说明原因

### 配置管理

- **API 服务商** —— Anthropic、DeepSeek、自定义兼容接口
- **模型检测** —— 连接后自动拉取可用模型列表并选择
- **一键导入** —— 识别已有的 Claude Code 配置（`settings.json` 或环境变量）
- **配置文件编辑** —— settings.json、CLAUDE.md、.mcp.json，源码/表单双模式

### 其他

- **MCP 管理** —— 增删改查 + 真实握手测试（stdio / HTTP）
- **故障诊断** —— 一键扫描常见问题并给出修复建议
- **日志脱敏** —— API Key、Token、密码写入日志前自动替换

## 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10 1809+ / Windows 11 |
| 架构 | x64 |
| 内存 | 4 GB（推荐 8 GB） |
| 运行时 | WebView2 Runtime（Windows 11 自带，Windows 10 需安装） |

> **Windows 10 用户注意**：系统默认没有 WebView2。应用启动时若检测到缺失，会自动
> 尝试安装（优先使用同目录的 `MicrosoftEdgeWebview2Setup.exe`，否则询问后联网下载）。

## 快速开始

### 便携版（推荐）

1. 从 [Releases](https://github.com/RRRadiant/claude-code-manager/releases) 下载 `ClaudeCodeManager-x64-portable.exe`
2. 双击运行
3. 按新手引导走完 7 步向导

> 便携版在 **Windows 10** 上建议与 `MicrosoftEdgeWebview2Setup.exe` 放在同一目录，
> 这样缺少 WebView2 时可以离线静默安装。

### 安装版

1. 下载 `ClaudeCodeManager-x64-setup.exe`（或 `.msi`）
2. 运行安装程序
3. 从开始菜单启动

### 安装流程说明

点「安装完整环境」后会依次进行：

```
1. 并行下载安装 Node.js + Git
   ├─ Node.js：多个镜像并发测速 → 下载 → SHA256 校验 → 解压 → 加入 PATH
   └─ Git：多个镜像并发测速 → 下载 → SHA256 校验 → 静默安装
2. 弹窗提示重启应用（让新的环境变量生效）
3. 重启后再次点击安装 → 自动跳过已装组件 → 安装 Claude Code
4. 若 Claude Code 装完但仍检测不到 → 弹窗说明需重启
```

**为什么需要重启**：新安装的工具目录写入的是**注册表 PATH**，而应用进程使用的是
**启动时继承的 PATH**，Windows 不允许进程自行更新环境块。重启是可靠的分界点。

## 下载源

所有下载都支持多源并发测速，取最快可用者：

| 组件 | 源 |
|------|-----|
| Node.js | 华为云、npmmirror、nodejs.org |
| Node.js 校验文件 | 上述镜像回退获取 |
| Git | npmmirror、GitHub |
| Claude Code | npm（临时切换 registry，装完还原） |
| WebView2 | 微软官方 |

## 安全说明

- **API Key 存储** —— 同时存 Windows Credential Manager，并**以明文写入
  `~/.claude/settings.json`**。这不是偷懒：Claude Code 只从该文件或环境变量按
  **字面值**读取 token，不认任何凭据引用。写入前自动生成 `.bak` 备份，写入后回读校验。
  详见 [docs/security.md](docs/security.md) 第 2 节。
- **命令隔离** —— 前端不能直接执行系统命令，所有副作用经 Rust 后端处理
- **无命令拼接** —— 所有子进程调用使用参数数组；需要执行 PowerShell 脚本时通过
  `-EncodedCommand` 传输，不使用字符串拼接
- **MCP 命令白名单** —— MCP 测试命令在 spawn 前经白名单校验，拒绝路径穿越与 shell 元字符
- **路径校验** —— 配置读写限定在允许的目录内，防止路径穿越
- **原子写入** —— 配置文件写入前备份、写临时文件校验后重命名，失败自动回滚
- **日志脱敏** —— API Key、Token、密码、邮箱写入日志前自动替换

> ⚠️ 由于 API Key 会明文写入 `~/.claude/settings.json`，请把该文件及其 `.bak`
> 备份视为敏感文件。

## 构建

### 前置要求

- Node.js 20+
- Rust 1.77+
- Visual Studio 2022 Build Tools（含 C++ 工作负载）
- WebView2 Runtime

### 步骤

```bash
git clone https://github.com/RRRadiant/claude-code-manager.git
cd claude-code-manager
npm install

# 开发模式
npm run tauri:dev

# x64 打包（MSI + NSIS 安装包）
npx tauri build --target x86_64-pc-windows-msvc
```

产物位于 `src-tauri/target/x86_64-pc-windows-msvc/release/`，
安装包在 `bundle/msi` 与 `bundle/nsis` 子目录。

### 常用命令

```bash
npm run typecheck              # TypeScript 类型检查
npm run lint                   # oxlint
npm run build                  # 前端生产构建
cd src-tauri && cargo test     # Rust 测试
cd src-tauri && cargo clippy -- -D warnings
```

> `Cargo.toml` 中配置了 `[profile]`（dev/test 关闭调试符号、release 加 `strip`）。
> 不加这段配置时 `target/` 会膨胀到 14 GB 以上，加上后同样构建约 1.9 GB。

## 项目结构

```
src/                      # React 前端
  components/             # 共享 UI 组件（含 glass/ 玻璃拟态组件）
  pages/                  # 9 个页面
  stores/                 # Zustand 状态管理
  services/tauri.ts       # Tauri IPC 封装
  types/                  # TypeScript 类型定义

src-tauri/src/            # Rust 后端
  commands/               # Tauri 命令处理器（薄分发层）
  config.rs               # 配置读取 / 原子写入 / 备份
  credentials.rs          # Windows Credential Manager 封装
  diagnostics.rs          # 系统诊断
  env_refresh.rs          # 从注册表刷新 PATH
  environment.rs          # 环境检测（Node / Git / Claude Code / WebView2）
  error.rs                # 统一错误类型 AppError
  impl_providers.rs       # Provider 适配器实现
  installer.rs            # 安装引擎（下载 / 校验 / 解压 / 安装）
  logging.rs              # 日志脱敏
  mcp.rs                  # MCP 管理 / 握手测试
  process.rs              # 安全命令执行
  providers.rs            # ProviderAdapter trait
  security.rs             # 路径校验 / Shell 校验 / 命令白名单
  task.rs                 # 任务系统（进度 / 取消 / 事件）

docs/                     # 架构、安全、参考文档与 ADR
```

## 文档

| 文档 | 内容 |
|------|------|
| [CONTEXT.md](CONTEXT.md) | 项目上下文速览（术语、架构分层、关键决策） |
| [HANDBOOK.md](HANDBOOK.md) | 交接文档（模块清单、命令列表、当前状态） |
| [docs/architecture.md](docs/architecture.md) | 架构设计、技术选型、分阶段计划 |
| [docs/security.md](docs/security.md) | 安全设计、威胁模型、凭据处理 |
| [docs/adr/](docs/adr/) | 架构决策记录 |
| [CHANGELOG.md](CHANGELOG.md) | 更新日志 |

## 许可证

MIT License — 详见 [LICENSE](LICENSE)
