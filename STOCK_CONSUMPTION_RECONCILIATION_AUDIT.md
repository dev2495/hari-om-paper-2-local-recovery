# Stock, Consumption & Reconciliation — Audit Report

_Hari Om Paper 2 ERP · Audit produced 2026-05-20_

## 0. Executive summary

The system **already implements your stated business model**:

> "We don't consume items as FG goes but as posted data, then on actual count confirm all fine and inventory closed and consumed."

This is exactly the architecture in code. **Three distinct consumption numbers** are tracked separately and reconciled at month-end:

| Stream | Source | Storage | When |
|---|---|---|---|
| **Ledger consumed** | `POST /api/inventory/issue` from production-issue page | `StockTransaction(ISSUE_PRODUCTION)` qty_change | Real-time as RM is issued to floor |
| **Theoretical** | Job-card BOM snapshot × produced/planned ratio × bamboo count | `MonthlyMaterialProvisional` rows | Computed daily/on-demand |
| **Reconciled actual** | Plant register imported by Stores | `MonthlyMaterialActual.actual_consumed_weight_kg` | Once per month at close |

**Two parallel state machines** govern lock-down:

```
Stock Certification:    DRAFT ─► CERTIFIED ─► CARRIED_FORWARD
Monthly Reconciliation: OPEN  ─► DRAFT     ─► APPROVED (locked_at)
```

**FG posting does NOT auto-consume RM** — confirmed via `mes-finish` and `production-service`. Job-close calls `POST /fg-inward/` which creates a `StockTransaction(FG_INWARD)` (positive qty_change only). RM consumption is a **separate, posted, later-confirmed flow**. ✅

The flow is **architecturally sound** and **production-ready**. The gaps are not structural — they are **enforcement gates** (variance thresholds, mandatory reasons, daily-vs-monthly cross-check) and **UX bridges** (cert and reco are parallel; should be linked).

---

## 1. Current status — what works

### 1.1 Production Reconciliation (`/production/reconciliation`)

| Aspect | Status | Evidence |
|---|---|---|
| Page wired end-to-end | ✅ | `apps/web-ui/app/(dashboard)/production/reconciliation/page.tsx` (593 lines) |
| Side-by-side theoretical vs actual table | ✅ | Lines 482-487 of page; rows from `monthly-material-summary` |
| Variance calc | ✅ | `variance_kg = actual - theoretical`, `variance_percent`, `variance_cost` |
| Period-close button | ✅ | `approveMonthlyClose({ month, notes })` → sets `status=APPROVED, locked_at=now()` |
| Close history (last 12 months) | ✅ | `monthly-close-history` endpoint |
| State machine | ✅ | `OPEN → DRAFT → APPROVED`. Re-import blocked after APPROVED (router line 1041) |
| Sidebar entry | ✅ | `/production/reconciliation` under Operations, roles Owner/Admin/PlantManager |
| Theory formula bridge | ✅ | Interactive paper/adhesive/parchment/moisture calculator (lines 316-351) |

**Endpoints (BFF → production-service):**
- `GET /api/production/monthly-material-summary` → `/reconciliation/monthly-summary`
- `GET /api/production/monthly-close-state` → `/reconciliation/monthly-close`
- `GET /api/production/monthly-close-history` → `/reconciliation/monthly-close/history`
- `POST /api/production/import-monthly-actuals` → `/reconciliation/monthly-actuals/import`
- `POST /api/production/approve-monthly-close` → `/reconciliation/monthly-close/approve`

### 1.2 Stock Lifecycle (`/inventory/stock-control`)

