# Hari Om correction completion report

**Date:** 17 September 2026  
**Branch:** `cursor/ui-polish-nav-c5f9`  
**Audited base SHA:** `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`  
**This correction commit:** recorded as `HEAD` on the branch after this file is committed.

This is the finishing pass from `HARI_OM_AGENT_CORRECTION_PROMPT.md` and `HARI_OM_PR_REVIEW_AND_COMPLETION_PLAN.md`. Useful work already on the audited branch was kept. The ten draft PRs were not rebuilt. A smoke suite was not treated as V2 completion.

**Honest status:** C1–C7 source patches and additive RR unit tests are in this commit. The listed unit commands passed. This is **not** a V2 go-live claim. Playwright, live overlapping Postgres, Docker image boot, the original 192-case pack, merge, and deploy remain owner gates (`NOT_RUN` / `NOT_VERIFIED`).

## What was done

### C1 — QC containment, samples, units, hold policy

- Incoming FAIL/INVALID/INCOMPLETE opens a quantity-scoped hold. Concession releases only an identified quantity; residual stays `QC_HOLD`; independent holds are not released.
- Measured FAIL is never rewritten to PASS. Whole-lot release requires the full lot quantity; unspecified/zero/negative/excess are rejected.
- Production ignores client `create_hold_on_fail`. FAIL/INVALID always opens a hold.
- FAIL without a reason is persisted with `REASON_PENDING`. Final submission still uses `submission_error`.
- Job-card sync persists every sample in `quality_checks.samples` instead of rejecting the stage write.
- Collector walks every winding sample. Whitespace is missing, not `0`. kg batch weights are not copied into g specimen fields (UI collector + shared evaluator aliases).

### C2 — Customer delivery schedule

- `schedule-entire-PO` uses merge mode `append`. Existing committed rows keep their ids/dates/qty. Remainder is added. Repeat after a full commitment is a no-op.
- Remaining-to-schedule subtracts active rows **and** fulfilled quantity that has no call-off row.
- Header edits reload stored delivery schedules and revalidate dates.
- Commit locks the sales order (`with_for_update`) and rejects a stale `expected_revision` (`STALE_PREVIEW`).
- Allocations cannot exceed either parent, duplicate a pair, or attach a lot from another line.
- Patch cannot set `delivered`. New rows cannot be created as locked/delivered.

### C3 — Immutable QC profiles

- Store/QC JSON save cannot self-approve. Approved edits open a new draft and keep `approved_snapshot`.
- Owner/Admin approve endpoints require `expected_revision`.
- Receipt (bulk inward + reel) pins the approved snapshot onto `inward_metadata`. Later master edits do not move a historical lot.

### C4–C6 — Evaluator, demand, notifications, packaging

- Shared `hariom_quality_eval.py`: categorical FAIL vs approved options; oven PRE-only; pair-mismatch FAIL; inverted bounds INVALID at eval time.
- Service shims walk the repo / `/app/shared`. Each of inventory and production vendors a copy and Docker `COPY shared ./shared`.
- Demand coverage is labeled `GROSS_ESTIMATE` with completeness `ESTIMATE`/`PARTIAL`. No generic parchment invention. UOM mismatch is `UNKNOWN`. QC-held PO is not usable coverage.
- Notifications: no plantless leak; Admin/Owner without `is_owner_all_plants` stay on assigned plants.

### C7 — UI

- Spec QC dialog: target weight / CS / recipe / ply / parchment, `role="dialog"`, Escape.
- Job card: samples in `quality_checks`; print keeps kg batch weights separate from g specimens.
- `PageHeader` on inventory, logistics dispatch, specifications index.

### C8 — Tests and evidence

See `docs/review/RR_REGRESSION_CHECKLIST.md` and `docs/review/EVIDENCE_LEDGER.md`.

## Change summary (files)

| Area | Files |
| --- | --- |
| Shared evaluator | `hariom-erp/shared/hariom_quality_eval.py` + vendored `services/{inventory,production}-service/shared/hariom_quality_eval.py` |
| Inventory QC | `concession_partition.py`, `quality_pin.py`, `quality_profile_lifecycle.py`, `routers/quality.py`, `routers/items.py`, `routers/inward.py`, `routers/reels.py`, `models.py`, `main.py`, Docker |
| Production QC | `routers/quality.py`, `routers/planning.py`, `models.py`, `main.py`, Docker |
| Sales schedules | `schedule_policy.py`, `schedule_service.py`, `routers/sales_orders.py` |
| Specs | `qc_profile.py`, `routers/specs.py` |
| Analytics / auth | `demand_coverage.py`, `notification_service.py` |
| Web UI | `lib/qc-measurement.ts`, `JobCardDocument.tsx`, `SpecQcToleranceDialog.tsx`, `SpecSheetDocument.tsx`, inventory / dispatch / specifications pages |
| Tests | production / sales / spec / inventory / auth / analytics / `qc-measurement.test.ts` |
| Evidence | `HARI_OM_CORRECTION_COMPLETION_REPORT.md`, `docs/review/*` |

`.venv/` is gitignored and was **not** committed.

## Verification checklist

| Check | Result |
| --- | --- |
| production `test_quality_eval` + `test_quality_pass_rate` | **18 passed** |
| production + `test_due_risk` + `test_pending_by_order` | **24 passed** |
| sales `test_pending_and_schedules` + `test_sales_commercial` | **24 passed** |
| sales `test_sales_logic` + `test_open_demand` | **13 passed** |
| spec `test_qc_profile` | **4 passed** |
| inventory `test_concession_and_profile` | **7 passed** |
| auth `test_notification_plant_scope` | **8 passed** |
| analytics `test_demand_coverage` | **5 passed** |
| web-ui `npm run test:unit` | **PASS** (23 / 2 / 20 / sales-order-entry / 2 / 8 / 13 / 10) |
| `py_compile` on touched Python | **PASS** (after inward dict close) |
| Playwright list / browser | **NOT_RUN** — missing runtime fixtures; no UI at :13000 |
| Planning router tests / typed validator | **NOT_RUN** — `.venv` has no `pydantic_settings` |
| Overlapping live Postgres | **NOT_RUN** |
| Docker image boot | **NOT_RUN** |
| Original 192 V2 pack | **NOT_RUN** (not replaced) |
| Merge / deploy | **NOT DONE** — owner approval required |

## Remaining gaps (do not skip)

1. Run Playwright against a live stack with `runtime_manifest.json`.
2. Two-session Postgres proof for concession and schedule revision races.
3. Install service extras (`pydantic_settings`, etc.) and run router-level production tests.
4. Boot inventory/production images and confirm `/app/shared/hariom_quality_eval.py` imports.
5. Execute the original 192 V2 cases as themselves.
6. Owner decision on main-targeted PR / merge / production.

Until those gates pass, this branch is **correction-complete for the listed source defects**, not production-released V2.
