#!/usr/bin/env bash
# Diagnose why `ccm` exits immediately for one user but not another.
#
# Usage: bash diag-ccm.sh          (as whichever user is being diagnosed)
#
# Every risky step is wrapped in `timeout` and writes to a file rather than to
# stdout: a TUI keeps the pty open after it exits, so reading its output inline
# blocks forever. Redirecting to a file and capping the run avoids that.

BIN=/usr/local/bin/ccm
OUT=/tmp/ccm-diag
rm -rf "$OUT"; mkdir -p "$OUT"

{
echo "=== who ==="
echo "user : $(id -un) (uid $(id -u))"
echo "HOME : $HOME"
echo "TERM : ${TERM:-<unset>}"

echo
echo "=== binary ==="
ls -la "$BIN"

echo
echo "=== per-user paths the TUI reads at startup ==="
for p in "$HOME/.claude" "$HOME/.claude/settings.json" "$HOME/.claude/agents" "$HOME/.claude/commands"; do
    printf '  %-42s ' "$p"
    if [ -e "$p" ]; then stat -c '%A %U:%G %sB' "$p"; else echo MISSING; fi
done

echo
echo "=== external commands ==="
for c in claude node npm git curl which; do
    printf '  %-7s ' "$c"; command -v "$c" 2>/dev/null || echo "NOT FOUND"
done
printf '  claude --version -> %s\n' "$(claude --version 2>&1 | head -1)"

echo
echo "=== run with NO pty (control case) ==="
timeout 10 "$BIN" > "$OUT/nopty.out" 2>&1 < /dev/null
echo "  exit=$?  stderr=[$(cat "$OUT/nopty.out")]"

echo
echo "=== run inside a real pty ==="
if command -v script >/dev/null 2>&1; then
    # timeout is essential: `script` waits on the pty, and a TUI that leaves the
    # pty open keeps it alive indefinitely.
    timeout 8 script -qec "$BIN" /dev/null > "$OUT/pty.out" 2>&1
    echo "  exit=$?  bytes=$(wc -c < "$OUT/pty.out")"
    echo "  --- first 30 lines, control chars escaped ---"
    head -30 "$OUT/pty.out" | cat -v | sed 's/^/    /'
else
    echo "  (script unavailable)"
fi

echo
echo "=== pty run stderr, if the program wrote any error ==="
grep -aoiE "error[^\x1b]{0,120}" "$OUT/pty.out" 2>/dev/null | head -5 || echo "  (no error text found)"
} 2>&1 | tee "$OUT/report.txt"
