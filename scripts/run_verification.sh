#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-${ROOT_DIR}/hariom-erp/venv-runtime/bin/python}"

echo "==> Python compile: service routers and canonical spec math"
"${PYTHON_BIN}" -m py_compile \
  "${ROOT_DIR}/apps/bff-api/src/routes/spec.py" \
  "${ROOT_DIR}/apps/bff-api/src/routes/inventory.py" \
  "${ROOT_DIR}/hariom-erp/services/spec-service/src/main.py" \
  "${ROOT_DIR}/hariom-erp/services/spec-service/src/routers/specs.py" \
  "${ROOT_DIR}/hariom-erp/services/spec-service/src/routers/calculations.py" \
  "${ROOT_DIR}/hariom-erp/services/spec-service/src/calculators.py" \
  "${ROOT_DIR}/hariom-erp/services/spec-service/src/spec_math.py"

echo "==> Spec-service math tests"
(
  cd "${ROOT_DIR}/hariom-erp/services/spec-service"
  "${PYTHON_BIN}" -m pytest tests/test_spec_math.py
)

echo "==> Web verification"
(
  cd "${ROOT_DIR}/apps/web-ui"
  npm run verify
)

echo "==> Verification complete"
