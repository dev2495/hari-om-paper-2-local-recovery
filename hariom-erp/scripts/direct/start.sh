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

resolve_runtime_venv_dir() {
  local erp_dir="$1"
  if [[ -n "${ERP_VENV_DIR:-}" ]]; then
    echo "${ERP_VENV_DIR}"
    return
  fi
  if [[ -d "${erp_dir}/venv-runtime" ]]; then
    echo "${erp_dir}/venv-runtime"
    return
  fi
  if [[ -d "${erp_dir}/.venv-runtime" ]]; then
    echo "${erp_dir}/.venv-runtime"
    return
  fi
  echo "${erp_dir}/.venv-direct"
}
RUNTIME_DIR="$(resolve_runtime_dir "${ROOT_DIR}")"
PID_DIR="${RUNTIME_DIR}/pids"
LOG_DIR="${RUNTIME_DIR}/logs"
PORTS_FILE="${RUNTIME_DIR}/ports.env"
VENV_DIR="$(resolve_runtime_venv_dir "${ROOT_DIR}")"
VENV_BIN="${VENV_DIR}/bin"
VENV_PYTHON="${VENV_BIN}/python"
VENV_MARKER="${VENV_DIR}/.erp_runtime_ok"

mkdir -p "$PID_DIR" "$LOG_DIR"

HOST="${ERP_HOST:-127.0.0.1}"

AUTH_PORT="${AUTH_PORT:-18001}"
MASTER_PORT="${MASTER_PORT:-18002}"
SPEC_PORT="${SPEC_PORT:-18003}"
PRODUCTION_PORT="${PRODUCTION_PORT:-18004}"
INVENTORY_PORT="${INVENTORY_PORT:-18005}"

ANALYTICS_PORT="${ANALYTICS_PORT:-18007}"
SALES_PORT="${SALES_PORT:-18008}"
BFF_PORT="${BFF_PORT:-14000}"
WEB_UI_PORT="${WEB_UI_PORT:-13000}"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-${USER:-postgres}}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_ADMIN_DB="${DB_ADMIN_DB:-postgres}"

REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/1}"
JWT_SECRET="${JWT_SECRET:-change_me_in_production}"
JWT_EXPIRES_MINUTES="${JWT_EXPIRES_MINUTES:-15}"
SESSION_IDLE_SECONDS="${SESSION_IDLE_SECONDS:-900}"

BOOTSTRAP_ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-admin@hariom.com}"
BOOTSTRAP_ADMIN_PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:-admin123}"
BOOTSTRAP_ADMIN_NAME="${BOOTSTRAP_ADMIN_NAME:-System Admin}"
BOOTSTRAP_ADMIN_PLANT_ID="${BOOTSTRAP_ADMIN_PLANT_ID:-PLANT_A}"

WEB_UI_MODE="${WEB_UI_MODE:-prod}" # prod|dev
NODE18_BIN="${NODE18_BIN:-/opt/homebrew/opt/node@18/bin}"
WEB_UI_TURBO="${WEB_UI_TURBO:-1}"

AUTH_SERVICE_URL="http://${HOST}:${AUTH_PORT}"
MASTER_SERVICE_URL="http://${HOST}:${MASTER_PORT}"
SPEC_SERVICE_URL="http://${HOST}:${SPEC_PORT}"
SALES_SERVICE_URL="http://${HOST}:${SALES_PORT}"
PRODUCTION_SERVICE_URL="http://${HOST}:${PRODUCTION_PORT}"
INVENTORY_SERVICE_URL="http://${HOST}:${INVENTORY_PORT}"

ANALYTICS_SERVICE_URL="http://${HOST}:${ANALYTICS_PORT}"
BFF_URL="http://${HOST}:${BFF_PORT}"

make_db_url() {
  local db_name="$1"
  if [[ -n "$DB_PASSWORD" ]]; then
    echo "postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${db_name}"
  else
    echo "postgresql://${DB_USER}@${DB_HOST}:${DB_PORT}/${db_name}"
  fi
}

