#!/usr/bin/env python3
"""Supervise the Hari Om ERP staging stack inside one TinyPod app container."""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.error import URLError
from urllib.parse import quote_plus
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
PYTHON = sys.executable


def env(name: str, default: str) -> str:
    return os.getenv(name, default)


def public_web_port() -> str:
    explicit_port = os.getenv("WEB_UI_PORT")
    if explicit_port:
        return explicit_port
    return os.getenv("PORT", "13000")


def is_railway_runtime() -> bool:
    return bool(os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_SERVICE_ID"))


def require_railway_secret(name: str, unsafe_values: set[str]) -> None:
    value = os.getenv(name, "")
    if not value or value in unsafe_values:
        raise RuntimeError(f"{name} must be set to a production value before deploying on Railway")


def require_railway_flag_off(name: str) -> None:
    value = os.getenv(name, "").strip().lower()
    if value in {"1", "true", "yes", "on"}:
        raise RuntimeError(f"{name} must be false before deploying on Railway")


AUTH_PORT = env("AUTH_PORT", "18001")
MASTER_PORT = env("MASTER_PORT", "18002")
SPEC_PORT = env("SPEC_PORT", "18003")
PRODUCTION_PORT = env("PRODUCTION_PORT", "18004")
INVENTORY_PORT = env("INVENTORY_PORT", "18005")
ANALYTICS_PORT = env("ANALYTICS_PORT", "18007")
SALES_PORT = env("SALES_PORT", "18008")
BFF_PORT = env("BFF_PORT", "14000")
BFF_BIND_HOST = env("BFF_BIND_HOST", "127.0.0.1")
WEB_UI_PORT = public_web_port()

AUTH_URL = f"http://127.0.0.1:{AUTH_PORT}"
MASTER_URL = f"http://127.0.0.1:{MASTER_PORT}"
SPEC_URL = f"http://127.0.0.1:{SPEC_PORT}"
PRODUCTION_URL = f"http://127.0.0.1:{PRODUCTION_PORT}"
INVENTORY_URL = f"http://127.0.0.1:{INVENTORY_PORT}"
ANALYTICS_URL = f"http://127.0.0.1:{ANALYTICS_PORT}"
SALES_URL = f"http://127.0.0.1:{SALES_PORT}"
BFF_URL = f"http://127.0.0.1:{BFF_PORT}"


def database_url(db_name: str) -> str:
    db_user = env("DB_USER", "hariom")
    db_password = os.getenv("DB_PASSWORD", "")
    db_host = env("DB_HOST", "postgres")
    db_port = env("DB_PORT", "5432")
    if db_password:
        return f"postgresql://{quote_plus(db_user)}:{quote_plus(db_password)}@{db_host}:{db_port}/{db_name}"
    return f"postgresql://{quote_plus(db_user)}@{db_host}:{db_port}/{db_name}"


BASE_ENV = {
    "APP_ENV": env("APP_ENV", "production"),
    "ENVIRONMENT": env("ENVIRONMENT", "production"),
    "NODE_ENV": env("NODE_ENV", "production"),
    "ERP_HOST": "127.0.0.1",
    "JWT_SECRET": env("JWT_SECRET", "change_me_in_production"),
    "SECRET_KEY": env("JWT_SECRET", "change_me_in_production"),
    "AUTH_SERVICE_URL": AUTH_URL,
    "MASTER_SERVICE_URL": MASTER_URL,
    "MASTER_DATA_SERVICE_URL": MASTER_URL,
    "MASTERDATA_SERVICE_URL": MASTER_URL,
    "SPEC_SERVICE_URL": SPEC_URL,
    "SALES_SERVICE_URL": SALES_URL,
    "PRODUCTION_SERVICE_URL": PRODUCTION_URL,
    "INVENTORY_SERVICE_URL": INVENTORY_URL,
    "ANALYTICS_SERVICE_URL": ANALYTICS_URL,
    "BFF_INTERNAL_URL": BFF_URL,
    "NEXT_PUBLIC_BFF_URL": BFF_URL,
    "WEB_UI_PORT": WEB_UI_PORT,
    "BOOTSTRAP_ADMIN_EMAIL": env("BOOTSTRAP_ADMIN_EMAIL", "devarsh@hariom.com"),
    "BOOTSTRAP_ADMIN_PASSWORD": env("BOOTSTRAP_ADMIN_PASSWORD", "admin123"),
    "BOOTSTRAP_ADMIN_NAME": env("BOOTSTRAP_ADMIN_NAME", "Devarsh Admin"),
    "BOOTSTRAP_ADMIN_PLANT_ID": env("BOOTSTRAP_ADMIN_PLANT_ID", "PLANT_A"),
    "BOOTSTRAP_OWNER_EMAIL": env("BOOTSTRAP_OWNER_EMAIL", "yash@hariom.com"),
    "BOOTSTRAP_OWNER_PASSWORD": env("BOOTSTRAP_OWNER_PASSWORD", "owner123"),
    "BOOTSTRAP_OWNER_NAME": env("BOOTSTRAP_OWNER_NAME", "Yash Owner"),
    "BOOTSTRAP_OWNER_PLANT_ID": env("BOOTSTRAP_OWNER_PLANT_ID", "PLANT_A"),
    "SEED_DEMO_USERS": env("SEED_DEMO_USERS", "false"),
    "ANALYTICS_CACHE_TTL_SECONDS": env("ANALYTICS_CACHE_TTL_SECONDS", "120"),
}


@dataclass(frozen=True)
class ManagedProcess:
    name: str
    cwd: Path
    command: list[str]
    health_url: str | None
    extra_env: dict[str, str]


PROCESSES = [
    ManagedProcess(
        name="auth-service",
        cwd=ROOT / "hariom-erp/services/auth-service",
        command=[PYTHON, "-m", "uvicorn", "src.main:app", "--host", "127.0.0.1", "--port", AUTH_PORT],
        health_url=f"{AUTH_URL}/",
        extra_env={"DATABASE_URL": database_url("authdb")},
    ),
    ManagedProcess(
        name="masterdata-service",
        cwd=ROOT / "hariom-erp/services/masterdata-service",
        command=[PYTHON, "-m", "uvicorn", "src.main:app", "--host", "127.0.0.1", "--port", MASTER_PORT],
        health_url=f"{MASTER_URL}/health",
        extra_env={"DATABASE_URL": database_url("masterdb")},
    ),
    ManagedProcess(
        name="spec-service",
        cwd=ROOT / "hariom-erp/services/spec-service",
        command=[PYTHON, "-m", "uvicorn", "src.main:app", "--host", "127.0.0.1", "--port", SPEC_PORT],
        health_url=f"{SPEC_URL}/health",
        extra_env={"DATABASE_URL": database_url("specdb")},
    ),
    ManagedProcess(
        name="sales-service",
        cwd=ROOT / "hariom-erp/services/sales-service",
        command=[PYTHON, "-m", "uvicorn", "src.main:app", "--host", "127.0.0.1", "--port", SALES_PORT],
        health_url=f"{SALES_URL}/health",
        extra_env={"DATABASE_URL": database_url("salesdb")},
    ),
    ManagedProcess(
        name="inventory-service",
        cwd=ROOT / "hariom-erp/services/inventory-service",
        command=[PYTHON, "-m", "uvicorn", "src.main:app", "--host", "127.0.0.1", "--port", INVENTORY_PORT],
        health_url=f"{INVENTORY_URL}/health",
        extra_env={"DATABASE_URL": database_url("inventorydb")},
    ),
    ManagedProcess(
        name="production-service",
        cwd=ROOT / "hariom-erp/services/production-service",
        command=[PYTHON, "-m", "uvicorn", "src.main:app", "--host", "127.0.0.1", "--port", PRODUCTION_PORT],
        health_url=f"{PRODUCTION_URL}/health",
        extra_env={"DATABASE_URL": database_url("productiondb")},
    ),
    ManagedProcess(
        name="analytics-service",
        cwd=ROOT / "hariom-erp/services/analytics-service",
        command=[PYTHON, "-m", "uvicorn", "src.main:app", "--host", "127.0.0.1", "--port", ANALYTICS_PORT],
        health_url=f"{ANALYTICS_URL}/health",
        extra_env={"DATABASE_URL": database_url("analyticsdb")},
    ),
    ManagedProcess(
        name="analytics-worker",
        cwd=ROOT / "hariom-erp/services/analytics-service",
        command=[PYTHON, "-m", "src.job_worker"],
        health_url=None,
        extra_env={"DATABASE_URL": database_url("analyticsdb")},
    ),
    ManagedProcess(
        name="bff-api",
        cwd=ROOT / "apps/bff-api",
        command=[PYTHON, "-m", "uvicorn", "src.main:app", "--host", BFF_BIND_HOST, "--port", BFF_PORT],
        health_url=f"{BFF_URL}/health/ready",
        extra_env={},
    ),
    ManagedProcess(
        name="web-ui",
        cwd=ROOT / "apps/web-ui",
        command=["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", WEB_UI_PORT],
        health_url=f"http://127.0.0.1:{WEB_UI_PORT}/login",
        extra_env={},
    ),
]


children: list[subprocess.Popen[str]] = []
shutdown_requested = False


def wait_for_tcp(host: str, port: int, timeout_seconds: int = 90) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=2):
                return
        except OSError:
            time.sleep(1)
    raise TimeoutError(f"Timed out waiting for TCP {host}:{port}")


