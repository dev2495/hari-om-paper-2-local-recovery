#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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

RUNTIME_DIR="$(resolve_runtime_dir "${ROOT_DIR}")"
PID_DIR="${RUNTIME_DIR}/pids"
PORTS_FILE="${RUNTIME_DIR}/ports.env"

SERVICES=(
  web-ui
  bff-api
  analytics-service
  production-service
  inventory-service
  sales-service
  spec-service
  masterdata-service
  auth-service
)

if [[ ! -d "$PID_DIR" ]]; then
  echo "No runtime PID directory found: $PID_DIR"
  exit 0
fi

for service in "${SERVICES[@]}"; do
  pidfile="${PID_DIR}/${service}.pid"
  if [[ ! -f "$pidfile" ]]; then
    continue
  fi

  pid="$(cat "$pidfile")"
  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "[stop] ${service} (pid ${pid})"
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  else
    echo "[stop] ${service} pid file exists but process is already stopped"
  fi

  rm -f "$pidfile"
done

rm -f "$PORTS_FILE"

echo "Direct ERP runtime stopped."
