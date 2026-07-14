#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTEST="$ROOT_DIR/hariom-erp/venv-runtime/bin/pytest"

cd "$ROOT_DIR"

if [[ ! -x "$PYTEST" ]]; then
  echo "Missing repo pytest runtime: $PYTEST" >&2
  exit 1
fi

echo "== Full backend regression suites =="
env PYTHONPATH=apps/bff-api "$PYTEST" apps/bff-api/tests
env PYTHONPATH=hariom-erp/services/auth-service "$PYTEST" hariom-erp/services/auth-service/tests
env PYTHONPATH=hariom-erp/services/masterdata-service "$PYTEST" hariom-erp/services/masterdata-service/tests
env PYTHONPATH=hariom-erp/services/spec-service/src "$PYTEST" hariom-erp/services/spec-service/tests
env PYTHONPATH=hariom-erp/services/sales-service "$PYTEST" hariom-erp/services/sales-service/tests
env PYTHONPATH=hariom-erp/services/inventory-service "$PYTEST" hariom-erp/services/inventory-service/tests
env PYTHONPATH=hariom-erp/services/production-service "$PYTEST" hariom-erp/services/production-service/tests
env PYTHONPATH=hariom-erp/services/analytics-service "$PYTEST" hariom-erp/services/analytics-service/tests

echo "== Runtime control scripts =="
bash -n hariom-erp/scripts/direct/start.sh hariom-erp/scripts/direct/stop.sh hariom-erp/scripts/direct/status.sh start_all.sh stop_all.sh status_all.sh scripts/start_verified_runtime.sh deploy/aws-ec2/*.sh
RUNTIME_CONTROL_TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hariom-stop-contract.XXXXXX")"
RUNTIME_CONTROL_TEST_PID=""
cleanup_runtime_control_test() {
  if [[ -n "$RUNTIME_CONTROL_TEST_PID" ]] && kill -0 "$RUNTIME_CONTROL_TEST_PID" >/dev/null 2>&1; then
    kill "$RUNTIME_CONTROL_TEST_PID" >/dev/null 2>&1 || true
    kill -9 "$RUNTIME_CONTROL_TEST_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$RUNTIME_CONTROL_TEST_DIR"
}
trap cleanup_runtime_control_test EXIT
mkdir -p "$RUNTIME_CONTROL_TEST_DIR/pids"
sleep 30 &
RUNTIME_CONTROL_TEST_PID=$!
printf '%s\n' "$RUNTIME_CONTROL_TEST_PID" > "$RUNTIME_CONTROL_TEST_DIR/pids/web-ui.pid"
ERP_RUNTIME_DIR="$RUNTIME_CONTROL_TEST_DIR" bash hariom-erp/scripts/direct/stop.sh >/dev/null
wait "$RUNTIME_CONTROL_TEST_PID" 2>/dev/null || true
if kill -0 "$RUNTIME_CONTROL_TEST_PID" >/dev/null 2>&1; then
  echo "Runtime shutdown did not stop the selected runtime process" >&2
  exit 1
fi
if [[ -e "$RUNTIME_CONTROL_TEST_DIR/pids/web-ui.pid" ]]; then
  echo "Runtime shutdown did not clear the selected runtime PID marker" >&2
  exit 1
fi
RUNTIME_CONTROL_TEST_PID=""
trap - EXIT
rm -rf "$RUNTIME_CONTROL_TEST_DIR"
echo "Runtime shutdown override passed."

echo "== Production scheduler/runtime requirements =="
grep -qx 'apscheduler==3.10.4' hariom-erp/scripts/direct/requirements.all.txt
grep -q 'name="analytics-worker"' deploy/tinypod/start_erp.py
env PYTHONPATH=hariom-erp/services/analytics-service "$ROOT_DIR/hariom-erp/venv-runtime/bin/python" - <<'PY'
from src.job_queue import ensure_job_schema
from src.job_worker import main as worker_main
from src.scheduler import get_status

assert callable(ensure_job_schema)
assert callable(worker_main)
status = get_status()
assert "queue" in status
PY
env PYTHONPATH=apps/bff-api "$ROOT_DIR/hariom-erp/venv-runtime/bin/python" - <<'PY'
from src.services.books_guard import books_guard_status

status = books_guard_status()
assert status["ttl_seconds"] == 60
assert status["mode"] in {"inprocess_only", "redis_with_inprocess_fallback", "shared_required"}
assert "redis" in status
PY

echo "== Web dependency audit =="
cd "$ROOT_DIR/apps/web-ui"
if [[ ! -d node_modules ]]; then
  npm ci
fi
npm audit --audit-level=high

echo "== Web tests =="
npm run test

echo "== Web lint =="
npm run lint

echo "== Web typecheck =="
npx tsc --noEmit --pretty false

echo "== Web production build =="
npm run build

echo "Verification completed."
