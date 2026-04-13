#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTEGRITY = ROOT / "scripts" / "runtime_integrity.py"
SHIM = """from importlib.machinery import SourcelessFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

_pyc_path = Path(__file__).with_suffix(".pyc")
_loader = SourcelessFileLoader(__name__, str(_pyc_path))
_spec = spec_from_loader(__name__, _loader)
_module = module_from_spec(_spec)
_loader.exec_module(_module)
globals().update(_module.__dict__)
"""


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


def list_backend_paths() -> list[Path]:
    result = subprocess.run(
        ["python3", str(INTEGRITY), "list", "--scope", "backend-source"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    seen: set[Path] = set()
    paths: list[Path] = []
    prefix = f"{ROOT}/"
    for line in result.stdout.splitlines():
        if "] " not in line:
            continue
        raw = line.split("] ", 1)[1].strip()
        if raw.endswith(".icloud-placeholder"):
            raw = raw[:-18]
        if not raw.startswith(prefix):
            continue
        rel = Path(raw[len(prefix) :])
        if rel.suffix != ".py" or rel in seen:
            continue
        seen.add(rel)
        paths.append(ROOT / rel)
    return paths


def choose_pyc(path: Path) -> Path | None:
    direct = path.with_suffix(".pyc")
    if direct.exists() and not is_dataless(direct) and direct.stat().st_size > 0:
        return direct
    cache = path.parent / "__pycache__" / f"{path.stem}.cpython-311.pyc"
    if cache.exists() and not is_dataless(cache) and cache.stat().st_size > 0:
        return cache
    return None


def create_shim(path: Path, pyc_path: Path) -> None:
    direct = path.with_suffix(".pyc")
    if pyc_path != direct:
        shutil.copyfile(pyc_path, direct)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(SHIM, encoding="utf-8")


def main() -> int:
    created = 0
    skipped = 0
    for path in list_backend_paths():
        pyc_path = choose_pyc(path)
        if pyc_path is None:
            skipped += 1
            continue
        create_shim(path, pyc_path)
        created += 1
        print(f"shimmed {path.relative_to(ROOT)}")
    print(f"[create-pyc-shims] created={created} skipped={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
