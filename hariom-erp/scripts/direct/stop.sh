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

terminate_managed_pid() {
  local pid="$1"
  local pgid=""
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
  if [[ -n "$pgid" && "$pgid" == "$pid" ]]; then
    kill -TERM -- "-${pid}" >/dev/null 2>&1 || true
  else
    kill -TERM "$pid" >/dev/null 2>&1 || true
  fi
  sleep 1
  if kill -0 "$pid" >/dev/null 2>&1; then
    if [[ -n "$pgid" && "$pgid" == "$pid" ]]; then
      kill -KILL -- "-${pid}" >/dev/null 2>&1 || true
    else
      kill -KILL "$pid" >/dev/null 2>&1 || true
    fi
  fi
}

stop_listener_port() {
  local port="$1"
  local pids=""
  command -v lsof >/dev/null 2>&1 || return 0
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "$pids" ]] || return 0
  for pid in $pids; do
    kill -TERM "$pid" >/dev/null 2>&1 || true
  done
  sleep 1
  for pid in $pids; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -KILL "$pid" >/dev/null 2>&1 || true
    fi
  done
}

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
    terminate_managed_pid "$pid"
  else
    echo "[stop] ${service} pid file exists but process is already stopped"
  fi

  rm -f "$pidfile"
done

# npm and similar launchers may hand work to a child before the marker is
# observed. Close only listeners on ports recorded by this managed runtime.
if [[ -f "$PORTS_FILE" ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      *_PORT)
        if [[ "$value" =~ ^[0-9]+$ ]]; then
          stop_listener_port "$value"
        fi
        ;;
    esac
  done < "$PORTS_FILE"
fi

rm -f "$PORTS_FILE"

echo "Direct ERP runtime stopped."
