#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ERP_DIR="${BASE_DIR}/hariom-erp"
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

MODE_FILE="$(resolve_runtime_dir "${ERP_DIR}")/orchestrator.env"

if [[ ! -f "$MODE_FILE" ]]; then
  echo "[verify-runtime] runtime manifest missing: ${MODE_FILE}"
  exit 1
fi

# shellcheck disable=SC1090
source "$MODE_FILE"

check() {
  local label="$1"
  local url="$2"
  if curl -fsS "$url" >/dev/null 2>&1; then
    echo "[ok] ${label}: ${url}"
  else
    echo "[fail] ${label}: ${url}"
    return 1
  fi
}

check "auth-service" "http://127.0.0.1:${AUTH_PORT}/"
check "masterdata-service" "http://127.0.0.1:${MASTER_PORT}/health"
check "spec-service" "http://127.0.0.1:${SPEC_PORT}/health"
check "sales-service" "http://127.0.0.1:${SALES_PORT}/health"
check "inventory-service" "http://127.0.0.1:${INVENTORY_PORT}/health"
check "production-service" "http://127.0.0.1:${PRODUCTION_PORT}/health"
check "analytics-service" "http://127.0.0.1:${ANALYTICS_PORT}/health"
check "bff-api" "http://127.0.0.1:${BFF_PORT}/health"
if [[ "${START_WEB_UI:-1}" == "1" ]]; then
  check "web-ui" "http://127.0.0.1:${WEB_UI_PORT}/login"
fi

echo "[verify-runtime] all runtime endpoints responded"
