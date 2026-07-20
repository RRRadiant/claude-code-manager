# 贡献指南

感谢你考虑为 Claude Code Manager 贡献代码！

## 行为准则

本项目采用 [Contributor Covenant](CODE_OF_CONDUCT.md) 行为准则。请确保你的互动是尊重和包容的。

## 开发流程

1. Fork 仓库并创建你的分支 (`git checkout -b feature/my-feature`)
2. 提交更改 (`git commit -m 'feat: add my feature'`)
3. 推送到分支 (`git push origin feature/my-feature`)
4. 创建 Pull Request

## 代码风格

### Rust
- 使用 `cargo fmt` 格式化代码
- 使用 `cargo clippy` 检查常见错误
- 遵循 Rust API 指南

### TypeScript / React
- 使用 `npx oxlint` 检查代码
- 使用 `npx tsc --noEmit` 类型检查
- 组件使用函数式组件 + Hooks
- 状态管理使用 Zustand

## 提交信息

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档更新
- `refactor:` 代码重构
- `test:` 测试
- `chore:` 构建/工具链

## 测试

- Rust: `cargo test`
- 前端: `npx vitest run`
- TypeScript: `npx tsc --noEmit`

确保所有测试通过后再提交 PR。

## Pull Request 要求

- 提供清晰的描述和动机
- 包含测试（如适用）
- 不引入新的编译器警告
- 不泄露敏感信息到日志
- 更新相关文档
