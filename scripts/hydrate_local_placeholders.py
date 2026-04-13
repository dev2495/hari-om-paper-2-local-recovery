#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

from runtime_integrity import IntegrityIssue, ROOT, SCOPES, is_dataless, list_dataless_paths, list_integrity_issues

DEFAULT_SCOPES = ["critical-source"]


def chunked(items: list[Path], size: int) -> list[list[Path]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def _placeholder_for(path: Path) -> Path:
    return path.with_name(f"{path.name}.icloud-placeholder")


def _downloadable_target(path: Path) -> Path | None:
    if path.exists():
        return path
    placeholder = _placeholder_for(path)
    if placeholder.exists():
        return placeholder
    return None


def download_targets(paths: list[Path]) -> list[Path]:
    if not paths:
        return []

    resolved_targets = []
    original_lookup: dict[Path, Path] = {}
    for path in paths:
        target = _downloadable_target(path)
        if target is None:
            continue
        resolved_targets.append(target)
        original_lookup[target] = path

    if not resolved_targets:
        return sorted(paths)

    result = subprocess.run(
        ["/usr/bin/brctl", "download", *[str(path) for path in resolved_targets]],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode == 0:
        return []

    failed: list[Path] = []
    for path in resolved_targets:
        single = subprocess.run(
            ["/usr/bin/brctl", "download", str(path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if single.returncode != 0:
            failed.append(original_lookup[path])
    return failed


def _issues_for_custom_paths(paths: list[Path]) -> list[IntegrityIssue]:
    pending: dict[Path, IntegrityIssue] = {}
    for path in paths:
        if path.exists() and is_dataless(path):
            pending[path] = IntegrityIssue(path=path, reason="dataless")
        placeholder = _placeholder_for(path)
        if placeholder.exists() and (not path.exists() or is_dataless(path)):
            pending.setdefault(path, IntegrityIssue(path=path, reason="placeholder"))
    return sorted(pending.values(), key=lambda issue: (str(issue.path), issue.reason))


def wait_for_hydration(scopes: list[str], timeout_seconds: int, stagnant_seconds: int) -> list[IntegrityIssue]:
    pending = list_integrity_issues(scopes)
    last_signature = tuple((str(issue.path), issue.reason) for issue in pending)
    deadline = time.time() + timeout_seconds
    last_progress_at = time.time()
    while pending and time.time() < deadline:
        pending = list_integrity_issues(scopes)
        signature = tuple((str(issue.path), issue.reason) for issue in pending)
        if signature != last_signature:
            last_signature = signature
            last_progress_at = time.time()
        elif stagnant_seconds > 0 and time.time() - last_progress_at >= stagnant_seconds:
            break
        if pending:
            time.sleep(1)
    return pending


def format_issue(issue: IntegrityIssue) -> str:
    placeholder = _placeholder_for(issue.path)
    if issue.reason == "placeholder" and placeholder.exists():
        return f"[placeholder] {issue.path} <- {placeholder}"
    return f"[{issue.reason}] {issue.path}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Hydrate iCloud dataless runtime files.")
    parser.add_argument("--timeout-seconds", type=int, default=120)
    parser.add_argument(
        "--stagnant-seconds",
        type=int,
        default=5,
        help="Fail early when the unresolved set stops changing for this many seconds.",
    )
    parser.add_argument("--chunk-size", type=int, default=32)
    parser.add_argument(
        "--scope",
        action="append",
        choices=sorted(SCOPES),
        dest="scopes",
        help="Limit hydration to a specific scope. Defaults to critical-source.",
    )
    parser.add_argument("paths", nargs="*", help="Optional custom roots/files to hydrate.")
    args = parser.parse_args()

    custom_paths = bool(args.paths)
    if custom_paths:
        targets = sorted({Path(path) for path in args.paths})
        scopes = DEFAULT_SCOPES
    else:
        scopes = args.scopes or DEFAULT_SCOPES
        targets = list_dataless_paths(scopes)

    if not targets:
        print("[hydrate] no dataless runtime files found")
        return 0

    print(f"[hydrate] downloading {len(targets)} dataless runtime files from scopes: {', '.join(scopes)}")
    download_failures: list[Path] = []
    for chunk in chunked(targets, args.chunk_size):
        download_failures.extend(download_targets(chunk))

    pending = _issues_for_custom_paths(targets) if custom_paths else wait_for_hydration(scopes, args.timeout_seconds, args.stagnant_seconds)
    unresolved: dict[Path, IntegrityIssue] = {issue.path: issue for issue in pending}
    for path in download_failures:
        unresolved[path] = IntegrityIssue(path=path, reason="download-failed")
    if unresolved:
        print("[hydrate] unresolved runtime files after hydration attempt:", file=sys.stderr)
        for issue in sorted(unresolved.values(), key=lambda item: (str(item.path), item.reason)):
            print(f"  - {format_issue(issue)}", file=sys.stderr)
        return 1

    print("[hydrate] runtime files hydrated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
