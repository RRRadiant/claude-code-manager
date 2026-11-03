#!/bin/bash
# Claude Code Manager TUI — 一键安装
# 用法: 在源码目录执行 bash install.sh
#
# 安装顺序：先找 cargo 构建产物 target/release/ccm，再退回 dist/ 下随仓库分发的
# 预编译二进制。两者都没有时请先构建（见下方提示）。
set -e
R='\033[0;31m' G='\033[0;32m' C='\033[0;36m' N='\033[0m'
BIN_DIR="$HOME/.local/bin"; BIN="$BIN_DIR/ccm"
ARCH=$(uname -m); OS=$(uname -s)
case "$OS" in
    Linux) P="linux"; case "$ARCH" in x86_64) A="x64" ;; aarch64) A="arm64" ;; *) echo -e "${R}不支持的架构: $ARCH${N}"; exit 1 ;; esac ;;
    Darwin) P="macos"; case "$ARCH" in x86_64) A="x64" ;; arm64) A="arm64" ;; *) echo -e "${R}不支持的架构: $ARCH${N}"; exit 1 ;; esac ;;
    *) echo -e "${R}不支持的系统: $OS${N}"; exit 1 ;;
esac
echo -e "${C}  Claude Code Manager TUI — ${OS} ${A}${N}"
mkdir -p "$BIN_DIR"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Candidate binaries, best first: the binary you just built, then the prebuilt
# one committed under dist/ (built at 1.0.0; rebuild from source for current fixes,
# see docs/kali-verification.md).
for CANDIDATE in \
    "$SCRIPT_DIR/target/release/ccm" \
    "$SCRIPT_DIR/dist/ccm-${P}-${A}"; do
    if [ -x "$CANDIDATE" ]; then
        echo -e "  ${G}使用本地二进制${N}: $CANDIDATE"
        cp "$CANDIDATE" "$BIN"
        break
    fi
done

if [ ! -x "$BIN" ]; then
    echo -e "${R}没有找到可用的 ccm 二进制${N}"
    echo -e "  请先在源码目录构建，然后重跑本脚本："
    echo -e "    cd cli/ccm-tui && cargo build --release"
    exit 1
fi
chmod +x "$BIN"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$HOME/.bashrc"
    echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$HOME/.zshrc" 2>/dev/null || true
fi
echo -e "${G}✓ 安装完成!${N}  运行: ccm"