| Aspect | Status | Evidence |
|---|---|---|
| Opening load posting | ✅ | `InventoryOpeningLoad` + lines; creates `PaperReel` (REEL) or `StockBatch + StockTransaction(OPENING)` (BULK) |
| Daily statement | ✅ | `useInventoryStockStatement({ start_date, end_date })` — opening + in + out + adj + closing per item |
| Draft certification | ✅ | Auto-hydrates from statement, pre-fills `physical_qty = closing_qty` |
| Physical-count edit | ✅ | Only when `status = DRAFT`; backend rejects PATCH otherwise (router line 485) |
| Variance computation | ✅ | `variance_qty = physical_qty - closing_qty`, `variance_value = variance_qty * unit_cost` |
| Certify (lock) | ✅ | Sets `status=CERTIFIED, certified_by, certified_at`; UI inputs disabled |
| Carry-forward (metadata, no double-posting) | ✅ | Creates `InventoryCarryForward` with `opening_qty = physical_qty` and `source_variance_qty`. NO new `StockTransaction` created |
| Carry-forward to next opening | ⚠️ | Carry-forward is a **proof document**, not an auto-ledger-posting. User must manually post opening load to seed next period (intentional but requires discipline) |
| Read-only lock after CERTIFIED | ✅ | Frontend `disabled={selectedCertification.status !== "DRAFT"}` + backend HTTP 400 guard |

**Endpoints:**
- `GET /api/inventory/stock-control/statement?start_date&end_date`
- `POST /api/inventory/stock-control/opening-loads` → `INVENTORY_OPENING_LOAD_POSTED`
- `POST /api/inventory/stock-control/certifications` → `INVENTORY_CERTIFICATION_DRAFTED`
- `PATCH /api/inventory/stock-control/certifications/{id}` (DRAFT only)
- `POST /api/inventory/stock-control/certifications/{id}/certify` → `INVENTORY_STOCK_CERTIFIED`
- `POST /api/inventory/stock-control/certifications/{id}/carry-forward` → `INVENTORY_CARRY_FORWARD_GENERATED`

**Models:**
- `InventoryCertificationLine.physical_qty` (nullable, defaults to `closing_qty`)
- `InventoryCertificationLine.variance_qty` = computed
- `InventoryCertificationLine.variance_value` = `variance_qty * unit_cost`
- `InventoryCarryForwardLine.opening_qty` = `physical_qty or closing_qty`
- `InventoryCarryForwardLine.source_variance_qty` = certification line variance

### 1.3 Consumption Flow

| Layer | Where | Status |
|---|---|---|
| **Daily issue** (RM → WIP) | `apps/web-ui/app/(dashboard)/inventory/production-issue/page.tsx` → `POST /api/inventory/issue` → `StockTransaction(ISSUE_PRODUCTION)` referencing `production_job_id` | ✅ Wired |
| **Reel issue** (parallel) | `apps/web-ui/app/(dashboard)/inventory/reels/issue/page.tsx` → `ReelScanEvent(ISSUE_SCAN)` | ✅ Wired |
| **Theoretical** | `_provisional_material_rows()` in `production-service/src/routers/reconciliation.py` → reads `job_card.material_plan_snapshot.bom_snapshot`, multiplies `paper_row.weight_kg × provisional_bamboo_count` | ✅ Wired |
| **Reconciled actual** | `MonthlyActualImportPayload.rows[]` via `/monthly-actuals/import` → `MonthlyMaterialActual.actual_consumed_weight_kg` | ✅ Wired |
| **FG creation** | `production-service/jobs.py` close-job calls `POST /fg-inward/` → `StockTransaction(FG_INWARD)` positive qty. **Does NOT auto-issue RM** | ✅ Confirmed — matches your model |

### 1.4 BOM / theoretical chain

`Sales Order Line → released_qty → Job Card.planned_qty → Recipe → /calculate/bom/{recipe_id} → paper rows × bamboo count → MonthlyMaterialProvisional`

Specific files:
- `planning.py` lines 2256-2288 — builds `material_plan_snapshot.bom_snapshot` from spec service `/calculate/bom/{recipe_id}`
- `reconciliation.py` lines 403-454 — `_provisional_material_rows()` computes theoretical
- `reconciliation.py` line 445 — `theoretical_kg = paper_row.weight_kg * provisional_bamboo_count`
- `reconciliation.py` line 31 — `PAPER_EXPECTED_CONSUMPTION_FACTOR = 1.07` (7% standard wastage for paper)

