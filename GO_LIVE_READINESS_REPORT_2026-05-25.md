# Hari Om ERP Go-Live Readiness Report

Date: 2026-05-25
Checkout: `/Users/devarshthakkar/local_repos/yash hari on/Hari Om Paper 2 Local`
Branch: `staging`

## Short Answer

The Hari Om ERP codebase and local production runtime are ready for master-data entry and opening-stock preparation. All repo task files are closed except explicitly skipped/out-of-scope items, and the final local gates passed.

Actual Railway go-live was not executed in this session because this shell has no Railway CLI and no `RAILWAY_TOKEN`. The code is now hardened for Railway, but the live Railway deployment still needs owner authentication/project linking, attached persistent Railway PostgreSQL, and production secrets.

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
  - refuses embedded Postgres on Railway unless explicitly enabled for a persistent volume-backed service,
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

## Current Live Local Stack

- Web UI: `http://127.0.0.1:13000/login`
- BFF: `http://127.0.0.1:14000/health`
- Runtime mode: direct
- Current runtime consistency: `failed: 0`

## Confidence

Local production-runtime confidence: high.

Reason: compile, test, typecheck, production build, runtime restart, API consistency, browser flows, hard-cutover business validation, and opening-stock smoke all passed on the same checkout.

Railway production confidence: conditional.

Reason: the repo has Railway Dockerfile and `railway.toml` configuration and is now hardened against common production mistakes. Use the existing `/var/lib/postgresql` Railway volume or attach Railway Postgres before entering real company stock data.

## Railway Go-Live Requirements

Before using Railway for real users and real opening stock:

1. Install/login to Railway CLI or provide `RAILWAY_TOKEN`.
2. Link this repo to the intended Railway project/service.
3. Use the existing Railway volume mounted at `/var/lib/postgresql`, or attach Railway PostgreSQL.
4. Expose these database variables to the app service:
   - `PGHOST`
   - `PGPORT`
   - `PGUSER`
   - `PGPASSWORD`
   - `PGDATABASE`
5. Set production secrets:
   - `JWT_SECRET`
   - `BOOTSTRAP_ADMIN_EMAIL`
   - `BOOTSTRAP_ADMIN_PASSWORD`
   - `BOOTSTRAP_OWNER_EMAIL`
   - `BOOTSTRAP_OWNER_PASSWORD`
6. Deploy the Dockerfile service.
7. Verify `/login`, BFF `/health`, hard-cutover smoke, and opening-stock smoke against the Railway URL.

## Tomorrow Start Order

1. Add master data: papers, adhesives, parchments, tube sizes, mandrels, packaging, tools, suppliers, customers, users, plants/locations.
2. Review item policy values: unit cost, reorder level, safety stock, and lead-time days.
3. Run a small opening-stock load first and verify stock statement.
4. Upload remaining opening stock in controlled batches.
5. Certify opening balances only after the owner/store team checks totals.

## Remaining Improvements

These are improvements, not blockers for local master-data/opening-stock start:

- Add a Railway-specific smoke script once the real Railway URL and token are available.
- Add backup/restore runbook for Railway Postgres before live stock entry.
- Add owner-facing first-day checklist in the UI for master-data completeness and opening-stock signoff.
- Add a nightly production backup verification job after Railway deployment.
