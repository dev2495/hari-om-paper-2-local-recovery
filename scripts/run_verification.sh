#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTEST="$ROOT_DIR/hariom-erp/venv-runtime/bin/pytest"

cd "$ROOT_DIR"

if [[ ! -x "$PYTEST" ]]; then
  echo "Missing repo pytest runtime: $PYTEST" >&2
  exit 1
fi

echo "== BFF route contracts =="
env PYTHONPATH=apps/bff-api "$PYTEST" apps/bff-api/tests/test_route_contracts.py

echo "== Tooling master contract =="
env PYTHONPATH=hariom-erp/services/masterdata-service "$PYTEST" hariom-erp/services/masterdata-service/tests/test_tool_master_contract.py

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

echo "== Analytics scheduler regression tests =="
env PYTHONPATH=hariom-erp/services/analytics-service "$ROOT_DIR/hariom-erp/venv-runtime/bin/pytest" \
  hariom-erp/services/analytics-service/tests/test_scheduler.py

echo "== Spec math parity =="
env PYTHONPATH=hariom-erp/services/spec-service/src "$PYTEST" hariom-erp/services/spec-service/tests/test_spec_math.py

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
