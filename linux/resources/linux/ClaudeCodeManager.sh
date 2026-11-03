#!/usr/bin/env bash
# Launcher for the AppImage that works on systems without FUSE and on systems
# where the Chromium sandbox cannot initialise.
#
# Two independent environmental failures are handled here.
#
# 1. Missing FUSE 2.
#    An AppImage type 2 mounts itself through libfuse.so.2. Minimal installs,
#    containers, WSL and fresh Ubuntu 24.04 setups do not ship it (the package is
#    `libfuse2`, renamed to `libfuse2t64` on 24.04+), so a plain launch dies with
#        Cannot mount AppImage, please check your FUSE setup.
#        error loading libfuse.so.2
#    The AppImage runtime has its own answer: `--appimage-extract-and-run` unpacks
#    to a temporary directory and executes from there. Verified by masking
#    libfuse.so.2 with a bind mount — the plain launch fails, this flag succeeds.
#    The cost is about 0.9s of extra startup (1.8s vs 0.9s measured) and the
#    temporary directory is cleaned up on exit. Users install nothing.
#
# 2. Sandbox initialisation failure — the reason a double-click does *nothing*.
#    `chrome-sandbox` inside an AppImage cannot carry the setuid bit, because the
#    embedded filesystem is a read-only squashfs image mounted at run time. The
#    sandbox therefore depends on unprivileged user namespaces, and modern Ubuntu
#    restricts those:
#        kernel.apparmor_restrict_unprivileged_userns = 1
#    Chromium then refuses to start. Launched from a .desktop file there is no
#    terminal, so stderr is discarded and the user sees nothing at all. This
#    launcher retries with --no-sandbox and says why.
#
# Prefer the permanent fixes over the fallback; see docs/distribution.md.
#
# Usage:
#   ./ClaudeCodeManager.sh                 # launch (auto-detects both problems)
#   ./ClaudeCodeManager.sh --sandbox       # do not fall back to --no-sandbox
#   ./ClaudeCodeManager.sh --print-path    # print the resolved AppImage path
#
# Any other arguments are passed through to the application.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/claude-code-manager"
LOG="$LOG_DIR/launch.log"

mkdir -p "$LOG_DIR" 2>/dev/null || true

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$1" >>"$LOG" 2>/dev/null || true; }

die() {
    printf '\033[31m错误：%s\033[0m\n' "$1" >&2
    shift
    for line in "$@"; do printf '  %s\n' "$line" >&2; done
    log "FATAL: $1"
    exit 1
}

