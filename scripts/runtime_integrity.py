#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ERP_ROOT = ROOT / "hariom-erp"
WEB_UI_ROOT = ROOT / "apps" / "web-ui"
WEB_UI_NEXT = WEB_UI_ROOT / ".next"

COMMON_SKIP_DIRS = {
    ".git",
    ".next",
    ".runtime",
    "runtime",
    "venv-runtime",
    ".pytest_cache",
    "__pycache__",
    "reports",
    "output",
}

SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".cjs", ".mjs", ".json", ".sh", ".ini"}


def _service_source_targets(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return sorted(path / "src" for path in root.iterdir() if path.is_dir() and (path / "src").exists())


SERVICE_SOURCE_TARGETS = _service_source_targets(ERP_ROOT / "services")

BACKEND_SOURCE_TARGETS = [
    ROOT / "apps" / "bff-api" / "src",
    ROOT / "start_all.sh",
    ROOT / "stop_all.sh",
    ROOT / "scripts" / "browser_release_gate.sh",
    ROOT / "scripts" / "compile_release_gate_report.py",
    ROOT / "scripts" / "e2e_hard_cutover_validation.py",
    ROOT / "scripts" / "hydrate_local_placeholders.py",
    ROOT / "scripts" / "recover_dataless_python_from_pyc.py",
    ROOT / "scripts" / "run_verification.sh",
    ROOT / "scripts" / "runtime_integrity.py",
    ROOT / "scripts" / "runtime_smoke.sh",
    ROOT / "scripts" / "start_verified_runtime.sh",
    ROOT / "scripts" / "verify_runtime_consistency.py",
    ERP_ROOT / "scripts" / "direct" / "bootstrap.sh",
    ERP_ROOT / "scripts" / "direct" / "ensure_databases.py",
    ERP_ROOT / "scripts" / "direct" / "start.sh",
    ERP_ROOT / "scripts" / "direct" / "stop.sh",
    *SERVICE_SOURCE_TARGETS,
]

WEB_SOURCE_TARGETS = [
    WEB_UI_ROOT / "app",
    WEB_UI_ROOT / "components",
    WEB_UI_ROOT / "context",
    WEB_UI_ROOT / "hooks",
    WEB_UI_ROOT / "lib",
    WEB_UI_ROOT / "types",
    WEB_UI_ROOT / "e2e",
    WEB_UI_ROOT / "package.json",
    WEB_UI_ROOT / "package-lock.json",
    WEB_UI_ROOT / "tsconfig.json",
    WEB_UI_ROOT / "next.config.js",
    WEB_UI_ROOT / "next.config.mjs",
    WEB_UI_ROOT / "playwright.config.cjs",
]

SCOPES = {
    "backend-source": {
        "targets": BACKEND_SOURCE_TARGETS,
        "skip_dirs": COMMON_SKIP_DIRS | {"node_modules", ".venv-direct", ".venv-runtime", "venv-direct"},
        "suffixes": SOURCE_SUFFIXES,
    },
    "web-source": {
        "targets": WEB_SOURCE_TARGETS,
        "skip_dirs": COMMON_SKIP_DIRS | {"node_modules", ".venv-direct", ".venv-runtime", "venv-direct"},
        "suffixes": SOURCE_SUFFIXES,
    },
    "critical-source": {
        "targets": [*BACKEND_SOURCE_TARGETS, *WEB_SOURCE_TARGETS],
        "skip_dirs": COMMON_SKIP_DIRS | {"node_modules", ".venv-direct", ".venv-runtime", "venv-direct"},
        "suffixes": SOURCE_SUFFIXES,
    },
    "web-deps": {
        "targets": [WEB_UI_ROOT / "node_modules"],
        "skip_dirs": set(),
    },
    "web-runtime": {
        "targets": [],
        "skip_dirs": set(),
    },
    "runtime-venv": {
        "targets": [],
        "skip_dirs": set(),
    },
}


@dataclass(frozen=True, order=True)
class IntegrityIssue:
    path: Path
    reason: str


def _ls_flags(path: Path) -> str:
    result = subprocess.run(
        ["ls", "-lO", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return ""
    parts = result.stdout.strip().split(maxsplit=8)
    if len(parts) < 5:
        return ""
    return parts[4]


def is_dataless(path: Path) -> bool:
    flags = _ls_flags(path)
    return "dataless" in {flag.strip() for flag in flags.split(",") if flag.strip()}


def _placeholder_real_path(path: Path) -> Path | None:
    if not path.name.endswith(".icloud-placeholder"):
        return None
    return path.with_name(path.name.removesuffix(".icloud-placeholder"))


def _allowed_suffix_for_path(path: Path) -> str | None:
    real_path = _placeholder_real_path(path)
    if real_path is not None:
        return real_path.suffix
    return path.suffix


def _ignore_placeholder_shadow(path: Path) -> bool:
    real_path = _placeholder_real_path(path)
    if real_path is None or not real_path.exists():
        return False
    return not is_dataless(real_path)


def _find_dataless_in_dir(root: Path, skip_dirs: set[str]) -> list[Path]:
    if not root.exists():
        return []

    if not skip_dirs:
        result = subprocess.run(
            ["find", str(root), "-type", "f", "-flags", "+dataless", "-print"],
            capture_output=True,
            text=True,
            check=False,
        )
    else:
        command = ["find", str(root)]
        command.extend(["(", "-type", "d", "("])
        for index, name in enumerate(sorted(skip_dirs)):
            if index:
                command.append("-o")
            command.extend(["-name", name])
        command.extend([")", "-prune", ")", "-o", "-type", "f", "-flags", "+dataless", "-print"])
        result = subprocess.run(command, capture_output=True, text=True, check=False)

    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr.strip() or f"find failed for {root}")

    return [Path(line) for line in result.stdout.splitlines() if line.strip()]


def _find_placeholders_in_dir(root: Path, skip_dirs: set[str]) -> list[Path]:
    if not root.exists():
        return []

    if not skip_dirs:
        command = ["find", str(root), "-type", "f", "-name", "*.icloud-placeholder", "-print"]
    else:
        command = ["find", str(root)]
        command.extend(["(", "-type", "d", "("])
        for index, name in enumerate(sorted(skip_dirs)):
            if index:
                command.append("-o")
            command.extend(["-name", name])
        command.extend([")", "-prune", ")", "-o", "-type", "f", "-name", "*.icloud-placeholder", "-print"])

    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr.strip() or f"find placeholder scan failed for {root}")

    return [Path(line) for line in result.stdout.splitlines() if line.strip()]


def _read_trace_file(path: Path) -> list[Path]:
    if not path.exists() or is_dataless(path):
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []

    files = payload.get("files") or []
    resolved: list[Path] = []
    base_dir = path.parent
    for value in files:
        candidate = (base_dir / value).resolve()
        if candidate.exists():
            resolved.append(candidate)
    return resolved


def resolve_web_runtime_targets() -> list[Path]:
    trace_files: list[Path] = []
    if WEB_UI_NEXT.exists():
        trace_files.extend(sorted(WEB_UI_NEXT.glob("*.nft.json")))
        trace_files.extend(sorted((WEB_UI_NEXT / "server").rglob("*.nft.json")))

    targets: set[Path] = {
        WEB_UI_NEXT / "BUILD_ID",
        WEB_UI_NEXT / "package.json",
        WEB_UI_NEXT / "required-server-files.json",
    }
    for trace_file in trace_files:
        targets.add(trace_file)
        targets.update(_read_trace_file(trace_file))
    return sorted(path for path in targets if path.exists())


def _scope_targets(scope: str) -> list[Path]:
    if scope == "web-runtime":
        return resolve_web_runtime_targets()
    if scope == "runtime-venv":
        preferred = ERP_ROOT / "venv-runtime"
        legacy = ERP_ROOT / ".venv-runtime"
        if preferred.exists() or not legacy.exists():
            return [preferred]
        return [legacy]
    return list(SCOPES[scope]["targets"])


def _path_allowed_for_scope(scope: str, path: Path) -> bool:
    suffixes = SCOPES[scope].get("suffixes")
    if suffixes is None:
        return True
    if _ignore_placeholder_shadow(path):
        return False
    return _allowed_suffix_for_path(path) in suffixes


def list_integrity_issues(scopes: list[str]) -> list[IntegrityIssue]:
    issues: dict[Path, IntegrityIssue] = {}
    for scope in scopes:
        config = SCOPES[scope]
        for target in _scope_targets(scope):
            if target.is_file():
                if is_dataless(target) and _path_allowed_for_scope(scope, target):
                    issues[target] = IntegrityIssue(path=target, reason="dataless")
                continue

            for path in _find_dataless_in_dir(target, config["skip_dirs"]):
                if _path_allowed_for_scope(scope, path):
                    issues[path] = IntegrityIssue(path=path, reason="dataless")

            for placeholder in _find_placeholders_in_dir(target, config["skip_dirs"]):
                real_path = _placeholder_real_path(placeholder)
                if real_path is None or not _path_allowed_for_scope(scope, placeholder):
                    continue
                if real_path.exists() and not is_dataless(real_path):
                    continue
                issues.setdefault(real_path, IntegrityIssue(path=real_path, reason="placeholder"))

    return sorted(issues.values(), key=lambda issue: (str(issue.path), issue.reason))


def list_dataless_paths(scopes: list[str]) -> list[Path]:
    return [issue.path for issue in list_integrity_issues(scopes)]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect dataless files in critical ERP runtime paths.")
    parser.add_argument(
        "command",
        choices=("list", "count", "check"),
        default="list",
        nargs="?",
        help="How to report dataless files.",
    )
    parser.add_argument(
        "--scope",
        action="append",
        choices=sorted(SCOPES),
        dest="scopes",
        help="Limit inspection to a specific scope. Defaults to all scopes.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    scopes = args.scopes or sorted(SCOPES)
    issues = list_integrity_issues(scopes)

    if args.command == "count":
        print(len(issues))
        return 0

    if args.command == "check":
        if not issues:
            print(f"[runtime-integrity] OK for scopes: {', '.join(scopes)}")
            return 0
        print(
            f"[runtime-integrity] found {len(issues)} unresolved files for scopes: {', '.join(scopes)}",
            file=sys.stderr,
        )
        for issue in issues:
            print(f"[{issue.reason}] {issue.path}", file=sys.stderr)
        return 1

    for issue in issues:
        print(f"[{issue.reason}] {issue.path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