AUTH_DB_URL="$(make_db_url authdb)"
MASTER_DB_URL="$(make_db_url masterdb)"
SPEC_DB_URL="$(make_db_url specdb)"
SALES_DB_URL="$(make_db_url salesdb)"
PRODUCTION_DB_URL="$(make_db_url productiondb)"
INVENTORY_DB_URL="$(make_db_url inventorydb)"

ANALYTICS_DB_URL="$(make_db_url analyticsdb)"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

check_port_free() {
  local port="$1"
  local name="$2"
  if command -v lsof >/dev/null 2>&1 && lsof -tiTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port ${port} is already in use (service: ${name})."
    echo "Stop conflicting services (for example Docker stack) or override ${name} port env var."
    exit 1
  fi
}

ensure_venv() {
  if [[ ! -x "${VENV_PYTHON}" || ! -f "${VENV_MARKER}" ]]; then
    echo "Shared runtime is missing. Bootstrapping first..."
    "${ROOT_DIR}/scripts/direct/bootstrap.sh" --skip-ui
  fi
}

ensure_web_ui_deps() {
  local web_ui_dir="${ROOT_DIR}/../apps/web-ui"
  if [[ ! -d "${web_ui_dir}/node_modules" ]]; then
    echo "web-ui dependencies missing. Running bootstrap..."
    "${ROOT_DIR}/scripts/direct/bootstrap.sh" --skip-python
  fi
}

ensure_databases() {
  "${VENV_BIN}/python" "${ROOT_DIR}/scripts/direct/ensure_databases.py" \
    --host "$DB_HOST" \
    --port "$DB_PORT" \
    --user "$DB_USER" \
    --password "$DB_PASSWORD" \
    --admin-db "$DB_ADMIN_DB"
}

start_uvicorn_service() {
  local name="$1"
  local workdir="$2"
  local port="$3"
  local database_url="$4"
  local pidfile="${PID_DIR}/${name}.pid"
  local logfile="${LOG_DIR}/${name}.log"

  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" >/dev/null 2>&1; then
    echo "[start] ${name} already running (pid $(cat "$pidfile"))"
    return
  fi

  check_port_free "$port" "$name"

  env \
    DATABASE_URL="$database_url" \
    JWT_SECRET="$JWT_SECRET" \
    JWT_EXPIRES_MINUTES="$JWT_EXPIRES_MINUTES" \
    SESSION_IDLE_SECONDS="$SESSION_IDLE_SECONDS" \
    AUTH_SERVICE_URL="$AUTH_SERVICE_URL" \
    MASTER_DATA_SERVICE_URL="$MASTER_SERVICE_URL" \
    SPEC_SERVICE_URL="$SPEC_SERVICE_URL" \
    SALES_SERVICE_URL="$SALES_SERVICE_URL" \
    PRODUCTION_SERVICE_URL="$PRODUCTION_SERVICE_URL" \
    INVENTORY_SERVICE_URL="$INVENTORY_SERVICE_URL" \
    ANALYTICS_SERVICE_URL="$ANALYTICS_SERVICE_URL" \
    REDIS_URL="$REDIS_URL" \
    SECRET_KEY="$JWT_SECRET" \
    BOOTSTRAP_ADMIN_EMAIL="$BOOTSTRAP_ADMIN_EMAIL" \
    BOOTSTRAP_ADMIN_PASSWORD="$BOOTSTRAP_ADMIN_PASSWORD" \
    BOOTSTRAP_ADMIN_NAME="$BOOTSTRAP_ADMIN_NAME" \
    BOOTSTRAP_ADMIN_PLANT_ID="$BOOTSTRAP_ADMIN_PLANT_ID" \
    "${VENV_PYTHON}" "${ROOT_DIR}/scripts/direct/launch_detached.py" \
      --cwd "$workdir" \
      --pidfile "$pidfile" \
      --logfile "$logfile" \
      -- "${VENV_PYTHON}" -m uvicorn src.main:app --host "$HOST" --port "$port"

  echo "[start] ${name} pid $(cat "$pidfile") on ${HOST}:${port}"
}

