# Release Process

## Prerequisites

1. Ensure you have all target toolchains installed:
   ```bash
   rustup target add x86_64-pc-windows-msvc
   rustup target add aarch64-pc-windows-msvc
   ```

2. Install Visual Studio ARM64 build tools (for ARM64 builds)

3. Set up code signing certificate (recommended)

## Creating a Release

1. Update version in:
   - `src-tauri/Cargo.toml` (package.version)
   - `src-tauri/tauri.conf.json` (version)
   - `package.json` (version)

2. Update `CHANGELOG.md`

3. Commit and tag:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. GitHub Actions will automatically:
   - Build x64 portable + installer
   - Build ARM64 portable
   - Generate SHA-256 checksums
   - Generate update manifest
   - Create a draft release

5. Review and publish the draft release on GitHub.

## Release Artifacts

| File | Description |
|------|-------------|
| `ClaudeCodeManager-x64-portable.exe` | x64 portable (no install needed) |
| `ClaudeCodeManager-arm64-portable.exe` | ARM64 portable |
| `ClaudeCodeManager-x64-setup.exe` | x64 NSIS installer |
| `*-SHA256.txt` | Checksum files |
| `update-manifest.json` | Auto-update manifest |
| `sbom.json` | Software Bill of Materials |

## Version Scheme

Follow SemVer: `MAJOR.MINOR.PATCH`

- MAJOR: Breaking changes
- MINOR: New features, backward compatible
- PATCH: Bug fixes

## Pre-release

For beta releases, use `-beta.N` suffix:
```bash
git tag v0.2.0-beta.1
```

The release workflow will create a prerelease on GitHub.
