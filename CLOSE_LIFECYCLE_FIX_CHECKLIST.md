# Stock Lifecycle / Consumption / Reconciliation — Full Fix Checklist

_Hari Om Paper 2 ERP · Production-ready cut to close every gap from the audit_

Every item lists **backend → BFF → frontend → test/verify** in execution order. Cross-reference with `STOCK_CONSUMPTION_RECONCILIATION_AUDIT.md` for the underlying findings.

---

## 0. Conventions

- **PROD-SVC** = `hariom-erp/services/production-service/src/`
- **INV-SVC** = `hariom-erp/services/inventory-service/src/`
- **BFF** = `apps/bff-api/src/routes/`
- **WEB** = `apps/web-ui/`
- **Status emojis**: ⏳ pending · 🔄 in-progress · ✅ done · ⚠️ stretch · ❌ blocked

All endpoints get a notification event emission on success. All mutations are idempotent where possible.

---

## 1. Gap 4 — link Stock Cert ↔ Monthly Reco _(structural unlock)_

**Why it matters:** today, you can APPROVE monthly reconciliation while the period's stock certification is still DRAFT. Physical count must come first; book consumption derives from it.

### 1.1 Backend
- ✅ Add `GET /reconciliation/period-state/{month}` in PROD-SVC — returns `{ reco_status, stock_cert_status, can_approve, blockers[] }`. Joins `MonthlyMaterialClose` + most-recent `InventoryCertification` whose period_end falls in the same month.
- ✅ Modify `POST /reconciliation/monthly-close/approve` to reject (HTTP 422) when stock cert is not at least `CERTIFIED` for that period.
- ✅ Emit event `INVENTORY_PERIOD_STATE_PROBED` for auditability.

### 1.2 BFF
- ✅ Proxy `GET /api/production/period-state/{month}`.

### 1.3 Frontend
- ✅ Banner on reconciliation page: "Stock cert for {month} is {status} — close blocked until CERTIFIED" with a deep-link to `/inventory/stock-control` pre-filtered to the right period.
- ✅ Disable the "Close Month" button when `period_state.can_approve === false`.
- ✅ Show the blockers list inline.

### 1.4 Verify
- ✅ With DRAFT cert: close button disabled, banner visible, deep-link works.
- ✅ With CERTIFIED cert: close button enabled.
- ✅ Direct API call with no cert: 422 with explanation.

---

## 2. Gap 2 + 3 — variance reason + threshold gate _(enforcement)_

**Why it matters:** today, any variance can sail through with no explanation. Big variances should require justification AND tolerance-based rejection.

### 2.1 Data
- ✅ Tolerance per item type (defaults): paper 5 kg, adhesive 0.5 kg, parchment 1 kg, packaging 10 pcs. Stored in `production-service/src/utils.py` constants for now; can be moved to settings later.

### 2.2 Backend
- ✅ Compute `over_tolerance: bool` per row in `MonthlyMaterialSummaryResponse.rows` based on item type and `|variance_kg|`.
- ✅ Modify `POST /reconciliation/monthly-close/approve`: also rejects (HTTP 422) when any row has `over_tolerance=true` AND `notes` is empty.
- ✅ Validation surface includes `blockers: [{ item_code, variance_kg, reason: "VARIANCE_NEEDS_NOTE" }]` so the UI can pinpoint.

### 2.3 Frontend
- ✅ Each row in the reconciliation table gets a "Notes" inline editor that posts to `import-monthly-actuals` (re-importing with notes).
- ✅ Visual: row turns amber when `over_tolerance && !notes`, green when explained, rose when critical and unexplained.
- ✅ Close button disabled while blockers exist; blockers shown as expandable card.

### 2.4 Verify
- ✅ Try to close with 50 kg variance and no notes → 422 with blocker list.
- ✅ Add notes → close succeeds.

---

## 3. Gap 1 — daily ledger ↔ reconciliation bridge _(observability)_

**Why it matters:** today the reconciliation shows only theoretical and actual. The ledger sum (sum of `ISSUE_PRODUCTION` for the month) is the third number that tells you whether stores issued differently than spec.

### 3.1 Backend
- ✅ Extend `MonthlyMaterialActualRow` and reco summary computation to include `ledger_issued_kg` per item — summed from `StockTransaction` where `transaction_type IN (ISSUE_PRODUCTION, ISSUE_FROM_REEL)` and `date IN [month_start, month_end+1)`.
- ✅ Compute `ledger_vs_theoretical_kg` and `ledger_vs_actual_kg` as derived fields.

### 3.2 BFF
- ✅ Passthrough; no new endpoint.

### 3.3 Frontend
- ✅ Add 3rd column "Ledger issued" alongside Theoretical and Actual.
- ✅ Visualize the three with a small sparkline + arrow indicators per row.
- ✅ Hover tooltip explains each number's source.

