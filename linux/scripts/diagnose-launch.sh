#!/usr/bin/env bash
# Diagnose "double-clicking the app does nothing".
#
# A silent failure is almost always the Electron sandbox refusing to initialise.
# When launched from a .desktop file there is no terminal, so stderr goes nowhere
# and the user sees nothing at all — the process simply exits.
#
# This script answers, in order:
#   1. Is the AppImage itself runnable (FUSE, exec bit, file type)?
#   2. Is the sandbox able to initialise (user namespaces, chrome-sandbox mode)?
#   3. What does the app actually print when run from a terminal?
#
# Run it as the user who cannot launch the app — NOT with sudo. The whole point
# is to observe that user's environment.
#
# Usage: bash diagnose-launch.sh [path-to-AppImage-or-installed-binary]

set -uo pipefail

APP="${1:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

hr() { printf '\n%s\n' "──────────────────────────────────────────────"; }
say() { printf '  %s\n' "$1"; }

if [ -z "$APP" ]; then
    for c in "$HERE"/*.AppImage "$HERE"/ClaudeCodeManager*.AppImage /opt/*/claude-code-manager; do
        [ -e "$c" ] && { APP="$c"; break; }
    done
fi
if [ -z "$APP" ]; then
    APP="$(command -v claude-code-manager 2>/dev/null || true)"
fi

echo "══════════════════════════════════════════════"
echo " Claude Code Manager 启动诊断"
echo "══════════════════════════════════════════════"
say "用户：$(id -un) (uid $(id -u))"
say "系统：$( . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" )"
say "内核：$(uname -r)"
say "会话：XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-<无>}  DISPLAY=${DISPLAY:-<无>}"
say "程序：${APP:-<未找到>}"

if [ -z "$APP" ] || [ ! -e "$APP" ]; then
    hr
    echo "找不到程序文件。请把 AppImage 路径作为参数传进来，例如："
    echo "  bash diagnose-launch.sh ~/下载/ClaudeCodeManager-1.0.0-x86_64.AppImage"
    exit 1
fi

# ── 1. The file itself ────────────────────────────────────────────────────────
hr
echo "1. 文件本身"
if [ -x "$APP" ]; then say "✓ 有执行权限"; else
    say "✗ 没有执行权限 —— 双击不会有任何反应"
    say "  修：chmod +x \"$APP\""
fi
say "类型：$(file -b "$APP" | cut -c1-70)"
say "大小：$(du -h "$APP" | cut -f1)"

if head -c 4 "$APP" | grep -q ELF; then
    if [ -e /dev/fuse ] && { ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; }; then
        say "✓ FUSE 2 可用（AppImage 可直接挂载）"
    else
        say "✗ 缺 FUSE 2 —— AppImage 无法挂载"
        say "  修：sudo apt install libfuse2   （Ubuntu 24.04+ 用 libfuse2t64）"
        say "  或不解包直接跑：\"$APP\" --appimage-extract && ./squashfs-root/AppRun"
    fi
fi

# ── 2. Sandbox prerequisites ──────────────────────────────────────────────────
hr
echo "2. 沙箱前提条件（静默失败最可能的原因）"

