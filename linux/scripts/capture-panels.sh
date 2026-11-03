#!/usr/bin/env bash
# Capture several panels of the GUI headlessly, deterministically.
#
# Why not synthetic clicks: under Xvfb, `xdotool click` did not reach the app
# even with a window manager running, and every attempt produced a byte-identical
# screenshot of the landing panel. Rather than fight input routing, this drives
# the app through state it already persists.
#
# `MainLayout` reads `activePanel` from `~/.claude-code-manager.json` via the
# `app:get-state` IPC channel, falling back to 'environment'. Writing that file
# and starting the app therefore renders any panel on first paint — and doubles
# as a check that the persisted-state path works at all.
#
# Usage: bash capture-panels.sh [AppImage]

set -uo pipefail

APPIMAGE="${1:-$HOME/ccm/dist/Claude Code Manager-1.0.0.AppImage}"
OUT="$HOME/ui-captures"
DISP=":98"
STATE="$HOME/.claude-code-manager.json"

PANELS="environment:api:skills:plugins:settings:config-files"

mkdir -p "$OUT"
rm -f "$OUT"/*.png 2>/dev/null
cp "$STATE" "$OUT/state.backup.json" 2>/dev/null || true

cleanup() {
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null
  [ -n "${WM_PID:-}" ] && kill "$WM_PID" 2>/dev/null
  [ -n "${XVFB_PID:-}" ] && kill "$XVFB_PID" 2>/dev/null
  wait 2>/dev/null
  # Leave the user's state file as it was.
  if [ -f "$OUT/state.backup.json" ]; then
    cp "$OUT/state.backup.json" "$STATE"
  else
    rm -f "$STATE"
  fi
}
trap cleanup EXIT

[ -f "$APPIMAGE" ] || { echo "FAIL: AppImage not found: $APPIMAGE"; exit 1; }

echo "=== starting Xvfb on $DISP ==="
Xvfb "$DISP" -screen 0 1280x820x24 -nolisten tcp > "$OUT/xvfb.log" 2>&1 &
XVFB_PID=$!
for _ in $(seq 1 40); do
  xdpyinfo -display "$DISP" >/dev/null 2>&1 && break
  sleep 0.25
done
export DISPLAY="$DISP"

if command -v xfwm4 >/dev/null 2>&1; then
  xfwm4 --display="$DISP" --compositor=off --daemon > "$OUT/wm.log" 2>&1 &
  WM_PID=$!
  sleep 2
fi

capture_one() {
  panel="$1"

  # Seed the persisted panel. The app merges this into its own state file, so
  # keeping the rest of the object intact is what makes the run realistic.
  if [ -f "$OUT/state.backup.json" ]; then
    python3 - "$OUT/state.backup.json" "$STATE" "$panel" <<'PY'
import json, sys
src, dst, panel = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    state = json.load(open(src))
except Exception:
    state = {}
state['activePanel'] = panel
json.dump(state, open(dst, 'w'), indent=2)
PY
  else
    printf '{\n  "activePanel": "%s"\n}\n' "$panel" > "$STATE"
  fi

  "$APPIMAGE" --no-sandbox --disable-gpu --disable-dev-shm-usage \
    > "$OUT/app-$panel.log" 2>&1 &
  APP_PID=$!

  # Wait for a mapped window rather than a fixed sleep, so a slow start does not
  # produce a screenshot of an empty root window.
  for _ in $(seq 1 40); do
    kill -0 "$APP_PID" 2>/dev/null || break
    n=$(xwininfo -display "$DISP" -root -children 2>/dev/null | grep -c '0x')
    [ "$n" -gt 0 ] && break
    sleep 1
  done
  sleep 6
  import -display "$DISP" -window root "$OUT/$panel.png" 2>/dev/null
  if [ -f "$OUT/$panel.png" ]; then
    echo "  $panel -> $(du -h "$OUT/$panel.png" | cut -f1)"
  else
    echo "  $panel -> CAPTURE FAILED"
  fi

  kill "$APP_PID" 2>/dev/null
  wait "$APP_PID" 2>/dev/null
  APP_PID=""
  sleep 1.5
}

echo
echo "=== capturing panels ==="
IFS=':' read -ra LIST <<< "$PANELS"
for p in "${LIST[@]}"; do
  capture_one "$p"
done

echo
echo "=== distinct captures (identical hashes mean the panel switch failed) ==="
md5sum "$OUT"/*.png 2>/dev/null | awk '{print "  " substr($1,1,10), $2}'
echo
echo "unique images: $(md5sum "$OUT"/*.png 2>/dev/null | awk '{print $1}' | sort -u | wc -l) of $(ls "$OUT"/*.png 2>/dev/null | wc -l)"
