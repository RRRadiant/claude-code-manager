# ADR-0001: 自动更新暂缓接入

- 状态：已接受
- 日期：2026-07-20

## 背景

项目早期规划中包含应用自身（CCM）的自动更新能力，设想通过 Tauri updater 插件
实现「下载新版本 → 校验 Ed25519 签名 + SHA-256 → 替换 / 升级」的流程。

但当前阶段：

- `src-tauri/capabilities/default.json` 仅授予 `core:default`，未启用 `plugin:updater`
- 前端与后端均无 updater 相关实现（`@tauri-apps/plugin-updater` 与相关 Rust 模块不存在）
- 发布工作流中的 update manifest 仅为占位骨架，签名仍是硬编码占位符

## 决策

**暂缓接入 CCM 自动更新，将其标记为「计划中」。**

- 用户通过手动下载 GitHub Releases 获取新版本（便携版 / 安装版）。
- Claude Code 自身的更新走 Claude Code 内置机制（终端 `claude update`），CCM 不重复实现。
- 保留发布工作流中 update manifest 的生成骨架与签名占位符，并标注 TODO，
  待自动更新正式落地后再接入真实签名。

## 后果

- 优点：避免在签名密钥、更新服务器、回滚机制尚未就绪时发布不可用的更新通道；
  降低安全面（不暴露未经验证的签名验证链路）。
- 代价：用户需手动更新 CCM；`docs/security.md` 第 7 节与相关文档必须明确标注
  「自动更新尚未实现（计划中）」，不得再声称已实现 Ed25519 验证。

## 关联

- 发布工作流：`.github/workflows/release.yml`
- 安全文档：`docs/security.md` 第 7 节
