#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.runtime"
if [[ ! -d "$RUNTIME_DIR" && -d "${ROOT_DIR}/runtime" ]]; then
  RUNTIME_DIR="${ROOT_DIR}/runtime"
fi
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
