# Design: boxes, short close returns, QC flags, operator filter (Agent JOB, 1 Nov 2026)

Owner decisions 1, 2, 3, 7 (operator filter) and 8 of `BUILD_BRIEF.md`. Batch-entry (V2) cards first; old-form (V1) cards are aligned where noted.

## 1. Short close returns the balance (V2)

Every stage keeps a **pcs target** next to its unit target:

| field (stage `actuals_snapshot`) | meaning |
|---|---|
| `effective_target` | target in the stage unit (bamboo / pcs), as today |
| `effective_target_pcs` | the same target in pcs (released pcs until an upstream short close cuts it) |
| `returned_pcs` | pcs this stage's short close gave back to the order |
| `short_close` | `{good, target, unit, returned_pcs, reason, at, return_key}` |
| `shrunk_from` | per downstream stage: the targets and planner-slot qtys before this close (for reopen) |

At a short close of stage S: `good_pcs = good × pcs/bamboo` (bamboo stages) or `good`; `returned = max(0, target_pcs(S) − good_pcs)`.
Every downstream stage gets `effective_target_pcs = min(own, good_pcs)` and `effective_target` in its unit (bamboo = good bamboo, pcs = good_pcs). Downstream open planner slots shrink to the new target (latest slots give first, `required_capacity` scaled); the old figures are kept in `shrunk_from`.

The card keeps `planned_qty` (the original plan, so closed-stage history reads "40 of 84 bamboo") and moves `released_qty → released_qty − returned`, `returned_qty += returned`. A completion effect `sales_return` (outbox, retried) calls the new sales endpoint `POST /sales-orders/release-lots/{lot}/stage-returns` with an idempotency key `<card>:<stage>:close:<n>`; it is delivered straight after the close and retried by the worker if Sales is down. Sales keeps one row per return in `sales_order_release_lot_returns` (lot, card, key, qty, status ACTIVE/REVERSED) and moves the qty from the lot to the line's unreleased balance (order short-closed → the balance is dropped, as for a force close).

**Invariant** (tested): Σ returns + Σ box pcs (FG) = released pcs, when no stage made more than its target (more = surplus).

**Reopen** of a short-closed stage: if the `sales_return` effect has not been delivered it is cancelled; otherwise Sales `POST …/stage-returns/{key}/reverse` gives the pcs back to the lot only when the line still has that many unreleased pcs and the order is not short-closed/cancelled, else the reopen is refused with the plain reason. Targets and slots come back from `shrunk_from`; card released/returned qty move back. History shows "Winding closed short: 40 of 84 bamboo, 520 pcs back to the order · reason".

## 2. Boxes (the dispatch unit)

New table `fg_boxes` (production DB, created by `create_all` at service start like every other table):

| column | |
|---|---|
| `id`, `plant_id`, `job_card_id`, `seq_no` | |
| `box_code` (unique) | `B` + card number without `/` and `-` + `-` + 3-digit seq, e.g. `B261014-001`, child card `B261014A-001` |
| `qty`, `qty_per_box`, `is_part` | pcs in this box; spec qty per box at packing; part box flag |
| `box_master_code` | spec box code (from the Packaging master) |
| `status` | `PACKED` → `DISPATCHED` (or `RETAINED` by the surplus decision; `VOID` reserved) |
| `allocations` | `[{entry_id, entry_no, pcs}]`: which Process runs filled the box |
| `business_date`, `shift_code`, `operator_name`, `machine_id` | from the run that completed the box |
| `qc_flagged`, `qc_flags` | out-of-band readings of the runs in the box (flag only) |
| `packaging` | theory packing material for this box (box 1, plastic/fadda per box, kg from master weights) + `warnings` |
| `fg_status`, `fg_item_id`, `inventory_batch_id`, `inventory_transaction_id` | FG posting per box |
| `dispatch_id`, `dispatched_at`, `label_prints`, `last_printed_at`, `packed_at`, `packed_by` | |

**Packing rule.** After every Process run, QC reading save and Process close, `pack_boxes` packs the QC-cleared good pcs not yet in a box (runs whose readings are short wait), oldest run first, into full boxes of `qty_per_box`. Leftover pcs carry to the next run. At Process close the remainder becomes one **part box**. With no qty per box on the spec nothing is boxed until the packing is set; at Process close all pcs go into one part box flagged "no qty per box on the spec". A Process run whose pcs are in a box cannot be voided. Reopening Process keeps the boxes; new runs fill new boxes.

**Stock.** Each box queues a `fg_box` effect: inventory FG inward of `qty` into a batch named after the box code (`external_ref FG-BOX-<id>`, idempotent, box code and part flag in the movement). A movement-blocking hold defers the posting. Each box also re-posts the card's month-end theory (`box_theory`), and theory packing rows come from the boxes (one box per box, plastic/fadda × per-box count, kg = pcs × master weight); a row that cannot be costed (no SKU, no weight for a KG item, box code not a stock item) is kept with a warning instead of being dropped. V2 Process close no longer queues the card-level `fg_inward`.

**Dispatch.** The challan of a box card carries `box_ids`. Seal checks: boxes belong to the card, are `PACKED` and posted to stock; qty = Σ box pcs ≤ released allocation left; only movement-blocking holds block. Inventory dispatch is posted per box batch (`external_ref PROD-DISPATCH-BOX-<id>`, idempotent per box), then Sales record-dispatch with the total. Boxes become `DISPATCHED`. Cards are on the dispatch register as soon as one box is packed (Process may still be running). The card completes when Process is closed and no box is left `PACKED`; "Retain surplus" marks the leftover boxes `RETAINED`. Cards whose FG was posted the old way (no boxes) keep the old quantity path.

**Challan.** Lists every box code with pcs (part boxes marked), box count, pcs per box and total; packing block from the spec (box code, qty per box, plastic/fadda per box).

**Labels.** `/production/boxes/labels?card=<id>` (or `?codes=`) prints stickers: A4 sheet (2×4 or 3×7) or single 100×75 mm. Fields: plant label heading, customer, product/spec, size, colour, job card no, SO no / customer PO, box code, pcs (PART BOX), packed date + shift, operator, QR → `/production/boxes/<code>`. Reprint is counted on the box (audit), never touches stock. `/scan` opens a box page for a box code or box URL.

## 3. QC flags only

Readings outside the band never create a hold on a job card (V1 inspection API included); the inspection keeps `FAIL` and a `flagged` marker, and the flag shows on the run, the box, the card and the dispatch register. Dispatch no longer requires V1 final QC pass; it is blocked only by movement-blocking holds placed on purpose. The 2-readings-per-check rule for closing a stage stays. GRN QC is untouched.

## 4. V1 alignment

* Completing a V1 stage below plan needs a reason and Owner/Admin/Plant Manager.
* V1 force close refuses while a movement-blocking hold is open or the Winder readings are short.
* Operations Control commercial short-close of a V1 card no longer marks it COMPLETED while made pcs are still in Oven/Process: it returns the gap and the card finishes normally.

## 5. Operator filter

Every floor log (runs, QC without a run, QC readings on a run; phone and PC) asks for the operator and offers only active employees whose Masters › Employees department is the stage (WINDER, OVEN, PROCESS). The server refuses an operator from another department.
