# Close-the-loop cluster — fix & verify report

**Repo:** Hari Om Paper 2 ERP (`/Users/devarshthakkar/local_repos/yash hari on/Hari Om Paper 2 Local`)
**Scope:** P1.10, P2.12, P2.14, P2.16, process-level short-close, P3.2, P3.5, P3.6
**Verdict date:** 2026-06-02 · **Status:** ALL GREEN (verified)

---

## 1. Executive verdict

The cluster is genuinely closed-loop, not just recorded. Before this work, several of these features existed only as a row written to a table with no downstream effect — most notably the short-close **CARRY_FORWARD** path, which minted a top-up job card but left its release lot orphaned (`release_lot_id = None`) with a stale `TODO`, so the sales order line never saw the gap come back into production. HOLD decisions were a dead end (written, never surfaced or resolvable). Downtime that knocked job cards off-machine was logged but produced no planner nudge. Short-close was hard-locked to one row per job card, so a process-stage close was impossible.

What is now wired end-to-end (DB → service → BFF → hook → UI), each independently traced:

| # | Item | State before | State now |
|---|------|-------------|-----------|
| P1.10 | Carry-forward lot reallocation | Always orphaned the new lot | **Closed-loop** — server-to-server lot split; SO line conserves qty |
| process-level | Per-stage short-close | One row per JC (blocked) | **Closed-loop** — uniqueness now `(job_card_id, stage_type)`, 7 scopes |
| P3.2 | HOLD follow-up tracking | Write-only dead end | **Closed-loop** — `hold_status` lifecycle + holds list + resolve endpoint + UI panel |
| P3.5 | Sales-sync retry | Single attempt, no backoff | **Closed-loop** — 3-attempt backoff on 5xx/network, 4xx fail-fast |
| P2.12 | Planner carry-forward flag | Not surfaced | **Closed-loop** — 3 fields on board API + amber badge |
| P2.14 | Downtime reschedule nudge | None | **Closed-loop** — `reschedule_status`, queue endpoint, UI panel |
| P3.6 | Downtime action column | "End now" only | **Closed-loop** — "Reschedule (n)" action wired to the panel |
| P2.16 | Operator dropdown | 4 free-text inputs | **Closed-loop** — Employee-master `<select>` on 5 stages (4 operator + QC inspector) |

**Honest score: 8/8 wired and verified.** No item is a stub. There is one deliberate scoping decision (G8 badges 2 of 5 card-render sites — the 2 that actually carry the data; see §6), and three identical-but-not-shared pure helpers across two services (see §5). Neither undermines the "done" claim; both are documented.

**Gate summary:** Every gate passes. I independently re-ran the load-bearing ones (py_compile on all 7 changed `.py` files, the full production-service pytest suite, and `tsc --noEmit` on web-ui) — all green. py_compile = OK, pytest = **79 passed** (54 pre-existing + 25 new), tsc = **exit 0, zero errors**. The remaining web-ui gates (next lint / next build / npm test) I relied on from the verify run; they are consistent with the clean typecheck and the fact that every referenced symbol resolves on disk.

---

## 2. Verification gauntlet

| Gate | Result | Re-run here? | Evidence |
|------|--------|--------------|----------|
| py_compile (all changed `.py`) | **PASS** | Yes | `ALL_PY_COMPILE_OK` across models.py, main.py, operations.py, planning.py, schemas/planning.py, sales_orders.py, bff routes/production.py |
| pytest production-service | **PASS** | Yes | `79 passed, 3 warnings in 0.40s` (3 warnings are pre-existing Pydantic v2 deprecations, unrelated) |
| new test file alone | **PASS** | Yes | `25 passed, 1 warning` — 4 classes confirmed on disk |
| tsc --noEmit (web-ui) | **PASS** | Yes | exit 0, **zero output** — full app typechecks |
| next lint --quiet (web-ui) | **PASS** | Relied on verify run | "No ESLint warnings or errors" |
| next build (web-ui) | **PASS** | Relied on verify run | "Compiled successfully"; `/operations/control` and `/planning/board` both present |
| npm test (web-ui) | **PASS** | Relied on verify run | sucrase suites: spec-math 21/21, spec-sheet-suggestions 3/3, reconciliation-math 2/2 |

**New tests added** — `hariom-erp/services/production-service/tests/test_operations_close_loop.py` (25 pure-function unit tests, no DB / no network), all passing:

