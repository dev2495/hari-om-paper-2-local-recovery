#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v python3.11 >/dev/null 2>&1 && ! python3 - <<'PY' >/dev/null 2>&1
import sys
raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)
PY
then
  echo "Python 3.11 is required. Install it first, then rerun this script."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js 18 first, then rerun this script."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required. Install/start PostgreSQL first, then rerun this script."
  exit 1
fi

if [[ -d "${NODE18_BIN:-}" ]]; then
  export PATH="${NODE18_BIN}:$PATH"
elif [[ -d "/opt/homebrew/opt/node@18/bin" ]]; then
  export NODE18_BIN="/opt/homebrew/opt/node@18/bin"
  export PATH="${NODE18_BIN}:$PATH"
fi

node_major="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)"
if [[ "$node_major" != "18" ]]; then
  echo "Node.js 18 is required for this Next.js app. Current node: $(node -v 2>/dev/null || echo missing)"
  echo "Set NODE18_BIN to a Node 18 bin directory, then rerun."
  exit 1
fi

echo "[setup] bootstrapping Python and web dependencies"
bash hariom-erp/scripts/direct/bootstrap.sh

echo "[setup] creating/checking PostgreSQL databases"
ERP_VENV_DIR="${ERP_VENV_DIR:-hariom-erp/venv-runtime}" bash start_all.sh --direct

echo
echo "[setup] complete. App was started once to create DB tables and seed baseline data."
echo "Open http://127.0.0.1:13000/login or run: bash setup_test_pc/start_for_tester.sh"
