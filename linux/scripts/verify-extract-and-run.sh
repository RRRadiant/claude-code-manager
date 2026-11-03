#!/usr/bin/env bash
# Does `--appimage-extract-and-run` actually rescue a machine without FUSE 2?
#
# The user's machine reported "Cannot mount AppImage, please check your FUSE
# setup." — an AppImage runtime message, not an Electron one. The question this
# answers is whether a single flag makes the AppImage work anyway, which would
# turn "every user must install libfuse2" into "ship one extra argument".
#
# FUSE 2 is hidden by making the dynamic loader unable to resolve libfuse.so.2:
# the AppImage runtime is static, but it dlopen()s libfuse at mount time, and
# LD_LIBRARY_PATH takes precedence over the system search path for that lookup.
# This is a faithful simulation of a machine without the package — verified by
# the fact that the plain launch must fail with the FUSE message.
#
# Usage: bash verify-extract-and-run.sh [AppImage]

set -uo pipefail

A="${1:-$HOME/ccm/dist/Claude Code Manager-1.0.0.AppImage}"
EMPTY="$(mktemp -d)"
trap 'rm -rf "$EMPTY"' EXIT

echo "══════════════════════════════════════════════"
echo " 无 FUSE 2 时的启动方式对比"
echo "══════════════════════════════════════════════"
echo "  目标：$A"
echo "  隐藏 libfuse.so.2 的方式：LD_LIBRARY_PATH=$EMPTY"
echo

# Sanity check: with the system path intact, does the runtime even look for FUSE?
echo "── 基线：LD_LIBRARY_PATH 指向空目录（模拟缺 FUSE）──"
for mode in "--plain" "--extract-and-run"; do
    case "$mode" in
        --plain) args=() ; label="普通运行（= 双击等价）" ;;
        --extract-and-run) args=(--appimage-extract-and-run) ; label="加 --appimage-extract-and-run" ;;
    esac

    printf '  %-34s ' "$label"
    out="$(env LD_LIBRARY_PATH="$EMPTY" timeout 25 "$A" "${args[@]}" 2>&1)"
    rc=$?

    if printf '%s' "$out" | grep -q 'Cannot mount AppImage'; then
        echo "✗ 失败：Cannot mount AppImage（缺 FUSE）"
        printf '%s\n' "$out" | head -3 | sed 's/^/        /'
    elif printf '%s' "$out" | grep -qE 'Missing X server|DISPLAY|ozone'; then
        echo "✓ 通过：程序已加载（仅缺显示环境）"
    elif printf '%s' "$out" | grep -q 'appimage_extracted'; then
        echo "✓ 通过：已解包到临时目录"
        printf '%s\n' "$out" | head -2 | sed 's/^/        /'
    elif [ "$rc" = "124" ]; then
        echo "✓ 通过：进程持续运行（超时未退出）"
    else
        echo "? 未知（exit=$rc）"
        printf '%s\n' "$out" | head -4 | sed 's/^/        /'
    fi
done

echo
echo "── 对照：LD_LIBRARY_PATH 指向真实库目录（FUSE 可用）──"
printf '  %-34s ' "普通运行"
out="$(env LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu timeout 25 "$A" 2>&1)"
if printf '%s' "$out" | grep -q 'Cannot mount AppImage'; then
    echo "✗ 仍然报 FUSE —— 说明系统确实缺 FUSE"
    echo "  （本机 dpkg: $(dpkg -l 2>/dev/null | grep -cE 'libfuse') 个 libfuse 包）"
elif printf '%s' "$out" | grep -qE 'Missing X server|DISPLAY|ozone'; then
    echo "✓ 挂载成功，程序已加载"
else
    echo "? exit=$? —— $(printf '%s' "$out" | head -1)"
fi

echo
echo "══════════════════════════════════════════════"
echo " 结论"
echo "══════════════════════════════════════════════"
if env LD_LIBRARY_PATH="$EMPTY" timeout 25 "$A" --appimage-extract-and-run 2>&1 | grep -qE 'Missing X server|DISPLAY|appimage_extracted'; then
    echo "  → --appimage-extract-and-run 可以在没有 FUSE 的机器上启动程序。"
    echo "    因此可以在 .desktop 的 Exec 行加这个参数，让双击直接可用，"
    echo "    用户无需安装任何东西。"
else
    echo "  → 该参数不足以绕过 FUSE 缺失，需要换运行时或改用其他分发格式。"
fi
echo