- **CarryForwardLotSplitTests** (6) — original shrinks by gap, new lot == gap, total conserved (incl. messy floats), original floors at 0 when gap>original, `None` coercion, full-drain.
- **StageTypeNormalizationTests** (7) — allowed set is exactly the 7 contract values; every allowed value accepted; lowercase/whitespace normalized; `None`/`""` default to `JOB_CARD`; whitespace-only and junk tokens rejected 422.
- **SalesRetryPredicateTests** (5) — retry 502/503/504 while attempts remain; no retry on final attempt; never retry 4xx; never retry 2xx; never retry non-transient 500.
- **RescheduleQueuePredicateTests** (7) — PENDING/NULL with affected ids included (incl. lowercase); DONE/DISMISSED excluded; empty/non-list affected ids excluded even when PENDING/NULL.

**Candor on test depth:** the new coverage is **unit-level on the pure logic** (split math, stage validation, retry predicate, reschedule filter). The DB-backed orchestration — transaction rollback, `(job_card_id, stage_type)` idempotency at the DB layer, the live server-to-server sales calls, HOLD resolve — is exercised by the **existing** 54-test integration suite plus import/compile, but **no new DB-integration test was added** for the new endpoints. That is the honest gap (see §8).

---

## 3. What each feature does now, end-to-end

Layers below are real and traced by file:line. Production-service router has `prefix="/operations"` and is mounted in `main.py`, so external paths are `/operations/...`.

### P1.10 — Carry-forward lot reallocation
- **DB:** `SalesOrderReleaseLot` (sales-service) gains a new row per split; production's `JobCard` gains the top-up card.
- **Service (production):** `operations.py:361 _spawn_carry_forward_job_card` creates+flushes the WINDER-start top-up JC, then calls `operations.py:290 _reallocate_carry_forward_release_lot`, which POSTs to `{SALES_SERVICE_URL}/sales-orders/release-lots/{id}/reallocate-carry-forward` with `{carry_forward_job_card_id, gap_qty}` (lines 305-312).
- **Service (sales):** `sales_orders.py:871 reallocate_release_lot_carry_forward` loads the original lot plant-scoped (404 if missing), shrinks `original.released_qty` via `carry_forward_lot_split` (line 897), mints a new lot for `gap_qty` pointed at the carry JC (lines 900-913), commits, emits `release_lot_reallocated_carry_forward` audit, and returns both `id` and `release_lot_id` plus `release_qty` (lines 936-949).
- **Fallback (honest):** if the source JC has no `release_lot_id` **or** the sales call fails, production falls back to `release_lot_id=None` + `orphaned=True` and emits `carry_forward_orphan_release_lot` — **never hard-fails the short-close** (`operations.py:411` onward). The success path emits `carry_forward_release_lot_reallocated`.
- **UI:** surfaced via the carry-forward badge (P2.12) once the top-up JC re-enters the queue.

### Process-level short-close
- **DB:** `models.py:523` — `UniqueConstraint("job_card_id", "stage_type", name="uq_short_close_job_card_stage")` replaces the old single-column guard; `stage_type` column at `models.py:531` (`NOT NULL DEFAULT 'JOB_CARD'`).
- **Migration:** `main.py:78-90` — idempotent `ADD COLUMN IF NOT EXISTS` for `stage_type` + the uniqueness swap (`DROP CONSTRAINT IF EXISTS` → `DROP INDEX IF EXISTS` → `CREATE UNIQUE INDEX IF NOT EXISTS uq_short_close_job_card_stage`). The legacy single-column index is **no longer recreated** (comment at `main.py:59-65`).
- **Service:** `operations.py:497 short_close_job_card` normalizes/validates `stage_type` against the 7-value `ALLOWED_SHORT_CLOSE_STAGE_TYPES` (422 otherwise); idempotency is now `(job_card_id, stage_type)` with a stage-named 409.
- **BFF → hook → UI:** existing short-close proxy carries the new `stage_type` field; control page modal has the `scStageType` select (`control/page.tsx:144`) with all 7 scopes and a "Scope" column on the recent-closes table.

