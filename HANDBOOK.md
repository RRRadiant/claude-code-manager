# Claude Code Manager — Handoff Document

> 生成时间: 2026-07-20
> 目的: 下次对话时读取此文档，快速了解项目状态

---

## 项目概览

**Claude Code Manager** 是一个 Windows 桌面应用，为 Claude Code 提供图形化管理界面。目标用户是不熟悉命令行的 AI Agent 新手。

## 技术栈

| 层 | 技术 | 版本 |
|---|------|------|
| 桌面框架 | Tauri 2 | 2.x |
| 后端 | Rust | 1.97.1 |
| 前端 | React + TypeScript | 19.x / 6.x |
| 构建 | Vite | 8.x |
| 状态管理 | Zustand | 5.x |
| 效果库 | @creativoma/liquid-glass | 1.x |
| CI/CD | GitHub Actions | — |

## 项目结构

```
D:\桌面\NewCC/
├── src/                    # React 前端
│   ├── pages/              # 9 个页面
│   ├── components/         # Sidebar, StatusBar, Onboarding
│   ├── services/tauri.ts   # IPC 封装
│   ├── stores/             # Zustand stores
│   └── types/index.ts      # TS 类型定义
├── src-tauri/src/          # Rust 后端 (17 模块)
│   ├── commands/           # 7 命令文件
│   ├── installer.rs        # 安装/卸载
│   ├── impl_providers.rs   # Provider 适配器
│   ├── mcp.rs              # MCP 测试引擎
│   └── ...
├── docs/                   # 架构/安全文档
└── .github/workflows/      # CI + Release
```

## 已验证状态

| 检查 | 结果 |
|------|------|
| TypeScript 编译 | ✅ 通过 |
| Vite 构建 | ✅ 通过 (88ms) |
| Rust 编译 | ✅ 0 错误 |
| Rust 测试 | ✅ **132/132 通过** |
| Git 仓库 | ✅ 已初始化 (commit 907dcea) |

## Rust 模块清单

| 模块 | 文件 | 功能 |
|------|------|------|
| `commands/` | 7 文件 | Tauri IPC 命令 (16 个命令) |
| `error` | error.rs | `AppError` 统一错误码 (30+) |
| `task` | task.rs | 任务系统 (进度/取消/事件) |
| `logging` | logging.rs | 日志脱敏 (API Key/Token/密码) |
| `security` | security.rs | 路径验证/Shell校验/权限检查 |
| `process` | process.rs | 安全命令执行 (超时/取消) |
| `environment` | environment.rs | Windows/PS/Git/WebView2检测 |
| `config` | config.rs | 配置读取/原子写入/备份 |
| `credentials` | credentials.rs | Windows Credential Manager |
| `installer` | installer.rs | Claude Code 安装/卸载 |
| `impl_providers` | impl_providers.rs | Anthropic/DeepSeek/Custom 适配器 |
| `mcp` | mcp.rs | MCP 测试 (stdio/HTTP 握手) |
| `model_detection` | model_detection.rs | 模型检测 (stub) |
| `providers` | providers.rs | ProviderAdapter trait + 类型 |
| `diagnostics` | diagnostics.rs | 8 项系统诊断检查 |

## Tauri 命令列表 (16 个)

```
detect_environment        环境检测
check_path                PATH 检查
get_tasks                 任务列表
cancel_task               取消任务
clear_tasks               清除已完成
run_diagnostics           全量诊断
list_config_files         配置列表
read_config_file          读取配置
write_config_file         写入配置
test_provider_connection  测试 Provider 连接
detect_provider_models    检测模型
list_mcp_servers          列出 MCP Server
test_mcp_server           测试 MCP 连接
test_raw_mcp_stdio        测试原始 MCP Stdio
install_claude_code       安装 Claude Code
uninstall_claude_code     卸载 Claude Code
```

## 前端页面 (9 个)

| 页面 | 路由 | 功能 |
|------|------|------|
| 首页 | `#home` | 仪表盘 + 环境概览 + 快速入口 |
| 安装与环境 | `#environment` | 系统检测 + 一键安装 |
| API 与模型 | `#providers` | Anthropic/DeepSeek/自定义配置 |
| 配置文件 | `#config` | JSON 编辑器 (源码/表单模式) |
| MCP 管理 | `#mcp` | MCP Server 增删改查 + 测试 |
| 故障诊断 | `#diagnostics` | 一键诊断 + 结果展示 |
| 软件更新 | `#updates` | Claude Code + CCM 双更新 |
| 设置 | `#settings` | 主题/动画/布局配置 |
| 关于 | `#about` | 版本/技术栈/链接 |

## 新手引导

应用首次启动时显示 7 步 Onboarding 向导：
1. 欢迎页 → 2. 检测环境 → 3. 安装 Claude Code → 4. 配置 API → 5. 检测模型 → 6. MCP(可选) → 7. 完成

可通过 `stores/appStore.ts` 中的 `onboardingCompleted` 控制。

## 测试覆盖 (132 个)

| 模块 | 测试数 | 覆盖内容 |
|------|--------|---------|
| `security` | 34 | 路径验证/shell校验/MCP命令/提权 |
| `updater` | 30 | 版本比较/通道/状态/清单序列化 |
| `environment` | 22 | Windows检测/PS/Git/WebView2/序列化 |
| `process` | 23 | CommandSpec/命令执行/超时/取消 |
| `logging` | 6 | API Key脱敏/路径脱敏/边界 |
| `config` | 3 | 作用域解析/写入校验 |
| `credentials` | 1 | 凭据ID格式 |
| `diagnostics` | 1 | 诊断不panic |

运行测试: `cd src-tauri && cargo test`

## 安全设计亮点

- API Key 不存 JSON / localStorage → Windows Credential Manager
- 前端不执行任何系统命令 → 所有操作经 Rust IPC
- 命令使用参数数组 → 无字符串拼接/注入
- 日志统一脱敏 → API Key/Token/密码/邮箱自动替换
- 原子文件写入 → 写入前备份，写入失败自动回滚
- 路径规范化 → 防止路径遍历攻击

## 下一步工作

1. **构建安装包** — `npx tauri build --bundles nsis` (后台运行中)
2. **本地预览** — `npm run tauri dev`
3. **清理警告** — 81 个 Rust warnings (多为未使用的骨架代码)
4. **补充集成测试** — 当前为纯单元测试
5. **添加前端测试** — Vitest 配置已就绪但尚无测试
6. **集成 liquid-glass** — 包已安装，需在组件中导入使用
7. **完善 Provider 功能** — apply_config/remove_config 已实现但未完全测试
8. **完善 MCP 编辑** — 新增/编辑/删除功能需要前端对接后端

## 常用命令

```bash
# 前端开发
npm run dev              # Vite 开发服务器
npm run typecheck        # TypeScript 类型检查
npm run build            # 前端生产构建

# Tauri
npm run tauri dev        # 启动桌面应用 (开发模式)
npm run tauri build      # 构建安装包
npm run tauri:build-arm64 # ARM64 构建

# Rust
cd src-tauri && cargo test     # 运行测试
cd src-tauri && cargo check    # 编译检查
cd src-tauri && cargo fix      # 自动修复警告
```

## 注意事项

- Cargo 镜像已配置为 USTC，如遇网络问题可切换
- 系统代理配置: `127.0.0.1:7897` (Clash)
- 无代码签名，首次运行会触发 SmartScreen
- 便携版不需要管理员权限
```

