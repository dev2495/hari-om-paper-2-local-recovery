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
