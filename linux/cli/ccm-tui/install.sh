#!/bin/bash
# Claude Code Manager TUI — 一键安装
# 用法: 在源码目录执行 bash install.sh
#
# 安装顺序：先用本目录 cargo 构建产物 target/release/ccm。其次才是
# dist/ccm-<os>-<arch>，那是你从 GitHub Releases 下载后自己放进来的文件，
# 仓库不再提交这些二进制。两者都没有时请先构建或下载（见下方提示）。
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

# Best first: the binary you just built, then a release asset you downloaded
# into dist/ (ccm-linux-x64, ccm-linux-arm64, or ccm-macos-arm64).
# A browser download is not executable. chmod it before the -x test, or a
# fresh install skips the file that is sitting right there.
for CANDIDATE in \
    "$SCRIPT_DIR/target/release/ccm" \
    "$SCRIPT_DIR/dist/ccm-${P}-${A}"; do
    if [ -f "$CANDIDATE" ]; then
        chmod +x "$CANDIDATE"
        if [ -x "$CANDIDATE" ]; then
            echo -e "  ${G}使用本地二进制${N}: $CANDIDATE"
            cp "$CANDIDATE" "$BIN"
            break
        fi
    fi
done

if [ ! -x "$BIN" ]; then
    echo -e "${R}没有找到可用的 ccm 二进制${N}"
    echo -e "  在源码目录构建后重跑本脚本："
    echo -e "    cd cli/ccm-tui && cargo build --release"
    echo -e "  或从 GitHub Releases 下载 ${C}ccm-${P}-${A}${N}，用同目录的 SHA256 校验后放到 dist/ 再重跑："
    echo -e "    https://github.com/RRRadiant/claude-code-manager/releases"
    exit 1
fi
chmod +x "$BIN"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$HOME/.bashrc"
    echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$HOME/.zshrc" 2>/dev/null || true
fi
echo -e "${G}✓ 安装完成!${N}  运行: ccm"
