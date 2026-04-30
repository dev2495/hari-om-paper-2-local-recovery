#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:13000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-${BOOTSTRAP_ADMIN_EMAIL:-devarsh@hariom.com}}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-${BOOTSTRAP_ADMIN_PASSWORD:-}}"
OWNER_EMAIL="${OWNER_EMAIL:-${BOOTSTRAP_OWNER_EMAIL:-yash@hariom.com}}"
OWNER_PASSWORD="${OWNER_PASSWORD:-${BOOTSTRAP_OWNER_PASSWORD:-}}"

if [[ -z "$ADMIN_PASSWORD" ]]; then
  echo "ADMIN_PASSWORD or BOOTSTRAP_ADMIN_PASSWORD is required for authenticated smoke checks." >&2
  exit 2
fi

python3 - "$BASE_URL" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$OWNER_EMAIL" "$OWNER_PASSWORD" <<'PY'
import json
import sys
import urllib.error
import urllib.request

base_url, email, password, owner_email, owner_password = sys.argv[1:6]
base_url = base_url.rstrip("/")


def request(method, path, payload=None, token=None):
    data = None
    headers = {"Content-Type": "application/json", "User-Agent": "hariom-tinypod-smoke"}
    if payload is not None:
        data = json.dumps(payload).encode()
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["X-Plant-ID"] = "PLANT_A"
    req = urllib.request.Request(f"{base_url}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read().decode()
            if not raw:
                return response.status, None
            try:
                return response.status, json.loads(raw)
            except json.JSONDecodeError:
                return response.status, raw[:200]
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")[:500]
        raise SystemExit(f"[fail] {method} {path} -> HTTP {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"[fail] {method} {path}: {exc}") from exc


status, _ = request("GET", "/login")
print(f"[ok] login page HTTP {status}")

status, login_payload = request("POST", "/api/auth/login", {"email": email, "password": password})
token = (login_payload or {}).get("access_token")
if not token:
    raise SystemExit(f"[fail] login succeeded without access_token: {login_payload}")
print(f"[ok] auth login HTTP {status}")

if owner_password:
    status, owner_payload = request("POST", "/api/auth/login", {"email": owner_email, "password": owner_password})
    if not (owner_payload or {}).get("access_token"):
        raise SystemExit(f"[fail] owner login succeeded without access_token: {owner_payload}")
    print(f"[ok] owner auth login HTTP {status}")

checks = [
    ("GET", "/api/auth/me"),
    ("GET", "/api/master/papers"),
    ("GET", "/api/spec/specifications"),
    ("GET", "/api/sales/orders"),
    ("GET", "/api/production/job-cards"),
    ("GET", "/api/inventory/balance"),
    ("GET", "/api/analytics/dashboard/overview"),
]

for method, path in checks:
    status, _ = request(method, path, token=token)
    print(f"[ok] {path} HTTP {status}")

print("[ok] TinyPod smoke passed")
PY
