# Job Card, Time Reconciliation & Stack Review — 2026-09-25

## 1. Job card print rebuilt to the client workbook (`Job Card .xlsx`)

`components/production/JobCardDocument.tsx` → `renderReleasePrintLayout()` (route `/production/job-cards/{id}/print`).

The layout copies the workbook's cells: 8 columns, the same merges, the same field order, and English + Hindi labels.

| Side | Content (workbook rows) |
|---|---|
| Front | Title + JC No/SO + QR (r1) · 12 header fields: Date, Customer, Mandrel, Lot No / Weight per pc, Color, Order Qty, Size / Parchment Paper, Pcs per Bamboo, Required C.S, Denier (r3–7) · **Winding** (r9–21: Date/Shift band, Winder No/Operator/Supervisor/QC sign, Output/Accepted (3-row), 3 reject lines, Start A/End B/Cycle B−A, Length/Weight/OD/ID/C.S/Pasting REQ row + 4 samples) · **Oven** (r23–34: 3 batch rows, Pre/Post weight & moisture REQ row + 3 samples) |
| Back | Identity strip (JC/Lot/Customer/Size) · **Process Line** (r36–46: 2 rows, 8-column Length/ID/OD/Weight/Moisture/C.S/Notch distance/Notch depth REQ + 3 samples) · **Dispatch** (r48–51: Dispatch Date / Lead Time band, 2 rows, extends to 4 for partial shipments) · **Space for combination, tooling, drawing** (r52–62) with the tooling summary printed at the top |

- Checked with headless Chromium PDF output: **exactly 2 A4 pages** (a blank card and a fully-filled card with 3 shipments), with no content cut off. Print with *two-sided, flip on long edge, 100 % scale*.
- REQ cells are printed from the spec snapshot. Winding uses bamboo length, wet bamboo weight and pre-dry C.S. Oven uses wet and dry bamboo weight and the moisture band. Process uses the client ID/OD/length/weight/C.S bands and notch distance/depth.
- Actuals already entered in the ERP print into their cells. Everything else is left blank for handwriting.
- **Denier** and **Pasting** are not stored anywhere in the ERP, so they print as blank write-in boxes. Add them to the spec master if they should be pre-filled.

## 2. Card time vs system entry time (reconciliation)

The card is filled on the floor, and the times are typed into the ERP later. Before this change:

| Bug (confirmed) | Effect |
|---|---|
| The UI kept Start/End only inside `entry_snapshot` and never sent `start_time`/`end_time` | **Every stage's actual start/end = the moment it was typed.** Cycle time, shift output, OEE and capacity were all wrong for late entries |
| The UI sent `shift_code`, but `StageOutputPayload` rejects extra fields | The backend refused stage saves from the entry screen with a 422 error |
| The UI sends `pre_oven_weight_kg` / `moisture_before`; the backend required `pre_weight` / `pre_moisture` | **Oven stage could never be completed from the UI** (400) |
| The capacity check bucketed output by *today*, not by the card's day | Typing in yesterday's card consumed today's shift capacity, causing false "capacity exceeded" errors |
| A draft saved without times set start = typing time, and completion never overwrote it | Wrong start time even when the card time was given later |
| The oven 5–6 h rule used the planned window or typed text, not actual card times, and had no override | A real card could not be booked |

Fixes (production-service `routers/planning.py`, `schemas/planning.py`, web-ui):
- The UI sends Start (A)/End (B) as ISO times with the plant offset. Cycle Time (B−A) is calculated, not typed.
- The backend treats times without an offset as plant local time (IST).
- The backend rejects: End before Start, and times in the future (10-minute tolerance). Completing Slitting, Winder, Oven or Process now **requires card times**; a supervisor can complete without them only by giving an override reason, and the entry is flagged `SYSTEM_ENTRY`.
- Card times become the segment/stage `actual_start` / `actual_end`. `entered_at` / `entered_by` stay as the typing record.
- Each save records `actuals_snapshot.time_reconciliation`: card start/end, cycle minutes, entered at/by, **entry lag in minutes**, late flag (> 6 h) and source. A rolling log is kept in `time_reconciliation_log`. The same data is added to the audit event and returned as response `warnings`.
- The shift written on the card is recorded in `entry_snapshot.shift_code`. The planner's shift is not changed.
- New report **`GET /planning/time-reconciliation`** (BFF `/api/production/planning/time-reconciliation`), paginated, with filters for date / stage / late only. UI page: **`/production/job-cards/time-reconciliation`**, linked from Job Cards.
- The job card view shows card A→B, cycle, entered time + lag, and a late badge for each completed stage.

## 3. Other flow fixes

- **Stage handover bug.** Sessions run with `autoflush=False`, so after a segment was completed, the "open segments remaining" query still counted it as open. The next-stage handover was skipped: input qty was not set, default plan date/shift were not set, and the segment was not created. Stages the planner does not schedule (e.g. Packing) could then stall with *"No open stage segment"*. Fixed with an explicit flush. A regression test fails without the fix.
- The job card detail now returns **`dispatch_history`**: sealed shipments with date, qty, cumulative qty and pending qty. Reprinted cards show the real dispatch rows and lead time.
- Stage rows now expose `entered_at` / `entered_by`.

## 4. Scale / performance

- DB pools were 3+1 connections per service, so about 5 concurrent saves already queued. Pools are now env-tunable via `DB_POOL_SIZE` / `DB_MAX_OVERFLOW`. Defaults: production & inventory 8+4; auth, masterdata & analytics 4+2. The total stays under Postgres's default 100 connections.
- New indexes: `job_cards(plant_id, created_at DESC)`, `job_cards(release_lot_id)`, `job_cards(sales_order_line_id)`, `job_card_stages(entered_at)`, and a partial capacity-lookup index on completed segments. They are created at startup in the guarded compatibility block.
- Purchase receipts list: removed per-row lazy loads (order, line item, line batch) by using `selectinload`.

## 5. Found but NOT changed (needs a business decision)

1. **Paper reel inward is not linked to POs.** `POST /reels/inward` stores `po_no` as free text only, so the PO line balance and status never move for paper, the biggest spend. The PO GRN endpoint also accepts REEL-tracked paper items and creates bulk batches, which gives two receiving paths and a risk of double-counting stock. Recommendation: pick the reel inward as the paper path, link it to `po_line_id` with a kg balance check, and block GRN for `tracking_mode = REEL` items.
2. Packing completes without FG inward if `fg_item_id` is missing. Dispatch then correctly blocks (409), but a warning at packing time would surface it earlier.
3. `auth-service` has 3 failing tests and `analytics-service` fails to collect tests (missing `reportlab`). Both results are identical before and after this change.

## 6. Verification

- production-service: **108 passed**, run against a live PostgreSQL 16. New tests: `test_card_time_reconciliation.py` (unit) and `test_card_time_postgres.py` (late winder entry end to end, oven UI keys, next-stage handover, future-time rejection, dispatch history). The partial-dispatch Postgres test also ran.
- inventory-service 8 passed · masterdata 7 passed · BFF 26 passed.
- web-ui: `tsc --noEmit` clean, `next lint` clean, `npm test` passing (the print contract test was updated to check the client section order and field names).
- Browser checks: print PDF page count and overflow, card-time panel on the job card view, reconciliation page.