say "chrome-sandbox 的 setuid 位："
SANDBOX_HINT=""
NOEXEC_HINT=""
case "$APP" in
    *.AppImage) say "  （AppImage 内，需解包后检查，见第 4 步）" ;;
    *)
        REAL="$(dirname "$(readlink -f "$APP")")"
        for sb in "$REAL/chrome-sandbox" /opt/*/chrome-sandbox; do
            [ -e "$sb" ] || continue
            mode="$(stat -c '%A %U:%G' "$sb")"
            say "  $sb"
            say "    $mode"
            if [ -u "$sb" ]; then say "    ✓ 有 setuid 位";
            else say "    ✗ 缺 setuid 位 —— 沙箱会失败"; SANDBOX_HINT=1; fi
        done
        ;;
esac

userns="$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 'n/a')"
say "unprivileged_userns_clone = $userns"
maxns="$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 'n/a')"
say "max_user_namespaces       = $maxns"
if [ "$maxns" = "0" ]; then
    say "  ✗ 用户命名空间被禁用 —— Electron 沙箱无法启动"
    SANDBOX_HINT=1
fi

if [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
    restr="$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)"
    say "apparmor_restrict_unprivileged_userns = $restr"
    if [ "$restr" = "1" ]; then
        say "  ✗ Ubuntu 24.04+ 默认限制未特权用户命名空间 —— 这是最常见的静默失败原因"
        SANDBOX_HINT=1
    fi
else
    say "apparmor_restrict_unprivileged_userns = <不存在>（Ubuntu 24.04 之前的内核）"
fi

say "容器环境：$(systemd-detect-virt 2>/dev/null || echo unknown)"

# ── noexec mounts ─────────────────────────────────────────────────────────────
# A third silent-failure mode, and an easy one to miss: if the directory holding
# the binary is mounted noexec, the kernel refuses to execute it. Double-clicking
# does nothing, and even a terminal launch can be uninformative because some file
# managers run the file through a helper that swallows the error.
say "程序所在目录的挂载选项："
_dir="$(dirname "$APP")"
if command -v findmnt >/dev/null 2>&1; then
    _opts="$(findmnt -no OPTIONS -T "$_dir" 2>/dev/null || true)"
    if [ -n "$_opts" ]; then
        say "  $_dir"
        say "    $_opts"
        if printf '%s' "$_opts" | grep -q 'noexec'; then
            say "    ✗ 该目录以 noexec 挂载 —— 系统会拒绝执行这里的任何程序"
            say "      这就是「双击毫无反应」的原因之一"
            say "      修：把程序移到 ~/.local/bin 或 /opt 等可执行目录"
            NOEXEC_HINT=1
        else
            say "    ✓ 未包含 noexec"
        fi
    fi
elif findmnt --version >/dev/null 2>&1; then
    findmnt -T "$_dir" 2>/dev/null | sed 's/^/    /'
else
    say "  （没有 findmnt，跳过）"
fi

# ── 3. Actually run it ────────────────────────────────────────────────────────
hr
echo "3. 实际运行（捕获 stderr —— 双击时这些信息会丢失）"
echo "  命令：$APP --no-sandbox"
timeout 20 "$APP" --no-sandbox > "$OUT/nosb.log" 2>&1
rc=$?
say "退出码：$rc  （124 = 超时未退出，说明进程活着）"
if [ -s "$OUT/nosb.log" ]; then
    say "输出："
    head -20 "$OUT/nosb.log" | sed 's/^/    /'
else
    say "输出：<空>"
fi

echo
echo "  命令：$APP   （默认，即双击等价）"
timeout 20 "$APP" > "$OUT/plain.log" 2>&1
rc2=$?
say "退出码：$rc2"
if [ -s "$OUT/plain.log" ]; then
    say "输出："
    head -20 "$OUT/plain.log" | sed 's/^/    /'
else
    say "输出：<空 —— 这正是双击时看到的效果>"
fi

# ── 4. AppImage internals, if applicable ──────────────────────────────────────
case "$APP" in
    *.AppImage)
        hr
        echo "4. AppImage 内部（解包后检查 chrome-sandbox）"
        if ( cd "$OUT" && timeout 120 "$APP" --appimage-extract >/dev/null 2>&1 ); then
            sb="$OUT/squashfs-root/chrome-sandbox"
            if [ -e "$sb" ]; then
                say "chrome-sandbox 权限：$(stat -c '%A %U:%G' "$sb")"
                say "  （AppImage 内该文件不可能带 setuid —— 首次挂载时由运行时设置，"
                say "    因此沙箱只能依赖用户命名空间）"
            fi
            say "AppRun 存在：$([ -x "$OUT/squashfs-root/AppRun" ] && echo 是 || echo 否)"
        else
            say "解包失败"
        fi
        ;;
esac

# ── Conclusion ────────────────────────────────────────────────────────────────
hr
echo "结论"
if [ -z "${DISPLAY:-}" ]; then
    # Without a display, Electron dies during platform init and never reaches the
    # sandbox, so both runs above produce the same "Missing X server" line. A
    # report that ended in "见上面的输出" here would be actively misleading —
    # this is the normal result of running the script over SSH.
    echo "  ⚠ 当前会话没有图形显示（DISPLAY 未设置），本次诊断无法判定问题。"
    echo
    echo "    原因：Electron 在平台初始化阶段就退出了（Missing X server），"
    echo "    根本走不到沙箱那一步 —— 上面两次运行的结果因此都是无效的。"
    echo "    通过 SSH 运行本脚本时必然如此，不代表程序有问题。"
    echo
    echo "    请在【真正打不开软件的那台机器】上，从【图形桌面的终端】重新运行："
    echo "      echo \$DISPLAY                       # 应有值，如 :0"
    echo "      bash diagnose-launch.sh <AppImage 路径>"
    echo
    echo "    只能在 SSH 里操作那台机器时，改用："
    echo "      DISPLAY=:0 bash diagnose-launch.sh <AppImage 路径>"
    echo "      （需要该用户有权访问 X：xhost +SI:localuser:\$USER）"
    echo
    echo "    本次仍然有效的结论："
    echo "      - 文件执行权限：$([ -x "$APP" ] && echo 有 || echo 无)"
    echo "      - noexec 挂载：${NOEXEC_HINT:+存在}${NOEXEC_HINT:-未发现}"
    echo "      - sysctl 与 FUSE 状态见第 2 节"
elif [ -n "$NOEXEC_HINT" ]; then
    echo "  → 程序所在目录以 noexec 挂载。系统拒绝执行该目录下的程序，"
    echo "    所以双击毫无反应。把 AppImage 移到 ~/.local/bin 后重试。"
elif grep -qiE 'sandbox|namespace|SUID' "$OUT/plain.log" 2>/dev/null; then
    echo "  → 沙箱初始化失败。这是「双击无反应」的典型原因。"
    echo "    永久修法（三选一）："
    echo "      a) 启用未特权用户命名空间："
    echo "         sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0"
    echo "         echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/99-userns.conf"
    echo "      b) 装 .deb 并给 chrome-sandbox 设 setuid（安全性最好）："
    echo "         sudo apt install ./claude-code-manager_1.0.0_amd64.deb"
    echo "         sudo chown root:root /opt/*/chrome-sandbox && sudo chmod 4755 /opt/*/chrome-sandbox"
    echo "      c) 用 ./ClaudeCodeManager.sh 启动（自动回退到 --no-sandbox）"
elif [ "$rc2" = "124" ]; then
    echo "  → 程序其实起来了（超时未退出），问题在窗口显示或桌面环境。"
elif [ -z "$(cat "$OUT/plain.log")" ]; then
    echo "  → 无任何输出就退出。请把本脚本的完整输出发给开发者。"
else
    echo "  → 见上面的输出。"
fi

if [ -n "$SANDBOX_HINT" ]; then
    echo
    echo "  本次检测到沙箱前提条件缺失。"
fi

# A single copy-pasteable block. The full report above is useful on screen, but
# asking a user to select it out of a terminal reliably loses lines; this is what
# they should send back.
hr
echo "↓ ↓ ↓  请把下面这一整块复制回传（从 === 开始到 === 结束）  ↓ ↓ ↓"
echo "=== CCM DIAG BEGIN ==="
echo "os=$( . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" )"
echo "kernel=$(uname -r)"
echo "arch=$(uname -m)"
echo "session=${XDG_SESSION_TYPE:-?} display=${DISPLAY:-<none>}"
echo "virt=$(systemd-detect-virt 2>/dev/null || echo unknown)"
echo "app=${APP}"
echo "app_size=$(du -h "$APP" 2>/dev/null | cut -f1) exec=$([ -x "$APP" ] && echo y || echo n)"
echo "fuse2=$( { [ -e /dev/fuse ] && ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; } && echo y || echo n)"
echo "userns_clone=$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo n/a)"
echo "max_user_ns=$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo n/a)"
echo "apparmor_userns_restrict=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo absent)"
echo "noexec=$(printf '%s' "${NOEXEC_HINT:-n}" | sed 's/^1$/y/;s/^$/n/')"
echo "rc_default=$rc2 rc_nosandbox=$rc"
echo "--- default-run output ---"
cat "$OUT/plain.log" 2>/dev/null | head -15
echo "--- nosandbox-run output ---"
cat "$OUT/nosb.log" 2>/dev/null | head -15
echo "=== CCM DIAG END ==="
echo "↑ ↑ ↑  复制到上面这块为止  ↑ ↑ ↑"
echo
