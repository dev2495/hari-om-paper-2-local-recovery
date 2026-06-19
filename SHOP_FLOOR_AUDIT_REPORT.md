# Hari Om ERP — Operations Honesty + Shop-Floor Masters Audit

**Date:** 2026-05-29
**Scope:** Operations honesty (short-close, downtime, backdating, data-entry-lag), shop-floor masters (Employee/Shift/Holiday/ReasonCode), audit-coverage uplift, APScheduler + status panel, plus broader codebase cross-cutting gaps.
**Methodology:** Per-area code inspection followed by adversarial verification of every finding. 27 confirmed, 2 refuted.

---

## 1. Executive verdict

**The work is largely shipped but it is not "all green."** Every claimed feature has code paths in place — models, routers, BFF proxies, hooks, and pages all exist and the Next.js manifest reflects them. The happy path for shop-floor masters, short-close + carry-forward, downtime logging, data-entry-lag KPI, the audit-coverage uplift, and the APScheduler status panel can be exercised end-to-end. Plant-scope is consistently enforced across the stack, role-gating is in the right places, and the books-guard is correctly wired onto stage-output writes.

**The honesty story has real holes, however.** One P0 transaction-safety bug in the short-close + carry-forward flow can lose both the short-close record and the carry-forward job card on a mid-flight exception, with no audit trail. Seven P1 issues span: missing idempotency on short-close (a second call duplicates JCs), books-guard structurally wrapping its error payload such that the frontend renders `[object Object]`, the StockTransaction ledger NEVER stamping `effective_date = actual_end.date()` (the inventory ledger always posts at server now()), Customer/Supplier PUT and Contact CRUD entirely bypassing audit, all four shop-floor masters having zero audit coverage, downtime PUT silently accepting `ended_at < started_at`, a duplicate owner-pack risk between Render cron and in-process scheduler, and a broken release-lot linkage when CARRY_FORWARD spawns a top-up JC.

**Honest score: B−.** Roughly 70% of what was claimed is operationally true. The remaining 30% is split between (a) silent acceptance of invalid input that the UI happens to prevent today and (b) audit/integrity gaps that erode the "honesty" thesis the work was meant to deliver. Two of the loudest claims — "ledger postings stamp `effective_date = actual_end.date()`" and "shop-floor masters are cockpit-grade with audit" — are false as written.

---

## 2. Per-area scorecard

| Area | Verdict | One-line summary |
|---|---|---|
| Shop-floor masters (Employee/Shift/Holiday/ReasonCode) | **Partial** | Wiring complete end-to-end; shift time format unvalidated, list endpoints default `include_inactive=True`, zero audit coverage. |
| Short-close + carry-forward | **Partial** | Core flow works; **P0** transaction-safety flaw, missing idempotency, no reason-code FK, hardcoded `current_stage='WINDER'`, broken release-lot linkage. |
| Machine downtime | **Partial** | Create path solid; PUT silently accepts inverted timestamps, no UI to end ONGOING events, no future-start guard, update emits no audit. |
| Backdating + books-guard (stage entries) | **Partial** | Guard correctly wired on stage-output. **CRITICAL**: StockTransaction has no `effective_date` — ledger always posts at server now(), contradicting the headline claim. Future-dated writes accepted. |
| Data-entry-lag KPI | **Partial** | Query, plant-scope, NULL handling, BFF wiring, and UI all correct. **p90 off-by-one** (uses `int(...)` instead of `ceil`). Diagnostic-only — no preventive UI on the entry form. |
| Audit coverage uplift (F) | **Partial** | Sales-service writes audit on 4 mutations; customer/supplier create+deactivate covered. **Gaps**: PUT on customer/supplier, all contact CRUD, all 12 shop-floor master mutations, all 13+ inventory mutation handlers. Inventory `audit_client.py` is dead code. |
| APScheduler + status panel | **Partial** | Lazy import, thread-safe in-process status, env-var gating, UI panel all correct. **`/scheduler/status` has no auth.** Render cron + in-process scheduler can both fire owner-pack with no coordination. |
| Broader codebase / system-wide flows | **Partial** | Books-guard error shape breaks UI rendering, carry-forward not flagged on planner board, no late-entry warning on entry form, downtime doesn't suggest reschedule, inventory + contacts unaudited, 9 report pages still on legacy shell. |

