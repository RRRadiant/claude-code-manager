"""Minimal SSH/SFTP helper for driving the Kali test VM.

Exists because this workstation has no `sshpass`/`plink`/`expect`, and the VM only
accepts password authentication. Uses paramiko, which is already installed.

Credentials are read from the environment, never from argv (argv is visible to
every process on the machine) and never written to disk.

    set CCM_VM_HOST=192.0.2.10      # replace with your test VM's address
    set CCM_VM_USER=kali
    set CCM_VM_PASS=...

Usage:
    python tools/vm.py run "<shell command>"
    python tools/vm.py run --sudo "<shell command>"
    python tools/vm.py put <local> <remote>
    python tools/vm.py get <remote> <local>
    python tools/vm.py probe            # standard read-only survey
"""

from __future__ import annotations

import codecs
import os
import sys
import textwrap

import paramiko

# The VM emits UTF-8 (Chinese text, box-drawing, check marks). This workstation's
# console defaults to GBK on a zh-CN Windows install, so writing those bytes
# straight to stdout raises UnicodeEncodeError and kills the transfer mid-stream.
# Reconfiguring both streams to UTF-8 with replacement is the fix; the terminal
# then renders correctly as long as it is set to a Unicode codepage.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")


def connect() -> paramiko.SSHClient:
    host = os.environ.get("CCM_VM_HOST")
    user = os.environ.get("CCM_VM_USER")
    password = os.environ.get("CCM_VM_PASS")
    if not host or not user or not password:
        sys.exit("CCM_VM_HOST / CCM_VM_USER / CCM_VM_PASS must be set")

    client = paramiko.SSHClient()
    # The VM is a disposable test box on a host-only network; pinning its key
    # would mean re-approving every snapshot rollback, which is worse than the
    # risk here. This is not a pattern to copy for a production target.
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=host,
        username=user,
        password=password,
        timeout=15,
        banner_timeout=20,
        auth_timeout=20,
        look_for_keys=False,
        allow_agent=False,
    )
    return client


def run(client: paramiko.SSHClient, command: str, sudo: bool = False, timeout: int = 900) -> int:
    if sudo:
        command = "sudo -S -p '' " + command

    stdin, stdout, stderr = client.exec_command(command, timeout=timeout, get_pty=sudo)
    if sudo:
        stdin.write(os.environ["CCM_VM_PASS"] + "\n")
        stdin.flush()

    # Binary mode, then decode incrementally. Paramiko's text wrapper calls
    # `s.decode('utf-8')` per read *line*, and a TUI's output splits multibyte
    # characters across read boundaries — decoding each chunk independently
    # raised UnicodeDecodeError and killed the transfer mid-stream.
    chan = stdout.channel
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    while True:
        data = chan.recv(65536)
        if not data:
            break
        sys.stdout.write(decoder.decode(data))
    sys.stdout.write(decoder.decode(b"", final=True))

    err = stderr.read().decode("utf-8", errors="replace")
    if err.strip():
        sys.stdout.write("\n--- stderr ---\n" + err)

    status = chan.recv_exit_status()
    print(f"\n[exit {status}]")
    return status


PROBE = textwrap.dedent(
    """
    echo "===== OS ====="
    . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"
    uname -srm
    echo "===== DISPLAY / DESKTOP ====="
    echo "DISPLAY=${DISPLAY:-<unset>}"
    echo "XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-<unset>}"
    ls -1 /usr/share/xsessions/ 2>/dev/null | head -20 || echo "no /usr/share/xsessions"
    command -v Xvfb xvfb-run x11vnc startx 2>/dev/null || echo "no Xvfb/xvfb-run/x11vnc/startx"
    pgrep -a Xorg 2>/dev/null | head -5 || echo "no Xorg running"
    echo "===== RUNTIMES ====="
    for c in node npm git curl tar xz rustc cargo python3 gcc make; do
      printf '%-8s ' "$c"; command -v $c >/dev/null 2>&1 && $c --version 2>&1 | head -1 || echo "MISSING"
    done
    echo "===== TAR XZ SUPPORT ====="
    tar --help 2>&1 | grep -qi xz && echo "tar: xz OK" || echo "tar: xz NOT advertised"
    ldconfig -p 2>/dev/null | grep -c liblzma | sed 's/^/liblzma entries: /'
    echo "===== SUDO ====="
    sudo -n true 2>&1 && echo "sudo: NOPASSWD OK" || echo "sudo: password required"
    echo "===== DISK / MEM ====="
    df -h / /home 2>/dev/null | grep -v tmpfs
    free -h | head -2
    echo "===== NETWORK EGRESS ====="
    for u in https://nodejs.org https://npmmirror.com https://mirrors.huaweicloud.com https://registry.npmjs.org; do
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$u" 2>/dev/null)
      echo "$u -> ${code:-FAIL}"
    done
    echo "===== EXISTING INSTALL ====="
    ls -la ~/.local/share/claude-code-manager 2>/dev/null || echo "no app data dir"
    ls -la ~/.local/bin 2>/dev/null | head -10 || echo "no ~/.local/bin"
    echo "===== HOME / ARCH ====="
    echo "HOME=$HOME  ARCH=$(uname -m)  USER=$(id -un)  GROUPS=$(id -Gn)"
    """
).strip()


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    action = sys.argv[1]
    client = connect()
    try:
        if action == "run":
            sudo = "--sudo" in sys.argv
            args = [a for a in sys.argv[2:] if a != "--sudo"]
            if not args:
                sys.exit("run needs a command")
            return run(client, args[0], sudo=sudo)

        if action == "probe":
            return run(client, PROBE)

        if action == "put":
            local, remote = sys.argv[2], sys.argv[3]
            sftp = client.open_sftp()
            try:
                sftp.put(local, remote)
                size = sftp.stat(remote).st_size
                print(f"put {local} -> {remote} ({size} bytes)")
            finally:
                sftp.close()
            return 0

        if action == "get":
            remote, local = sys.argv[2], sys.argv[3]
            sftp = client.open_sftp()
            try:
                sftp.get(remote, local)
                print(f"get {remote} -> {local}")
            finally:
                sftp.close()
            return 0

        sys.exit(f"unknown action: {action}")
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())