### 1.5 Audit / event emissions

The BFF (`apps/bff-api/src/routes/inventory.py`) emits notification events on every stock-control state change:
- `INVENTORY_OPENING_LOAD_POSTED`
- `INVENTORY_CERTIFICATION_DRAFTED`
- `INVENTORY_STOCK_CERTIFIED`
- `INVENTORY_CARRY_FORWARD_GENERATED`

These flow into the workspace notification center.

---

## 2. Gaps — what is missing or unenforced

### Gap 1 — Daily ledger ↔ reconciliation bridge ❌

The system posts `StockTransaction(ISSUE_PRODUCTION)` every day, but the reconciliation table **does not surface the sum of daily issues as a third column** alongside theoretical and actual.

- **Why it matters:** Without seeing the ledger sum, you can't tell whether the variance between theoretical and actual is *because the operators issued differently than spec*, or *because the physical count says less ran through than was issued*.
- **Recommended fix:** Add a `ledger_issued_kg` column to `MonthlyMaterialSummaryResponse.rows` — sum `StockTransaction(ISSUE_PRODUCTION)` per item for the month.

### Gap 2 — Variance reason / notes not enforced ❌

`MonthlyActualImportRow.notes` is **optional**. Users can import a 200 kg variance row with no explanation, then approve close.

- **Backend evidence:** `reconciliation.py` line 1060-1063: `notes=row.notes` (no `required=True`)
- **Recommended fix:** UI warning + backend guard — when `|variance_kg| > tolerance`, `notes` must be non-empty. Tolerance can be a per-item-type setting (e.g. paper 5 kg, adhesive 0.5 kg).

### Gap 3 — No variance-threshold gate on monthly approval ❌

`/monthly-close/approve` blindly sets `status=APPROVED, locked_at=now()`. There is **no check** that all unresolved variances have been explained.

- **Backend evidence:** `reconciliation.py` lines 1181-1185 — no validation loop.
- **Recommended fix:** Reject approval with HTTP 422 if any row has `|variance_kg| > tolerance` AND empty notes. Block until owner adds explanation.

### Gap 4 — Stock certification and monthly reconciliation are parallel, not linked ⚠️

Two independent state machines, two independent close ceremonies:
- `InventoryCertification.status: DRAFT → CERTIFIED → CARRIED_FORWARD` (stock side)
- `MonthlyMaterialClose.status: OPEN → DRAFT → APPROVED` (consumption side)

You can `APPROVE` a month's consumption reconciliation while the stock certification for the same period is still `DRAFT` — or vice-versa.

- **Recommended fix:** Make one a hard prerequisite. Either: (a) monthly close requires the period's stock cert to be `CERTIFIED`, or (b) stock cert requires monthly reco to be `APPROVED`. Most ERPs choose (a) because physical stock count is the source of truth — book consumption derives from it.

### Gap 5 — Carry-forward is not auto-posted as next-period opening ⚠️

The `InventoryCarryForward` document carries the **proof** (line.opening_qty = physical_qty, source_variance_qty captured) — but the operator still has to **manually create an opening load** for the new period, copying numbers from the CF doc.

- **Recommended fix:** Add an "Auto-create opening load from this CF" button on the carry-forward detail, which posts an `OPENING` `StockTransaction` for each line on `period_end + 1`. This bridges the proof-document → ledger-posting gap.

### Gap 6 — No drill-down from variance row to underlying transactions ❌

When you see a row in the reconciliation table with a 47 kg variance, there is no click-through to:
- The daily issue ledger entries for that item that month
- The job cards whose BOM contributed to the theoretical
- The opening + inward + outward chain

- **Recommended fix:** Make each variance row clickable → opens the inventory ledger filtered to `item_id` and the period. Adds context for "where did the variance come from".

### Gap 7 — FG cannot be manually posted ⚠️