---

## 3. Confirmed gaps — ranked by severity

### P0 — Critical

#### P0.1 Transaction-safety flaw in short-close + carry-forward
- **Area:** Short-close + carry-forward flow
- **Evidence:** `hariom-erp/services/production-service/src/routers/operations.py:170-232`
- **Description:** The handler flushes the carry-forward JobCard, assigns `short.carry_forward_job_card_id = carry.id`, marks the original JC `COMPLETED`, and then calls `db.commit()` at line 231. The entire critical section has **no try/except**. If `_sync_sales_short_close()` raises (lines 186-195) or anything else fails between the carry-flush and commit, the session rolls back and **both** the short-close row and the carry-forward JC vanish, while the original JC remains in its prior incomplete state — with no audit record of the attempted operation (audit emission at line 234-253 is after commit and is best-effort anyway).
- **Fix sketch:** Wrap the section in an explicit transaction; on exception, log and re-raise so the API caller gets a clear failure. Emit a "short_close_failed" audit event before re-raise so forensics can recover intent.

---

### P1 — High

#### P1.1 Short-close has no idempotency guard
- **Area:** Short-close + carry-forward
- **Evidence:** `production-service/src/routers/operations.py:128-163`; `models.py:510-537` (no unique constraint on `JobCardShortClose`).
- **Description:** No `if job.status == "COMPLETED": raise 409` check. A second POST creates a duplicate `JobCardShortClose` row and, for `CARRY_FORWARD`, a duplicate top-up JC. Frontend filter is client-side only.
- **Fix:** Reject if `job.status == "COMPLETED"` or if a `JobCardShortClose` row already exists for this `job_card_id`; consider a unique index.

#### P1.2 StockTransaction lacks `effective_date` — ledger ignores `actual_end`
- **Area:** Backdating + books-guard
- **Evidence:** `inventory-service/src/models.py:178-207` (StockTransaction has only `created_at`); `production-service/src/routers/planning.py:1513-1530` (FG inward payload omits `actual_end`); `inventory-service/src/utils/stock_calc.py:176` uses `txn.created_at.isoformat()`.
- **Description:** The claim that "downstream ledger postings stamp `effective_date = actual_end.date()`" is **false**. Backdated stage entries pass books-guard but their inventory postings always stamp at server `now()`. Monthly close math will not match operational reality.
- **Fix:** Add `effective_date Date` column to `StockTransaction`; thread `actual_end` through the FG-inward payload; use `effective_date` in ledger queries and reports. Alternatively, retract the claim.

#### P1.3 Downtime PUT silently accepts `ended_at < started_at`
- **Area:** Machine downtime
- **Evidence:** `production-service/src/routers/operations.py:463-466`.
- **Description:** PUT assigns `ended_at` unconditionally, then only computes `duration_minutes` if `ended_at >= started_at`. No 422 raised. POST validates this; PUT does not.
- **Fix:** Mirror the POST check: `if payload.ended_at and row.started_at and payload.ended_at < row.started_at: raise HTTPException(422, ...)`.

#### P1.4 Books-guard error payload wrapped as `{detail: {...}}` — frontend renders `[object Object]`
- **Area:** Broader / system-wide
- **Evidence:** `apps/bff-api/src/services/books_guard.py:242-256`; `apps/web-ui/app/(dashboard)/operations/control/page.tsx:113` does `err?.response?.data?.detail` expecting a string.
- **Description:** FastAPI default exception handler wraps the dict, the middleware in `apps/bff-api/src/main.py:44-60` only unwraps `plant_guard`, and the UI displays a stringified object. The honesty signal is invisible to the user.
- **Fix:** Either extend the BFF middleware to unwrap books-guard exceptions or update the UI to read `data.detail.code` / `data.detail.message`.

#### P1.5 Customer & Supplier UPDATE endpoints emit no audit
- **Area:** Audit coverage uplift
- **Evidence:** `masterdata-service/src/routers/customer.py:319-350`; `supplier.py:201-264`.
- **Description:** POST and DELETE emit; PUT does not. Material master mutations bypass the audit trail.
- **Fix:** Add `emit_audit_event(..., action="customer_updated"/"supplier_updated", ...)` after `db.commit()` with diff payload.

