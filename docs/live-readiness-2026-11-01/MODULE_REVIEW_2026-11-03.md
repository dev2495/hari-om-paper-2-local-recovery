# Whole-stack flow review (3 Nov 2026)

Report only, nothing changed. Four read-only code reviews traced the main flows from the screen through the BFF to the service: sales and planning; production and quality; purchasing, inward and issue; dispatch, masters, reports and users. Each finding was checked on both sides (UI and server). Confidence is marked as **confirmed** or **likely**.

**Bottom line:**
- No Critical problems.
- All 551 screen API calls match a BFF route.
- All 87 menu links have a page.
- The quantity maths for short close, boxes, issues, AIT serials and GRN numbers holds.
- What remains: buttons shown to roles the server refuses, "All plants" mode breaking some saves, and a few records that can get stuck.

## High
| # | Area | Problem | Scenario | Where | Conf. |
|---|---|---|---|---|---|
| H1 | Sales | Order buttons are shown to roles the server refuses. | A Planner presses Hold, Cancel, Short close or Edit and always gets "Operation not permitted". The plant head opens Release, which fails on save. Sales sees Plan, but the planning pages lock Sales out. | `sales-orders/[orderId]/page.tsx:247-275` vs `sales_orders.py:2323,2638,2694,2928,1737`, `order_closure.py:26`; `planning/layout.tsx` | confirmed |
| H2 | Purchase | A PO can get stuck as "Approved" forever. | A partly received PO is revised so its qty equals what was received, then approved. Every line is closed, but the status stays APPROVED, so it can't be short-closed or cancelled and MRP keeps counting it as open. | `inventory-service purchase.py:1326` (approve sets APPROVED), `:1071`, `:1455`, `:1480` | confirmed |
| H3 | Purchase | Short weight on a PO GRN can never be claimed. | The vendor bills 1000 kg and 950 kg is weighed. The QUANTITY case is opened with claim ₹0, so no debit note is possible. Manual GRNs do work out the claim. | `procurement.py:716-719, 1020-1031, 1291` vs `manual_receipts.py:216` | likely |

## Medium
| # | Area | Problem | Where | Conf. |
|---|---|---|---|---|
| M1 | Sales | With "All plants" selected, Send for approval, Edit, New order and colour breakup fail with 400 "Select one concrete plant". | `hooks/use-sales.ts:384,403`, `lib/api.ts:359,369` | confirmed |
| M2 | Design | Packing setup save fails the same way with "All plants" selected. | `specifications/packing-setup/page.tsx:100` vs `packing_setup.py:241` | confirmed |
| M3 | Sales | An order can get stuck if a release lot's job card was never created: it can't be cancelled or short-closed, and the lot can't be cancelled. | `order_closure.py:40-42,101-115`; release-lots amend not proxied | likely |
| M4 | Sales | A held order hides Cancel and Short close. Workaround: Resume, then close. | `sales-orders/[orderId]/page.tsx:170-176` | confirmed |
| M5 | Dispatch | A failed seal can block a card for good: the draft stays FAILED, there is no cancel, and new challans get 409. | `production-service dispatch.py:522-538, 636-639`; `logistics/dispatch/new/page.tsx` | likely |
| M6 | Dispatch | The dispatch notification link opens a 404 (`/logistics/dispatch/<card>` has no page). | `bff-api routes/dispatch.py:36` | confirmed |
| M7 | Production | On older V2 cards with a visible Final QC step, an out-of-band reading blocks Final QC (breaks "QC only flags"). | `entries.py:376-378`, `planning.py:4385-4397, 4650-4669`, `quality.py:1219`; `FinalQcForm.tsx` | likely |
| M8 | Production | Once tool usage has been posted, a stage cannot be reopened (no reversal exists), and an inventory outage also blocks reopen. | `entries.py:1388-1390`, `completion_worker.py:125-132` | likely |
| M9 | Purchase | A debit note cannot be voided from the screen; the server supports VOID. | `procurement.py:1382` vs `purchase/debit-notes/page.tsx:22` | confirmed |
| M10 | Reports | Sales pulse shows zeros instead of an error for the plant head and Sales; Inventory intelligence has the same problem for Store (403 on the owner pack). | `reports/sales/page.tsx:43-44`, `reports/inventory/page.tsx:39` vs `auth-service workspace.py:119,127` | confirmed |
| M11 | FG | The manual FG history shows pieces with a "kg" suffix. | `inventory/fg-inward/page.tsx:22,273` | confirmed |

## Low / notes
- "Release, keep case" on Invoice differences shows on every row but returns 409 unless the case was accepted first.
- Returning a rejected lot to the supplier does not lower the PO's received qty, so the replacement needs an over-receipt reason. This may be intended.
- Dispatch & SLA report: "sealed dispatches" counts cards (not challans), ignores the date range, and "ready at the gate" includes shipped cards. The dashboard's today_dispatch is always 0 because it looks for the wrong event name (not shown on screen).
- Reopen after a short close: the Sales reversal commits before Production. They can disagree only if the production commit fails.
- An operator login not linked to an employee sees every stage (the server checks the department, not the login's stage).

## Checked and clean
- **Sales and planning:**
  - 30 sales API contracts.
  - Maker-checker approve.
  - Line release (locked, idempotent).
  - Short-close and return-balance maths, hold and resume.
  - Planner board move, bulk move, split, sweep and saved views.
- **Production and quality:**
  - Log output, Log QC (out-of-band readings are flagged, never auto-held), stage close, and short close (returns add up to planned − good; reopen reverses).
  - Process close with full and part boxes, and box FG posting.
  - Manual holds, incoming QC (hold, concession, return), complaints.
  - Force close refused on V2 cards that have entries.
- **Purchase, inward and issue:**
  - PO create, submit and approve roles.
  - GRN against a PO and manual GRN (over-receipt reason, partial receipt, PO lock).
  - GRN numbers per April financial year.
  - AIT serials per plant and year, with opening-stock serials pushing the counter.
  - Held reels and lots refused at issue; scan issue is idempotent.
  - Bulk issue oldest first; issue history; debit note submit, approve, issue and settle.
- **Dispatch, masters and users:**
  - Ready jobs → boxes → seal (box-by-box posting, partial dispatch).
  - Print, manual FG reasons and roles.
  - Spec create, edit and approve; master edits.
  - User role change (keeps at least one admin).
  - Every menu link and every API path.

## Suggested fix order
1. **H1** (role-gate the sales buttons) and **M1/M2** (block saves with a clear "pick a plant" message when "All plants" is selected). These are quick and remove most of the everyday errors.
2. **H2** (re-derive PO status on approve), **H3** (work out the claim on PO GRN quantity cases), **M9** (void button).
3. **M5/M3/M8** (cancel paths for a failed seal, an unsynced release lot, and tool reversal), **M7** (flag, don't block, on V2 Final QC).
4. **M6, M10, M11** and the low items.
