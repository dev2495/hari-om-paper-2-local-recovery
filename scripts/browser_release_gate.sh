#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

RUNTIME_DIR="$(resolve_runtime_dir "${BASE_DIR}/hariom-erp")"
MANIFEST_PATH="${RUNTIME_DIR}/runtime_manifest.json"
FIXTURE_PATH="${BASE_DIR}/reports/browser_e2e_fixture_latest.json"
CONFIG_PATH="${BASE_DIR}/apps/web-ui/playwright.config.cjs"
OUTPUT_DIR="${BASE_DIR}/output/playwright"
WEB_UI_DIR="${BASE_DIR}/apps/web-ui"
NODE18_BIN="${NODE18_BIN:-/opt/homebrew/opt/node@18/bin}"

mkdir -p "${OUTPUT_DIR}"

if [[ ! -x "${NODE18_BIN}/node" || ! -x "${NODE18_BIN}/npm" ]]; then
  echo "Node 18 runtime not found at ${NODE18_BIN}"
  exit 1
fi

export PATH="${NODE18_BIN}:$PATH"
hash -r

if [[ ! -f "${MANIFEST_PATH}" ]]; then
  echo "Runtime manifest not found: ${MANIFEST_PATH}"
  echo "Start the verified runtime first: scripts/start_verified_runtime.sh"
  exit 1
fi

if [[ ! -f "${FIXTURE_PATH}" ]]; then
  echo "Browser fixture not found: ${FIXTURE_PATH}"
  echo "Run the hard cutover validation first so browser tests have seeded order and user data."
  exit 1
fi

export ERP_RUNTIME_MANIFEST="${MANIFEST_PATH}"
export ERP_BROWSER_FIXTURE="${FIXTURE_PATH}"
export WEB_URL="$("${NODE18_BIN}/node" -e "const fs=require('fs');const manifest=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(manifest.urls?.web||'http://127.0.0.1:13000'))" "${MANIFEST_PATH}")"
export PLAYWRIGHT_BASE_URL="${WEB_URL}"

echo "Browser gate using Web UI: ${WEB_URL}"
echo "Skipping blocking curl readiness probes and handing readiness over to Playwright navigation."
echo "Running browser gate serially because tests share live seeded users and auth sessions."

if [[ -x "${WEB_UI_DIR}/node_modules/.bin/playwright" ]]; then
  echo "using local Playwright from ${WEB_UI_DIR}/node_modules"
  (
    cd "${WEB_UI_DIR}"
    ./node_modules/.bin/playwright test --config "${CONFIG_PATH}" --workers=1
  )
elif node -e "require.resolve('@playwright/test')" >/dev/null 2>&1; then
  node -e "console.log('using root-resolved @playwright/test')"
  npx playwright test --config "${CONFIG_PATH}" --workers=1
else
  echo "Playwright dependency is not installed locally."
  echo "Rebuild web-ui dependencies before running the browser release gate."
  exit 1
fi
