#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -d "${NODE18_BIN:-}" ]]; then
  export PATH="${NODE18_BIN}:$PATH"
elif [[ -d "/opt/homebrew/opt/node@18/bin" ]]; then
  export NODE18_BIN="/opt/homebrew/opt/node@18/bin"
  export PATH="${NODE18_BIN}:$PATH"
fi

export WEB_UI_MODE="${WEB_UI_MODE:-prod}"
export DB_HOST="${DB_HOST:-127.0.0.1}"
export DB_PORT="${DB_PORT:-5432}"
export DB_USER="${DB_USER:-${USER:-postgres}}"
export DB_PASSWORD="${DB_PASSWORD:-}"
export DB_ADMIN_DB="${DB_ADMIN_DB:-postgres}"

bash start_all.sh --direct
