from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parents[1]
ERP_DIR = BASE_DIR / "hariom-erp"
REPORT_DIR = BASE_DIR / "reports"
WEB_UI_DIR = BASE_DIR / "apps" / "web-ui"
BFF_DIR = BASE_DIR / "apps" / "bff-api"


def resolve_runtime_dir() -> Path:
    override = os.getenv("ERP_RUNTIME_DIR")
    if override:
        return Path(override)
    preferred = ERP_DIR / "runtime"
    legacy = ERP_DIR / ".runtime"
    if preferred.exists() or not legacy.exists():
        return preferred
    return legacy


RUNTIME_DIR = resolve_runtime_dir()

RUNTIME_ENV_PATH = RUNTIME_DIR / "orchestrator.env"
PORTS_ENV_PATH = RUNTIME_DIR / "ports.env"
MANIFEST_PATH = RUNTIME_DIR / "runtime_manifest.json"

DEFAULT_PORTS = {
    "AUTH_PORT": 18001,
    "MASTER_PORT": 18002,
    "SPEC_PORT": 18003,
    "PRODUCTION_PORT": 18004,
    "INVENTORY_PORT": 18005,
    "ANALYTICS_PORT": 18007,
    "SALES_PORT": 18008,
    "BFF_PORT": 14000,
    "WEB_UI_PORT": 13000,
}


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception:
        return None


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _read_pid(path: Path) -> str | None:
    value = _read_text(path)
    return value if value else None


def _runtime_urls(host: str, ports: dict[str, int]) -> dict[str, str]:
    public_web = os.getenv("APP_PUBLIC_URL")
    return {
        "auth": f"http://{host}:{ports['AUTH_PORT']}",
        "master": f"http://{host}:{ports['MASTER_PORT']}",
        "spec": f"http://{host}:{ports['SPEC_PORT']}",
        "production": f"http://{host}:{ports['PRODUCTION_PORT']}",
        "inventory": f"http://{host}:{ports['INVENTORY_PORT']}",
        "analytics": f"http://{host}:{ports['ANALYTICS_PORT']}",
        "sales": f"http://{host}:{ports['SALES_PORT']}",
        "bff": f"http://{host}:{ports['BFF_PORT']}",
        "web": f"http://{host}:{ports['WEB_UI_PORT']}",
        "web_public": public_web or f"http://{host}:{ports['WEB_UI_PORT']}",
    }


def build_runtime_manifest() -> dict[str, Any]:
    runtime_env = load_env_file(RUNTIME_ENV_PATH)
    ports_env = load_env_file(PORTS_ENV_PATH)

    host = os.getenv("HOST", runtime_env.get("HOST", ports_env.get("HOST", "127.0.0.1")))
    ports: dict[str, int] = {}
    for key, default in DEFAULT_PORTS.items():
        raw = os.getenv(key, runtime_env.get(key, ports_env.get(key, str(default))))
        try:
            ports[key] = int(str(raw).strip())
        except ValueError:
            ports[key] = default

    urls = _runtime_urls(host, ports)
    build_id = _read_text(WEB_UI_DIR / ".next" / "BUILD_ID")
    build_manifest = _read_json(WEB_UI_DIR / ".next" / "build-manifest.json")
    app_build_manifest = _read_json(WEB_UI_DIR / ".next" / "app-build-manifest.json")

    log_files = {
        "auth": str(RUNTIME_DIR / "logs" / "auth-service.log"),
        "master": str(RUNTIME_DIR / "logs" / "masterdata-service.log"),
        "spec": str(RUNTIME_DIR / "logs" / "spec-service.log"),
        "sales": str(RUNTIME_DIR / "logs" / "sales-service.log"),
        "production": str(RUNTIME_DIR / "logs" / "production-service.log"),
        "inventory": str(RUNTIME_DIR / "logs" / "inventory-service.log"),
        "analytics": str(RUNTIME_DIR / "logs" / "analytics-service.log"),
        "bff": str(RUNTIME_DIR / "logs" / "bff-api.log"),
        "web": str(RUNTIME_DIR / "logs" / "web-ui.log"),
    }
    pid_files = {
        "auth": str(RUNTIME_DIR / "pids" / "auth-service.pid"),
        "master": str(RUNTIME_DIR / "pids" / "masterdata-service.pid"),
        "spec": str(RUNTIME_DIR / "pids" / "spec-service.pid"),
        "sales": str(RUNTIME_DIR / "pids" / "sales-service.pid"),
        "production": str(RUNTIME_DIR / "pids" / "production-service.pid"),
        "inventory": str(RUNTIME_DIR / "pids" / "inventory-service.pid"),
        "analytics": str(RUNTIME_DIR / "pids" / "analytics-service.pid"),
        "bff": str(RUNTIME_DIR / "pids" / "bff-api.pid"),
        "web": str(RUNTIME_DIR / "pids" / "web-ui.pid"),
    }

    return {
        "generated_at": datetime.now().isoformat(),
        "mode": runtime_env.get("MODE", "direct"),
        "host": host,
        "ports": ports,
        "urls": urls,
        "settings": {
            "start_web_ui": runtime_env.get("START_WEB_UI", "1") == "1",
            "web_ui_source_build": runtime_env.get("WEB_UI_SOURCE_BUILD", "0") == "1",
            "web_ui_mode": runtime_env.get("WEB_UI_MODE", "prod"),
            "startup_preflight": runtime_env.get("STARTUP_PREFLIGHT", "1") == "1",
        },
        "paths": {
            "workspace_root": str(BASE_DIR),
            "erp_root": str(ERP_DIR),
            "runtime_dir": str(RUNTIME_DIR),
            "manifest_path": str(MANIFEST_PATH),
            "web_ui_dir": str(WEB_UI_DIR),
            "bff_dir": str(BFF_DIR),
            "reports_dir": str(REPORT_DIR),
        },
        "web": {
            "build_id": build_id,
            "build_dir": str(WEB_UI_DIR / ".next"),
            "build_manifest_present": bool(build_manifest),
            "app_build_manifest_present": bool(app_build_manifest),
        },
        "logs": log_files,
        "pids": {
            name: _read_pid(Path(path))
            for name, path in pid_files.items()
        },
        "defaults": {
            "admin_email": os.getenv("ADMIN_EMAIL", os.getenv("BOOTSTRAP_ADMIN_EMAIL", "admin@hariom.com")),
            "admin_password": os.getenv("ADMIN_PASSWORD", os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "admin123")),
        },
    }


def load_runtime_manifest() -> dict[str, Any]:
    manifest = _read_json(MANIFEST_PATH)
    if manifest:
        return manifest
    return build_runtime_manifest()


def write_runtime_manifest(manifest: dict[str, Any]) -> Path:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return MANIFEST_PATH
