#!/usr/bin/env python3
from __future__ import annotations

import os
import fnmatch
import shutil
import subprocess
import sys
from pathlib import Path


TOP_LEVEL_FILES = [
    "ARCHITECTURE.md",
    "DECISIONS.md",
    "SYSTEM_DESIGN.md",
    "TESTING_GUIDE.md",
    "start_all.sh",
    "start_services.sh",
    "start_ui.sh",
    "status_all.sh",
    "stop_all.sh",
    "stop_services.sh",
]

WEB_UI_ROOT_FILES = [
    "apps/web-ui/Dockerfile",
    "apps/web-ui/next-env.d.ts",
    "apps/web-ui/next.config.js",
    "apps/web-ui/package-lock.json",
    "apps/web-ui/package.json",
    "apps/web-ui/playwright.config.cjs",
    "apps/web-ui/postcss.config.js",
    "apps/web-ui/tailwind.config.ts",
    "apps/web-ui/tsconfig.json",
]

HARIOM_ROOT_FILES = [
    "hariom-erp/.env",
    "hariom-erp/.env.example",
    "hariom-erp/.gitignore",
    "hariom-erp/ACCESS_GUIDE.md",
    "hariom-erp/Hariom_ERP_Final_Requirements_and_Plan.md",
    "hariom-erp/README.md",
    "hariom-erp/ROADMAP.md",
    "hariom-erp/TASK.md",
    "hariom-erp/docker-compose.yml",
    "hariom-erp/render.yaml",
    "hariom-erp/start_all.sh",
    "hariom-erp/status_all.sh",
    "hariom-erp/stop_all.sh",
]

TREE_DIRS = [
    "apps/web-ui/app",
    "apps/web-ui/components",
    "apps/web-ui/context",
    "apps/web-ui/e2e",
    "apps/web-ui/hooks",
    "apps/web-ui/lib",
    "apps/web-ui/pages",
    "apps/web-ui/public",
    "apps/web-ui/types",
    "apps/bff-api/src",
    "hariom-erp/services",
    "hariom-erp/scripts",
    "hariom-erp/docs",
    "hariom-erp/infra",
    "hariom-erp/ui",
    "scripts",
]

SKIP_PATH_PARTS = {
    "__pycache__",
    ".next",
    ".runtime",
    "runtime",
    ".pytest_cache",
    "node_modules",
    "playwright-report",
    "test-results",
    ".turbo",
    "venv",
    ".venv-direct",
    ".venv-runtime",
    "site-packages",
    ".git",
    "tests",
    "alembic",
}

SKIP_FILE_PATTERNS = [
    "*.pyc",
    "*.icloud-placeholder",
    "*.log",
    "*.bak",
    "*.dataless-orig",
    "* 2.tsx",
    "* 2.ts",
    "* 2.js",
    "* 2.py",
    "* 2.sh",
    "* 3.tsx",
    "* 3.ts",
    "* 3.js",
    "nohup.out",
    "IMPLEMENTATION_SUMMARY.md",
]


def should_skip(rel: str) -> bool:
    path = Path(rel)
    if any(part in SKIP_PATH_PARTS for part in path.parts):
        return True
    return any(fnmatch.fnmatch(path.name, pattern) for pattern in SKIP_FILE_PATTERNS)


def gather_files(source_root: Path) -> list[str]:
    files: list[str] = []
    for rel in TOP_LEVEL_FILES + WEB_UI_ROOT_FILES + HARIOM_ROOT_FILES + [
        "apps/bff-api/Dockerfile",
        "apps/bff-api/requirements.txt",
    ]:
        if (source_root / rel).is_file() and not should_skip(rel):
            files.append(rel)

    for rel_dir in TREE_DIRS:
        base = source_root / rel_dir
        if not base.exists():
            continue
        for root, _dirs, filenames in os.walk(base):
            for name in filenames:
                rel = str((Path(root) / name).relative_to(source_root))
                if not should_skip(rel):
                    files.append(rel)

    return sorted(set(files))


def copy_one(source_root: Path, target_root: Path, rel: str, timeout_seconds: int = 2) -> tuple[bool, str | None]:
    src = source_root / rel
    dst = target_root / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(2):
        try:
            subprocess.run(["cp", "-p", str(src), str(dst)], check=True, timeout=timeout_seconds)
            return True, None
        except subprocess.TimeoutExpired:
            if attempt == 0:
                subprocess.run(["brctl", "download", str(src)], check=False, timeout=5)
                continue
            return False, "timeout"
        except subprocess.CalledProcessError as exc:
            if attempt == 0:
                subprocess.run(["brctl", "download", str(src)], check=False, timeout=5)
                continue
            return False, f"copy_failed:{exc.returncode}"
    return False, "unknown"


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: export_to_local_workspace.py <source-root> <target-root>")
        return 1

    source_root = Path(sys.argv[1]).expanduser().resolve()
    target_root = Path(sys.argv[2]).expanduser()

    if not source_root.is_dir():
        print(f"Source root not found: {source_root}")
        return 1

    shutil.rmtree(target_root, ignore_errors=True)
    target_root.mkdir(parents=True, exist_ok=True)

    files = gather_files(source_root)
    failures: list[tuple[str, str]] = []

    for index, rel in enumerate(files, start=1):
        ok, reason = copy_one(source_root, target_root, rel)
        if not ok and reason is not None:
            failures.append((rel, reason))
        if index % 50 == 0:
            print(f"copied {index}/{len(files)}")
            sys.stdout.flush()

    report = target_root / "EXPORT_REPORT.txt"
    report.write_text(
        "\n".join(
            [
                f"source={source_root}",
                f"target={target_root}",
                f"files_total={len(files)}",
                f"failures={len(failures)}",
                "",
                *[f"{rel} :: {reason}" for rel, reason in failures],
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"Export complete: {target_root}")
    print(f"Failures: {len(failures)}")
    if failures:
        for rel, reason in failures[:20]:
            print(f"{rel} :: {reason}")
    return 0 if not failures else 2


if __name__ == "__main__":
    raise SystemExit(main())