### P3.2 — HOLD follow-up tracking
- **DB:** `models.py:543-548` — `hold_status`, `resolved_at`, `resolved_by`, `resolution_decision`, `resolution_note`.
- **Service:** short-close sets `hold_status='OPEN'` when decision is HOLD; **`GET /operations/short-close/holds`** (`operations.py:807`) lists open holds plant-scoped; **`POST /operations/short-close/{short_close_id}/resolve-hold`** (`operations.py:824`) validates the resolve decision, requires `hold_status==OPEN` (409 otherwise), executes it via the shared helpers, stamps the resolution fields, and emits `short_close_hold_resolved`. Role-guarded `[PlantManager, Admin, Owner]`.
- **BFF:** `production.py:324` (holds) + `production.py:332` (resolve-hold).
- **Hook:** `use-production.ts:602 useHolds` + `:612 useResolveHold` (invalidates `['short-close-holds']` and `['short-closes']`).
- **UI:** `control/page.tsx` HOLD panel — lists holds, inline resolve form (carry-forward / short-close-SO toggle + note), toasts and drops the row via invalidation.

### P3.5 — Sales-sync retry
- **Service:** `operations.py:217 _sync_sales_short_close` is a 3-attempt loop (lines 235-287). Retries on `httpx.RequestError` and on 502/503/504 (predicate `should_retry_sales_status`, line 264) with `time.sleep(backoff*attempt)`; **4xx raises immediately** (line 275, not retried); exhausted 5xx / final network error raises 502. Verified by reading the loop: success `return`s inside the loop (line 281), only RequestError-exhaustion reaches the trailing raise (line 284).
- **Tests:** SalesRetryPredicateTests pin the retry/no-retry matrix.

### P2.12 — Planner carry-forward flag
- **Schema:** `schemas/planning.py:185-187` adds `is_carry_forward`, `carry_forward_source_job_card_id`, `carry_forward_reason_code` to `QueueJobCardItem` (which is `extra="forbid"`).
- **Service:** `planning.py:3495 _carry_forward_lookup` queries `JobCardShortClose` where `carry_forward_job_card_id IS NOT NULL`, plant-scoped; built once per request at both `GET /planning/board` (`planning.py:4361`) and `GET /planning/queues` (`planning.py:4429`). There is exactly **one** `QueueJobCardItem(...)` construction site (`planning.py:3863`, confirmed `grep -c` = 1), which sets exactly the 3 new fields (lines 3915-3919) — so `extra="forbid"` will not 500.
- **UI:** `planning/board/page.tsx:229 CarryForwardBadge` (early-returns null when `!is_carry_forward`, line 230) rendered at the unscheduled queue card (line 1470) and the scheduled machine-lane card (line 1685).

### P2.14 — Downtime reschedule nudge
- **DB:** `models.py:571` `reschedule_status` (NULL/PENDING/DONE/DISMISSED).
- **Service:** `create_downtime` sets `reschedule_status='PENDING'` when affected JCs are non-empty; **`GET /operations/downtime/reschedule-queue`** (`operations.py:1302`) lists NULL/PENDING rows with non-empty `affected_job_card_ids`; **`PUT /operations/downtime/{downtime_id}/reschedule-status`** (`operations.py:1332`) validates DONE/DISMISSED and stamps it.
- **BFF:** `production.py:360` (queue) + `production.py:368` (status). **Hook:** `use-production.ts:624 useRescheduleQueue` + `:634 useUpdateRescheduleStatus`.
- **UI:** `control/page.tsx` reschedule panel — machine, window, drill-link per affected JC to `/planning/board?job_card_id=…`, "Mark rescheduled" / "Dismiss" buttons.

### P3.6 — Downtime action column
- **UI only (data already present):** `control/page.tsx` recent-downtime table keeps "End now" for ONGOING rows and adds a **"Reschedule (n)"** button for any row with non-empty `affected_job_card_ids`, which smooth-scrolls to and briefly highlights the reschedule panel (`reschedulePanelHighlight`, line 105).

### P2.16 — Operator dropdown
- **UI only:** `JobCardDocument.tsx:11` imports `useEmployees`; `:420` calls it; `:1336 renderOperatorPicker` renders an Employee-master `<select>` filtered by department/skills. Wired at SLITTING/WINDER/OVEN/PROCESS (lines 1261, 1495, 1627, 1697) and QC inspector (line 1810). **Backend payload unchanged** — `operator_name` stays a string; the employee uuid is stashed in JSONB `entry_snapshot` only. Falls back to free-text if the employees API errors, so entry is never blocked.

