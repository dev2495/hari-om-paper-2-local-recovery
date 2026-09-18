#!/usr/bin/env bash
# Isolated verification runtime: disposable DBs, non-default ports, owned PIDs only.
# Does not reclaim foreign listeners on 13000/14000/1800x and does not touch production.
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=resolve_node.sh
source "${BASE_DIR}/scripts/resolve_node.sh"
export_resolved_node

export ERP_ISOLATED_VERIFY="${ERP_ISOLATED_VERIFY:-1}"
export ERP_RUNTIME_DIR="${ERP_RUNTIME_DIR:-${BASE_DIR}/hariom-erp/runtime-verify}"
export ERP_VENV_DIR="${ERP_VENV_DIR:-${BASE_DIR}/hariom-erp/venv-verify}"
export ERP_DB_PREFIX="${ERP_DB_PREFIX:-hariom_nverify_}"
export ERP_ALLOW_RECLAIM_FOREIGN_PORTS="${ERP_ALLOW_RECLAIM_FOREIGN_PORTS:-0}"
export ERP_ALLOW_BYTECODE_RECOVERY="${ERP_ALLOW_BYTECODE_RECOVERY:-0}"
export ERP_SKIP_PLACEHOLDER_HYDRATE="${ERP_SKIP_PLACEHOLDER_HYDRATE:-1}"
export ERP_EXPECTED_SHA="${ERP_EXPECTED_SHA:-$(git -C "${BASE_DIR}" rev-parse HEAD)}"

export HOST="${HOST:-127.0.0.1}"
export AUTH_PORT="${AUTH_PORT:-28001}"
export MASTER_PORT="${MASTER_PORT:-28002}"
export SPEC_PORT="${SPEC_PORT:-28003}"
export PRODUCTION_PORT="${PRODUCTION_PORT:-28004}"
export INVENTORY_PORT="${INVENTORY_PORT:-28005}"
export ANALYTICS_PORT="${ANALYTICS_PORT:-28007}"
export SALES_PORT="${SALES_PORT:-28008}"
export BFF_PORT="${BFF_PORT:-24000}"
export WEB_UI_PORT="${WEB_UI_PORT:-23000}"
export WEB_UI_MODE="${WEB_UI_MODE:-prod}"
export START_WEB_UI="${START_WEB_UI:-1}"
export WEB_UI_TURBO="${WEB_UI_TURBO:-0}"
export WEB_UI_SOURCE_BUILD="${WEB_UI_SOURCE_BUILD:-0}"
export STARTUP_PREFLIGHT="${STARTUP_PREFLIGHT:-1}"

export AUTH_DB_NAME="${AUTH_DB_NAME:-${ERP_DB_PREFIX}authdb}"
export MASTER_DB_NAME="${MASTER_DB_NAME:-${ERP_DB_PREFIX}masterdb}"
export SPEC_DB_NAME="${SPEC_DB_NAME:-${ERP_DB_PREFIX}specdb}"
export SALES_DB_NAME="${SALES_DB_NAME:-${ERP_DB_PREFIX}salesdb}"
export PRODUCTION_DB_NAME="${PRODUCTION_DB_NAME:-${ERP_DB_PREFIX}productiondb}"
export INVENTORY_DB_NAME="${INVENTORY_DB_NAME:-${ERP_DB_PREFIX}inventorydb}"
export ANALYTICS_DB_NAME="${ANALYTICS_DB_NAME:-${ERP_DB_PREFIX}analyticsdb}"

mkdir -p "${ERP_RUNTIME_DIR}/pids" "${ERP_RUNTIME_DIR}/logs" "${BASE_DIR}/reports" "${BASE_DIR}/output/playwright"

echo "[isolated-verify] SHA=${ERP_EXPECTED_SHA}"
echo "[isolated-verify] runtime=${ERP_RUNTIME_DIR}"
echo "[isolated-verify] venv=${ERP_VENV_DIR}"
echo "[isolated-verify] db prefix=${ERP_DB_PREFIX}"
echo "[isolated-verify] web=http://${HOST}:${WEB_UI_PORT} bff=http://${HOST}:${BFF_PORT}"

ERP_RUNTIME_DIR="${ERP_RUNTIME_DIR}" "${BASE_DIR}/stop_all.sh" >/dev/null 2>&1 || true

"${BASE_DIR}/start_all.sh"

RUNTIME_PYTHON="${ERP_VENV_DIR}/bin/python3.11"
if [[ ! -x "${RUNTIME_PYTHON}" ]]; then
  RUNTIME_PYTHON="${ERP_VENV_DIR}/bin/python"
fi
if [[ ! -x "${RUNTIME_PYTHON}" ]]; then
  echo "Isolated runtime python missing: ${ERP_VENV_DIR}"
  exit 1
fi

export ERP_RUNTIME_MANIFEST="${ERP_RUNTIME_DIR}/runtime_manifest.json"
"${RUNTIME_PYTHON}" "${BASE_DIR}/scripts/verify_runtime_consistency.py" --write-manifest --expected-sha "${ERP_EXPECTED_SHA}"

echo "[isolated-verify] ready"
echo "manifest: ${ERP_RUNTIME_MANIFEST}"
echo "PLAYWRIGHT_BASE_URL=http://${HOST}:${WEB_UI_PORT}"
