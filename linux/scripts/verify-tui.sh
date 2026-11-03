#!/usr/bin/env bash
# Real-PTY verification for the ccm TUI.
#
# A TUI needs a terminal. Piping it through a plain pipe makes ratatui fail or
# render nothing, so this drives it inside a tmux session — a genuine PTY — and
# captures the pane with `capture-pane -e`, which preserves the escape sequences
# ratatui emits.
#
# It also proves the performance fix: the old event loop spawned
# `claude --version` four times a second, so counting `claude` execs over a fixed
# window with no keystrokes is a direct measurement of whether that is fixed.
#
# Usage: bash verify-tui.sh [path-to-ccm]
# Writes evidence to ~/tui-verify/ and prints a summary.

set -uo pipefail

CCM="${1:-$HOME/ccm/cli/ccm-tui/target/release/ccm}"
OUT="$HOME/tui-verify"
SESSION="ccm-verify"

mkdir -p "$OUT"
rm -f "$OUT"/* 2>/dev/null

echo "=== target ==="
[ -f "$CCM" ] || { echo "FAIL: binary not found at $CCM"; exit 1; }
ls -la "$CCM"
file "$CCM" | cut -c1-100

tmux kill-session -t "$SESSION" 2>/dev/null

echo
echo "=== launching inside a real PTY (tmux) ==="
# A wide, tall terminal so every tab has room to render its full layout.
tmux new-session -d -s "$SESSION" -x 200 -y 50
# `exec` makes the pane's own process the TUI, so `tmux list-panes -F #{pane_pid}`
# yields the pid we actually want. Searching with `pgrep -f release/ccm` matched
# the wrapper shell too — its command line contains that string — and checking the
# wrong process reported a working quit as a failure.
tmux send-keys -t "$SESSION" "exec $CCM" Enter
sleep 4
CCM_PID=$(tmux list-panes -t "$SESSION" -F '#{pane_pid}' 2>/dev/null | head -1)
echo "pane pid: ${CCM_PID:-<unknown>}"

capture() {
  tmux capture-pane -t "$SESSION" -p -e 2>/dev/null > "$OUT/$1.ansi"
  tmux capture-pane -t "$SESSION" -p 2>/dev/null > "$OUT/$1.txt"
}

echo
echo "=== tab 1: Status ==="
capture tab1-status
sed -n '1,24p' "$OUT/tab1-status.txt"

# Walk every tab so each one is exercised, not just the landing page.
for n in 2 3 4 5 6 7 8; do
  tmux send-keys -t "$SESSION" "$n"
  sleep 1.2
  capture "tab${n}"
done

echo
echo "=== tab titles seen across all captures ==="
grep -hoE '(Status|Install|API|Models|Skills|Agents|Config|Help)' "$OUT"/tab*.txt 2>/dev/null | sort -u | tr '\n' ' '
echo

echo
echo "=== per-tab first non-empty content line ==="
for n in 1 2 3 4 5 6 7 8; do
  f="$OUT/tab${n}.txt"
  [ -f "$f" ] || continue
  line=$(grep -v '^[[:space:]]*$' "$f" | sed -n '2p' | cut -c1-90)
  printf "  tab%d: %s\n" "$n" "${line:-<empty>}"
done

echo
echo "=== performance: is the node CLI still spawned on every tick? ==="
# Return to the Status tab, then measure how many times the node CLI is started
# over 6 seconds with no input at all. The old event loop called
# `app.refresh()` every 250ms and that re-ran `claude --version` — a Node.js
# program — so the expected count there was ~24.
tmux send-keys -t "$SESSION" "1"
sleep 1
if command -v strace >/dev/null 2>&1; then
  if [ -n "$CCM_PID" ] && kill -0 "$CCM_PID" 2>/dev/null; then
    timeout 6 strace -f -e trace=execve -o "$OUT/execs.log" -p "$CCM_PID" 2>/dev/null
    # `grep -c` on a single file prints one number; `|| echo 0` appended a second
    # when it found nothing, and the caller's `[ ... ]` then saw "0\n0".
    NODE_EXECS=$(grep -c 'execve.*node' "$OUT/execs.log" 2>/dev/null)
    TOTAL_EXECS=$(grep -c 'execve' "$OUT/execs.log" 2>/dev/null)
    NODE_EXECS=${NODE_EXECS:-0}
    TOTAL_EXECS=${TOTAL_EXECS:-0}
    echo "  node/claude execs in 6s idle : $NODE_EXECS"
    echo "  total execve in 6s idle      : $TOTAL_EXECS"
    if [ "$NODE_EXECS" -le 1 ]; then
      echo "  => PASS: no per-tick CLI spawning (was ~24)"
    else
      echo "  => FAIL: still spawning node every tick"
    fi
  else
    echo "  (could not resolve the ccm pid; skipping)"
  fi
else
  echo "  (strace not installed; skipping)"
fi

echo
echo "=== interaction: two-step quit ==="
tmux send-keys -t "$SESSION" "q"
sleep 1.5
capture quit-first
if grep -q "再按一次 q 退出" "$OUT/quit-first.txt" 2>/dev/null; then
  echo "  first q  -> confirmation prompt shown  (PASS)"
else
  echo "  first q  -> no confirmation prompt     (FAIL)"
fi
if [ -n "$CCM_PID" ] && kill -0 "$CCM_PID" 2>/dev/null; then
  echo "  first q  -> process still alive        (PASS)"
else
  echo "  first q  -> process exited             (FAIL)"
fi

tmux send-keys -t "$SESSION" "q"
sleep 2
if [ -n "$CCM_PID" ] && kill -0 "$CCM_PID" 2>/dev/null; then
  echo "  second q -> process still alive        (FAIL)"
  tmux kill-session -t "$SESSION" 2>/dev/null
else
  echo "  second q -> exited cleanly             (PASS)"
fi

echo
echo "=== artifacts in $OUT ==="
ls -la "$OUT" | tail -n +2

echo
if [ -s "$OUT/tab1-status.txt" ] && [ -s "$OUT/tab5.txt" ]; then
  echo "RESULT: PASS — TUI rendered across tabs in a real PTY"
  exit 0
else
  echo "RESULT: FAIL — captures are empty"
  exit 1
fi
