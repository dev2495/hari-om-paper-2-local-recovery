#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ERP_DIR="${ERP_DIR:-${BASE_DIR}/hariom-erp}"
RUNTIME_DIR="${ERP_DIR}/.runtime"
if ! mkdir -p "${RUNTIME_DIR}" 2>/dev/null; then
  RUNTIME_DIR="${ERP_DIR}/runtime"
  mkdir -p "${RUNTIME_DIR}"
fi
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
    ! lsof -ti "tcp:${port}" >/dev/null 2>&1
    return
  fi
  if command -v nc >/dev/null 2>&1; then
    ! nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return
  fi
  return 0
}

RESERVED_PORTS=()

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
    selected="$(find_free_port "$default_port")"
    echo "[port] ${var_name} ${requested} unavailable, selected ${selected}"
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
