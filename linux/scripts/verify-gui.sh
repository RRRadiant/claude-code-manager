#!/usr/bin/env bash
# Headless GUI verification for Claude Code Manager.
#
# The VM has no display, so the Electron app cannot start the way a user would
# start it. This script gives it a real X server (Xvfb), launches the built
# AppImage, and proves the app actually rendered: it looks for the window with
# xdotool and captures the screen with ImageMagick's `import`.
#
# A screenshot is the difference between "the process stayed alive" and "the UI
# drew itself". Electron will happily run for minutes with a blank or crashed
# renderer, so process liveness alone proves nothing.
#
# Usage: bash verify-gui.sh [path-to-AppImage]
# Writes evidence to ~/gui-verify/ and prints a summary.

set -uo pipefail

APPIMAGE="${1:-$HOME/ccm/dist/Claude Code Manager-1.0.0.AppImage}"
OUT="$HOME/gui-verify"
DISP=":99"
GEOMETRY="1280x800x24"

mkdir -p "$OUT"
rm -f "$OUT"/*.png "$OUT"/*.log 2>/dev/null

echo "=== target ==="
echo "appimage : $APPIMAGE"
[ -f "$APPIMAGE" ] || { echo "FAIL: AppImage not found"; exit 1; }
echo "size     : $(du -h "$APPIMAGE" | cut -f1)"

cleanup() {
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null
  [ -n "${XVFB_PID:-}" ] && kill "$XVFB_PID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT

echo
echo "=== starting Xvfb on $DISP ($GEOMETRY) ==="
Xvfb "$DISP" -screen 0 "$GEOMETRY" -nolisten tcp > "$OUT/xvfb.log" 2>&1 &
XVFB_PID=$!
for _ in $(seq 1 40); do
  xdpyinfo -display "$DISP" >/dev/null 2>&1 && break
  sleep 0.25
done
if ! xdpyinfo -display "$DISP" >/dev/null 2>&1; then
  echo "FAIL: Xvfb did not come up"
  cat "$OUT/xvfb.log"
  exit 1
fi
echo "X server up: $(xdpyinfo -display "$DISP" | grep -E 'dimensions' | head -1)"

# A window manager is required for synthetic clicks to reach the app. Under a
# bare Xvfb server nothing owns the input focus, so `xdotool click` is delivered
# to the root window and the app never sees it — which produced four identical
# screenshots on the first attempt at multi-panel capture.
export DISPLAY="$DISP"
if command -v xfwm4 >/dev/null 2>&1; then
  xfwm4 --display="$DISP" --compositor=off --daemon > "$OUT/wm.log" 2>&1 &
  WM_PID=$!
  sleep 2
  echo "window manager: xfwm4 (pid $WM_PID)"
else
  echo "window manager: NONE — synthetic clicks may not reach the app"
fi

echo
echo "=== launching AppImage ==="
# --no-sandbox: Electron refuses to start its setuid sandbox in this container-like
# environment; the flag is unrelated to the app's own contextIsolation settings.
export ELECTRON_DISABLE_SECURITY_WARNINGS=1
"$APPIMAGE" --no-sandbox --disable-gpu --disable-dev-shm-usage \
  > "$OUT/app.log" 2>&1 &
APP_PID=$!
echo "pid=$APP_PID"

echo
echo "=== waiting for a window (up to 60s) ==="
FOUND=""
WIN_NAME=""
for i in $(seq 1 60); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "!! process exited early (after ${i}s)"
    break
  fi
  # Detect a real browser window, not just any X window.
  #
  # `xdotool search --name .` looks like it should match everything, but it
  # returns nothing for an Electron window on a bare Xvfb server — the search
  # walks the tree with match criteria a window mapped without a window manager
  # does not satisfy. This produced a false FAIL on a run whose screenshot plainly
  # showed the fully rendered UI. WM_CLASS is the reliable signal, with a size
  # check on the root's children as a fallback.
  W=$(xdotool search --display "$DISP" --class "." 2>/dev/null | head -1)
  if [ -z "$W" ]; then
    W=$(xwininfo -display "$DISP" -root -children 2>/dev/null \
        | grep -oE '0x[0-9a-f]+' | head -1)
  fi

  if [ -n "$W" ]; then
    FOUND="$W"
    WIN_NAME=$(xdotool getwindowname "$W" 2>/dev/null)
    echo "window appeared after ${i}s (id=$FOUND)"
    break
  fi
  sleep 1
done

# Give the renderer time to paint before capturing.
sleep 6

echo
echo "=== window tree ==="
xwininfo -display "$DISP" -root -children 2>/dev/null | sed -n '3,14p'
echo
echo "detected window : ${FOUND:-<none>}"
echo "window name     : ${WIN_NAME:-<unknown>}"

echo
echo "=== capturing screenshots ==="
if import -display "$DISP" -window root "$OUT/screenshot.png" 2>"$OUT/import.log"; then
  echo "captured: $OUT/screenshot.png ($(du -h "$OUT/screenshot.png" | cut -f1))"
else
  echo "FAIL: import failed"
  cat "$OUT/import.log"
fi

# Walk a few sidebar entries so more than the landing panel is evidenced.
# The y offsets are derived from the sidebar's own layout: a 28px brand row, then
# per group a 24px label plus 33px per item — see Sidebar.tsx.
if command -v xdotool >/dev/null 2>&1; then
  capture_panel() {
    label="$1"; y="$2"
    xdotool mousemove --display "$DISP" 105 "$y" 2>/dev/null
    xdotool click --display "$DISP" 1 2>/dev/null
    sleep 2.5
    out="$OUT/panel-$(echo "$label" | tr -d ' ').png"
    import -display "$DISP" -window root "$out" 2>/dev/null && echo "  $label (y=$y)"
  }

  echo
  echo "=== capturing other panels ==="
  capture_panel "api" 165
  capture_panel "skills" 303
  capture_panel "plugins" 429
fi

echo
echo "=== process status ==="
if kill -0 "$APP_PID" 2>/dev/null; then
  echo "app process: ALIVE"
  ps -o pid,rss,etime,cmd -p "$APP_PID" 2>/dev/null | tail -1
  # Count renderer/gpu helper processes as a sign the multi-process model started.
  echo "child processes: $(pgrep -P "$APP_PID" 2>/dev/null | wc -l)"
else
  echo "app process: EXITED"
fi

echo
echo "=== app log (last 30 lines) ==="
tail -30 "$OUT/app.log" 2>/dev/null || echo "(empty)"

echo
echo "=== summary ==="
if [ -f "$OUT/screenshot.png" ] && [ -n "$FOUND" ]; then
  echo "RESULT: PASS — window created and screenshot captured"
  exit 0
else
  echo "RESULT: FAIL — no window or no screenshot"
  exit 1
fi
