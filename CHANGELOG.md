# 更新日志

本项目的所有重要变更均记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增
- MCP 测试命令安全校验（拒绝 shell 元字符与路径穿越）。
- 依赖自动更新扫描（Dependabot：npm + cargo，每周）。
- 工程文档：CONTEXT.md、架构决策记录（ADR）。

### 变更
- 移除未使用的 `@tauri-apps/plugin-shell` 前端依赖。
- 修正发布工作流与 CI 工作流中的 Windows 打包与校验逻辑。

### 修复
- `.gitignore` 补充忽略 `.zcode/` 与 WebView2 引导安装程序。

## [0.1.0] - 2026-07-20

### 新增
- 首个版本：Claude Code Manager Windows 图形化管理工具。
- Claude Code 环境检测、安装与卸载。
- API 服务商配置（Anthropic、DeepSeek、自定义兼容接口）。
- 模型检测与选择。
- 配置文件可视化编辑（settings.json、CLAUDE.md、.mcp.json）。
- MCP Server 管理与测试。
- 故障诊断。
- 凭据经 Windows Credential Manager 安全存储。
- 日志脱敏（API Key / Token / 密码 / 邮箱）。