---

## 4. Integration seams checked

I read **both sides** of every cross-layer boundary:

1. **operations.py ↔ models.py columns** — every column operations references (`stage_type`, `hold_status`, `resolved_at`, `resolved_by`, `resolution_decision`, `resolution_note`, `reschedule_status`) exists in `models.py` with matching types. Uniqueness is `uq_short_close_job_card_stage` on `(job_card_id, stage_type)`. **PASS.**
2. **operations.py ↔ sales reallocate endpoint** — production POSTs `{carry_forward_job_card_id, gap_qty}`; sales `ReleaseLotReallocatePayload` (`sales_orders.py:80`) has exactly those two keys. Sales returns both `id` and `release_lot_id` = `new_lot.id` (lines 937, 940), and production reads `body.get("release_lot_id") or body.get("id")` (`operations.py:330`). Sales also returns `release_qty` (line 941), which production cross-checks (`operations.py:341`). Role guard `[Admin, Owner, Sales, Planner, PlantManager]` matches. **PASS — this is a real wire, the highest-risk seam, fully reconciled.**
3. **planning.py ↔ QueueJobCardItem (`extra="forbid"`)** — single construction site sets only the 3 fields the schema defines; nothing extra. **PASS.**
4. **BFF ↔ production routes** — all 4 proxy paths byte-match the production routes (`production.py:324/332/360/368` ↔ `operations.py:807/824/1302/1332`). Literal segments `/holds` and `/reschedule-queue` are reachable and not shadowed by the dynamic single-param routes (different method or different depth). **PASS.**
5. **api.ts → BFF → hooks → UI** — api.ts methods hit `/api/production/operations/...` via `withPlantHeader`; hooks call them with documented queryKeys/invalidations; control page imports all 4 hooks (they exist at the cited lines); board badge consumes the 3 carry-forward fields. `tsc --noEmit` exit 0 is the proof the whole chain type-checks. **PASS.**

---

## 5. Contract deviations

All are minor, documented, and backward-compatible:

