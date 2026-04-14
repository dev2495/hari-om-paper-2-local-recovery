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
mkdir -p "${RUNTIME_DIR}"
MODE_FILE="${RUNTIME_DIR}/orchestrator.env"


for arg in "$@"; do
  case "$arg" in
    --direct|--auto|--mode=direct|--mode=auto)
      # accepted aliases for backward compatibility
      ;;
    --docker|--mode=docker)
      echo "Docker mode is intentionally disabled in this unified runtime."
      echo "Use direct runtime only: ./start_all.sh"
      exit 1
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--direct|--auto]"
      exit 1
      ;;
  esac
done

if [[ ! -d "$ERP_DIR" ]]; then
  echo "ERP directory not found: $ERP_DIR"
  exit 1
fi

port_is_free() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    ! lsof -tiTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  if command -v nc >/dev/null 2>&1; then
    ! nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return
  fi
  return 0
}

RESERVED_PORTS=()

pidfile_for_port_var() {
  case "$1" in
    AUTH_PORT) echo "${RUNTIME_DIR}/pids/auth-service.pid" ;;
    MASTER_PORT) echo "${RUNTIME_DIR}/pids/masterdata-service.pid" ;;
    SPEC_PORT) echo "${RUNTIME_DIR}/pids/spec-service.pid" ;;
    PRODUCTION_PORT) echo "${RUNTIME_DIR}/pids/production-service.pid" ;;
    INVENTORY_PORT) echo "${RUNTIME_DIR}/pids/inventory-service.pid" ;;
    ANALYTICS_PORT) echo "${RUNTIME_DIR}/pids/analytics-service.pid" ;;
    SALES_PORT) echo "${RUNTIME_DIR}/pids/sales-service.pid" ;;
    BFF_PORT) echo "${RUNTIME_DIR}/pids/bff-api.pid" ;;
    WEB_UI_PORT) echo "${RUNTIME_DIR}/pids/web-ui.pid" ;;
    *) return 1 ;;
  esac
}

service_running_for_port_var() {
  local pidfile
  pidfile="$(pidfile_for_port_var "$1")" || return 1
  [[ -f "$pidfile" ]] || return 1
  local pid
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

is_reserved() {
  local port="$1"
  local reserved
  for reserved in "${RESERVED_PORTS[@]-}"; do
    if [[ "$reserved" == "$port" ]]; then
      return 0
    fi
  done
  return 1
}

find_free_port() {
  local start_port="$1"
  local port="$start_port"
  while true; do
    if port_is_free "$port" && ! is_reserved "$port"; then
      echo "$port"
      return
    fi
    port=$((port + 1))
  done
}

pick_port() {
  local var_name="$1"
  local default_port="$2"
  local requested="${!var_name:-$default_port}"
  local selected="$requested"

  if ! port_is_free "$requested" || is_reserved "$requested"; then
    if service_running_for_port_var "$var_name" && ! is_reserved "$requested"; then
      selected="$requested"
    else
      selected="$(find_free_port "$default_port")"
      echo "[port] ${var_name} ${requested} unavailable, selected ${selected}"
    fi
  fi

  RESERVED_PORTS+=("$selected")
  export "${var_name}=${selected}"
}

pick_port AUTH_PORT 18001
pick_port MASTER_PORT 18002
pick_port SPEC_PORT 18003
pick_port PRODUCTION_PORT 18004
pick_port INVENTORY_PORT 18005
pick_port ANALYTICS_PORT 18007
pick_port SALES_PORT 18008
pick_port BFF_PORT 14000
pick_port WEB_UI_PORT 13000

echo "[mode] starting DIRECT runtime"
(
  cd "$ERP_DIR"
  AUTH_PORT="$AUTH_PORT" \
  MASTER_PORT="$MASTER_PORT" \
  SPEC_PORT="$SPEC_PORT" \
  PRODUCTION_PORT="$PRODUCTION_PORT" \
  INVENTORY_PORT="$INVENTORY_PORT" \
  ANALYTICS_PORT="$ANALYTICS_PORT" \
  SALES_PORT="$SALES_PORT" \
  BFF_PORT="$BFF_PORT" \
  WEB_UI_PORT="$WEB_UI_PORT" \
  ./scripts/direct/start.sh
)

cat > "$MODE_FILE" <<EOF
MODE=direct
HOST=127.0.0.1
AUTH_PORT=${AUTH_PORT}
MASTER_PORT=${MASTER_PORT}
SPEC_PORT=${SPEC_PORT}
PRODUCTION_PORT=${PRODUCTION_PORT}
INVENTORY_PORT=${INVENTORY_PORT}
ANALYTICS_PORT=${ANALYTICS_PORT}
SALES_PORT=${SALES_PORT}
BFF_PORT=${BFF_PORT}
WEB_UI_PORT=${WEB_UI_PORT}
EOF

echo
echo "[ready] Direct runtime is up"
echo "Web UI: http://127.0.0.1:${WEB_UI_PORT}/login"
echo "BFF:    http://127.0.0.1:${BFF_PORT}/health"
