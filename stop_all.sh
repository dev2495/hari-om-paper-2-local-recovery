#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ERP_DIR="${ERP_DIR:-${BASE_DIR}/hariom-erp}"
if [[ -z "${ERP_RUNTIME_DIR:-}" ]]; then
  if [[ -d "${ERP_DIR}/.runtime" && ( -f "${ERP_DIR}/.runtime/orchestrator.env" || -d "${ERP_DIR}/.runtime/pids" ) ]]; then
    export ERP_RUNTIME_DIR="${ERP_DIR}/.runtime"
  elif [[ -d "${ERP_DIR}/runtime" || ! -e "${ERP_DIR}/.runtime" ]]; then
    export ERP_RUNTIME_DIR="${ERP_DIR}/runtime"
  else
    export ERP_RUNTIME_DIR="${ERP_DIR}/.runtime"
  fi
fi

if [[ ! -d "${ERP_DIR}" ]]; then
  echo "ERP directory not found: ${ERP_DIR}"
  exit 1
fi

(
  cd "${ERP_DIR}"
  ./scripts/direct/stop.sh
)