`POST /fg-inward/` is **only** triggered by job-close (`jobs.py` line 529). There is no UI to manually post FG for:
- Rework yield (FG re-introduced after rework)
- Returns from customer (FG re-entering stock)
- Manual adjustments

- **Recommended fix:** Add a manual FG-inward form (similar to RM inward) for non-job FG events. Or document this as an intentional restriction.

### Gap 8 — Theoretical calculation logic is scattered ⚠️

The conversion `released_qty → theoretical_consumption_kg` is split across:
- `planning.py` `_build_job_card_snapshots()` — captures BOM snapshot at job creation
- spec service `/calculate/bom/{recipe_id}` — computes per-recipe BOM
- `reconciliation.py` `_provisional_material_rows()` — applies ratio + multiplies weights

This is hard to debug when a variance is anomalous. There's no single function to point at and say "here's how theoretical is calculated".

- **Recommended fix:** Centralize into `ConsumptionExpectationService.compute_for_period(month, plant)` that returns one canonical dataset, called from both planning (for snapshot capture) and reconciliation (for variance bridge). Same logic, one source of truth.

### Gap 9 — No mini-reconciliation cadence ⚠️

The current system reconciles **only at month-end**. If a 200 kg variance starts on day 3, you don't see it until day 30+. The 1.07 wastage factor for paper smooths but doesn't catch systemic drift.

- **Recommended fix:** Add a non-binding "Weekly drift" view on the same reconciliation page — same calculation, applied to the running week, no approval needed. Early-warning, not enforcement.

### Gap 10 — No "Books are locked" cross-app flag ⚠️

When monthly close is APPROVED, nothing in sales, production, or planning visibly indicates the books are locked for that period. A planner could theoretically still try to backdate a release into a closed month.

- **Recommended fix:** Add a `period_locked_until` flag derived from `MonthlyMaterialClose` and surface it as a chip on every page (header). Backend guards on `released_at` / `created_at` < locked-until should reject.

---

## 3. What can be done — concrete next steps

### Quick wins (UI-only, 1-2 days each)

1. **Add "Ledger sum" column to reconciliation table** — sum `StockTransaction(ISSUE_PRODUCTION)` per item per month, surface as a third column next to theoretical and actual. Fully read-only, no backend gate changes. Closes Gap 1.
2. **Add variance-reason warning chip** — when `|variance_kg| > tolerance` and `notes` is empty, render a yellow chip on the row. Frontend-only nudge. Closes part of Gap 2.
3. **Add drill-down from variance row to ledger** — `Link href="/inventory/ledger?item_id=X&start=…&end=…"`. Pure routing. Closes Gap 6.
4. **Surface "Books locked" chip on header** — when current month's `MonthlyMaterialClose.status === "APPROVED"`, show a red chip in the workspace header. Frontend-only. First step toward Gap 10.

### Medium (backend + UI, 1-2 weeks each)

5. **Add backend variance-threshold gate** — in `/monthly-close/approve`, reject with HTTP 422 if any row has `|variance_kg| > tolerance` AND empty notes. Tolerances stored per item type. Closes Gap 3.
6. **Link stock cert ↔ monthly reco** — approval of `MonthlyMaterialClose` requires `InventoryCertification.status >= "CERTIFIED"` for the same period. One-way. Closes Gap 4.
7. **Auto-create opening load from carry-forward** — button on CF detail; one click posts the `OPENING` transactions. Closes Gap 5.
8. **Manual FG-inward form** — mirror RM inward; allow rework / returns / adjustments. Closes Gap 7.

### Larger (architectural, 2-4 weeks)

9. **Centralize `ConsumptionExpectationService`** — one canonical computation, called from planning (snapshot) and reconciliation (variance). Refactors `planning.py` + `reconciliation.py` + spec service. Closes Gap 8.
10. **Weekly drift view** — read-only, same formulas, running-week scope. Closes Gap 9.
11. **Full books-lock enforcement** — backend guards on backdated mutations across sales/production/inventory. Closes Gap 10 fully.