#### P1.6 All contact CRUD (customer + supplier) is unaudited
- **Area:** Audit coverage uplift
- **Evidence:** `customer.py:408-526`; `supplier.py:322-445`.
- **Description:** Six endpoints (create/update/delete × 2) have zero audit calls.
- **Fix:** Wire `emit_audit_event` with entity_type `customer_contact` / `supplier_contact`.

#### P1.7 All twelve shop-floor master mutations are unaudited
- **Area:** Audit coverage uplift
- **Evidence:** `masterdata-service/src/routers/shop_floor.py` lines 126, 164, 199, 287, 324, 357, 430, 465, 496, 584, 624, 667.
- **Description:** Despite the "cockpit-grade masters" claim, none of the Employee/Shift/Holiday/ReasonCode CRUD writes emit audit.
- **Fix:** Add `emit_audit_event` calls following the sales-service pattern.

#### P1.8 Inventory-service audit_client is dead code
- **Area:** Audit coverage uplift
- **Evidence:** `inventory-service/src/utils/audit_client.py` exists; `grep emit_audit_event` across `inventory-service/src/routers/*` returns zero hits.
- **Description:** FG inward, RM issue, dispatch, reel issues, purchase, item CRUD — none emit audit. Inventory is the second-largest mutable surface.
- **Fix:** Wire `emit_audit_event` into `fg_inward.py`, `reel_issues.py`, `dispatch.py`, `purchase.py`, `items.py` mutation handlers.

#### P1.9 Render cron + in-process scheduler both fire owner-pack — no coordination
- **Area:** APScheduler
- **Evidence:** `hariom-erp/render.yaml:30-36` (Render cron at UTC 14:30) vs `analytics-service/src/scheduler.py:29` (default 06:30 IST).
- **Description:** Neither environment sets `SCHEDULER_ENABLED=false`, so the same owner-pack ships twice per day — once at IST 20:00 from Render's cron service, once at IST 06:30 from in-process APScheduler. Customers receive duplicate emails.
- **Fix:** Pick one path. Set `SCHEDULER_ENABLED=false` on the web service in `render.yaml`, OR remove the Render cron and rely on in-process. Document the chosen path in the scheduler module docstring.

#### P1.10 Carry-forward JC orphaned from release-lot
- **Area:** Cross-cutting / short-close
- **Evidence:** `production-service/src/routers/operations.py:199-225`; `sales-service/src/routers/sales_orders.py:880-892`.
- **Description:** CARRY_FORWARD reduces the SO line qty AND creates a top-up JC pointing at the same `sales_order_line_id`. The new JC inherits `release_lot_id` from the original (line 209), but no new release-lot is created for the gap qty. Two JCs now point at a line whose qty has shrunk — release-lot tracking becomes inconsistent.
- **Fix:** After creating the carry-forward JC, POST back to sales-service to allocate a new release-lot for `gap_qty` and stamp the new lot on the carry JC.

#### P1.11 Late-entry / shift-attribution gaps on stage entry form
- **Area:** Cross-cutting
- **Evidence:** `apps/web-ui/components/production/JobCardDocument.tsx` lines 1179-1191 (only assignment warning), 1252-1265 (simple datetime input); `SYSTEM_REVIEW.md:106` promised >6h late-entry inline warning.
- **Description:** Late-entry warning was promised, never built. `JobCardStage.shift_code` is nullable, `StageOutputPayload` doesn't even include `shift_code`, the entry form has no shift picker. Shift-level KPIs (adherence, night premium) cannot be reliably computed.
- **Fix:** Add `shift_code` to `StageOutputPayload`; pre-fill from `currentUser.employee.default_shift`; require for WINDER/PROCESS stages; show NoteCallout if `now - actual_end > 6h`.

---

### P2 — Medium

#### P2.1 Shift time format unvalidated
- `masterdata-service/src/routers/shop_floor.py:230-231, 309-310` — `start_time`/`end_time` are bare `str` with only a "HH:MM" doc comment. `"25:00"` and `"abc"` accepted. Fix: add Pydantic `Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")`.

