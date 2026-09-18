#!/usr/bin/env bash
# Install full checked-out service requirements and locked web/Playwright deps
# into isolated directories. Does not reuse a partial repo-root .venv.
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=resolve_node.sh
source "${BASE_DIR}/scripts/resolve_node.sh"
export_resolved_node

ERP_DIR="${BASE_DIR}/hariom-erp"
VENV_DIR="${ERP_VENV_DIR:-${ERP_DIR}/venv-verify}"
WEB_UI_DIR="${BASE_DIR}/apps/web-ui"
REQ_ALL="${ERP_DIR}/scripts/direct/requirements.all.txt"

find_python_base() {
  if command -v python3.11 >/dev/null 2>&1; then
    command -v python3.11
    return
  fi
  echo "Python 3.11 is required for isolated verify envs." >&2
  exit 1
}

PYTHON_BASE="$(find_python_base)"
echo "[isolated-env] python=${PYTHON_BASE}"
echo "[isolated-env] venv=${VENV_DIR}"

rm -rf "${VENV_DIR}"
"${PYTHON_BASE}" -m venv "${VENV_DIR}"
VENV_PY="${VENV_DIR}/bin/python"
if [[ ! -x "${VENV_PY}" ]]; then
  echo "venv python missing after create"
  exit 1
fi
if [[ ! -x "${VENV_DIR}/bin/python3.11" ]]; then
  ln -sf "$(basename "${VENV_PY}")" "${VENV_DIR}/bin/python3.11"
fi

"${VENV_PY}" -m pip install --upgrade pip setuptools wheel
"${VENV_PY}" -m pip install -r "${REQ_ALL}"

# Union each checked-out service requirements file so no declared package is omitted.
while IFS= read -r req; do
  echo "[isolated-env] installing ${req}"
  "${VENV_PY}" -m pip install -r "${req}"
done < <(find "${ERP_DIR}/services" "${BASE_DIR}/apps/bff-api" -name requirements.txt | sort)

"${VENV_PY}" - <<'PY'
import pydantic_settings
import fastapi
import sqlalchemy
print("pydantic-settings", pydantic_settings.__version__)
print("fastapi", fastapi.__version__)
PY

echo "[isolated-env] web-ui npm ci --include=dev"
(
  cd "${WEB_UI_DIR}"
  npm ci --include=dev
)

PLAYWRIGHT="${WEB_UI_DIR}/node_modules/.bin/playwright"
if [[ ! -x "${PLAYWRIGHT}" ]]; then
  echo "Playwright CLI missing after npm ci"
  exit 1
fi
echo "[isolated-env] playwright version: $("${PLAYWRIGHT}" --version)"
"${PLAYWRIGHT}" install chromium

touch "${VENV_DIR}/.erp_runtime_ok"
echo "[isolated-env] done"