def wait_for_http(name: str, url: str, timeout_seconds: int = 120) -> None:
    deadline = time.monotonic() + timeout_seconds
    request = Request(url, headers={"User-Agent": "hariom-tinypod-health"})
    while time.monotonic() < deadline:
        for child in children:
            if child.poll() is not None:
                raise RuntimeError(f"{child.args} exited early with code {child.returncode}")
        try:
            with urlopen(request, timeout=3) as response:
                if 200 <= response.status < 400:
                    print(f"[ready] {name}: {url}", flush=True)
                    return
        except URLError:
            pass
        except TimeoutError:
            pass
        time.sleep(1)
    raise TimeoutError(f"Timed out waiting for {name}: {url}")


def stream_output(name: str, pipe) -> None:
    assert pipe is not None
    for line in iter(pipe.readline, ""):
        print(f"[{name}] {line}", end="", flush=True)


def start_process(spec: ManagedProcess) -> subprocess.Popen[str]:
    process_env = os.environ.copy()
    process_env.update(BASE_ENV)
    process_env.update(spec.extra_env)
    process = subprocess.Popen(
        spec.command,
        cwd=spec.cwd,
        env=process_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    threading.Thread(target=stream_output, args=(spec.name, process.stdout), daemon=True).start()
    children.append(process)
    print(f"[start] {spec.name} pid={process.pid}", flush=True)
    return process


def terminate_all(processes: Iterable[subprocess.Popen[str]]) -> None:
    for process in reversed(list(processes)):
        if process.poll() is None:
            process.terminate()
    deadline = time.monotonic() + 15
    for process in reversed(list(processes)):
        while process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.2)
        if process.poll() is None:
            process.kill()