### 3.4 Verify
- ✅ Ledger sum matches a manual SQL `SELECT SUM(qty_change)` on a known month.

---

## 4. Gap 5 — auto-create opening load from carry-forward _(close the loop)_

**Why it matters:** today the CF document carries proof but you still have to manually post an opening load to seed next period's ledger. One-click should do it.

### 4.1 Backend
- ✅ New endpoint `POST /stock-control/carry-forwards/{cf_id}/post-opening` in INV-SVC.
- ✅ For each CF line, create an `InventoryOpeningLoad` + matching `StockTransaction(OPENING)` on `period_end + 1` with `external_ref = "OPENING:CF:{cf_id}:{line_no}"` for idempotency.
- ✅ Mark CF status as `POSTED` (new state) + capture `posted_opening_load_id`.
- ✅ Emit `INVENTORY_CF_OPENING_POSTED` event.

### 4.2 BFF
- ✅ Proxy `POST /api/inventory/stock-control/carry-forwards/{cf_id}/post-opening`.

### 4.3 Frontend
- ✅ Button on CF detail: "Post as opening load" — primary CTA when status is `GENERATED`, secondary/disabled when `POSTED`.
- ✅ Confirmation modal showing the proposed opening date + line preview.
- ✅ Success toast linking to the new opening load doc.

### 4.4 Verify
- ✅ CF → post-opening → new opening doc exists, status flips to POSTED, idempotent on re-click.

---

## 5. Gap 10 — books-locked workspace flag _(cross-app awareness)_

**Why it matters:** when a month closes, the entire app should visibly know. Sales/production planners should see it before they attempt backdated mutations.

### 5.1 Backend
- ✅ `GET /workspace/books-state` in PROD-SVC — returns `{ locked_through, locked_by, locked_at, current_month_status, current_cert_status, plant_id }`.
- ✅ `locked_through` = max `period_end` of APPROVED monthly close where matching cert is at least CERTIFIED.

### 5.2 BFF
- ✅ Proxy `GET /api/workspace/books-state`.

### 5.3 Frontend
- ✅ Add a `BooksLockedChip` component in the workspace header (right side, next to plant switcher).
- ✅ When locked, chip is amber: "Books locked thru May 31".
- ✅ Chip tooltip shows: locked_by, locked_at, deep-link to reconciliation history.

### 5.4 Verify
- ✅ Approve a month → chip appears across all pages.

---

## 6. Gap 6 — drill-down from variance row to ledger _(traceability)_

**Why it matters:** variance > 0 should be one click away from showing every transaction for that item in that month.

### 6.1 Backend
- ✅ Existing `GET /inventory/transactions?item_id=X&start_date&end_date` already supports this; no new endpoint.

### 6.2 Frontend
- ✅ Each reco row gets a "🔍 Drill" link → `/inventory/ledger?item_id={id}&start={month_start}&end={month_end}&from=reco`.
- ✅ Ledger page reads query params and auto-filters; surfaces a "Back to reconciliation" pill.

### 6.3 Verify
- ✅ Click drill on a row → ledger opens, filters applied, count of transactions matches.

---

## 7. Gap 7 — manual FG-inward page _(non-job FG flows)_

**Why it matters:** rework returns and customer returns must be re-inwarded. Today, FG inward is only auto-triggered by job-close.

### 7.1 Backend
- ✅ `POST /fg-inward/manual` in INV-SVC — accepts `item_id`, `qty`, `reason_code (REWORK | RETURN | ADJUSTMENT)`, `notes`, `reference`, optional `batch_no`, optional `location_id`.
- ✅ Creates `StockBatch` (or appends to existing) + `StockTransaction(FG_INWARD)` with `external_ref = "FG:MANUAL:{reason}:{timestamp}"`.
- ✅ Emit `INVENTORY_MANUAL_FG_INWARD` event.

### 7.2 BFF
- ✅ Proxy `POST /api/inventory/fg-inward/manual`.

### 7.3 Frontend
- ✅ New page `/inventory/fg-inward` with form: item picker (FG items only), qty, reason dropdown, notes, optional batch/location.
- ✅ Recent posts list on the same page (last 10).
- ✅ Sidebar entry under Supply Chain.

### 7.4 Verify
- ✅ Submit a rework return → ledger shows it, stock balance increases.

---

## 8. Gap 9 — weekly drift mini-view _(early warning)_

**Why it matters:** waiting 30 days to see a 200 kg drift is unacceptable. Weekly view is read-only — no approval, no lock, just visibility.

