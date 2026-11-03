#!/bin/bash
#
# Capture the first-run guide and the panels it hands off to.
#
#   scripts/capture-guide.sh [output-dir]
#
# The guide is the one screen a returning user never sees, so it is also the one
# screen a restyle can silently break: an earlier build shipped a stylesheet with
# an empty Tailwind utility layer, and because the first-run screen was the only
# one still written in utility classes it rendered as bare text while every other
# panel looked fine. Rendering it is the only way to check it.
#
# Needs: Xvfb, xdotool, ImageMagick (`import`), the .deb installed, and no
# `claude` on PATH — the guide still shows, but the environment panel behind it
# then reports a different state.
#
# One WSL invocation only: WSL tears down the processes a session started when
# that session ends, so an app launched from one shell is gone by the next.
set -u

OUT=${1:-/tmp/guide-shots}
APP=${CCM_APP:-/opt/Claude Code Manager/claude-code-manager}
DISPLAY_NUM=${CCM_DISPLAY:-:99}
export DISPLAY="$DISPLAY_NUM"

CLEAN_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
STATE="$HOME/.claude-code-manager.json"

mkdir -p "$OUT"

for tool in Xvfb xdotool import; do
  command -v "$tool" >/dev/null || { echo "missing: $tool"; exit 1; }
done

# The guide is shown or not purely by the app-state flag, which this script
# clears, so an installed CLI no longer prevents it — the panels behind it just
# look different. Warn rather than refuse: the guide itself is still accurate.
if env PATH="$CLEAN_PATH" bash -lc 'command -v claude' >/dev/null 2>&1; then
  echo "note: 'claude' is on PATH, so the panels behind the guide show an installed state"
fi

start() {
  pkill -f "$APP" 2>/dev/null
  sleep 2
  pgrep -x Xvfb >/dev/null || {
    nohup Xvfb "$DISPLAY_NUM" -screen 0 1280x900x24 >/tmp/ccm-xvfb.log 2>&1 &
    sleep 2
  }
  : > /tmp/ccm-guide-app.log
  nohup env PATH="$CLEAN_PATH" "$APP" --no-sandbox >/tmp/ccm-guide-app.log 2>&1 &
  sleep 10
}

# The guide is centred; its primary button is the only accent-filled element in
# the lower half of the card, and nothing else at that x reacts to a click. Scan
# downwards until the screen changes.
#
# The pointer is parked in a corner before each capture: moving it across a
# button changes that button's hover styling, which is enough to make two
# screenshots of the *same* step differ and convince a naive comparison that the
# click worked.
advance() {
  local name="$1" before after
  park
  before=$(md5sum /tmp/ccm-guide-before.png | cut -d' ' -f1)

  local y
  for y in 500 520 540 560 580 600 620 640 660 680; do
    xdotool mousemove 640 "$y" click 1
    sleep 2
    park
    import -window root "$OUT/$name.png"
    after=$(md5sum "$OUT/$name.png" | cut -d' ' -f1)
    if [ "$after" != "$before" ]; then
      echo "  $name.png (clicked 640,$y)"
      return 0
    fi
  done
  echo "  !! nothing changed while advancing to $name"
  return 1
}

park() {
  xdotool mousemove 10 10
  sleep 1
  import -window root /tmp/ccm-guide-before.png
}

set_panel() {
  python3 - "$STATE" "$1" <<'PY'
import json, sys
path, panel = sys.argv[1], sys.argv[2]
try:
    state = json.load(open(path))
except Exception:
    state = {}
state['activePanel'] = panel
state['onboardingCompleted'] = True
json.dump(state, open(path, 'w'), indent=2)
PY
}

echo "capturing into $OUT"

# ── First run: the guide over the interface ──────────────────────────────────
rm -f "$STATE"
rm -rf "$HOME/.config/Claude Code Manager" "$HOME/.config/claude-code-manager"
start
park
import -window root "$OUT/1-向导-欢迎.png"; echo "  1-向导-欢迎.png"
advance "2-向导-环境检测"
advance "3-向导-检测结果"   # the step stays put and shows the count
advance "4-向导-安装"
advance "5-环境面板"        # this step navigates to the panel and closes the guide

# ── The panels the guide hands off to ────────────────────────────────────────
for entry in "api:6-API配置" "models:7-模型管理"; do
  panel=${entry%%:*}
  name=${entry##*:}
  set_panel "$panel"
  start
  import -window root "$OUT/$name.png"
  echo "  $name.png"
done

pkill -f "$APP" 2>/dev/null
echo "--- app stderr (empty means no crash, no JS error) ---"
cat /tmp/ccm-guide-app.log