def handle_signal(signum, _frame) -> None:
    global shutdown_requested
    shutdown_requested = True
    print(f"[shutdown] received signal {signum}", flush=True)
    terminate_all(children)


def main() -> int:
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    if is_railway_runtime():
        require_railway_secret("JWT_SECRET", {"change_me_in_production"})
        require_railway_secret("BOOTSTRAP_ADMIN_PASSWORD", {"admin123", "password", "hariom"})
        require_railway_secret("BOOTSTRAP_OWNER_PASSWORD", {"owner123", "password", "hariom"})
        require_railway_flag_off("RESET_BOOTSTRAP_PASSWORDS")
        require_railway_flag_off("USE_SIMPLE_STAGING_PASSWORDS")

    db_host = env("DB_HOST", "postgres")
    db_port = int(env("DB_PORT", "5432"))
    print(f"[preflight] waiting for postgres at {db_host}:{db_port}", flush=True)
    wait_for_tcp(db_host, db_port)

    for spec in PROCESSES:
        start_process(spec)
        if spec.health_url:
            wait_for_http(spec.name, spec.health_url)

    print(f"[ready] Hari Om ERP web UI is serving on 0.0.0.0:{WEB_UI_PORT}", flush=True)

    while not shutdown_requested:
        for process in children:
            return_code = process.poll()
            if return_code is not None:
                print(f"[exit] child exited code={return_code}: {process.args}", flush=True)
                terminate_all(children)
                return return_code or 1
        time.sleep(2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
