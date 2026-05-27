# Reports Suite Go-Live Completion Report

**Date:** 2026-05-27  
**Project:** Hari Om Paper 2  
**Scope:** Reports and analytics suite, backend aggregation, BFF proxies, UI pages, local release verification.

## Verdict

The reports suite is production-ready locally and ready for Railway deployment.

The earlier report-suite implementation has been hardened in this pass:

- Removed the client-side saved-views demo from `/reports`.
- Removed fake metric fallbacks such as fixed `91.4%`, `96.8%`, and `28 days`.
- Added a real operator productivity endpoint instead of deriving operators from blocker rows.
- Restarted the production Next server after build to remove stale chunk risk.
- Verified report pages in an authenticated Chrome session, not only by HTTP status.

## Shipped Surface

### Frontend

- `/reports` - report landing with audience tabs and real current report signals.
- `/analytics` - KPI dashboard with live owner-pack, production, sales, quality, exception, and dispatch data.
- `/reports/owner` - Owner Daily Pack.
- `/reports/operations` - machine utilization, stage queue, schedule adherence, real operator productivity, blockers.
- `/reports/inventory` - stock value, RM days-on-hand from real velocity rows, velocity matrix, shortages, movers.
- `/reports/sales` - funnel, OTIF trend, lead-time anatomy, customer ladder, SKU mix.
- `/reports/customer-360` - per-customer open/closed/delayed/OTIF/risk ladder.
- `/reports/variance` and `/reports/quality` - shared Quality & Variance Bridge.
- Existing `/reports/production`, `/reports/dispatch`, `/reports/exceptions`, `/reports/plants`, and `/reports/loss` remain real-data report shell pages and were browser-smoked.

### Backend

`hariom-erp/services/analytics-service/src/routers/deep_cuts.py` now exposes six authenticated, plant-scoped endpoints:

- `GET /deep/machine-utilization`
- `GET /deep/customer-360`
- `GET /deep/operator-productivity`
- `GET /deep/leadtime-anatomy`
- `GET /deep/scrap-cost-ladder`
- `GET /deep/item-velocity`

All six are registered in analytics-service and proxied through BFF at `/api/analytics/deep/*`.

## Real-Data Guardrails

The report suite no longer uses fake display values for operational metrics:

- Schedule adherence shows `-` until the backend returns a real value.
- QC pass rate shows `-` until the quality payload returns the value.
- RM days-on-hand is computed from item velocity rows when owner-pack does not provide it.
- Owner Daily Pack does not invent a customer or standup question when the payload is empty.
- Analytics anomaly copy only reports facts present in the current payload.
- `/reports` shows current report signals from live payloads instead of a saved-views demo table.

## Verification Evidence

| Gate | Result |
| --- | --- |
| Python compile for analytics/BFF changes | PASS |
| `npm run lint -- --quiet` | PASS |
| `npx tsc --noEmit --pretty false` | PASS |
| `npm run verify` in `apps/web-ui` | PASS: lint, help coverage, tests, TypeScript, Next build |
| Next production build during `start_all.sh` | PASS: 106 routes generated |
| Authenticated local API smoke | PASS: 15 analytics/report endpoints returned HTTP 200 |
| `bash scripts/runtime_smoke.sh` | PASS: 35 checks, 0 failures |
| Authenticated Chrome report smoke | PASS: 14 report routes rendered with no client-side errors |
| Runtime log scan after smoke | PASS: no traceback/internal server error/application error hits |

Authenticated Chrome routes verified:

- `/reports`
- `/analytics`
- `/reports/owner`
- `/reports/operations`
- `/reports/inventory`
- `/reports/sales`
- `/reports/customer-360`
- `/reports/variance`
- `/reports/quality`
- `/reports/production`
- `/reports/dispatch`
- `/reports/exceptions`
- `/reports/plants`
- `/reports/loss`

## Notes

- The historical `REPORTS_REDESIGN_REPORT.md` remains as a design record. This file is the current implementation and go-live evidence.
- Railway deployment and live URL verification will be appended after the production deploy completes.