#### P2.2 Short-close `reason_code` not validated against ReasonCode master
- `production-service/src/routers/operations.py:135-140`. Backend accepts any non-empty string; UI filters to `SHORT_CLOSE` category client-side only. Same applies to `MachineDowntime.reason_code` (`operations.py:376-378`) and the schema columns (`models.py:529, 551` — String(40) with no FK). Fix: query masterdata or local mirror, enforce category match.

#### P2.3 Gap-calc passes when `produced_qty == 0`
- `production-service/src/routers/operations.py:159-163`; `ShortClosePayload` validates `ge=0`. Zero-production short-closes spawn a carry-forward for the entire planned qty with no special flagging.

#### P2.4 No UI to end ONGOING downtime events
- `apps/web-ui/app/(dashboard)/operations/control/page.tsx:247-276`; `useUpdateDowntime` exists in `use-production.ts:573-579` but unused. Users re-submit the form.

#### P2.5 No future-start guard on downtime POST
- `production-service/src/routers/operations.py:369-383`. `started_at = "2099-01-01"` accepted.

#### P2.6 Books-guard accepts future-dated stage entries
- `apps/bff-api/src/services/books_guard.py:242-252` only checks `candidate_date <= locked_through`. End-time set 2 weeks ahead passes silently.

#### P2.7 p90 formula floors instead of ceilings
- `production-service/src/routers/operations.py:582` — `int(len(minutes) * 0.9) - 1`. Returns wrong index for n=5, 11, 12, 15, etc. Fix: `math.ceil(len(minutes) * 0.9) - 1`.

#### P2.8 In-process scheduler state lost on restart
- `analytics-service/src/scheduler.py:38, 143-144`. `_job_status` is an in-memory dict. UI shows `—` after every redeploy.

#### P2.9 `/scheduler/status` endpoint has no auth
- `analytics-service/src/main.py:124-127`. BFF requires token (`apps/bff-api/src/routes/analytics.py:161`) but direct backend calls bypass it. Leaks cron timings and error messages.

#### P2.10 `actor_role` inconsistently passed in audit calls
- Sales-service stamps it; `customer.py` and `supplier.py` create/deactivate omit it. Role-based filtering of audit timeline breaks for master mutations.

#### P2.11 Inventory mutations (FG inward, dispatch, issue, reels) unaudited
- Duplicate of P1.8 from the broader-codebase angle. Listed again because operationally these are the most material write paths.

#### P2.12 Carry-forward top-up JCs not flagged on planner board
- `production-service/src/routers/planning.py:3726-3773` doesn't join `JobCardShortClose`. Planners can't tell a top-up apart from a fresh JC. `QueueJobCardItem` schema has no carry-forward context field.

#### P2.13 Downtime audit only on create, not on update
- `production-service/src/routers/operations.py:420-438` vs `443-469`. Closing an ONGOING event is unaudited.

#### P2.14 Downtime doesn't suggest reschedule of affected JCs
- `affected_job_card_ids` is stored as JSONB but never used. `SYSTEM_REVIEW.md:86` promised reschedule prompt; not built.

#### P2.15 Data-entry-lag is diagnostic-only
- KPI surfaces on `/reports/operations` but the entry form (`JobCardDocument.tsx`) has no inline warning, defeating preventive intent.

#### P2.16 Operator FK never migrated
- `production-service/src/models.py:41` — `ProductionJob.operator_name` still String(100); Employee master exists but isn't referenced. Shift / skill linkage impossible.

#### P2.17 Backdating guard not on short-close (work-date scenario)
- BFF `/operations/short-close` doesn't invoke `assert_not_backdated`. *Note: a related claim was refuted because `ShortClosePayload` has no date field today, but if `work_date` is ever introduced this guard must come with it.*

---

### P3 — Low