start_bff() {
  local name="bff-api"
  local workdir="${ROOT_DIR}/../apps/bff-api"
  local pidfile="${PID_DIR}/${name}.pid"
  local logfile="${LOG_DIR}/${name}.log"

  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" >/dev/null 2>&1; then
    echo "[start] ${name} already running (pid $(cat "$pidfile"))"
    return
  fi

  check_port_free "$BFF_PORT" "$name"

  env \
    AUTH_SERVICE_URL="$AUTH_SERVICE_URL" \
    MASTER_SERVICE_URL="$MASTER_SERVICE_URL" \
    SPEC_SERVICE_URL="$SPEC_SERVICE_URL" \
    SALES_SERVICE_URL="$SALES_SERVICE_URL" \
    PRODUCTION_SERVICE_URL="$PRODUCTION_SERVICE_URL" \
    INVENTORY_SERVICE_URL="$INVENTORY_SERVICE_URL" \
    ANALYTICS_SERVICE_URL="$ANALYTICS_SERVICE_URL" \
    "${VENV_PYTHON}" "${ROOT_DIR}/scripts/direct/launch_detached.py" \
      --cwd "$workdir" \
      --pidfile "$pidfile" \
      --logfile "$logfile" \
      -- "${VENV_PYTHON}" -m uvicorn src.main:app --host "$HOST" --port "$BFF_PORT"

  echo "[start] ${name} pid $(cat "$pidfile") on ${HOST}:${BFF_PORT}"
}

