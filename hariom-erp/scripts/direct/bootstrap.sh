#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKSPACE_ROOT="${ROOT_DIR}/.."
resolve_runtime_venv_dir() {
  local erp_dir="$1"
  if [[ -n "${ERP_VENV_DIR:-}" ]]; then
    echo "${ERP_VENV_DIR}"
    return
  fi
  if [[ -d "${erp_dir}/venv-runtime" || ! -e "${erp_dir}/.venv-runtime" ]]; then
    echo "${erp_dir}/venv-runtime"
    return
  fi
  echo "${erp_dir}/.venv-runtime"
}

VENV_DIR="$(resolve_runtime_venv_dir "${ROOT_DIR}")"
VENV_BIN="${VENV_DIR}/bin"
VENV_PYTHON="${VENV_BIN}/python3.11"
VENV_MARKER="${VENV_DIR}/.erp_runtime_ok"
REQ_FILE="${ROOT_DIR}/scripts/direct/requirements.all.txt"
WEB_UI_DIR="${ROOT_DIR}/../apps/web-ui"
NODE18_BIN="${NODE18_BIN:-/opt/homebrew/opt/node@18/bin}"
WEB_UI_SOURCE_BUILD="${WEB_UI_SOURCE_BUILD:-0}"
INTEGRITY_SCRIPT="${WORKSPACE_ROOT}/scripts/runtime_integrity.py"
HYDRATE_SCRIPT="${WORKSPACE_ROOT}/scripts/hydrate_local_placeholders.py"
RECOVER_SCRIPT="${WORKSPACE_ROOT}/scripts/recover_dataless_python_from_pyc.py"

SKIP_PYTHON=0
SKIP_UI=0

usage() {
  cat <<'EOF'
Usage: bootstrap.sh [--skip-python] [--skip-ui]

Bootstraps the shared direct-runtime Python venv and the web-ui dependencies.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --skip-python)
      SKIP_PYTHON=1
      ;;
    --skip-ui)
      SKIP_UI=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      usage
      exit 1
      ;;
  esac
done

find_python_base() {
  if command -v python3.11 >/dev/null 2>&1; then
    command -v python3.11
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    local python3_path
    python3_path="$(command -v python3)"
    if "${python3_path}" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)' >/dev/null 2>&1; then
      echo "${python3_path}"
      return
    fi
  fi
  echo "Missing Python 3.11 interpreter for runtime bootstrap." >&2
  exit 1
}

ensure_node18_runtime() {
  if [[ ! -x "${NODE18_BIN}/node" || ! -x "${NODE18_BIN}/npm" ]]; then
    echo "Node 18 runtime not found at ${NODE18_BIN}."
    echo "Install Node 18 or set NODE18_BIN to a valid Node 18 bin directory."
    exit 1
  fi
  export PATH="${NODE18_BIN}:$PATH"
  hash -r

  local node_major
  node_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [[ "$node_major" != "18" ]]; then
    echo "Detected Node $(node -v), expected Node 18 for stable Next.js runtime."
    echo "Please point NODE18_BIN to a Node 18 installation."
    exit 1
  fi
}

scope_dataless_count() {
  /usr/bin/env python3 "${INTEGRITY_SCRIPT}" count --scope "$1"
}

scope_is_healthy() {
  local scope="$1"
  [[ "$(scope_dataless_count "$scope")" == "0" ]]
}

web_ui_deps_healthy() {
  [[ -d "${WEB_UI_DIR}/node_modules" ]] || return 1
  [[ -x "${WEB_UI_DIR}/node_modules/.bin/next" ]] || return 1
  [[ -f "${WEB_UI_DIR}/node_modules/next/dist/build/output/log.js" ]] || return 1
  [[ -f "${WEB_UI_DIR}/node_modules/next/dist/lib/commands.js" ]] || return 1
  [[ -f "${WEB_UI_DIR}/node_modules/next/dist/compiled/arg/index.js" ]] || return 1
  [[ -f "${WEB_UI_DIR}/node_modules/next/dist/compiled/semver/index.js" ]] || return 1
}

