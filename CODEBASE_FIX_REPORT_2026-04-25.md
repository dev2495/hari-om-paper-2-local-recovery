# Hari Om ERP High/Medium Fix Report

Date: 2026-04-25
Repo: `/Users/devarshthakkar/local_repos/yash hari on/Hari Om Paper 2 Local`
Scope: CodeRabbit critical/major issue fixes plus business-contract fixes that could safely be completed without a destructive schema rewrite.

## Executive Summary

The highest-risk runtime issues from the review were fixed and verified against the local production runtime. The stack is currently running, the web build passes, and authenticated smoke checks pass for login, sales orders, planning job cards, inventory balance, and the main client-demo pages.

The most important product fix is the sales-release contract: line releases are now persisted in the sales service before production sync, production writes the created job card back to the sales release lot, and dispatch sealing posts sales fulfillment instead of leaving dispatch and commercial status independent.

## Critical Fixes Completed

1. Hardcoded demo users are no longer seeded in production by default.
   - `SEED_DEMO_USERS` now controls demo seeding explicitly.
   - Local/demo remains usable because seeding defaults on outside production.
   - Production-like `APP_ENV`, `ENVIRONMENT`, `FASTAPI_ENV`, or `NODE_ENV` disables demo seeding unless opted in.

2. Report detail page hook crash fixed.
   - The `useMemo` table-column calculation was moved to the top level of `ReportDetailPage`.
   - This removes the Rules of Hooks violation during loading-to-success transitions.

3. Sales release truth fixed.
   - Sales service now owns line release lots through the existing `sales_order_release_lots` table.
   - BFF line-release route now has a real backend endpoint.
   - Sales UI now persists release rows first, then sends persisted release lot IDs to production.
   - Production release sync now writes `job_card_id` back to the sales release lot.
   - Sales lines now expose `released_qty`, `release_remaining_qty`, and `release_lots`.

## Major Fixes Completed

1. RBAC matrix endpoint now validates and applies enabled role payloads instead of ignoring input.
2. RBAC role listing now avoids `KeyError` if role order and DB contents drift.
3. Inventory reservations now reduce available stock instead of always returning `0`.
4. Ledger date filtering no longer crashes on malformed row dates.
5. FG inward access keeps legacy `Production` and `SupervisorEntry` roles while supporting the new canonical roles.
6. Dispatch ready list no longer exposes `PROCESS` jobs as dispatch-ready.
7. Dispatch routes now accept canonical `Dispatch`, `Store`, and `PlantManager` roles.
8. Dispatch sealing now posts sales fulfillment for linked sales-order lines.
9. Quality holds now block automatic next-stage queue creation.
10. MRP shortage notification handles non-list `lines` payloads safely.
11. Analytics dashboard removed fabricated backlog/blocked sparklines and adds loading/error visibility.
12. Inventory ledger adds loading/error states, stable fallback row keys, and safe date rendering.
13. Inventory dashboard no longer mixes kg and pcs into one `load` number.
14. Production issue form clears stale raw-paper exception state and prevents zero quantity.
15. Raw-material inward disables submit during posting and shows mutation errors.
16. Supplier delete and policy update flows now catch and show errors instead of throwing unhandled rejections.
17. New-user form now correctly selects loaded plants and enforces minimum password length.
18. Auth role checks now compare roles case-insensitively for global plant access.
19. Plant display handles UUID casing consistently.
20. Planner tracker preserves valid zero quantities by using nullish fallback.
21. Planner action-list empty state now reflects the filtered action list.
22. Owner/admin landing chart threshold and infrastructure unit formatting were corrected.
23. Reconciliation queries now pass the selected plant into the backend request.
24. System locations creation handles mutation failures.
25. Machine capacity rendering now handles null/undefined values.

## Verified

- Python compile passed for patched backend/BFF files.
- `npx tsc --noEmit --pretty false` passed.
- `npm run build` passed.
- `./start_all.sh` passed and rebuilt the production web UI.
- `./status_all.sh` shows all services running.
- `POST /api/auth/login` returned `200`.
- `GET /api/auth/me` returned `200`.
- `GET /api/sales/orders` returned `200`.
- `GET /api/production/job-cards` returned `200`.
- `GET /api/inventory/balance` returned `200`.
- Web pages returned `200`: `/sales-orders`, `/planning/board`, `/reports`, `/inventory/ledger`.

## Current Runtime

- Web UI: `http://127.0.0.1:13000/login`
- BFF: `http://127.0.0.1:14000/health`
- All direct services are running on their configured local ports.

## Remaining Larger-Scope Gaps

These were identified by the review but are not fully safe to finish as a quick patch without deeper workflow/schema work:

1. Full procurement lifecycle from MRP shortage to purchase requisition, PO approval, goods receipt, and supplier performance is still a feature build.
2. Full server-side permission enforcement should be centralized across all services; the role matrix is improved but route decorators still exist in each service.
3. Scheduled reports still need durable delivery audit, retry state, per-recipient format preferences, and export resource limits.
4. Historical release-lot backfill for old production job cards should be handled by a one-time reconciliation script before client data migration.
5. Stock-control performance can still be optimized further with aggregate SQL for very large inventory history.
6. Spec defaults/math fixture gates remain a separate hardening task from this high/medium fix pass.

## Presentation Notes

Use the currently running local runtime for the client demo. The safest demo path is:

1. Login with the owner demo account on local.
2. Show owner/admin landing separation and role switcher.
3. Show reports and analytics pages.
4. Show sales order release dialog using release quantities and target winder.
5. Show planning board/tracker after release sync.
6. Show inventory ledger/balance and stock-control pages.

Avoid promising that procurement/PO lifecycle and scheduled report delivery are complete; they are still listed above as remaining larger-scope gaps.