---

## 4. File / endpoint index (for future reference)

### Frontend pages
- `apps/web-ui/app/(dashboard)/production/reconciliation/page.tsx` — monthly material close (593 lines)
- `apps/web-ui/app/(dashboard)/inventory/stock-control/page.tsx` — opening / certification / carry-forward (410 lines)
- `apps/web-ui/app/(dashboard)/inventory/production-issue/page.tsx` — daily RM → WIP issue
- `apps/web-ui/app/(dashboard)/inventory/reels/issue/page.tsx` — reel-tracked issue
- `apps/web-ui/app/(dashboard)/inventory/ledger/page.tsx` — full transaction ledger
- `apps/web-ui/app/(dashboard)/inventory/raw-material-inward/page.tsx` — daily inward
- `apps/web-ui/app/(dashboard)/inventory/page.tsx` — inventory landing dashboard

### Hooks
- `apps/web-ui/hooks/use-production.ts` — `useMonthlyMaterialSummary`, `useMonthlyCloseState`, `useMonthlyCloseHistory`, `useImportMonthlyActuals`, `useApproveMonthlyClose`
- `apps/web-ui/hooks/use-inventory.ts` — `useInventoryStockStatement`, `useOpeningLoads`, `useStockCertifications`, `useCarryForwards`, `useCreateOpeningLoad`, `useCreateStockCertification`, `useUpdateStockCertification`, `useCertifyStockCertification`, `useCreateCarryForward`

### BFF routes (FastAPI)
- `apps/bff-api/src/routes/production.py` — proxies to production-service `/reconciliation/*`
- `apps/bff-api/src/routes/inventory.py` — proxies to inventory-service `/stock-control/*` + emits notification events

### Backend services
- `hariom-erp/services/production-service/src/routers/reconciliation.py` — monthly summary, import actuals, approve close
- `hariom-erp/services/production-service/src/routers/planning.py` — job-card snapshot creation (BOM)
- `hariom-erp/services/production-service/src/routers/jobs.py` — job close → FG inward call
- `hariom-erp/services/inventory-service/src/routers/stock_control.py` — opening / cert / carry-forward
- `hariom-erp/services/inventory-service/src/routers/issue.py` — RM issue ledger
- `hariom-erp/services/inventory-service/src/routers/fg_inward.py` — FG inward ledger

### Models (SQLAlchemy)
- `production-service/src/models.py`:
  - `MonthlyMaterialProvisional` (theoretical per item per month)
  - `MonthlyMaterialActual` (imported actuals per item per month)
  - `MonthlyMaterialClose` (state machine: OPEN/DRAFT/APPROVED + locked_at)
- `inventory-service/src/models.py`:
  - `InventoryOpeningLoad` + `InventoryOpeningLoadLine`
  - `InventoryCertification` + `InventoryCertificationLine` (state machine: DRAFT/CERTIFIED/CARRIED_FORWARD)
  - `InventoryCarryForward` + `InventoryCarryForwardLine`
  - `StockTransaction` (TransactionType: OPENING, INWARD, ISSUE_PRODUCTION, FG_INWARD, ADJUSTMENT, MOVE, etc.)

---

## 5. Verdict

**Your model is implemented.** The 3-stream architecture (ledger / theoretical / reconciled actual), the two-stage close (stock cert + monthly reco), the no-auto-consume-on-FG behaviour — all there, all wired, all guarded by state machines and read-only locks.

**What's missing is enforcement and ergonomics:** variance reasons aren't required, thresholds aren't checked, stock cert and reco don't gate each other, carry-forward doesn't auto-post next opening, and there's no daily-vs-monthly cross-check. None of these are large rewrites — they're small targeted additions that turn a "well-modelled audit trail" into a "system that won't let me close badly".

If I had to prioritize a single fix, it would be **Gap 4 (link cert ↔ reco)** — that one change forces the right ceremony order and makes the rest of the gaps observable instead of silent.