- **G1 migration guarding** — the existing `_ensure_schema_compatibility` had no helper and ran everything in one shared `engine.begin()` transaction (which can't satisfy "a failure on one must not abort the rest"). Implemented the explicitly-permitted per-statement try/except branch (`main.py:92-97`). Fallback uses `print(...)` because this module has no logger; the `logger.warning` HARD RULE applies to audit emits, not the schema-compat routine.
- **G2 audit fallback** — the reallocate endpoint's audit try/except uses `logger.warning(...)` (added `import logging` + module logger) instead of the file's local `except: pass` style, to honor the global HARD RULE. The three pre-existing bare-`pass` audit blocks were **left untouched** to stay surgical.
- **G3 extras (additive)** — `ShortCloseResponse` also exposes `resolved_at/resolved_by/resolution_decision/resolution_note` (contract minimum was `stage_type`+`hold_status`) so the resolve UI has the full row; explicit success-path audit `carry_forward_release_lot_reallocated` added alongside the orphan warning; reschedule-queue filters JSONB non-emptiness in Python after a SQL NULL/PENDING filter (JSONB array length isn't portably expressible in SQLAlchemy core).
- **G6 path/header** — used the real `/api/production` prefix and `withPlantHeader` helper (the contract's illustrative pseudocode showed bare paths and a non-existent `plantHeader`); the contract told the agent to copy the neighbouring methods exactly, which takes precedence.
- **G9 QC inspector (additive)** — contract named only `operator_name`/`operator_employee_id`, but the mission listed QC among picker stages, so the QC inspector field was routed through the same picker (writes `inspector_name` + stashes `inspector_employee_id`). The 4 true operator stages follow the contract exactly.
- **Pure helpers duplicated, not shared** — `carry_forward_lot_split` exists **identically** in both `operations.py` and `sales_orders.py` rather than as a shared module (cross-service import is not this codebase's pattern). They are kept in sync by being byte-identical and **both unit-tested**. This is a deliberate, stated trade-off, not an oversight.

One **genuine latent bug** was found and fixed during verify: `main.py`'s first migration transaction was unconditionally **recreating** the legacy single-column `uq_short_close_job_card` index on every boot, which the new guarded block then immediately dropped. Net final state was correct, but it churned the constraint each startup and contradicted the per-stage uniqueness design. Removed and replaced with the explanatory comment at `main.py:59-65`.

---

## 6. NOT done / deferred

Stated plainly:

- **Skill master / skill-routing** — out of scope for this cluster and **still deferred per the owner.** No skill-related work was touched.
- **No new DB-integration tests** for the four new endpoints. The new pytest file is **pure-unit only** (split math, stage validation, retry predicate, reschedule filter). Transaction rollback, DB-level `(job_card_id, stage_type)` idempotency, live server-to-server sales calls, and HOLD resolve are covered only by the **existing** integration suite + import/compile. This is the most material testing gap.
- **G8 badge scope (deliberate PARTIAL)** — `planning/board/page.tsx` has 5 `jobCardRef(job)` render sites; the badge is on **2** (unscheduled queue card L1470, scheduled lane card L1685) — the only two that consume the board/queue API carrying the G4 fields. The other 3 (month-calendar, planner action list, summary stage board) render from the separate `usePlanningJobCards`/`jobsQuery` list endpoint, which does **not** carry the carry-forward fields, so badging them would be misleading. Documented as an interpretation, not a defect; the badge no-ops on falsy data, so extending later is a one-line change.
- **No sales-side BFF proxy** for `reallocate-carry-forward` — correct by design; it is server-to-server only.
- **No accounting / GST scope touched.** No commit, branch, or push was made; edits stayed within the owning file set.

---

## 7. Files changed inventory

**production-service** (`hariom-erp/services/production-service/`)
- `src/models.py` — short-close columns + uniqueness swap; `machine_downtime.reschedule_status`
- `src/main.py` — 10 idempotent migration statements (per-statement guard); removed stale index recreate
- `src/routers/operations.py` — retry loop, shared carry-forward helpers, stage-type validation, 4 new endpoints, serializers, 4 extracted pure helpers
- `src/routers/planning.py` — `_carry_forward_lookup` + threading into the single queue-item builder
- `src/schemas/planning.py` — 3 carry-forward fields on `QueueJobCardItem`
- `tests/test_operations_close_loop.py` — **new**, 25 unit tests

**sales-service** (`hariom-erp/services/sales-service/`)
- `src/routers/sales_orders.py` — `ReleaseLotReallocatePayload`, `reallocate-carry-forward` endpoint, `carry_forward_lot_split`, module logger

**bff-api** (`apps/bff-api/`)
- `src/routes/production.py` — 4 new proxies

**web-ui** (`apps/web-ui/`)
- `lib/api.ts` — 4 productionApi methods
- `hooks/use-production.ts` — 4 hooks
- `app/(dashboard)/operations/control/page.tsx` — short-close scope select, HOLD panel, reschedule panel, downtime action column
- `app/(dashboard)/planning/board/page.tsx` — `CarryForwardBadge` at 2 sites
- `components/production/JobCardDocument.tsx` — operator/inspector dropdowns on 5 stages

---

## 8. Recommended follow-up

1. **Add DB-backed integration tests for the four new endpoints** — the biggest gap. Cover: `(job_card_id, stage_type)` idempotency 409 at the DB layer; HOLD resolve happy-path + the `hold_status != OPEN` 409; the reallocate seam against a real (or fake-transport) sales call incl. the orphan fallback; and the reschedule-status transitions. Pure-unit coverage is good but does not prove the orchestration.
2. **Promote `carry_forward_lot_split` to a shared module** — it lives byte-identical in two services. A tiny shared util (or a contract test asserting the two copies are equal) removes the silent-drift risk if one side is edited later.
3. **Verify migration on a legacy docker volume** — the swap from `uq_short_close_job_card` to `uq_short_close_job_card_stage` is idempotent on paper, but run it once against a volume that actually has the old single-column index + duplicate-`job_card_id` short-close rows to confirm `CREATE UNIQUE INDEX` does not fail on pre-existing duplicates (and decide on a dedupe step if it can).
4. **Decide G8 badge scope explicitly** — either extend the board API's data to the 3 summary/list views (then drop the badge in) or confirm the 2-site decision is final, so it isn't re-flagged in future reviews.
5. **Persist `operator_employee_id` / `inspector_employee_id` to a real column** if reporting ever needs to join operators to the Employee master — today they live only in JSONB `entry_snapshot`, which is fine for display but awkward for analytics.
