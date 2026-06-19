# Production Readiness Handoff - 2026-06-20

## Scope

Implement the review fixes from the previous audit and keep this file updated with what changed, what was verified, and what still needs evidence before any production-ready claim.

## Baseline

- Worktree was already dirty before this implementation pass started.
- Existing modified areas included BFF production routes, operations control UI, planning board UI, production/inventory/masterdata/sales services, render config, and new audit/report files.
- Those existing changes are treated as owner/worktree state and are not reverted.

## Fix Tracker

| Area | Status | Evidence |
|---|---:|---|
| Duplicate BFF route registrations | Done | Current BFF routes have one handler per method/path; added `apps/bff-api/tests/test_route_contracts.py`. |
| Canonical spec math/defaults drift | Done | Removed dead stale helper math from `spec-sheet-utils.ts`; aligned active `spec-sheet.ts` defaults to 9.0/0.91; added canonical validator. |
| Global spec defaults end-to-end | Done | Current tree has model/schema, spec-service GET/PUT, BFF GET/PUT, frontend API/hook, and create-form bootstrap. |
| Spec sheet component split | Done | Current tree has the planned shared/section/print/workspace components; live editor delegates to them and stale helper math was removed. |
| Legacy route canonicalization | Done | Catch-all is redirect-only; `/master` source directory removed after migrating implementations to `/masters`; visible planner/dispatch/master links point to canonical routes. |
| Role policy cleanup | Done | Visible navigation uses condensed role names; legacy aliases remain only in workspace normalization. |
| Verification command refresh | Done | Web `npm test` now runs static validators plus TS unit tests; root `scripts/run_verification.sh` uses current BFF/spec/web gates. |
| Degraded fallback visibility | Done | Spec preview exposes `degraded/degraded_reason` and renders a warning; inventory health timeout now returns HTTP 503 with `degraded: true`. |
| Active service tree cleanup | Done | Moved `*.unreadable.bak` and `src.pre_restore_*` recovery folders out of `hariom-erp/services` into `hariom-erp/archive/recovery/2026-06-20/`. |
| Documentation alignment | Done | Updated `ARCHITECTURE.md`, `IMPLEMENTATION.md`, and this handoff for current spec math, route, and verification behavior. |

## Verification Log

- `env PYTHONPATH=apps/bff-api hariom-erp/venv-runtime/bin/pytest apps/bff-api/tests/test_route_contracts.py` - passed, 2 tests.
- `node apps/web-ui/scripts/validate-spec-canonical.cjs` - passed after confirming it failed on stale 8/0.905 constants before the patch.
- `npm run test` in `apps/web-ui` - passed: help coverage, canonical spec validation, route validation, and TS unit tests (`21/21`, `3/3`, `2/2`).
- `env PYTHONPATH=hariom-erp/services/spec-service/src hariom-erp/venv-runtime/bin/pytest hariom-erp/services/spec-service/tests/test_spec_math.py` - passed, 28 tests.
- `npm audit --audit-level=high` in `apps/web-ui` - passed with 0 vulnerabilities after compatible audit fix.
- `bash scripts/run_verification.sh` - passed end to end after archive cleanup: BFF route contracts, spec math parity, web audit, web static/unit tests, lint, typecheck, and `next build`.
- `env PYTHONPATH=hariom-erp/services/production-service/src hariom-erp/venv-runtime/bin/pytest hariom-erp/services/production-service/tests` - passed, 79 tests.
- `hariom-erp/venv-runtime/bin/python -m compileall -q apps/bff-api/src hariom-erp/services/*/src` - passed with no compile errors.
- Built app smoke on `http://localhost:3100`:
  - `GET/HEAD /master` returns `308` to `/masters`.
  - `GET/HEAD /planning` and `/production/planner` return `308` to `/planning/board`.
  - `GET/HEAD /dispatch` returns `308` to `/logistics/dispatch`.
  - `GET/HEAD /specs` returns `308` to `/specifications`.
  - Browser navigation to `/masters` reaches the auth gate as expected for an unauthenticated session.
- `npm run test` rerun after adding redirect assertions to `validate-route-canonical.cjs` - passed.