start_web_ui() {
  local name="web-ui"
  local workdir="${ROOT_DIR}/../apps/web-ui"
  local pidfile="${PID_DIR}/${name}.pid"
  local logfile="${LOG_DIR}/${name}.log"

  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" >/dev/null 2>&1; then
    echo "[start] ${name} already running (pid $(cat "$pidfile"))"
    return
  fi

  check_port_free "$WEB_UI_PORT" "$name"

  (
    cd "$workdir"
    # Next.js 14 in this project is tested with Node 18, not the system default Node 25.
    if [[ -d "$NODE18_BIN" ]]; then
      export PATH="${NODE18_BIN}:$PATH"
      hash -r
    fi
    if [[ "$WEB_UI_MODE" == "prod" ]]; then
      echo "[preflight] Web UI production build..."
      env BFF_INTERNAL_URL="$BFF_URL" NEXT_PUBLIC_BFF_URL="$BFF_URL" npm run build
      env \
        BFF_INTERNAL_URL="$BFF_URL" \
        NEXT_PUBLIC_BFF_URL="$BFF_URL" \
        "${VENV_PYTHON}" "${ROOT_DIR}/scripts/direct/launch_detached.py" \
          --cwd "$workdir" \
          --pidfile "$pidfile" \
          --logfile "$logfile" \
          -- npm run start -- -H "$HOST" -p "$WEB_UI_PORT"
    else
      if [[ "$WEB_UI_TURBO" == "1" ]]; then
        env \
          BFF_INTERNAL_URL="$BFF_URL" \
          NEXT_PUBLIC_BFF_URL="$BFF_URL" \
          "${VENV_PYTHON}" "${ROOT_DIR}/scripts/direct/launch_detached.py" \
            --cwd "$workdir" \
            --pidfile "$pidfile" \
            --logfile "$logfile" \
            -- npm run dev -- --turbo --hostname "$HOST" --port "$WEB_UI_PORT"
      else
        env \
          BFF_INTERNAL_URL="$BFF_URL" \
          NEXT_PUBLIC_BFF_URL="$BFF_URL" \
          "${VENV_PYTHON}" "${ROOT_DIR}/scripts/direct/launch_detached.py" \
            --cwd "$workdir" \
            --pidfile "$pidfile" \
            --logfile "$logfile" \
            -- npm run dev -- --hostname "$HOST" --port "$WEB_UI_PORT"
      fi
    fi
  )

  echo "[start] ${name} pid $(cat "$pidfile") on ${HOST}:${WEB_UI_PORT} (${WEB_UI_MODE})"
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local timeout="${3:-60}"
  local i=0
  while (( i < timeout )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[ready] ${label}: ${url}"
      return 0
    fi
    sleep 1
    ((i += 1))
  done
  echo "[warn] timeout waiting for ${label} (${url}). Check ${LOG_DIR}/${label}.log"
  return 1
}

require_cmd curl
require_cmd npm

ensure_venv
ensure_web_ui_deps
ensure_databases

start_uvicorn_service "auth-service" "${ROOT_DIR}/services/auth-service" "$AUTH_PORT" "$AUTH_DB_URL"
start_uvicorn_service "masterdata-service" "${ROOT_DIR}/services/masterdata-service" "$MASTER_PORT" "$MASTER_DB_URL"
start_uvicorn_service "spec-service" "${ROOT_DIR}/services/spec-service" "$SPEC_PORT" "$SPEC_DB_URL"
start_uvicorn_service "sales-service" "${ROOT_DIR}/services/sales-service" "$SALES_PORT" "$SALES_DB_URL"
start_uvicorn_service "inventory-service" "${ROOT_DIR}/services/inventory-service" "$INVENTORY_PORT" "$INVENTORY_DB_URL"

start_uvicorn_service "production-service" "${ROOT_DIR}/services/production-service" "$PRODUCTION_PORT" "$PRODUCTION_DB_URL"
start_uvicorn_service "analytics-service" "${ROOT_DIR}/services/analytics-service" "$ANALYTICS_PORT" "$ANALYTICS_DB_URL"
start_bff
start_web_ui

wait_for_http "auth-service" "${AUTH_SERVICE_URL}/"
wait_for_http "masterdata-service" "${MASTER_SERVICE_URL}/health"
wait_for_http "spec-service" "${SPEC_SERVICE_URL}/health"
wait_for_http "sales-service" "${SALES_SERVICE_URL}/health"
wait_for_http "inventory-service" "${INVENTORY_SERVICE_URL}/health"

wait_for_http "production-service" "${PRODUCTION_SERVICE_URL}/health"
wait_for_http "analytics-service" "${ANALYTICS_SERVICE_URL}/health"
wait_for_http "bff-api" "${BFF_URL}/health"
wait_for_http "web-ui" "http://${HOST}:${WEB_UI_PORT}/login"

echo
echo "Direct ERP runtime is up."
echo "Web UI: http://${HOST}:${WEB_UI_PORT}/login"
echo "BFF:    ${BFF_URL}/health"
echo "Logs:   ${LOG_DIR}"

cat > "${PORTS_FILE}" <<EOF
HOST=${HOST}
AUTH_PORT=${AUTH_PORT}
MASTER_PORT=${MASTER_PORT}
SPEC_PORT=${SPEC_PORT}
SALES_PORT=${SALES_PORT}
PRODUCTION_PORT=${PRODUCTION_PORT}
INVENTORY_PORT=${INVENTORY_PORT}

ANALYTICS_PORT=${ANALYTICS_PORT}
BFF_PORT=${BFF_PORT}
WEB_UI_PORT=${WEB_UI_PORT}
EOF

WORKSPACE_SCRIPTS_DIR="$(cd "${ROOT_DIR}/.." && pwd)/scripts"
if [[ -d "${WORKSPACE_SCRIPTS_DIR}" ]] && command -v python3 >/dev/null 2>&1; then
  (
    cd "${WORKSPACE_SCRIPTS_DIR}"
    ERP_RUNTIME_DIR="${RUNTIME_DIR}" python3 - <<'PY'
from runtime_support import build_runtime_manifest, write_runtime_manifest

write_runtime_manifest(build_runtime_manifest())
PY
  ) >/dev/null 2>&1 || true
fi
