# Claude Code Manager — Handoff Document

## 项目概览

**定位**: Claude Code 的一键安装和可视化管理工具，同时提供 GUI 桌面版和 CLI 终端版。

**核心能力**: 用户无需手动编辑 `~/.claude/settings.json` 和 YAML frontmatter 文件，通过图形界面或终端 TUI 即可管理全部配置。

**对标参考**: CLI 版本借鉴了 [rustnet](https://github.com/domcyrus/rustnet) 的 TUI 架构模式（ratatui + crossterm），但全部为原创 Rust 代码。

## 代码仓库位置

```
linux/            # 主仓库 RRRadiant/claude-code-manager 的 Linux 子项目
```

> 本文档写于 Linux 版独立开发阶段。文中「项目根」按子项目根 `linux/` 理解；
> Windows 版（Tauri）位于其上一级目录。

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    发布包 (dist/)                        │
│  ┌───────────────────┐  ┌─────────────────────────────┐ │
│  │   linux-x64.zip   │  │      linux-arm64.zip        │ │
│  │   ├── AppImage     │  │   ├── AppImage              │ │
│  │   ├── ccm (CLI)    │  │   ├── ccm (CLI)             │ │
│  │   └── 启动脚本      │  │   └── 启动脚本               │ │
│  └───────────────────┘  └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
         ▲                              ▲
         │         electron-builder     │
         │         cargo zigbuild       │
         │                              │
┌────────┴──────────────────────────────┴─────────────────┐
│                      源代码                               │
│  ┌─────────────────────┐  ┌────────────────────────────┐ │
│  │   src/ (GUI)         │  │   cli/ccm-tui/ (CLI)       │ │
│  │   Electron + React   │  │   Rust + ratatui           │ │
│  │   TypeScript         │  │   单文件 ~980KB            │ │
│  └─────────────────────┘  └────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## 目录结构详解

```
claude-code-manager/
│
├── README.md                    # 项目说明（中英混合）
├── LICENSE                      # MIT
├── package.json                 # Electron 项目配置 + electron-builder 打包
├── electron.vite.config.ts      # electron-vite 构建配置
├── tsconfig.json                # TypeScript 配置
│
├── src/                         # ===== GUI 源码 (Electron) =====
│   ├── main/                    # 主进程
│   │   ├── index.ts             # BrowserWindow 创建, preload 注册
│   │   ├── ipc/                 # IPC 处理器 (contextBridge + invoke/handle)
│   │   │   ├── index.ts         # 统一注册入口
│   │   │   ├── config.ts        # settings.json 读写 + 深度合并
│   │   │   ├── agents.ts        # Agents CRUD (YAML frontmatter)
│   │   │   ├── commands.ts      # Skills CRUD (JSON/Markdown)
│   │   │   ├── plugins.ts       # 插件管理 (list/toggle/uninstall)
│   │   │   ├── hooks.ts         # 13 生命周期 hooks
│   │   │   ├── mcp.ts           # MCP Servers (stdio/sse)
│   │   │   ├── cli.ts           # Claude Code CLI 检测+安装 (6种路径)
│   │   │   ├── api-detector.ts  # 供应商模型自动检测
│   │   │   ├── safe-storage.ts  # electron.safeStorage 加密 API Key
│   │   │   └── file-watcher.ts  # chokidar 监听 ~/.claude/
│   │   ├── services/
│   │   │   ├── cli-detector.ts      # CLI 路径扫描
│   │   │   ├── dependency-checker.ts # 系统依赖检测 (libz, libsecret...)
│   │   │   └── providers.ts         # API 供应商定义
│   │   └── utils/
│   │       └── paths.ts             # ~/.claude 路径常量
│   │
│   ├── preload/
│   │   └── index.ts                 # contextBridge API (类型安全)
│   │
│   └── renderer/                    # React 前端
│       ├── App.tsx                  # 根组件
│       ├── main.tsx                 # ReactDOM 入口
│       ├── index.html               # HTML 壳
│       ├── env.d.ts                 # 类型声明 (window.electronAPI)
│       ├── styles/
│       │   └── global.css           # Tailwind CSS v4 + CSS 变量
│       ├── stores/
│       │   ├── configStore.ts       # Zustand: settings.json
│       │   ├── environmentStore.ts  # Zustand: 安装管线 + 依赖 + 桌面图标
│       │   └── appStore.ts          # Zustand: 向导开关、CLI 状态
│       ├── types/
│       │   └── claude-config.ts     # 完整 TypeScript 类型
│       └── components/
│           ├── layout/
│           │   ├── MainLayout.tsx   # 主布局 + 面板记忆 + 首次运行浮层
│           │   └── Sidebar.tsx      # 可折叠侧边栏 (10 项)
│           ├── onboarding/          # 首次运行向导（浮层，可跳过，可重开）
│           │   └── Onboarding.tsx
│           ├── environment/         # 环境面板
│           │   ├── EnvironmentPanel.tsx
│           │   ├── DependenciesCard.tsx   # 系统依赖 + 一键安装（开终端）
│           │   ├── ExistingConfigCard.tsx # 已有配置扫描 + 采纳 shell 变量
│           │   └── RestartPrompt.tsx      # 装完倒计时重启
│           ├── api-config/          # API 配置面板
│           ├── model-manager/       # 模型管理（三档层级映射可编辑）
│           ├── skills-manager/      # Skills 管理
│           ├── agents-manager/      # Agents 管理
│           ├── plugins-manager/     # 插件 + Marketplace
│           ├── hooks-manager/       # Hooks 管理
│           ├── mcp-manager/         # MCP Servers 管理
│           ├── settings/            # 通用设置 + 配置文件编辑
│           └── shared/              # JsonEditor, ConfirmDialog 等
│
├── cli/                         # ===== CLI 源码 =====
│   ├── ccm                      # 入口脚本 (优先 Rust 二进制)
│   └── ccm-tui/                 # Rust TUI 项目
│       ├── Cargo.toml           # ratatui 0.30 + crossterm 0.29
│       ├── install.sh           # 一键安装脚本
│       ├── dist/                # 预编译二进制 (本地开发用)
│       │   ├── ccm-linux-x64
│       │   ├── ccm-linux-arm64
│       │   └── ccm-macos-arm64
│       └── src/
│           ├── main.rs          # TUI 事件循环
│           ├── app.rs           # 应用状态 (~/.claude 读写)
│           └── ui/
│               ├── mod.rs       # 8 标签页 dispatch
│               ├── theme.rs     # 7 色主题
│               ├── state.rs     # UI 状态
│               ├── terminal.rs  # crossterm 设置/恢复
│               ├── widgets/
│               │   ├── tabs_bar.rs    # 顶部标签栏
│               │   └── status_bar.rs  # 底部快捷键提示
│               └── tabs/
│                   ├── status.rs      # 仪表盘
│                   ├── install.rs     # 安装器
│                   ├── api.rs         # API 配置
│                   ├── models.rs      # 模型映射
│                   ├── skills.rs      # Skills CRUD
│                   ├── agents.rs      # Agents CRUD
│                   ├── config.rs      # 配置文件编辑
│                   └── help.rs        # 帮助
│
├── resources/                   # 打包资源
│   └── linux/
│       ├── 512x512.png          # AppImage 图标
│       ├── icon.svg             # SVG 图标
│       ├── AppRun               # AppImage 入口
│       └── claude-code-manager.desktop  # 桌面入口文件
│
├── .github/workflows/
│   ├── release.yml              # CI: 打包 x64/arm64 AppImage + ccm 二进制
│   └── build-cli.yml            # CI: 仅 CLI 构建+Release
│
└── dist/                        # 打包输出 (gitignored)
    ├── Claude-Code-Manager.sh   # 统一启动脚本
    ├── linux-x64.zip            # x64 分发包
    ├── linux-arm64.zip          # ARM64 分发包
    ├── ccm-linux-x64            # 独立 CLI
    ├── ccm-linux-arm64          # 独立 CLI
    └── *.AppImage               # 独立 GUI
```

## 技术栈

### GUI (Electron)

| 层 | 技术 | 说明 |
|---|---|---|
| 桌面框架 | Electron 42 | contextIsolation + sandbox |
| 构建 | electron-vite 5 | HMR 全链路 |
| 前端 | React 19 + TypeScript | |
| 样式 | Tailwind CSS v4 | CSS 变量主题 |
| 状态管理 | Zustand | persist 中间件 |
| 代码编辑器 | Monaco Editor | 本地打包, 不依赖 CDN |
| IPC | contextBridge + invoke/handle | Renderer 零 Node 权限 |
| 文件监听 | chokidar | 1s 消抖, Linux inotify |
| 加密存储 | electron.safeStorage | Linux: libsecret, macOS: Keychain |
| 打包 | electron-builder | AppImage (.AppImage), deb, NSIS |
| CI | GitHub Actions | Ubuntu 24.04 runner |

### CLI (Rust TUI)

| 层 | 技术 | 说明 |
|---|---|---|
| TUI 框架 | ratatui 0.30 | Rust 终端 UI |
| 终端控制 | crossterm 0.29 | raw mode, 键盘事件 |
| 配置解析 | serde_json | ~/.claude/settings.json |
| 命令行检测 | which | 扫描 PATH |
| 跨编译 | cargo-zigbuild | macOS → Linux ELF |
| 最终大小 | ~980KB | LTO + strip 后 |

## 关键设计决策

### 1. 安全模型

```
Renderer (沙箱)                 Main Process
─────────────────               ─────────────
零 Node 权限                    唯一有权读写文件
通过 contextBridge 暴露 API      safeStorage 加密/解密
sandbox: true                   所有 IPC 处理器
```

### 2. CLI 双版本策略

`cli/ccm` → 优先运行 Rust TUI 二进制，未安装则提示安装并回退到 gum 脚本。gum 脚本保留在 `cli/ccm-gum` 作为备份。

### 3. DeepSeek/供应商 URL 处理

- 用户自由编辑 Base URL，切换供应商自动填充默认值
- 模型检测自动剥离 `/anthropic` 等后缀，用根 URL 调 `/models`
- 多候选端点依次尝试 (参考官方文档 `https://api-docs.deepseek.com/zh-cn/api/list-models`)

### 4. 启动脚本 (`Claude-Code-Manager.sh`)

自动完成: 系统依赖安装 → AppImage 安装 → CLI 二进制安装 → GUI 启动。主要处理:
- `libz.so` 缺失 (Ubuntu 24.04 libfuse2t64 问题)
- `libsecret-1.so.0` (safeStorage 加密)
- FUSE 不可用时的 --appimage-extract 回退
- `~/.local/bin` PATH 自动追加
- D-Bus 会话管理

### 5. 跨架构兼容

| 构建方式 | x64 | ARM64 |
|---------|:---:|:-----:|
| macOS → macOS | ✅ cargo build | ✅ cargo build |
| macOS → Linux | ✅ cargo zigbuild | ✅ cargo zigbuild |
| Linux → Linux | ✅ native | ✅ native (2 小时) |
| Windows | CI 仅 | CI 仅 |

## 构建命令

### GUI (Electron)

```bash
npm install --legacy-peer-deps
npm run dev          # 开发模式 (HMR)
npm run build        # 仅构建
npm run package:appimage  # 构建 + 打包 AppImage (x64)
npx electron-builder --linux appImage --arm64  # ARM64 打包
npm run package:all  # 全平台: --linux --mac --win
```

### CLI (Rust TUI)

```bash
cd cli/ccm-tui
cargo build --release                              # 本地平台
cargo zigbuild --target x86_64-unknown-linux-gnu --release   # Linux x64
cargo zigbuild --target aarch64-unknown-linux-gnu --release  # Linux ARM64
# 输出: target/<target>/release/ccm
```

### 安装 cargo-zigbuild (跨编译 Linux)

```bash
brew install zig          # macOS 安装 Zig linker
cargo install cargo-zigbuild
rustup target add x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu
```

## 发布流程

```bash
# 1. 确保所有改动已构建
npm run build
cd cli/ccm-tui && cargo zigbuild --target x86_64-unknown-linux-gnu --target aarch64-unknown-linux-gnu --release && cd ../..

# 2. 打包 AppImage (两个架构)
npx electron-builder --linux appImage --x64
npx electron-builder --linux appImage --arm64

# 3. 组装分发包
cp dist/Claude\ Code\ Manager-1.0.0.AppImage dist/linux-x64/
cp dist/Claude\ Code\ Manager-1.0.0-arm64.AppImage dist/linux-arm64/
cp cli/ccm-tui/dist/ccm-linux-x64 dist/linux-x64/ccm
cp cli/ccm-tui/dist/ccm-linux-arm64 dist/linux-arm64/ccm
cp dist/Claude-Code-Manager.sh dist/linux-x64/
cp dist/Claude-Code-Manager.sh dist/linux-arm64/

# 4. 打包 zip
cd dist
zip -r linux-x64.zip linux-x64/
zip -r linux-arm64.zip linux-arm64/

# 5. Git tag 推送触发 CI Release
git add . && git commit -m "release: v1.0.0"
git tag v1.0.0
git push origin main --tags
```

CI 自动创建 GitHub Release 并上传 4 个文件: `linux-x64.zip`, `linux-arm64.zip`, `ccm-linux-x64`, `ccm-linux-arm64`.

## 配置目录映射

| Claude Code 路径 | 管理面板功能 |
|---|---|
| `~/.claude/settings.json` | GUI: API 配置 / CLI: API tab |
| `~/.claude/settings.local.json` | GUI: 本地配置覆盖 |
| `~/.claude/commands/*.md` | Skills 管理 |
| `~/.claude/agents/*.md` | Agents 管理 |
| `~/.claude/plugins/` | 插件管理 |
| `~/.claude/.mcp.json` | MCP Servers |
| `~/.claude/CLAUDE.md` | 项目指令文件 |

## 用户使用流程

### 新用户 (GUI)

```
1. scp linux-x64.zip → Linux 机器
2. unzip linux-x64.zip && cd linux-x64
3. chmod +x Claude-Code-Manager.sh && ./Claude-Code-Manager.sh
   → 自动安装依赖
   → 自动安装 AppImage 到 ~/.local/bin/
   → 自动安装 CLI 到 ~/.local/bin/ccm
   → 启动 GUI 首次运行向导
4. 向导: 环境检测 → 安装 Claude Code CLI → 配置 API Key → 选择模型 → 完成
5. 管理面板: 管理 Skills/Agents/Plugins/MCP...
```

### 新用户 (CLI)

```
1. 终端输入 ccm (启动脚本已自动安装)
   或 ./ccm (直接运行二进制)
2. 键盘操作:
   1-8      跳标签
   Tab/]    下一个标签
   ↑↓/j k   移动光标
   Enter    确认
   n/d      新建/删除 Skill/Agent
   s        保存配置文件
   q        退出
```

## 已知限制

1. **启动脚本依赖 apt**: 非 Debian 系发行版需手动安装依赖 (`libsecret`, `gnome-keyring`, `zlib1g-dev`)
2. **safeStorage 依赖 gnome-keyring**: 无桌面环境的服务器可能无法使用加密存储
3. **arm64 AppImage 需在对应环境测试**: 本地 macOS ARM 可编译但未在 Linux ARM 实测
4. **无 macOS/Windows 打包**: CI 配置了 macOS/Windows 目标但未测试
5. **Monaco Editor 包体积大**: GUI asar 约 35MB (Monaco 占大部分)
6. **CLI 无 Hooks/Plugins/MCP 管理**: 仅 GUI 支持这些高级功能

## 环境依赖

### 构建时

- Node.js 22+ + npm
- Rust 1.80+ (for CLI)
- Zig (for Linux cross-compilation)
- libsecret-1-dev (Linux, for safeStorage native addon)

### 运行时 (用户机器)

- **通用**: Linux kernel 3.10+, glibc 2.17+
- **GUI 额外**: FUSE (for AppImage) / libsecret / gnome-keyring / GTK3 / libnotify
- **CLI**: 无额外依赖 (静态链接 libc)