ensure_workspace_sources() {
  local scopes=(--scope backend-source)
  if [[ "${SKIP_UI}" != "1" && "${WEB_UI_SOURCE_BUILD}" == "1" ]]; then
    scopes+=(--scope web-source)
  fi
  if [[ "${SKIP_UI}" != "1" && "${WEB_UI_SOURCE_BUILD}" != "1" ]]; then
    scopes+=(--scope web-runtime)
  fi
  local pass=1
  local backend_remaining=0
  local web_remaining=0
  while (( pass <= 5 )); do
    echo "[bootstrap] hydrating runtime sources (pass ${pass}/5)"
    /usr/bin/env python3 "${HYDRATE_SCRIPT}" --timeout-seconds 300 --stagnant-seconds 20 "${scopes[@]}" || true

    backend_remaining="$(scope_dataless_count backend-source)"
    if [[ "$backend_remaining" != "0" ]]; then
      /usr/bin/env python3 "${RECOVER_SCRIPT}"
      backend_remaining="$(scope_dataless_count backend-source)"
    fi

    web_remaining=0
    if [[ "${SKIP_UI}" != "1" && "${WEB_UI_SOURCE_BUILD}" == "1" ]]; then
      web_remaining="$(scope_dataless_count web-source)"
    fi

    if [[ "$backend_remaining" == "0" && "$web_remaining" == "0" ]]; then
      break
    fi
    ((pass += 1))
  done

  local check_args=(check --scope backend-source)
  if [[ "${SKIP_UI}" != "1" && "${WEB_UI_SOURCE_BUILD}" == "1" ]]; then
    check_args+=(--scope web-source)
  fi
  if [[ "${SKIP_UI}" != "1" && "${WEB_UI_SOURCE_BUILD}" != "1" ]]; then
    check_args+=(--scope web-runtime)
  fi
  /usr/bin/env python3 "${INTEGRITY_SCRIPT}" "${check_args[@]}"
}

venv_healthy() {
  if [[ ! -x "${VENV_PYTHON}" ]]; then
    return 1
  fi

  /usr/bin/env python3 - "${VENV_PYTHON}" <<'PY'
import subprocess
import sys

python_path = sys.argv[1]
try:
    subprocess.run(
        [
            python_path,
            "-c",
            "import site, sys; import sqlalchemy; import pg8000; print(sys.executable)",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
        timeout=10,
    )
except Exception:
    raise SystemExit(1)
PY
}

bootstrap_python() {
  local python_base
  python_base="$(find_python_base)"

  if venv_healthy && [[ -f "${VENV_MARKER}" ]] && [[ ! "${REQ_FILE}" -nt "${VENV_MARKER}" ]]; then
    echo "[bootstrap] shared runtime python env already healthy"
    return
  fi

  echo "[bootstrap] rebuilding shared runtime python env"
  rm -rf "${VENV_DIR}"
  "${python_base}" -m venv "${VENV_DIR}"

  if [[ ! -x "${VENV_PYTHON}" ]]; then
    local detected_python=""
    detected_python="$(find "${VENV_BIN}" -maxdepth 1 -type f -name 'python3*' | head -n 1 || true)"
    if [[ -n "${detected_python}" ]]; then
      ln -sf "$(basename "${detected_python}")" "${VENV_PYTHON}"
    fi
  fi

  "${VENV_PYTHON}" -m pip install --upgrade pip setuptools wheel
  "${VENV_PYTHON}" -m pip install -r "${REQ_FILE}"
  touch "${VENV_MARKER}"
}

bootstrap_ui() {
  ensure_node18_runtime

  if [[ ! -d "${WEB_UI_DIR}" ]]; then
    echo "web-ui directory not found: ${WEB_UI_DIR}"
    exit 1
  fi

  if web_ui_deps_healthy; then
    echo "[bootstrap] web-ui dependencies already healthy"
    return
  fi

  echo "[bootstrap] rebuilding web-ui dependencies"
  (
    cd "${WEB_UI_DIR}"
    if [[ -d node_modules ]]; then
      mv node_modules "node_modules.broken.$(date +%s)" 2>/dev/null || rm -rf node_modules
    fi
    rm -rf .next
    npm install
  )
  if ! web_ui_deps_healthy; then
    echo "[bootstrap] web-ui dependency rebuild completed but Next runtime is still incomplete"
    exit 1
  fi
}

ensure_workspace_sources

if [[ "${SKIP_PYTHON}" != "1" ]]; then
  bootstrap_python
fi

if [[ "${SKIP_UI}" != "1" ]]; then
  bootstrap_ui
fi

echo "[bootstrap] done"
