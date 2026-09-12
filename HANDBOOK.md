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
D:\桌面\软件\NewCC/
├── src/                    # React 前端
│   ├── pages/              # 9 个页面
│   ├── components/         # 共享 UI 组件（含 glass/ 玻璃拟态组件）
│   ├── services/tauri.ts   # IPC 封装
│   ├── stores/             # Zustand stores
│   └── types/index.ts      # TS 类型定义
├── src-tauri/src/          # Rust 后端（15 个模块 + main.rs 入口）
│   ├── commands/           # Tauri 命令处理器（8 文件）
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
| Rust 测试 | ✅ **89/89 通过** |
| Git 仓库 | ✅ 已初始化 (commit 907dcea) |

## Rust 模块清单

| 模块 | 文件 | 功能 |
|------|------|------|
| `commands/` | 8 文件 | Tauri IPC 命令 (30 个命令) |
| `error` | error.rs | `AppError` 统一错误码 (30+) |
| `task` | task.rs | 任务系统 (进度/取消/事件) |
| `logging` | logging.rs | 日志脱敏 (API Key/Token/密码) |
| `security` | security.rs | 路径验证/Shell校验/权限检查 |
| `process` | process.rs | 安全命令执行 (超时/取消) |
| `environment` | environment.rs | Windows/PS/Git/WebView2检测 |
| `env_refresh` | env_refresh.rs | 环境变量刷新（PATH 变更后重载） |
| `config` | config.rs | 配置读取/原子写入/备份 |
| `credentials` | credentials.rs | Windows Credential Manager |
| `installer` | installer.rs | Claude Code 安装/卸载 |
| `impl_providers` | impl_providers.rs | Anthropic/DeepSeek/Custom 适配器（含模型检测） |
| `mcp` | mcp.rs | MCP 测试 (stdio/HTTP 握手) |
| `providers` | providers.rs | ProviderAdapter trait + 类型 |
| `diagnostics` | diagnostics.rs | 系统诊断检查 |

## Tauri 命令列表 (30 个)

```
detect_environment        环境检测
check_path                PATH 检查
refresh_environment       刷新环境变量
detect_node_detailed      检测 Node.js 详情
get_tasks                 任务列表
cancel_task               取消任务
clear_tasks               清除已完成
run_diagnostics           全量诊断
list_config_files         配置列表
read_config_file          读取配置
write_config_file         写入配置
test_provider_connection  测试 Provider 连接
detect_provider_models    检测模型
save_provider_credential  保存 Provider 凭据
get_provider_credential   读取 Provider 凭据
delete_provider_credential 删除 Provider 凭据
save_provider_config      保存 Provider 配置
load_provider_config      读取 Provider 配置
list_mcp_servers          列出 MCP Server
test_mcp_server           测试 MCP 连接
update_mcp_server         更新 MCP Server
delete_mcp_server         删除 MCP Server
test_raw_mcp_stdio        测试原始 MCP Stdio
generate_install_plan     生成安装计划
detect_node_js            检测 Node.js
run_claude                运行 Claude Code
install_claude_code       安装 Claude Code
install_full_environment  安装完整环境
uninstall_claude_code     卸载 Claude Code
restart_app               重启应用
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
| 软件更新 | `#updates` | Claude Code 更新（CCM 自身自动更新计划中） |
| 设置 | `#settings` | 主题/动画/布局配置 |
| 关于 | `#about` | 版本/技术栈/链接 |

## 新手引导

应用首次启动时显示 7 步 Onboarding 向导：
1. 欢迎页 → 2. 检测环境 → 3. 安装 Claude Code → 4. 配置 API → 5. 检测模型 → 6. MCP(可选) → 7. 完成

可通过 `stores/appStore.ts` 中的 `onboardingCompleted` 控制。

## 测试覆盖 (89 个)

| 模块 | 测试数 | 覆盖内容 |
|------|--------|---------|
| `security` | 38 | 路径验证/shell校验/MCP命令/提权 |
| `environment` | 27 | Windows检测/PS/Git/WebView2/序列化 |
| `env_refresh` | 8 | 环境变量刷新 |
| `process` | 5 | CommandSpec/命令执行/超时/取消 |
| `logging` | 6 | API Key脱敏/路径脱敏/边界 |
| `config` | 3 | 作用域解析/写入校验 |
| `credentials` | 1 | 凭据ID格式 |
| `diagnostics` | 1 | 诊断不panic |

运行测试: `cd src-tauri && cargo test`

## WebView2 启动期引导安装

Windows 10 默认未安装 WebView2，而便携版是单文件 exe（不内置引导安装器）。
`main.rs` 在进入 Tauri、前端渲染之前处理缺失，流程：

1. 已安装 → 直接 `app_lib::run()` 启动。
2. 缺失时，先尝试运行 exe **同目录**的 `MicrosoftEdgeWebview2Setup.exe`（`/silent /install`）。
3. 同目录没有或安装失败 → 弹 `MB_OKCANCEL` 确认框，询问是否自动下载并安装。
   - 确认 → 用 `reqwest` + `tokio` 下载 Evergreen 引导安装器到 `%TEMP%`（校验 > 500KB），
     再以非静默 `/install` 运行（显示微软官方进度窗口），完成后用 `detect_webview2()` 二次校验。
   - 取消 → 直接退出。
4. 下载或安装失败 → 弹含官网链接的错误框后退出。

引导安装器下载地址（`main.rs` 常量 `WEBVIEW2_BOOTSTRAPPER_URL`）：
`https://go.microsoft.com/fwlink/p/?LinkId=2124703`（与 `package.json` 的 `download:webview2` 脚本一致）。

## 安全设计亮点

- API Key 存 Windows Credential Manager，并明文写入 `~/.claude/settings.json`
  （Claude Code 只认字面值 token）；写入前自动生成 `.bak` 备份，写入后回读校验
- 前端不执行任何系统命令 → 所有操作经 Rust IPC
- 命令使用参数数组 → 无字符串拼接/注入
- 日志统一脱敏 → API Key/Token/密码/邮箱自动替换
- 原子文件写入 → 写入前备份，写入失败自动回滚
- 路径规范化 → 防止路径遍历攻击

## 下一步工作

1. **构建安装包** — `npx tauri build --bundles nsis`
2. **本地预览** — `npm run tauri dev`
3. **清理警告** — 81 个 Rust warnings (多为未使用的骨架代码)
4. **补充集成测试** — 当前为纯单元测试
5. **添加前端测试** — Vitest 配置已就绪但尚无测试
6. ~~集成 liquid-glass~~ — 已完成，玻璃拟态组件已广泛使用（`src/components/glass/`）
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