# ── Locate the AppImage ───────────────────────────────────────────────────────
APPIMAGE=""
for candidate in "$HERE"/ClaudeCodeManager-*.AppImage "$HERE"/*.AppImage; do
    [ -f "$candidate" ] && { APPIMAGE="$candidate"; break; }
done
[ -n "$APPIMAGE" ] || die "未找到 .AppImage 文件" \
    "请把本脚本和 AppImage 放在同一个目录下。" \
    "当前目录：$HERE"

# ── Argument handling ─────────────────────────────────────────────────────────
ALLOW_NO_SANDBOX=1
ARGS=()
for arg in "$@"; do
    case "$arg" in
        --sandbox) ALLOW_NO_SANDBOX=0 ;;
        --print-path) printf '%s\n' "$APPIMAGE"; exit 0 ;;
        *) ARGS+=("$arg") ;;
    esac
done


log "launch requested: appimage=$APPIMAGE args=${ARGS[*]:-<none>}"

# There is deliberately no FUSE pre-flight check here.
#
# An earlier version probed for libfuse.so.2 by looking for the file and committed
# to a direct mount when it was found. That probe is not sound: a library can be
# present and still unloadable — version skew, a half-removed package, a masked
# file. On the test VM, masking libfuse.so.2 with a bind mount left the file in
# place, the probe reported "FUSE available", and the launch failed anyway.
#
# Whether FUSE works is only knowable by trying, so the chain below tries first
# and reads the error.

# ── Launch chain ──────────────────────────────────────────────────────────────
#
# Strategies are tried in order, and the *actual error output* decides whether to
# escalate — never a pre-flight guess.
#
# That distinction matters and was learned the hard way: an earlier version
# checked for libfuse.so.2 by looking for the file, then committed to a direct
# mount. On a machine where the library is present but unloadable (version skew,
# a broken package, a masked file) that check passes and the launch still fails.
# Trying first and reading the error handles every variant, including ones we
# cannot enumerate.
#
# A successful GUI launch never returns here, because the child stays alive.

# Run one strategy. Sets OUT/RC. Returns 0 if the child was still alive after the
# grace period, i.e. the app started.
try_strategy() {
    local log="/tmp/ccm-launch-$$.log"
    "$@" >"$log" 2>&1 &
    local pid=$!

    local waited=0
    while [ "$waited" -lt 5 ]; do
        sleep 0.4
        waited=$((waited + 1))
        kill -0 "$pid" 2>/dev/null || break
    done

    if kill -0 "$pid" 2>/dev/null; then
        disown "$pid" 2>/dev/null || true
        rm -f "$log"
        return 0
    fi

    OUT="$(cat "$log" 2>/dev/null)"
    RC=0
    wait "$pid" 2>/dev/null || RC=$?
    rm -f "$log"
    return 1
}

# Does the output look like FUSE was the obstacle?
looks_like_fuse() {
    printf '%s' "$OUT" | grep -qiE 'libfuse|Cannot mount AppImage|FUSE setup|fusermount'
}

# Does it look like the Chromium sandbox was the obstacle?
#
# Guarded against a false positive: on a machine with no display, Electron dies
# with "Missing X server or $DISPLAY" during platform init and never reaches the
# sandbox at all. Reporting a sandbox problem there sends the user off to change
# kernel settings for no reason — which is exactly what this check did on the
# test VM before the guard was added.
looks_like_sandbox() {
    printf '%s' "$OUT" | grep -qiE 'Missing X server|DISPLAY' && return 1
    printf '%s' "$OUT" | grep -qiE 'sandbox|namespace|SUID|zygote'
}

# Does it look like there is simply no display to draw on?
looks_like_no_display() {
    printf '%s' "$OUT" | grep -qiE 'Missing X server|DISPLAY|ozone_platform|cannot open display'
}

OUT=""
RC=0
TRIED_FUSE_FALLBACK=0

# ── Attempt 1: as the user would run it ───────────────────────────────────────
if try_strategy "$APPIMAGE" "${ARGS[@]+"${ARGS[@]}"}"; then
    log "launched directly"
    exit 0
fi
log "attempt 1 failed (rc=$RC): $(printf '%s' "$OUT" | head -2 | tr '\n' ' ')"

# ── Attempt 2: FUSE fallback ──────────────────────────────────────────────────
if looks_like_fuse; then
    echo "AppImage 无法挂载（缺 FUSE 2）—— 改用解包模式启动，无需安装任何东西。"
    echo "（想让它直接挂载运行、启动快约 0.9 秒，可安装 FUSE 2："
    echo "  sudo apt install libfuse2      # Ubuntu 24.04 及之后为 libfuse2t64"
    echo "  sudo dnf install fuse-libs     # Fedora / RHEL"
    echo "  sudo pacman -S fuse2           # Arch）"
    echo
    TRIED_FUSE_FALLBACK=1

    if try_strategy "$APPIMAGE" --appimage-extract-and-run "${ARGS[@]+"${ARGS[@]}"}"; then
        log "launched via --appimage-extract-and-run"
        exit 0
    fi
    log "attempt 2 failed (rc=$RC): $(printf '%s' "$OUT" | head -2 | tr '\n' ' ')"
fi

# ── Attempt 3: sandbox fallback ───────────────────────────────────────────────
SANDBOX_ARGS=()
[ "$TRIED_FUSE_FALLBACK" -eq 1 ] && SANDBOX_ARGS+=(--appimage-extract-and-run)

if looks_like_sandbox; then
    if [ "$ALLOW_NO_SANDBOX" -eq 0 ]; then
        printf '%s\n' "$OUT" >&2
        die "沙箱初始化失败（已指定 --sandbox，不再回退）" "完整修法见 docs/distribution.md。"
    fi

    cat <<'MSG'
⚠ 启动失败：Chromium 沙箱无法初始化。
  原因：AppImage 内的 chrome-sandbox 不可能带 setuid 位（只读镜像），
        只能依赖未特权用户命名空间，而新版本 Ubuntu 默认限制了它。

  本次将改用 --no-sandbox 重试（可启动，但该进程不再受沙箱保护）。
  永久修复（更安全，二选一）：

    a) 放开未特权用户命名空间（推荐）：
         echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/99-ccm-userns.conf
         sudo sysctl --system

    b) 安装 .deb 并把沙箱设为 setuid：
         sudo apt install ./claude-code-manager_1.0.0_amd64.deb
         sudo chown root:root /opt/*/chrome-sandbox && sudo chmod 4755 /opt/*/chrome-sandbox

MSG
    if try_strategy "$APPIMAGE" "${SANDBOX_ARGS[@]+"${SANDBOX_ARGS[@]}"}" --no-sandbox "${ARGS[@]+"${ARGS[@]}"}"; then
        log "launched with --no-sandbox"
        exit 0
    fi
    log "attempt 3 failed (rc=$RC)"
fi

# ── Nothing worked ────────────────────────────────────────────────────────────
# Print what we captured. A double-click showed the user nothing at all, so even a
# raw stderr dump is an improvement over silence.
printf '%s\n' "$OUT" >&2
echo >&2

if looks_like_no_display; then
    die "没有可用的图形显示" \
        "程序本身启动成功，但没有找到显示环境（DISPLAY 未设置或 X 不可用）。" \
        "如果你是从 SSH 运行的，请在图形桌面的终端里运行，或设置 DISPLAY=:0。" \
        "桌面用户遇到这个提示，说明会话环境异常，请重新登录桌面后重试。"
fi

die "启动失败" \
    "以上是程序的完整输出（双击时这些信息会被丢弃）。" \
    "完整诊断：bash scripts/diagnose-launch.sh \"$APPIMAGE\""


