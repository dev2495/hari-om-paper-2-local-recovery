#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ERP_DIR="${ERP_DIR:-${BASE_DIR}/hariom-erp}"
resolve_runtime_dir() {
  local erp_dir="$1"
  if [[ -n "${ERP_RUNTIME_DIR:-}" ]]; then
    echo "${ERP_RUNTIME_DIR}"
    return
  fi
  if [[ -d "${erp_dir}/runtime" || ! -e "${erp_dir}/.runtime" ]]; then
    echo "${erp_dir}/runtime"
    return
  fi
  echo "${erp_dir}/.runtime"
}

RUNTIME_DIR="$(resolve_runtime_dir "${ERP_DIR}")"
MODE_FILE="${RUNTIME_DIR}/orchestrator.env"
PORTS_FILE="${RUNTIME_DIR}/ports.env"
MANIFEST_FILE="${RUNTIME_DIR}/runtime_manifest.json"
WEB_UI_DIR="${BASE_DIR}/apps/web-ui"

NODE18_BIN="${NODE18_BIN:-/opt/homebrew/opt/node@18/bin}"
HOST="${ERP_HOST:-127.0.0.1}"
BIND_HOST="${BIND_HOST:-${ERP_BIND_HOST:-0.0.0.0}}"
WEB_UI_PORT="${WEB_UI_PORT:-13000}"
BFF_PORT="${BFF_PORT:-14000}"
APP_PUBLIC_HOST="${APP_PUBLIC_HOST:-$HOST}"
APP_PUBLIC_URL="${APP_PUBLIC_URL:-http://${APP_PUBLIC_HOST}:${WEB_UI_PORT}}"

if [[ -f "${MODE_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${MODE_FILE}"
fi

if [[ -f "${PORTS_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${PORTS_FILE}"
fi

if [[ -f "${MANIFEST_FILE}" ]]; then
  manifest_bff_port="$(/usr/bin/env python3 - "${MANIFEST_FILE}" <<'PY'
import json
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
data = json.loads(manifest_path.read_text(encoding="utf-8"))
print(data.get("ports", {}).get("BFF_PORT", ""))
PY
)"
  manifest_web_port="$(/usr/bin/env python3 - "${MANIFEST_FILE}" <<'PY'
import json
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
data = json.loads(manifest_path.read_text(encoding="utf-8"))
print(data.get("ports", {}).get("WEB_UI_PORT", ""))
PY
)"
  if [[ -n "${manifest_bff_port}" ]]; then
    BFF_PORT="${manifest_bff_port}"
  fi
  if [[ -n "${manifest_web_port}" ]]; then
    WEB_UI_PORT="${manifest_web_port}"
  fi
fi

if [[ ! -x "${NODE18_BIN}/node" || ! -x "${NODE18_BIN}/npm" ]]; then
  echo "Node 18 runtime not found at ${NODE18_BIN}"
  echo "Set NODE18_BIN to a valid Node 18 bin directory and rerun."
  exit 1
fi

export PATH="${NODE18_BIN}:$PATH"
hash -r

if [[ ! -d "${WEB_UI_DIR}" ]]; then
  echo "web-ui directory not found: ${WEB_UI_DIR}"
  exit 1
fi

if [[ ! -x "${WEB_UI_DIR}/node_modules/.bin/next" ]]; then
  echo "web-ui dependencies are missing."
  echo "Run: cd \"${ERP_DIR}\" && ./scripts/direct/bootstrap.sh --skip-python"
  exit 1
fi

echo "Starting web UI with Node $(node -v)"
echo "Web UI: http://${HOST}:${WEB_UI_PORT}/login"
echo "Phone:  ${APP_PUBLIC_URL}/login"
echo "BFF:    http://${HOST}:${BFF_PORT}/health"
echo "Docs:   http://${HOST}:${BFF_PORT}/docs"

cd "${WEB_UI_DIR}"
exec env \
  BFF_INTERNAL_URL="http://${HOST}:${BFF_PORT}" \
  NEXT_PUBLIC_BFF_URL="/" \
  NEXT_PUBLIC_APP_URL="${APP_PUBLIC_URL}" \
  ./node_modules/.bin/next dev --hostname "${BIND_HOST}" --port "${WEB_UI_PORT}"
