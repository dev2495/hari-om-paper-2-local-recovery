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
LOG_DIR="${RUNTIME_DIR}/logs"
PORTS_FILE="${RUNTIME_DIR}/ports.env"

SERVICES=(
  auth-service
  masterdata-service
  spec-service
  sales-service
  production-service
  inventory-service
  analytics-service
  bff-api
  web-ui
)

if [[ -f "$PORTS_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$PORTS_FILE"
fi

port_for() {
  case "$1" in
    auth-service) echo "${AUTH_PORT:-18001}" ;;
    masterdata-service) echo "${MASTER_PORT:-18002}" ;;
    spec-service) echo "${SPEC_PORT:-18003}" ;;
    sales-service) echo "${SALES_PORT:-18008}" ;;
    production-service) echo "${PRODUCTION_PORT:-18004}" ;;
    inventory-service) echo "${INVENTORY_PORT:-18005}" ;;
    analytics-service) echo "${ANALYTICS_PORT:-18007}" ;;
    bff-api) echo "${BFF_PORT:-14000}" ;;
    web-ui) echo "${WEB_UI_PORT:-13000}" ;;
    *) echo "-" ;;
  esac
}

is_port_listening() {
  local port="$1"
  if [[ -z "$port" || "$port" == "-" ]]; then
    return 1
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:${port}" >/dev/null 2>&1
    return
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return
  fi
  return 1
}

if [[ ! -d "$PID_DIR" ]]; then
  echo "No running direct runtime metadata found (${PID_DIR})."
  exit 0
fi

printf "%-20s %-10s %-10s %s\n" "SERVICE" "STATUS" "PID" "PORT"
for service in "${SERVICES[@]}"; do
  pidfile="${PID_DIR}/${service}.pid"
  port="$(port_for "$service")"
  if [[ -f "$pidfile" ]]; then
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      printf "%-20s %-10s %-10s %s\n" "$service" "running" "$pid" "$port"
    elif is_port_listening "$port"; then
      printf "%-20s %-10s %-10s %s\n" "$service" "running" "-" "$port"
    else
      printf "%-20s %-10s %-10s %s\n" "$service" "stale" "$pid" "$port"
    fi
  else
    if is_port_listening "$port"; then
      printf "%-20s %-10s %-10s %s\n" "$service" "running" "-" "$port"
    else
      printf "%-20s %-10s %-10s %s\n" "$service" "stopped" "-" "$port"
    fi
  fi
done

echo
echo "Logs directory: ${LOG_DIR}"