### 8.1 Backend
- ✅ `GET /reconciliation/weekly-drift?week_start=YYYY-MM-DD&plant_id=...` in PROD-SVC.
- ✅ Same computation as monthly summary but scoped to the 7-day window.
- ✅ Includes theoretical, ledger_issued (no actuals since not posted yet), and a "running variance" estimate.
- ✅ No mutation endpoint.

### 8.2 BFF
- ✅ Proxy `GET /api/production/weekly-drift`.

### 8.3 Frontend
- ✅ Add a tab "Weekly drift" to the reconciliation page.
- ✅ Read-only table + sparkline trend by item.
- ✅ Banner: "Read-only — for early warning; close ritual remains monthly".

### 8.4 Verify
- ✅ Last 4 weeks show progressive drift.

---

## 9. Gap 8 — centralize consumption expectation _(refactor)_

**Why it matters:** theoretical calc is split across `planning.py`, `reconciliation.py`, and the spec service `/calculate/bom/`. One bug fix today means three files.

### 9.1 Backend (refactor, no API change)
- ⚠️ Extract `compute_consumption_expectation(plant_id, period_start, period_end)` into a new `production-service/src/services/consumption.py`.
- ⚠️ Replace inline calls in `_provisional_material_rows()` and `_build_job_card_snapshots()`.
- **STATUS:** Stretch — useful but not user-facing. If context permits, otherwise log as TODO.

---

## 10. Premium UI Cut

Every page touched gets a premium-design pass with the existing Hari Om design system (`ExecutiveHero`, `MetricCard`, `Panel`, charts).

### 10.1 Reconciliation page (`/production/reconciliation`)
- ✅ Tabs: **Monthly Close · Weekly Drift · History**.
- ✅ Hero: premium gradient with KPIs (theoretical / ledger / actual / variance / blockers / cert status / can-approve).
- ✅ 3-column table with ledger, theoretical, actual, variance, % drift, tolerance flag, inline notes editor, drill-down chip.
- ✅ Blockers card: amber if variance unexplained, rose if cert missing.

### 10.2 Stock-control page (`/inventory/stock-control`)
- ✅ Tabs: **Open positions · Certifications · Carry-forward · History**.
- ✅ Workflow stepper at top: Open → Daily → Cert (DRAFT/CERTIFIED) → CF (GENERATED/POSTED).
- ✅ KPIs: book closing value, physical match %, variance value, certs in DRAFT, CFs pending opening post.
- ✅ Per-cert card with status pill, action buttons.
- ✅ "Post opening from CF" button.

### 10.3 Ledger page (`/inventory/ledger`)
- ✅ Honor `?item_id`, `?start`, `?end`, `?from=reco` query params.
- ✅ "Back to {from}" pill when contextual.
- ✅ Same premium chrome.

### 10.4 Manual FG (`/inventory/fg-inward`)
- ✅ Premium hero with reason guidance.
- ✅ Form + recent posts list.

### 10.5 Workspace header
- ✅ Books-locked chip with tooltip.

---

## 11. Tests / Verify

- ✅ `tsc --noEmit` clean
- ✅ Dev server compiles every changed page (no runtime panic)
- ✅ Curl-walk every new route: `/production/reconciliation`, `/inventory/stock-control`, `/inventory/ledger`, `/inventory/fg-inward`
- ✅ Smoke flow:
  1. Open period
  2. Draft cert, post physical counts
  3. Certify → CF generated
  4. Post CF as opening → ledger shows new OPENING
  5. Import monthly actuals with one variance row missing notes → approve fails (422)
  6. Add notes → approve fails (cert link gate) → certify if needed → approve succeeds
  7. Books-locked chip appears in header

---

## 12. Out-of-scope for this pass (parking lot)

- Database migrations for new fields (uses additive defaults via SQLAlchemy `default=` so no schema break needed in dev; production should still run Alembic).
- Full RBAC matrix surface for new endpoints (use existing role decorators).
- Cross-app books-locked enforcement on every mutation (chip + reco gate cover 80% of value).
- Centralized consumption refactor (Gap 8) — code-health only, no user-visible change.

---

## 13. Build order

1. Checklist doc ✅ (this file)
2. Backend: PROD-SVC reconciliation router (Gaps 1, 2, 3, 4, 8 partial, 9) — single pass
3. Backend: INV-SVC stock_control router (Gap 5) + fg_inward router (Gap 7)
4. Backend: workspace endpoint (Gap 10)
5. BFF: all new proxies in one pass
6. Frontend hooks update
7. Frontend: reconciliation page rebuild
8. Frontend: stock-control page rebuild
9. Frontend: ledger drill-down
10. Frontend: manual FG page
11. Frontend: weekly drift tab
12. Frontend: workspace header chip
13. Sidebar: surface new pages
14. tsc + dev server verify
15. Smoke walk-through

Let's go.
