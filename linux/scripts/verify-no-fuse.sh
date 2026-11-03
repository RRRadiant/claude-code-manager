#!/usr/bin/env bash
# Does `--appimage-extract-and-run` rescue a machine without FUSE 2?
#
# The user's machine reports "Cannot mount AppImage, please check your FUSE
# setup." Verified against their screenshot. This script answers whether one
# extra flag makes the AppImage work anyway, which would replace "every user must
# install libfuse2" with "ship one extra argument in the .desktop file".
#
# Hiding the library: LD_LIBRARY_PATH is NOT enough — the AppImage runtime
# resolves libfuse through the system search path, not that variable, so an
# earlier attempt at this test produced a false pass on a machine that has FUSE.
# A bind-mount of /dev/null over the real libfuse.so.2 is decisive, because after
# it the loader genuinely cannot find the library. It needs root and is undone on
# exit, including on Ctrl-C.
#
# Requires root (or sudo). Falls back to reporting that it cannot test.
#
# Usage: sudo bash verify-no-fuse.sh [AppImage]

set -uo pipefail

A="${1:-/home/kali/ccm/dist/Claude Code Manager-1.0.0.AppImage}"
LIB=""
for c in /usr/lib/x86_64-linux-gnu/libfuse.so.2 /lib/x86_64-linux-gnu/libfuse.so.2 /usr/lib/libfuse.so.2; do
    [ -e "$c" ] && { LIB="$c"; break; }
done

echo "══════════════════════════════════════════════"
echo " 缺 FUSE 2 时的启动方式对比（绑定挂载遮罩）"
echo "══════════════════════════════════════════════"
echo "  目标：$A"
echo "  库：${LIB:-<未找到>}"

if [ "$(id -u)" -ne 0 ]; then
    echo
    echo "  需要 root 才能绑定挂载遮罩库文件。请用 sudo 重新运行："
    echo "    sudo bash $0 \"$A\""
    echo
    echo "  （没有 root 就无法在本机真实模拟缺 FUSE，这正是不该假装测过的原因）"
    exit 2
fi

if [ -z "$LIB" ]; then
    echo "  本机没有 libfuse.so.2 可遮罩 —— 那它本来就没有 FUSE。"
    echo "  直接测："
    "$A" --version >/dev/null 2>&1
    echo "    普通运行 exit=$?"
    "$A" --appimage-extract-and-run --version >/dev/null 2>&1
    echo "    extract-and-run exit=$?"
    exit 0
fi

MASKED=0
restore() {
    if [ "$MASKED" -eq 1 ]; then
        umount "$LIB" 2>/dev/null && echo "  （已恢复 $LIB）"
        MASKED=0
    fi
}
trap restore EXIT INT TERM

echo
echo "── 遮罩 $LIB ──"
if ! mount --bind /dev/null "$LIB" 2>/dev/null; then
    echo "  绑定挂载失败（可能是只读或缺少权限），无法继续。"
    exit 2
fi
MASKED=1
echo "  已遮罩。loader 现在无法解析 libfuse.so.2："
if ldd "$A" >/dev/null 2>&1; then :; fi
printf '    ldconfig 查询: '
ldconfig -p 2>/dev/null | grep -c 'libfuse\.so\.2' | sed 's/^/条目 /'

echo
run_case() {
    local label="$1"; shift
    printf '  %-36s ' "$label"
    local out rc
    out="$(timeout 30 "$A" "$@" 2>&1)"
    rc=$?
    if printf '%s' "$out" | grep -q 'Cannot mount AppImage\|libfuse'; then
        echo "✗ 失败：$(printf '%s' "$out" | grep -oE 'Cannot mount AppImage.*|error loading libfuse[^ ]*' | head -1)"
        return 1
    fi
    if printf '%s' "$out" | grep -q 'appimage_extracted'; then
        echo "✓ 通过：解包到临时目录并启动"
        return 0
    fi
    if printf '%s' "$out" | grep -qE 'Missing X server|DISPLAY|ozone'; then
        echo "✓ 通过：程序已加载（仅缺显示环境）"
        return 0
    fi
    if [ "$rc" = "124" ]; then
        echo "✓ 通过：进程持续运行"
        return 0
    fi
    echo "? exit=$rc  $(printf '%s' "$out" | head -1 | cut -c1-60)"
    return 2
}

PLAIN_OK=0; EXTRACT_OK=0
run_case "普通运行（= 双击等价）" && PLAIN_OK=1
run_case "加 --appimage-extract-and-run" --appimage-extract-and-run && EXTRACT_OK=1

restore

echo
echo "══════════════════════════════════════════════"
echo " 结论"
echo "══════════════════════════════════════════════"
if [ "$EXTRACT_OK" = "1" ] && [ "$PLAIN_OK" = "0" ]; then
    echo "  ✓ 已证实：没有 FUSE 时，普通运行失败，但加 --appimage-extract-and-run 可以启动。"
    echo
    echo "  → 适配方案：把该参数写进 .desktop 的 Exec 行，用户双击即可，"
    echo "    无需安装任何东西："
    echo "        Exec=/path/to/AppImage --appimage-extract-and-run %U"
    echo "    代价：每次启动都要解包一次到 /tmp（约 444 MB，数秒）。"
elif [ "$EXTRACT_OK" = "1" ] && [ "$PLAIN_OK" = "1" ]; then
    echo "  ⚠ 遮罩后普通运行仍然成功 —— 遮罩没有真正生效，本次结果不可采信。"
    echo "    请检查 $LIB 是否确实被遮罩。"
elif [ "$EXTRACT_OK" = "0" ]; then
    echo "  ✗ --appimage-extract-and-run 在无 FUSE 时也无法启动。"
    echo "    → 需要换用新版运行时重新打包，或改用 .deb / tar.gz 分发。"
fi
echo