- **P3.1 List endpoints default `include_inactive=True`** — `shop_floor.py:113-120, 274-283, 567-580`. Backwards convention; UI compensates.
- **P3.2 HOLD short-close decision has no follow-up tracking** — `operations.py:170-232`. Original JC marked COMPLETED, no revisit mechanism.
- **P3.3 Audit-event `action` string mixes case** — `operations.py:234-253` emits `short_close_carry_forward` while `JobCardShortClose.decision` stores `CARRY_FORWARD`.
- **P3.4 Audit emission is silently swallowed** — `operations.py:252-253`. Intentional, but worth a `logger.warning` instead of bare `pass`.
- **P3.5 SHORT_CLOSE_SO sync to sales-service has no retry/circuit breaker** — `operations.py:67-98`. Acceptable fail-safe but should be noted.
- **P3.6 Downtime table has no action column** — `control/page.tsx:261-269`. Compare with short-closes table.
- **P3.7 Audit-call count claim was "7", actual is 8** — minor accounting error.
- **P3.8 9 report pages still on legacy `ReportDetailPage` shell** — visual inconsistency with `/reports/operations`.
- **P3.9 Carry-forward JC `current_stage` hardcoded to `WINDER`** — `operations.py:205-225`. Breaks for routings that skip WINDER.
- **P3.10 PlantHoliday master unused in OTIF/adherence math** — CRUD-only.
- **P3.11 Employee `skills` is CSV text** — no normalization, no Skill master.
- **P3.12 Short-close operates at JobCard level only** — segments ignored; may be intentional.

---

## 4. Refuted claims

| Original finding | Why refuted |
|---|---|
| "Backdating NOT guarded on short-close" (originally P1) | `ShortClosePayload` has no date field; `JobCardShortClose.created_at = utcnow()` is server-immutable. Backdating is structurally impossible today. Demoted to POLISH (still relevant if a `work_date` field is added later — see P2.17). |
| "Multi-replica scheduler duplicate-fire" (originally P1) | The owner-pack delivery is actually fired by a separate Render cron service (`render.yaml:30-36`), which has platform-level de-duplication. The in-process scheduler does still duplicate `exceptions_check_hourly` per replica, but that job is a `/health` heartbeat with no side effects. Reclassified NOT_A_BUG for the owner-pack concern. The orthogonal P1.9 (Render cron + in-process both firing owner-pack) remains valid because nothing currently disables one path. |

---

## 5. Cross-cutting + flow gaps

Beyond per-area findings, several end-to-end flows have visible breaks:

1. **Short-close → release-lot → SO line consistency is broken on CARRY_FORWARD.** Original JC reduces SO line, carry-forward JC inherits the same `release_lot_id` whose qty no longer matches. Planner sees two JCs against a shrunken line. Fix requires a sales-service callback to create a new release-lot for the gap.

2. **Ledger honesty contradicts itself.** Stage-output is books-guarded against backdating, but the inventory ledger that books-guard is supposed to protect doesn't honor `actual_end` anyway — `StockTransaction.created_at` is always server `now()`. So a stage entry from yesterday that passes the guard still books to today's inventory period. The honesty claim and the ledger reality don't match.

3. **Audit timeline is a patchwork.** Sales is well-covered, masterdata partially (create+deactivate only), inventory and shop-floor masters entirely absent. Anyone querying the audit timeline for "all writes to customer X" will get an incomplete picture (no PUT events, no contact events).

4. **Data-entry-lag is reactive, not preventive.** The KPI exists on the operations report, but the entry form has no UI to discourage late entries. The metric tells you about damage already done.

5. **Carry-forward JCs are invisible to planners.** Top-up JCs from short-close appear on the board with no parent linkage, no gap context, hardcoded `WINDER` stage. The genealogy chain (original → carry-forward) exists in `JobCardShortClose.carry_forward_job_card_id` but isn't queried by the board.

6. **Downtime events don't propagate to scheduling.** `affected_job_card_ids` is stored as JSON but never read; machines down 09:00-13:00 still show jobs scheduled on them at 10:00.

7. **Books-guard rejection is invisible at the UI.** Even when the guard fires correctly, the error renders as `[object Object]` because of the `{detail: {...}}` wrapping. The "loud honesty" signal is silent.

8. **Shop-floor masters exist but aren't consulted by downstream code.** PlantHoliday isn't used in adherence math; Employee isn't linked to `operator_name`; ShiftDefinition isn't used to infer `shift_code` on stage entries; ReasonCode isn't FK-enforced. The masters are present-but-disconnected.

---

## 6. What was NOT inspected

This audit was static code inspection plus adversarial code-level verification. The following were **not** performed:

- **No runtime exercise.** No service was started; no DB transaction was executed; no API was actually hit. Bugs that only appear under concurrency (the P0 transaction race) are inferred from code structure, not observed.
- **No integration tests run.** Pytest / Vitest / Playwright suites were not executed. Coverage levels not measured.
- **No migration scripts reviewed.** Alembic / SQL migrations for new columns (e.g., the missing `StockTransaction.effective_date`) were not checked for presence or correctness.
- **No load / soak testing.** Scheduler behavior under multi-replica deployment is reasoned from `render.yaml`, not observed in production.
- **No browser DOM verification.** UI claims were verified from JSX/TSX source; actual rendered output and accessibility were not screenshot-validated.
- **No security review of auth / token handling beyond `/scheduler/status`.** Other unauthenticated endpoints may exist; only the scheduler endpoint was specifically checked.
- **No review of the audit-service consumer** (`/audit-events/` receiver). We verified emitters; we did not verify the timeline actually persists and renders these events correctly.
- **No analysis of historical data.** The claim that backdated entries don't reach inventory was verified by code path; we did not query the database to find existing inconsistent rows.

---

## 7. Recommended next 7-day punch list

Ordered by leverage (impact ÷ effort). Each is scoped to land in a single PR.

1. **(Day 1) Fix the P0 transaction-safety hole in short-close.** Wrap `production-service/src/routers/operations.py:170-232` in a single explicit transaction with try/except; emit a `short_close_failed` audit event on rollback. Add a regression test that forces `_sync_sales_short_close` to raise. ~4 hours.

2. **(Day 1) Fix books-guard error-shape unwrapping.** Either extend the BFF middleware at `apps/bff-api/src/main.py:44-60` to unwrap `BOOKS_LOCKED` like `plant_guard`, or update `apps/web-ui/app/(dashboard)/operations/control/page.tsx:113` and any sibling consumers to read `data.detail.code`/`message`. ~2 hours. This is the loudest user-visible bug — guard fires, user sees `[object Object]`.

3. **(Day 2) Add idempotency + reason-code validation to short-close.** Reject if `job.status == "COMPLETED"` or if a `JobCardShortClose` row already exists; validate `reason_code` against masterdata `ReasonCode` with category check. Same handler covers both. ~3 hours. Also apply reason-code validation to downtime POST.

4. **(Day 2) Disable one of the two owner-pack schedulers.** In `render.yaml`, set `SCHEDULER_ENABLED=false` on the analytics web service env (recommended — keep the Render cron as the canonical path). Document in `scheduler.py` module docstring. ~30 minutes. Prevents duplicate customer emails.

5. **(Day 3) Add `effective_date` to StockTransaction OR retract the claim.** This is the single largest honesty discrepancy. Option A (correct): add `effective_date Date` column to `inventory-service/src/models.py`, thread `actual_end` through `planning.py:1513-1530`'s FG-inward payload, update `stock_calc.py:176` to prefer `effective_date`. Option B (honest): update SYSTEM_REVIEW.md to remove the claim and acknowledge ledger uses server time. ~1 day for option A.

6. **(Day 4) Close the audit-coverage gaps in customer/supplier PUT, contact CRUD, and shop-floor masters.** Mechanical — follow the sales-service pattern. Group into one PR per service. ~1 day total. While at it, fix the `actor_role` consistency.

7. **(Day 5) Wire inventory-service audit emitters.** The `audit_client.py` is already there; add `emit_audit_event` to `fg_inward.py`, `reel_issues.py`, `dispatch.py`, `purchase.py`, `items.py` mutation handlers. ~1 day.

8. **(Day 6) Fix downtime PUT temporal validation + add ONGOING-close UI.** Mirror the POST guard in `operations.py:463-466`; add an inline action button on ONGOING rows in `control/page.tsx:247-276` that calls the existing `useUpdateDowntime` hook. ~4 hours.

**Deferred to week 2 (worth doing, but not punch-list scope):** carry-forward release-lot re-allocation (P1.10), late-entry warning + shift-picker on entry form (P1.11), p90 percentile formula (P2.7), shift time-format regex (P2.1), `/scheduler/status` auth (P2.9), planner-board carry-forward flagging (P2.12), Operator FK migration (P2.16).

---

*End of report. Counts: 1 P0 + 11 P1 + 17 P2 + 12 P3 confirmed; 2 refuted. Most-load-bearing fix is the StockTransaction `effective_date` work — it determines whether the "honesty" thesis is actually true.*
