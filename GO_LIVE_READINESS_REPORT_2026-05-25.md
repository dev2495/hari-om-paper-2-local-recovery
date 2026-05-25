# Hari Om ERP Go-Live Readiness Report

Date: 2026-05-25
Checkout: `/Users/devarshthakkar/local_repos/yash hari on/Hari Om Paper 2 Local`
Branch: `staging`

## Short Answer

The Hari Om ERP codebase, local production runtime, and Railway production deployment are ready for master-data entry and opening-stock preparation. All repo task files are closed except explicitly skipped/out-of-scope items, and the final gates passed.

Railway production is live at `https://hariom-erp-production.up.railway.app`.

## What Was Completed

- Closed remaining spec-sheet component tasks without changing workbook flow or save/approval logic.
- Added maintainable spec-sheet section components, shared numeric input, searchable paper picker, delta pill, workspace shell, and print shell.
- Added Python/TypeScript spec math parity verification across five fixtures at `<= 3 dp`.
- Added a live opening-stock smoke that logs into BFF, posts an audited opening-load document, verifies the stock statement, and writes a report.
- Redirected old route leaks:
  - `/master` -> `/masters/papers`
  - `/master/items` -> `/inventory/items`
  - `/specs/:id/edit` -> `/specifications/:id/edit`
- Hardened Railway container startup:
  - removed simple staging bootstrap defaults from the Docker image,
  - supports external Railway Postgres through `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`,
  - allows embedded Postgres on Railway when Railway exposes the persistent `/var/lib/postgresql` volume marker,
  - requires real `JWT_SECRET`, `BOOTSTRAP_ADMIN_PASSWORD`, and `BOOTSTRAP_OWNER_PASSWORD` on Railway,
  - refuses Railway startup when staging password reset flags are enabled.

## Verification Run

- `./scripts/run_verification.sh` passed:
  - Python compile
  - spec-service pytest: `28 passed`
  - Python/TypeScript spec math parity: `5 fixtures <= 3 dp`
  - web lint
  - help coverage: `113 dashboard routes map to 18 guides`
  - TS tests: `21/21`, `3/3`, `2/2`
  - TypeScript compile
  - production Next build: `103` pages
- `bash scripts/start_verified_runtime.sh` passed and restarted the local production stack.
- Runtime consistency passed: `reports/runtime_consistency_20260525_023515.md`, `failed: 0`.
- Hard cutover validation passed: `114/114`, report `reports/hard_cutover_validation_20260525_023714.md`.
- Browser release gate passed: `8/8`.
- Opening-stock live smoke passed:
  - document no: `OPEN-SMOKE-20260524210755-E50F`
  - opening load id: `53c53f9a-799b-4ae5-a11d-fc1ee8879212`
  - report: `reports/opening_stock_live_smoke_20260524_210756.md`
- Legacy route redirect checks passed with `308 Permanent Redirect`.

## Railway Production Deployment

- Project: `hariom-paper-client-test`
- Service: `hariom-erp`
- URL: `https://hariom-erp-production.up.railway.app`
- Environment: `production`
- Region: `sfo`
- Volume: `hariom-erp-volume` mounted at `/var/lib/postgresql`
- Active deployment: `35baf5c1-5a86-407f-b626-23e63245a40c`
- Source commit deployed: `3eb0295`
- Railway status: `Online`
- Variable cleanup completed:
  - `RESET_BOOTSTRAP_PASSWORDS=false`
  - `USE_SIMPLE_STAGING_PASSWORDS=false`
  - `START_EMBEDDED_POSTGRES=true`
- Public checks:
  - `/login` returned `200`
  - `/master` returned `308` to `/masters/papers`
  - `/master/items` returned `308` to `/inventory/items`
  - `/specs/example/edit` returned `308` to `/specifications/example/edit`
  - authenticated `/api/auth/login` returned `200`
  - authenticated `/api/auth/roles` returned `200`

## Current Live Local Stack

- Web UI: `http://127.0.0.1:13000/login`
- BFF: `http://127.0.0.1:14000/health`
- Runtime mode: direct
- Current runtime consistency: `failed: 0`

## Confidence

Local production-runtime confidence: high.

Reason: compile, test, typecheck, production build, runtime restart, API consistency, browser flows, hard-cutover business validation, and opening-stock smoke all passed on the same checkout.

Railway production confidence: conditional.

Reason: the Railway deployment is live and authenticated API smoke passed. Remaining production confidence is conditional only around normal first-day operations: backups, owner signoff, and careful master-data/opening-stock entry.

## Railway Go-Live State

Railway go-live is complete for this service. The current production database is volume-backed at `/var/lib/postgresql`; do not remove or replace `hariom-erp-volume` during first-day operations.

## Tomorrow Start Order

1. Add master data: papers, adhesives, parchments, tube sizes, mandrels, packaging, tools, suppliers, customers, users, plants/locations.
2. Review item policy values: unit cost, reorder level, safety stock, and lead-time days.
3. Run a small opening-stock load first and verify stock statement.
4. Upload remaining opening stock in controlled batches.
5. Certify opening balances only after the owner/store team checks totals.

## Remaining Improvements

These are improvements, not blockers for master-data/opening-stock start:

- Add backup/restore runbook for Railway Postgres before live stock entry.
- Add owner-facing first-day checklist in the UI for master-data completeness and opening-stock signoff.
- Add a nightly production backup verification job.
