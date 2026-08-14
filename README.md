# Claude Code Manager

> Windows Claude Code 图形化管理工具 — 无需手动输入终端命令

[![CI](https://github.com/claude-code-manager/claude-code-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/claude-code-manager/claude-code-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue)
![x64](https://img.shields.io/badge/Arch-x64%20|%20ARM64-lightgrey)

---

## 概述

**Claude Code Manager** 是一款面向 Windows 用户的桌面应用，提供 Claude Code 的安装、配置、管理和故障诊断功能。

目标用户：
- 第一次接触 Claude Code 和 AI Agent 的用户
- 不熟悉 PowerShell、环境变量和 JSON 配置的用户
- 希望通过图形界面管理 Claude Code 的开发者

## 功能

- 🔧 **环境检测与安装** — 一键检测系统环境，安装/卸载 Claude Code
- 🔌 **API 配置** — 支持 Anthropic、DeepSeek 和自定义兼容接口
- 🤖 **模型管理** — 检测并选择可用的 AI 模型
- 📝 **配置文件管理** — 可视化编辑 settings.json、CLAUDE.md、.mcp.json
- 🔗 **MCP 管理** — 编辑、测试 MCP Server
- 🩺 **故障诊断** — 一键诊断常见问题
- 🔄 **自动更新（计划中）** — 应用自身自动更新尚未接入，请手动关注 Releases 获取新版本

## 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10 1809+ / Windows 11 |
| 架构 | x64 或 ARM64 |
| 内存 | 4 GB RAM（推荐 8 GB） |
| 运行时 | WebView2 Runtime（Windows 11 自带） |
| 可选 | Git for Windows |

## 快速开始

### 便携版（推荐）
1. 从 [Releases](https://github.com/claude-code-manager/claude-code-manager/releases) 下载最新便携版
2. 双击运行 `ClaudeCodeManager-x64-portable.exe`
3. 按照新手引导完成初始配置

### 安装版
1. 下载 `ClaudeCodeManager-x64-setup.exe`
2. 运行安装程序
3. 从开始菜单启动

## 构建

### 前置要求
- Node.js 20+
- Rust 1.77+
- Visual Studio 2022 Build Tools（含 C++ 工作负载）
- WebView2 Runtime

### 构建步骤

```bash
# 克隆仓库
git clone https://github.com/claude-code-manager/claude-code-manager.git
cd claude-code-manager

# 安装前端依赖
npm install

# x64 构建
npx tauri build --target x86_64-pc-windows-msvc

# ARM64 构建
npx tauri build --target aarch64-pc-windows-msvc --bundles nsis
```

## 安全说明

- **API Key 安全存储** — 所有 API Key 通过 Windows Credential Manager 加密存储，前端仅显示掩码
- **命令隔离** — 前端不能直接执行系统命令，所有操作经过 Rust 后端安全处理
- **MCP 测试命令白名单校验** — MCP 测试命令与参数在 spawn 前经安全校验（拒绝 shell 元字符与路径穿越），仅放行合法命令，防止命令注入
- **日志脱敏** — 日志模块提供 API Key、Token、密码等敏感信息脱敏能力

## 项目结构

```
src/                  # React 前端
  components/         # 共享 UI 组件（含 glass/ 玻璃拟态组件）
  pages/              # 页面组件（Home/Environment/Providers/Config/Mcp/Diagnostics/Updates/Settings/About）
  stores/             # Zustand 状态管理
  services/           # Tauri IPC 封装（tauri.ts）
  types/              # TypeScript 类型定义

src-tauri/src/        # Rust 后端
  commands/           # Tauri 命令处理器（子目录：config/diagnostics/environment/installer/mcp/providers/task）
  config.rs           # 配置读取/原子写入/备份
  credentials.rs      # Windows Credential Manager 凭据存储
  diagnostics.rs      # 系统诊断
  env_refresh.rs      # 环境变量刷新
  environment.rs      # 系统环境检测
  error.rs            # 统一错误类型 AppError
  impl_providers.rs   # Provider 适配器实现（Anthropic/DeepSeek/Custom）
  installer.rs        # Claude Code 安装/卸载
  logging.rs          # 日志脱敏
  mcp.rs              # MCP 管理/测试
  process.rs          # 安全命令执行
  providers.rs        # ProviderAdapter trait + 类型
  security.rs         # 路径校验 / Shell 校验 / 权限检查
  task.rs             # 任务系统（进度/取消/事件）
  lib.rs / main.rs    # 应用入口与命令注册
```

## 许可证

MIT License — 详见 [LICENSE](LICENSE)
