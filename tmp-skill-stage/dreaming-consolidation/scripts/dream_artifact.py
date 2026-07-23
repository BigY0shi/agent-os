#!/usr/bin/env python3
"""Create and diff review-mode dream artifacts.

This script never promotes changes into live memory. It creates a timestamped
run directory, copies the memory root into proposed/, and can later write a
unified diff between the live root and proposed/.
"""

from __future__ import annotations

import argparse
import difflib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", ".obsidian", ".trash"}


def copytree(src: Path, dst: Path) -> None:
    def ignore(_dir: str, names: list[str]) -> set[str]:
        return {name for name in names if name in SKIP_DIRS}

    if dst.exists():
        raise SystemExit(f"Refusing to overwrite existing proposed tree: {dst}")
    shutil.copytree(src, dst, ignore=ignore)


def text_files(root: Path) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for path in root.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        try:
            out[rel] = path.read_text(encoding="utf-8").splitlines(keepends=True)
        except UnicodeDecodeError:
            continue
    return out


def write_diff(memory_root: Path, proposed_root: Path, diff_path: Path) -> int:
    before = text_files(memory_root)
    after = text_files(proposed_root)
    changed = 0
    chunks: list[str] = []
    for rel in sorted(set(before) | set(after)):
        old = before.get(rel, [])
        new = after.get(rel, [])
        if old == new:
            continue
        changed += 1
        chunks.extend(
            difflib.unified_diff(
                old,
                new,
                fromfile=f"live/{rel}",
                tofile=f"proposed/{rel}",
                lineterm="",
            )
        )
        chunks.append("\n")
    diff_path.write_text("\n".join(chunks), encoding="utf-8")
    return changed


def init_run(args: argparse.Namespace) -> None:
    memory_root = Path(args.memory_root).expanduser().resolve()
    dream_root = Path(args.dream_root).expanduser().resolve()
    if not memory_root.exists() or not memory_root.is_dir():
        raise SystemExit(f"Memory root does not exist or is not a directory: {memory_root}")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    slug = args.label.strip().lower().replace(" ", "-") if args.label else "dream"
    run_dir = dream_root / f"{stamp}-{slug}"
    proposed = run_dir / "proposed"
    run_dir.mkdir(parents=True, exist_ok=False)
    copytree(memory_root, proposed)

    metadata = {
        "created_at_utc": stamp,
        "mode": args.mode,
        "memory_root": str(memory_root),
        "dream_root": str(dream_root),
        "run_dir": str(run_dir),
        "label": args.label,
    }
    (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    (run_dir / "changelog.md").write_text(
        "# Dream Changelog\n\n- Artifact initialized. Edit proposed/ then run --diff.\n",
        encoding="utf-8",
    )
    (run_dir / "diff.patch").write_text("", encoding="utf-8")
    print(run_dir)


def diff_run(args: argparse.Namespace) -> None:
    run_dir = Path(args.run_dir).expanduser().resolve()
    metadata_path = run_dir / "metadata.json"
    proposed = run_dir / "proposed"
    if not metadata_path.exists():
        raise SystemExit(f"Missing metadata.json in run dir: {run_dir}")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    memory_root = Path(metadata["memory_root"]).expanduser().resolve()
    if not proposed.exists():
        raise SystemExit(f"Missing proposed tree: {proposed}")
    changed = write_diff(memory_root, proposed, run_dir / "diff.patch")
    metadata["changed_text_files"] = changed
    metadata["diffed_at_utc"] = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"{changed} changed text file(s)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or diff a dream consolidation artifact.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    init = sub.add_parser("init", help="Create a timestamped dream artifact with proposed/ copied from memory root.")
    init.add_argument("--memory-root", required=True)
    init.add_argument("--dream-root", required=True)
    init.add_argument("--mode", choices=["review", "auto"], default="review")
    init.add_argument("--label", default="dream")
    init.set_defaults(func=init_run)

    diff = sub.add_parser("diff", help="Write diff.patch for an existing run directory.")
    diff.add_argument("--run-dir", required=True)
    diff.set_defaults(func=diff_run)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
