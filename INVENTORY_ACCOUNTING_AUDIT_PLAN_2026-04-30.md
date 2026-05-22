# Inventory Accounting And Reconciliation Audit Plan

Date: 2026-04-30
Scope: Hari Om ERP local checkout, inventory service, production reconciliation, stock-control UI, analytics/reporting.

## Executive Decision

Keep two ledgers separate and reconcile them monthly:

1. Inventory stock ledger is the accounting stock book. It owns opening stock, inwards, issues/outwards, adjustments, physical count, closing stock, critical-stock policy, fiscal-year closing, and carry-forward.
2. Production reconciliation is the consumption truth bridge. It owns job-card theory, daily store issue truth, actual consumed paper, expected 107 percent consumption basis, wastage split, and variance explanation.

Do not merge these into one page. The correct operating model is: inventory certifies stock quantity/value; production reconciliation certifies consumption variance. The monthly close should cross-check both before month lock.

## Current System Already Present

- Opening stock exists through `POST /inventory/stock-control/opening-loads`.
- Opening loads create either reel-tracked paper reels or bulk stock batches.
- Stock statement exists through `GET /inventory/stock-control/statement`.
- Stock statement computes opening, inward, outward, adjustment, closing, reorder risk, safety stock, and value.
- Certification exists through `POST /inventory/stock-control/certifications`.
- Certification creates draft physical-count lines from the computed statement.
- Physical quantity and variance update exists through `PATCH /inventory/stock-control/certifications/{id}`.
- Certification lock exists through `POST /inventory/stock-control/certifications/{id}/certify`.
- FY or period carry-forward exists through `POST /inventory/stock-control/certifications/{id}/carry-forward`.
- Production reconciliation already applies paper expected consumption factor as `1.07` and standard wastage as `7.0 percent`.
- Production shift material ledger exists for store issue/day/shift truth and advisory job allocation where exact reel-to-job mapping is not possible.

## Critical Gaps To Close

### Opening Stock

Current state is usable but needs tighter controls.

- Add import template validation for opening stock so users can upload initial stock from Excel without hand-entering every reel/batch.
- Add duplicate guard by item, reel code, batch number, and effective date before posting.
- Add mandatory unit cost source for opening lines: manual, supplier, or approved average.
- Add opening-stock approval state before posting into the live ledger if the client wants maker/checker later.
- Add visual summary: total opening kg, pieces, value, reel count, policy-missing items.

### Critical Stock Alerts

Current statement marks `CRITICAL`, `REORDER`, `POLICY_MISSING`, and `OK`.

Needed next:

- Add alert rules table so reorder level, safety stock, and lead time changes are auditable.
- Add dashboard cards: critical items, reorder items, policy-missing items, stockout risk days.
- Add MRP action: convert critical/reorder rows into purchase indent or supplier RFQ draft.
- Add notification event when an item crosses safety stock or reorder level.
- Add plant-level filter and owner all-plant rollup.

### Closing Stock

Current certification captures physical quantity and variance.

Needed next:

- Add closing checklist: all inwards posted, all reel issues closed, all dispatch posted, production month actuals saved, physical count entered.
- Add "variance explanation required" rule when quantity or value variance exceeds threshold.
- Add attachment support for physical count sheets or signed PDFs.
- Add immutable close snapshot after certification so later item master cost edits do not rewrite historical close value.
- Add stock close report PDF/XLSX.

### Fiscal Year Closing And Carry Forward

Carry-forward document currently exists, but it creates carry-forward rows only. It does not yet post the next year's opening ledger movements as a first-class accounting event.

Needed next:

- Add FY close wizard that requires the final monthly/annual certification to be `CERTIFIED`.
- Add carry-forward posting mode: draft, posted, reversed.
- Post carry-forward opening quantities into the next FY as explicit `OPENING` stock transactions/reels, linked to the carry-forward document.
- Add reversal endpoint before the next FY has any movement.
- Add one active opening source per item/reel/batch for a fiscal year to prevent double-opening.
- Add FY close audit report: previous closing, physical closing, variance, carried opening, cost source, posting reference.

### Production Reconciliation Link

Correct business rule:

- Spec sheet computes exact paper required for final output.
- Actual expected consumption basis is `107 percent` of exact output paper because `7 percent` is standard wastage.
- Variance should be calculated after comparing actual consumed paper against this expected consumption, not against dry output paper alone.

