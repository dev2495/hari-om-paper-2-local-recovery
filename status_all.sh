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

if [[ -f "$MODE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$MODE_FILE"
fi

echo "ERP Runtime Status"
echo "=================="
echo "Mode: direct"
echo

(
  cd "$ERP_DIR"
  ./scripts/direct/status.sh
)

if [[ -n "${WEB_UI_PORT:-}" && -n "${BFF_PORT:-}" ]]; then
  echo
  echo "Endpoints"
  echo "---------"
  echo "Web UI: http://127.0.0.1:${WEB_UI_PORT}/login"
  echo "BFF:    http://127.0.0.1:${BFF_PORT}/health"
  echo "Docs:   http://127.0.0.1:${BFF_PORT}/docs"
fi
