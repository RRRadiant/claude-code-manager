#!/usr/bin/env python3
"""Apply the mechanical part of the ccm-tui input-handling fix.

The character-boundary fix touches four tab files with the same few patterns.
Doing it by hand invites a typo in one of them; doing it here keeps the edit
uniform and reviewable.

Run from the repository root:  python tools/patch-tui.py

Idempotent: running it twice reports "nothing to do" instead of double-patching.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "cli" / "ccm-tui" / "src"

# Each entry carries the imports its file will need after patching.
FILES = {
    "ui/tabs/agents.rs": ["Refresh"],
    "ui/tabs/models.rs": ["Refresh"],
    "ui/tabs/config.rs": ["Refresh", "clip"],
    "ui/tabs/install.rs": ["Refresh", "clip"],
}

# `app.refresh()` took no argument before the throttling fix; the full variant is
# the correct replacement everywhere an action may have changed what is installed.
RULES = [
    (re.compile(r"app\.refresh\(\)"), "app.refresh(Refresh::Full)"),
    # Byte-indexed editing -> character-aware helpers on UIState.
    (
        re.compile(
            r"if ui_state\.input_cursor\s*>\s*0\s*\{\s*ui_state\.input_buffer\.remove\(ui_state\.input_cursor\s*-\s*1\);\s*ui_state\.input_cursor\s*-=\s*1;\s*\}"
        ),
        "ui_state.input_backspace();",
    ),
    (
        re.compile(
            r"ui_state\.input_buffer\.insert\(ui_state\.input_cursor,\s*(c|'\\n')\);\s*ui_state\.input_cursor\s*\+=\s*1;"
        ),
        r"ui_state.input_push(\1);",
    ),
    # A byte length is the wrong number to show for Chinese text.
    (re.compile(r"c\.len\(\)\)\)"), "c.chars().count()))"),
    # Byte-indexed slicing panics on multibyte input.
    (re.compile(r"&c\[\.\.800\]"), "clip(&c, 800)"),
    (re.compile(r"&e\[\.\.e\.len\(\)\.min\(100\)\]"), "clip(&e, 100)"),
    # `split('/')` never splits a Windows-style path; `rsplit` also handles
    # nested paths correctly on Unix.
    (re.compile(r"\.split\('/'\)\.last\(\)"), ".rsplit('/').next()"),
]


def apply(path: pathlib.Path) -> int:
    text = path.read_text(encoding="utf-8")
    original = text
    count = 0
    for pattern, replacement in RULES:
        text, n = pattern.subn(replacement, text)
        count += n
    if text != original:
        path.write_text(text, encoding="utf-8")
    return count


def ensure_imports(path: pathlib.Path, needed: list[str]) -> str:
    """Add any missing names to the file's `use crate::app::...` line."""
    text = path.read_text(encoding="utf-8")

    m = re.search(r"use crate::app::\{([^}]*)\};", text)
    if m:
        names = [n.strip() for n in m.group(1).split(",") if n.strip()]
        missing = [n for n in needed if n not in names]
        if not missing:
            return "imports ok"
        names.extend(missing)
        text = text[: m.start()] + "use crate::app::{" + ", ".join(names) + "};" + text[m.end() :]
    else:
        m2 = re.search(r"use crate::app::(\w+);", text)
        if m2:
            names = sorted({m2.group(1), *needed})
            text = (
                text[: m2.start()]
                + "use crate::app::{" + ", ".join(names) + "};"
                + text[m2.end() :]
            )
        else:
            return "NO app import found — check manually"

    path.write_text(text, encoding="utf-8")
    return "imports updated"


def main() -> int:
    total = 0
    for rel, needed in FILES.items():
        path = SRC / rel
        if not path.exists():
            print(f"MISSING  {rel}")
            continue
        n = apply(path)
        note = ensure_imports(path, needed)
        total += n
        print(f"{rel:26} {n:2d} replacements  ({note})")

    print(f"\ntotal replacements: {total}")
    if total == 0:
        print("nothing to do (already applied)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