Needed next:

- Surface the formula in the reconciliation UI per material row:
  `expected_consumption_kg = exact_output_paper_kg * 1.07`
- Split variance into standard wastage and true variance:
  `standard_wastage_kg = exact_output_paper_kg * 0.07`
  `true_variance_kg = actual_consumption_kg - expected_consumption_kg`
- Reconciliation close should block or warn if inventory stock certification is not complete for the same month.
- Inventory close should show a cross-check panel from production reconciliation: theory, expected 107 percent consumption, actual, variance, locked status.
- Monthly owner report should show both inventory value variance and production consumption variance separately.

## Recommended Target Flow

1. Opening stock setup:
   - Create item masters with UOM, tracking mode, reorder level, safety stock, lead time, and unit cost source.
   - Upload or enter opening stock.
   - Review exceptions: missing policy, duplicate reels, zero cost.
   - Post opening load.

2. Daily operations:
   - Raw material inward posts stock.
   - Store issues reels/material daily to production section.
   - Production job cards log output.
   - Packing creates FG.
   - Dispatch reduces FG.
   - Critical stock alerts run on every stock-affecting transaction.

3. Month end:
   - Store closes open reel issues and confirms daily material ledgers.
   - Production reconciliation imports actual month-end consumption.
   - System calculates exact output paper, standard 7 percent wastage, expected 107 percent consumption, actual, and true variance.
   - Inventory creates stock certification for the month.
   - Physical count is entered.
   - Variance explanations are added.
   - Production reconciliation and inventory certification both lock.

4. Fiscal year close:
   - Final period certification is completed.
   - FY close wizard validates no unlocked periods.
   - Carry-forward is generated and posted as next FY opening stock.
   - FY close report is exported and locked.

## Implementation Plan

### Phase 1: UI Hardening

- Improve `/inventory/stock-control` as a close cockpit with tabs: Opening, Statement, Certification, Carry Forward, Audit.
- Add KPIs: opening value, closing value, variance value, critical items, policy missing, certified months.
- Add clear empty states for no item policy, no opening load, no certification.
- Add month/FY selector and plant selector at the top.
- Add reconciliation cross-check card for selected month.

### Phase 2: Backend Controls

- Add inventory alert rule model and notification emission.
- Add certification threshold rules for required notes.
- Add immutable certification snapshot JSON for historical audit.
- Add carry-forward posting and reversal models.
- Add endpoint: `GET /inventory/stock-control/close-readiness?month=YYYY-MM`.
- Add endpoint: `GET /inventory/stock-control/fy-readiness?fy=FY YYYY-YY`.

### Phase 3: Reconciliation Integration

- Add stock certification status into production reconciliation close state.
- Add expected 107 percent consumption fields to every reconciliation row and report.
- Add close dependency warnings both ways:
  - Production reconciliation warns if stock certification is missing.
  - Inventory certification warns if production reconciliation is missing.
- Add month lock summary to owner/admin landing.

### Phase 4: Reporting

- Add inventory close report PDF/XLSX.
- Add FY carry-forward report PDF/XLSX.
- Add critical stock report.
- Add production consumption variance report with exact output, standard wastage, expected consumption, actual consumption, and true variance.

## Data Integrity Rules

- No negative stock unless explicitly configured for an item and approved by Admin.
- No stock certification edit after certified status.
- No carry-forward until certification is certified.
- No duplicate carry-forward per plant and certification.
- No FY opening repost if next FY already has stock movement, unless reversal path is clean.
- Reconciliation variance should use expected consumption after standard wastage, not dry output material alone.
- Physical count variance must store both quantity and value variance at the time of close.

## UI Pages To Add Or Improve

- `/inventory/stock-control`: close cockpit and operational controls.
- `/inventory/alerts`: critical stock and reorder cockpit.
- `/inventory/fy-close`: fiscal-year close wizard.
- `/production/reconciliation`: add inventory certification dependency panel.
- `/reports/inventory`: close-value, alert, and carry-forward reports.
- `/reports/reconciliation`: true consumption variance report.

## Priority Recommendation

Build in this order:

1. Planner date selector and calendar view.
2. Inventory stock-control cockpit polish and close-readiness endpoint.
3. Reconciliation 107 percent formula visibility and inventory close dependency.
4. Carry-forward posting/reversal hardening.
5. Reports and owner/admin landing rollups.

