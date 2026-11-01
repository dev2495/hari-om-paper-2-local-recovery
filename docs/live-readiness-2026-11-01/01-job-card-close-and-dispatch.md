# Job card early-close, short-close and partial dispatch: how the code behaves today

Code at commit 3c85b67, read on 1 Nov 2026. This was a read-only review: nothing was changed. The local season databases were queried read-only to confirm behaviour.

**Path shorthand** (all paths are under the repo root `/Users/devarshthakkar/Downloads/hari om/hari-om-paper-2-local-recovery`):
- `P/` = `hariom-erp/services/production-service/src/`
- `S/` = `hariom-erp/services/sales-service/src/`
- `W/` = `apps/web-ui/`
- `B/` = `apps/bff-api/src/`

**Status words used below:**
- **BLOCKED**: the server refuses.
- **WARNED/FLAGGED**: it saves, but shows a note or flag.
- **AUTOMATIC**: the system does it with no action from anyone.
- **SILENT**: nothing happens and nobody is told. Flagged because it matters.

**Card types:**
- **V2** = batch-entry card (`spec_snapshot.entry_model == "V2"`). Every new release is V2.
- **V1** = old-form card.

In the local database, 248 of 340 cards are V2.

---

## Headline findings (read this first)

1. **On V2 cards, short-closing a stage never returns the balance to the sales order.**
   - The Close stage dialog says "the balance goes back to the order" (`W/components/production/card/CloseStageDialog.tsx:157`), and so does the help guide (`docs/help-guide/chapters/10-job-cards.md:106`).
   - The server's close (`P/routers/entries.py:1104-1186`) never calls sales. The BFF only adds a notification (`B/routes/production.py:45-49`).
   - The release lot keeps the full quantity. The order line therefore has no unreleased balance, so the 600 cannot be released again and the order cannot be short-closed. The order sits at **Partly dispatched** for ever.
   - Confirmed in the local data. Card 26/10/14 is Done with 352 shipped. Its lot is still 400 released and 0 returned. Order line: 400 ordered, 352 fulfilled, order status PARTIALLY_DISPATCHED.
   - The only way out is the hidden **Operations Control → short-close** screen (`P/routers/operations.py:555`). It is linked only from the Masters page and Reports › Operations.
2. **V2 cards cannot be force-closed once anything is logged on them.**
   - The code refuses at `P/routers/lifecycle.py:533-535` and `547-548`.
   - So for V2, "force close at the Winder" does not exist. Scenario A is the same as Scenario A2: Close Winding short.
3. **Output logged on Process is not dispatchable until Process is closed, on both V1 and V2.**
   - Finished goods (FG) are posted once per card, at Process close (V2) or at Packing / final QC completion (V1). They are never posted per run.
   - A V2 card cannot continue after its Process close has posted FG: reopen is refused (`P/routers/entries.py:1198`).
   - So "ship 600 now, keep making the other 400 on the same card" is not possible. Any Oven bamboo not used is stranded as a residual-WIP hold with no route to FG.
4. **Reopening a short-closed V2 stage leaves the downstream targets cut down.**
   - Reopen (`P/routers/entries.py:1189-1212`) never restores `effective_target`.
   - The Dispatch allowance is capped at that target (`P/dispatch_quantities.py:49-50`).
   - Result: a card that is reopened and finished at full quantity can ship only the old short quantity. The rest has to be "retained surplus".
5. **A force-closed V1 card that is still running disappears from the open tabs of the Job cards list.**
   - It shows under **Closed early**, an open:false tab (`W/lib/job-card-tracking.ts:13,37`), while its made quantity still has to go through Oven, Process and Dispatch.
   - It never appears under **Ready to dispatch**.
6. **The V1 commercial short-close (Operations Control) marks the card COMPLETED straight away, whatever stage it is at** (`P/routers/operations.py:714-715`).
   - After that, the old form refuses every stage (`P/routers/planning.py:8514`).
   - Anything already made but not packed is stranded: no FG and no challan.
   - The "produced" quantity on that path is whatever the user types.

---

## 1. Every way a card, or one of its stages, ends early or closes

| # | Action | Card type | Who (server roles) | Preconditions (server) | Reason required | What is recorded | Audit / notification |
|---|---|---|---|---|---|---|---|
| 1a | **Close stage** (Close Winding / Oven / Process), batch entry | V2 only | Owner, Admin, PlantManager (`P/routers/entries.py:1105`). Owner and Admin are super-roles (`P/utils/auth.py:8,172`). | See the list of gates below this table. | Only for a short close or for unused input: any non-blank text (`:1134`, `:1148`). The UI also needs non-blank text. | Stage COMPLETED. `actuals_snapshot` gets `closed_by`, `supervisor_name` (= the login), `close_reason`, `close_kind` (SHORT_CLOSE or TARGET_MET), residual quantity and disposition (`:1157-1159`). **All** segments of the stage are set COMPLETED, unstarted planner slots included (`:1160`). | Audit row `close:<STAGE>` with the reason and the flow (`P/routers/entries.py:357`). Idempotency receipt. BFF stage-closed notification. |
| 1b | **Stage complete** (old form, `save_mode=complete`) | V1 only | Owner, Admin, PlantManager, **Operator** (Operator only on the current stage) (`P/routers/planning.py:8498,8612`). | Prior stages complete unless an override reason is given (`:8972-8982`). At least 2 readings per required check (`:8987-8995`). An active QC hold stores the output as restricted and does **not** complete the stage unless a PM+ override is given (`:8898-8970`). Output ≤ planned +10% unless an override is given (`:9068-9081`). | **None, even when far below plan.** | Stage COMPLETED with `output_qty`. The next stage's `input_qty` = this output. A new next-stage segment is created for the **full card qty** (`:9200-9214`). | Audit `completed` (`:9259-9288`). |
| 2 | **Force close** ("Closed early") | V1 in practice. V2 only when nothing at all is logged, and then it becomes a cancel. | Owner, Admin, PlantManager, Planner (`P/routers/lifecycle.py:69,524`). Sales side: Owner, Admin, Planner, PlantManager (`S/routers/sales_orders.py:3295`). | V2 with any non-void entry → BLOCKED (`:533-535`). State must be Queued, Scheduled or Running (`:537`). A release lot must exist (`:539`). "Made" = Winder output × pcs per bamboo, capped at plan (`:541-545`). Made ≥ plan → BLOCKED "complete the card normally" (`:549-550`). **No QC-hold check and no QC-readings check.** | Yes. At least 3 characters, server-side (`:515`). | Winder RUNNING segments → COMPLETED, unstarted → CANCELLED. Winder stage COMPLETED with output = made (`:560-572`). `planned_qty` = made, `released_qty` = made, `returned_qty` = balance, `close_mode` = FORCE, plus `close_reason`, `closed_at`, `closed_by` (`:573-602`). Next stage's open segments are trimmed to made (**next stage only**) (`:574-593`). Sales lot shrinks; the balance becomes unreleased on the line (`S/routers/sales_orders.py:3314-3322`). | `job_card_force_closed` with before/after, made and returned (`:614`). Sales `release_lot_balance_returned`. BFF notifies "N pcs back to the order" (`B/services/handoff_events.py:446-461`). |
| 3 | **Cancel card** | V1, or V2 with no runs and no QC | Same as force close (it is the same endpoint). | Made = 0 (`P/routers/lifecycle.py:554-558`). V2: zero non-void entries (`:533`, `:176-181`). | Yes, at least 3 characters. | All open segments CANCELLED. `status` = CANCELLED, `close_mode` = CANCELLED. Whole qty returned. Lot becomes `cancelled` (`S/routers/sales_orders.py:3316`). Further runs, QC, closes and voids are refused (`P/routers/entries.py:572-575`). | Same as force close. |
| 4 | **Commercial short-close of a card** (Operations Control: CARRY_FORWARD / SHORT_CLOSE_SO / HOLD) | Both, with very different rules | Owner, Admin, PlantManager (`P/routers/operations.py:561`) | Reason code (soft-checked against the SHORT_CLOSE masters, `:647-652`) and a decision. **V2:** every stage, Packing and QC must be COMPLETED, i.e. Process closed. `produced_qty` must equal the final-QC accepted FG. Gap = released − accepted (`:513-535`). **V1:** any time before COMPLETED. `produced_qty` is **typed by the user** and not checked against output (`:609-641`). One short-close per card and stage (`:617-633`). | Reason **code** required. Notes optional. | `job_card_short_closes` row. SHORT_CLOSE_SO: sales line qty is reduced and the lot shrinks / becomes short_closed (`S/routers/sales_orders.py:3339-3420`). CARRY_FORWARD: a new top-up card (`split_kind` CARRY_FORWARD) for the gap, full route from Winder, with its own lot split from the original (`P/routers/operations.py:372-444`). HOLD: stays open until resolved (`:912+`). **V1: card set COMPLETED immediately (`:714-715`).** V2: COMPLETED only if everything is shipped or retained, else stays at Dispatch (`:538-552`). | `short_close_<decision>`, or `short_close_failed` on error. BFF notification "short-closed (N pcs gap)" (`B/services/handoff_events.py:375-398`). |
| 5 | **Split into a new card** | Both | Owner, Admin, PlantManager, Planner (`P/routers/lifecycle.py:408`) | State Queued, Scheduled or Running (`:417`). Release lot exists (`:419`). Qty ≤ **unstarted first-stage slots** (PLANNED/QUEUED/ASSIGNED) (`P/lifecycle_rules.py:122-143`). At least 1 pc must stay on the original (`:428`). A running card with a single running Winder slot therefore has 0 to split. | Optional on the server (`:397`). The UI asks for at least 3 characters. | Parent qty and slots reduced (latest slots give first). Child card `-A` is created in the queue, unplaced, with the same spec, QC profile and colour. Lot split through `reallocate-carry-forward` (`:493-503`). Safe to retry via `request_id` (`:412-415`). | `job_card_split` on the parent and `job_card_created_by_split` on the child (`:504-505`). Sales audit. |
| 6 | **Edit qty / colour** | Both | Owner, Admin, PlantManager, Planner (`:349`) | Queued only (`:353-357`). Release lot exists. Something must actually change. Sales refuses more than the line's free qty (`S/routers/sales_orders.py:3261-3265`). | Optional (`:340`) | Card qty, snapshots and the first-stage slot are resized. Sales lot amended. | `job_card_amended` with before/after. Sales `release_lot_amended`. |
| 7 | **Close without supervisor** | V2 close and V1 complete | As in 1a / 1b | V2: `supervisor_id` optional; the login name is recorded instead (`P/routers/entries.py:70-71,1111-1112`). V1: no supervisor field is required. | n/a | `supervisor_name` = the login's name on V2 | As in 1a / 1b |
| 8 | **Emergency insert** | Both | Owner, Admin, PlantManager, Planner (`P/routers/lifecycle.py:636`) | Queued or Scheduled only, with unstarted first-stage work (`:641-648`). | Yes, at least 3 characters (`:628`). | The card goes first in the chosen slot. Overflow cards move to later shifts; running cards never move (`P/lifecycle_rules.py:161-179`). `is_emergency` = true. | `job_card_emergency_insert` with the list of bumped cards. Notifications. |
| 9 | **V1 → V2 switch** ("Move to batch entry") | V1 | Owner, Admin, PlantManager, Planner, Operator (`P/routers/planning.py:8434`) | Card not Completed or Cancelled. No stage other than Slitting completed (`:8450-8455`). | None | `entry_model` = V2 with the published stage QC rules. **Every non-completed stage's output, input, scrap, entry form and `actuals_snapshot` is wiped to 0.** Running segments go back to Assigned or Queued with 0 output (`:8472-8482`). Only the old `entry_snapshot` values are kept, as `old_drafts` (`:8458-8463`). The live running log (`actuals_snapshot.running_log`) is **not** kept. | `switched_to_batch_entry` |
| 10 | **Reopen stage** | V2 only (V1 has no reopen) | Owner, Admin (`P/routers/entries.py:1190`) | Reason. Refused if FG has been posted (`:1198`), if tool usage has been posted (`:1199-1201`), if a downstream stage is closed (`:1204`), if the month is closed (`:1202-1203`), or if residual stock was physically disposed (`:1207`). | Yes | Stage back to RUNNING. **Downstream `effective_target` is not restored** (see finding 4). | `reopen:<STAGE>` |
| 11 | **Retain surplus FG** (ends a card with extra FG) | V2 only | Owner, Admin, Dispatch (`P/routers/dispatch_surplus.py:33`) | Packing and QC closed, no hold, FG posted, the released quantity already shipped (`:55-75`) | At least 5 characters (`:24`) | Dispatch stage COMPLETED and card COMPLETED. The surplus stays in stock as a batch that this card can never ship (`P/routers/dispatch.py:612-613`). | `SURPLUS_FG_RETAINED` |
| 12 | **Card completes on dispatch** | Both | Owner, Admin, Dispatch seal (`P/routers/dispatch.py:31,505`) | Shipped ≥ dispatchable FG (`:730-732`) | n/a | Card COMPLETED, current stage DONE | Dispatch records |
| — | Legacy `/jobs/{id}/close` | Old ProductionJob model, not job cards | PM, Admin | — | — | Not part of the job card flow (`P/routers/jobs.py:502`) | — |

The server-side gates for a V2 Close stage (row 1a) are:
- previous stage closed (`:1130`), except Slitting, which closes along with Winding (`:1151-1156`);
- no drafts (`:1131`);
- at least 2 readings per required check, which applies to short closes too (`:1132`);
- no movement-blocking QC hold (`:1133`);
- short of target needs `short_close` plus a reason (`:1134`);
- on Process, every good batch must be QC-accepted (`:1138`) and there must be no Process carryover (`:1140`);
- unused upstream input must be put on HOLD or SCRAP with a reason (`:1146-1149`).

The help guide's "force close is old-form only" and "a batch card closes short on the card page" match the code. Its statements that the short close sends "the balance back to the order" do not.

---

## 2. Scenario A: a 1,000 pcs card, 400 pcs (40 bamboo at 10 pcs per bamboo) wound and logged, then closed early at the Winder

### A for V2 (batch entry): force close is BLOCKED, so "early close" here means Close Winding short (Scenario A2)

Force close returns 409 with the message "Runs or QC are already logged on this card: close it short with Close stage…" (`P/routers/lifecycle.py:533-535`). So on V2, A and A2 behave the same way, as follows.

**(a) The 400 already made**
- They carry on, on the same card. Oven may keep taking Winder batches, because Winding→Oven is continuous (`P/routers/entries.py:26,248`).
- Once Winding is closed, every Winding batch counts as QC-cleared (`:214`). AUTOMATIC.
- Downstream targets are cut down: Oven to 40 bamboo, and Process, Packing, QC and Dispatch to 400 pcs, written to `effective_target` (`:1162-1171`). AUTOMATIC.
- Oven and Process can still log runs. Oven cannot close before Winding is closed, and Process cannot close before Oven (`:1130`). BLOCKED until the previous stage is closed.
- At Oven close, any wound bamboo the Oven did not take must be put on HOLD or SCRAP with a reason (`:1146-1149`). BLOCKED until this is done.
- At Process close, the good pcs become FG. They are dispatchable up to the smallest of FG, released qty (1000) and the Dispatch target (400) (`P/dispatch_quantities.py:41-51`).

**(b) The 600 balance**
- It is **not** returned to the order. SILENT.
- `close_stage` makes no sales call (`P/routers/entries.py:1104-1186`).
- `job_cards.planned_qty`, `released_qty` and `returned_qty` are unchanged: the local data shows 500/500/0 and 400/400/0 on short-closed cards.
- The release lot stays at 1000 released.
- It **cannot be released again**: the order line's unreleased balance = line qty − Σ lot released = 0 (`S/routers/sales_orders.py:2997-3007`). BLOCKED.
- The order page's Short close is refused with "Everything left is already on job cards…" (`S/order_closure.py:101-105`, `52`). BLOCKED.
- The order page shows "made" = Winder pcs (400) taken from lifecycle `made_qty` (`W/app/(dashboard)/sales-orders/[orderId]/page.tsx:142-146`, `P/routers/lifecycle.py:101-106`). It also shows "still to send" 600 for ever, with status **Partly dispatched** after the first challan (`S/routers/sales_orders.py:647-660`).
- The only way out is Operations Control after Process is closed (`P/routers/operations.py:513-535`):
  - CARRY_FORWARD makes a new card for released − FG (for example 1000 − 390 = 610), starting again from Winding;
  - SHORT_CLOSE_SO cuts the line by the gap.

**(c) Inventory**
- **WIP:** there is no WIP inventory for tubes in progress; the inventory service has no production WIP entity. Bamboo the Oven did not take becomes a production-only `continuous_residual_wip` row (HOLD or DISPOSED) (`P/routers/entries.py:768-779`). It is visible only on the card's Material tab and print (`W/components/production/card/tabs/MaterialTab.tsx`). No stock posting, no report.
- **Material issue:** paper and reels are issued to the floor by shift, not to the card. Linking reel issues at Winding close is optional (`P/routers/entries.py:1135-1136`).
- **Theory consumption:** posted only at Process close, for the packed (FG) qty in proportion to plan (`P/routers/planning.py:553-569,637-649,777+`). It is AUTOMATIC. A short-closed card therefore posts theory for about 390 pcs. Paper used on rejected or scrapped bamboo and on residual WIP appears only as month-end variance.
- **FG inward:** once, by the completion worker, after Process close auto-closes Packing and QC, for the accepted qty (`P/routers/entries.py:1179-1184`, `P/completion_worker.py:85-89,27-39`). It is AUTOMATIC and retries on failure. It is blocked by a movement-blocking hold.
- **Losses:** no separate loss posting. Rejects, cutting loss and scrapped residuals stay as production records only.

**(d) Planner slots**
- The Winder's unstarted slots are marked COMPLETED with 0 output (`P/routers/entries.py:1160`). They drop out of the Winder load (`P/routers/lifecycle.py:830`) and show as "not needed" in plan matching (`P/plan_match.py:131-132`).
- **Oven and Process slots keep their full planned qty.** Only `effective_target` is changed, so capacity stays booked and the slots read as "partly" done until those stages close. SILENT.

**(e) QC**
- The short close still needs at least 2 readings per required check on the stage (`:1132`). BLOCKED until present.
- Out-of-band readings are flagged only (`:812-816`). WARNED/FLAGGED.
- Movement-blocking holds block the close (`:1133`). BLOCKED.
- Process close needs every Process batch QC-accepted (`:1138`). BLOCKED.

**(f) Dispatch readiness**
- Dispatch opens only after Process closes (`P/routers/dispatch.py:592-598`).

**(g) Reports and lists**
- The Job cards list shows the card as Running, then Ready to dispatch, then Done.
- Qty still reads 1000.
- The card manager's "Back to order" tile reads 0.
- Card history titles the event "Winding closed", **not** "closed short". `card_history.py:94` looks for `result.short_close`, but the stored result only holds `flow`, as the local audit rows confirm. WARNED/FLAGGED: wrong label.
- Reports › Operations short-close counts include only commercial short-closes, not stage short closes.

### A for V1 (old form) with Force close at the Winder

**(a) The 400**
- The Winder segment becomes COMPLETED and the stage COMPLETED at 40 bamboo, **without** the stage QC-readings gate and without posting tool usage. Force close does not go through `capture_stage_output` (`P/routers/lifecycle.py:560-572`).
- The card's `planned_qty` becomes 400 (`:573`).
- The Oven's open segments are trimmed to 400 pcs (`:591-592`).
- Oven, Process, Packing and QC can still be entered: running entries allow FORCE_CLOSED (`P/lifecycle_rules.py:97`, `P/routers/lifecycle.py:738`), and the old form only refuses COMPLETED or CANCELLED cards (`P/routers/planning.py:8514`). AUTOMATIC.
- **Process, Packing, QC and Dispatch segments keep the old planned qty.** The local card 26/10/24 shows 840 pcs on those segments after closing at 800. SILENT.

**(b) The 600**
- It is returned to the order (`P/routers/lifecycle.py:604-613`, `S/routers/sales_orders.py:3289-3336`). AUTOMATIC.
- The lot shrinks to 400 and becomes `short_closed`. The line now has 600 unreleased.
- The 600 can be released again as a new card from the order page, or dropped with order Short close. If the order was already short-closed, the returned balance is dropped automatically (`:3323-3325`).

**(c) Inventory**
- FG is posted when Packing or final QC completes with final QC passed (`P/routers/planning.py:9163-9174,9230-9245`). AUTOMATIC and synchronous.
- Theory is posted at Packing or QC completion (`:9147-9155`).
- No WIP posting.

**(d) Planner slots**
- Unstarted Winder slots are CANCELLED. The Oven is trimmed.
- Later stages are not trimmed (stale load). SILENT.

**(e) QC**
- No hold check and no readings check on force close. SILENT.
- Downstream stages keep their own QC gates.

**(f) Dispatch**
- Allowed once Packing, final QC and FG are posted.
- The dispatch register lists the card (`P/routers/dispatch.py:795`).

**(g) Reports and lists**
- The Job cards list puts it under **Closed early** (not an open tab), while its 400 are still in production (`W/lib/job-card-tracking.ts:13,37`).
- The stage track shows the current stage as "pending", not "current" (`:81,88`).
- The order page shows "Force closed … N pcs back to the order" (`W/app/(dashboard)/sales-orders/[orderId]/page.tsx:622`).

### A2 for V1 (normal "complete Winding" with 40 of 100 bamboo)

- No reason. No warning. No downstream target change. No balance returned. SILENT.
- The next stage's `input_qty` = 40. A new Oven segment, if none exists, is created for the **full 1000** (`P/routers/planning.py:9198-9214`).
- The order line is then stuck exactly as in V2, **unless** a planner force-closes the card afterwards.
- That is possible only while the card is not yet COMPLETED. "Made" counts Winder output (400 < 1000), so 600 is returned (`P/routers/lifecycle.py:537-550`).

---

## 3. Scenario B: Process has logged 600 of 1,000 good pcs and is still running

### V2

- **Is the 600 dispatch-ready now? No.** BLOCKED.
  - The dispatch register lists only cards whose current stage is Packing, QC, Dispatch or Done (`P/routers/dispatch.py:795`). A card at Process is not listed.
  - Sealing refuses with "Close the Process stage first…" (`:596-597`).
- **FG inward:**
  - not per run;
  - posted once, when Process is closed. Process close auto-closes Packing and QC with qty = Process good total (`P/routers/entries.py:419-433,1179-1184`);
  - posted by the completion worker for `min(packed, QC output)` (`P/dispatch_quantities.py:13-19`, `P/completion_worker.py:27-39`).
- **"Ready to dispatch" requires all of:**
  - Process closed (so Packing and QC are COMPLETED);
  - the FG posting delivered: a packing record with an inventory batch (`P/routers/dispatch.py:378-384,600-602`);
  - no hold in HOLD status, **including advisory or batch holds**, which do not block stage close (`:585-587` against `P/routers/planning.py:4692-4707`);
  - complete challan master data: plant legal name, address and GSTIN; customer ship-to street; vehicle; transporter; net weight (`P/routers/dispatch.py:330-362`);
  - the sales order line released and with balance (`S/routers/sales_orders.py:3463-3472`).
  - In the Job cards list, "Ready to dispatch" simply means the current stage is Dispatch (`W/lib/job-card-tracking.ts:40`).
- **Partial dispatch** works after Process close. AUTOMATIC.
  - Several challans can be sealed.
  - Each is limited to accepted FG minus shipped, and to the allowance = min(FG, released, Dispatch target) (`P/routers/dispatch.py:607-620`).
  - The card completes when shipped ≥ FG (`:730-732`).
  - The order goes Partly dispatched, then Closed, when line fulfilled ≥ line qty (`S/routers/sales_orders.py:647-660`).
- **Surplus:** if FG > the allowance, the card stays at Dispatch until "Retain surplus FG" (Owner, Admin, Dispatch, reason) closes it. The extra FG stays in stock with no route out (`P/routers/dispatch_surplus.py`). WARNED/FLAGGED.
- **The remaining 400:** to ship the 600 early, Process must be closed short with a reason. Then:
  - unused Oven bamboo must be put on HOLD or SCRAP (`P/routers/entries.py:1146-1149`);
  - FG 600 posts;
  - the card cannot be reopened after FG has posted (`:1198`);
  - the 400 cannot be made on this card. The held bamboo has no route to FG: residual "resolve" offers only SCRAP or RETURN (`:789`);
  - the commercial balance stays on the order line (headline finding 1). Operations Control CARRY_FORWARD can remake it from Winding.
  - Split does not help: it only takes unstarted first-stage quantity (`P/lifecycle_rules.py:128-133`).
- **Force close after partial Process output:** BLOCKED for V2 (`P/routers/lifecycle.py:533-535`).

### V1

- Process is one old-form entry per stage. A "partial" 600 can only be a **draft** (`P/routers/planning.py:8810-8888`), and a draft is not dispatchable.
- The dispatch path needs:
  - Process completed, then Packing completed (creates the packing record), then final QC completed and passed;
  - FG posted at Packing or QC completion (`:9163-9174`);
  - then sealing checks final QC passed, the packing record and the FG batch (`P/routers/dispatch.py:590-591,600-602,378-384`).
- Partial dispatch after that: several challans are allowed. The V1 allowance is the packed qty, with **no released-qty cap** (`P/dispatch_quantities.py:43-44`). Only the sales line balance limits it.
- Force close after partial Process output:
  - allowed only if the **Winder** made less than plan, because "made" is counted at the Winder only (`P/routers/lifecycle.py:541-550`);
  - if winding was complete it is refused with "Everything planned is already made — complete the card normally". BLOCKED.
  - If allowed, the made qty keeps moving and the Process form stays usable.

### V1 against V2 for Scenario B

| | V2 | V1 |
|---|---|---|
| Process partial visible as | Submitted runs, stage RUNNING | A draft on the stage form |
| FG posted | At Process close, by the async worker | At Packing / QC completion, synchronous |
| Dispatch before Process close | BLOCKED | BLOCKED (no packing record / FG) |
| Dispatch cap | min(FG, released, Dispatch target) | Packed qty, plus the sales line balance |
| Force close mid-Process | BLOCKED | Only if the Winder was short |
| Short close reason | Required | None |

---

## 4. Edge cases and gaps that would hurt live production

1. **Order lines stranded after a V2 stage short close.** See headline finding 1. Every V2 short close leaves the order at Partly dispatched for ever, and the help guide and dialog say the opposite. Already in the local data: 26/10/14 and 26/10/11. High impact: the order list, fulfilment, due and overdue counts and the "still to send" figures are all inflated.
2. **The V2 reopen bug.** The downstream `effective_target` stays cut after a reopen (`P/routers/entries.py:1162-1171` against `1189-1212`). The Dispatch allowance then caps shipping (`P/dispatch_quantities.py:49-50`), and the extra good FG must be "retained", not shipped.
3. **Stranded V2 WIP.**
   - Residual HOLD rows have no report, no month-end line and no route back into production (`P/routers/entries.py:782-792` offers SCRAP or RETURN only).
   - A V2 card whose made bamboo is all scrapped cannot close Oven or Process without logging fake QC readings. Stage readiness needs 2 readings per check even with zero runs (`hariom-erp/services/production-service/shared/season_quality.py:261-277`, `P/routers/entries.py:1132`).
   - It cannot be cancelled either, because it has entries.
4. **V1 commercial short-close strands WIP.** The card is set COMPLETED at any stage (`P/routers/operations.py:714-715`), after which the old form refuses everything (`P/routers/planning.py:8514`). The produced qty is typed and not checked.
5. **V1 force close skips gates.**
   - No QC-hold check and no 2-readings gate for the Winder.
   - No tool usage posted for the Winder.
   - A Winder **draft** quantity is counted as "made" (`P/routers/lifecycle.py:541-572`).
6. **Stale planner load.**
   - V1 force close trims only the next stage (`:574-593`). DB card 26/10/24 shows Process, Packing, QC and Dispatch still at 840 pcs.
   - V2 short close changes no downstream slot qty at all.
7. **List and status mismatches (UI against server).**
   - A force-closed V1 card that is still in production shows under "Closed early" (closed), never Running or Ready to dispatch (`W/lib/job-card-tracking.ts:37`).
   - The close dialog says un-QC'd runs will wait for QC, but the server clears every batch of a closed stage (`W/components/production/card/CloseStageDialog.tsx:226` against `P/routers/entries.py:214`).
   - Card history never says "closed short" (`P/routers/card_history.py:94`).
   - The order page's "made" is Winder pcs, not good pcs (`P/routers/lifecycle.py:101-106`).
   - The manager's "Back to order" is 0 for V2 short closes.
8. **Two hold rules.**
   - Stage close and FG posting ignore advisory or batch holds (`P/routers/planning.py:4692-4711`).
   - Dispatch sealing blocks on **any** hold in HOLD status (`P/routers/dispatch.py:202-210,585-587`).
   - So a card can close Process and post FG, and then fail to ship.
9. **Who closes.** V1 lets an Operator complete a stage, below plan and with no reason (`P/routers/planning.py:8498`). V2 needs a Plant Manager and a reason. The help guide states only the V2 rule.
10. **Overproduction guard after a short close.** V2's 110% check uses the original plan, not `effective_target` (`P/routers/entries.py:639-641`). Process can also log more pcs than the bamboo allow; that is only flagged as a count gap (`:685-701`). The extra becomes surplus to retain.
11. **Split mid-run.** Split only takes from unstarted first-stage slots (`P/lifecycle_rules.py:128`). A card with one running Winder slot cannot be split, so "split off the balance" is not a real alternative to a short close.
12. **The V1 → V2 switch drops the live running log.** `actuals_snapshot` is wiped and only `entry_snapshot` is kept as `old_drafts` (`P/routers/planning.py:8458-8476`). Runs logged through the old "running entry" are lost from the card. Audit events remain.
13. **Test-data anomalies to clean before go-live.**
   - Local cards CHK3/* and CHK4/* are COMPLETED with `close_mode = CANCELLED`.
   - Card 26/10/70 was cancelled and then received two entries on 27 Oct, apparently before today's cancel guard (`P/routers/entries.py:954`).
   - The Job cards list treats these inconsistently.
14. **Month-end.** A card that never reaches Process close posts no theory and no FG in that month. All its paper shows as unexplained variance, and scrapped residuals are never valued.

---

## Decisions the owner should make (options, not changes)

1. **What a V2 short close does to the order** (the most urgent):
   - (a) The stage short close also returns the unmade balance to the order line automatically, as the dialog promises. This needs a rule for which quantity counts: pcs equivalent at that stage, or final FG.
   - (b) Keep the balance on the card until Process closes. Then ask, in the close dialog itself, "remake (new card) / drop from order / decide later". This brings the hidden Operations Control decision onto the card page.
   - (c) Leave it as is and fix the wording. Not recommended: orders never close.
2. **Should V2 have a real "force close at the Winder"** (stop winding, the made qty finishes, the balance goes back)? Or is "Close Winding short" the one tool? If it is the one tool, it must carry the balance return in option 1.
3. **Partial dispatch while Process is running:**
   - (a) keep "Process must close" (simple, but the rest of the card is lost);
   - (b) allow an FG posting per Process batch, or a "part close" that posts FG for QC-accepted batches and keeps the stage open;
   - (c) allow splitting a running card at Process (unused Oven bamboo moves to a child card).
4. **Unused input at stage close:** keep HOLD/SCRAP only, or allow "carry to a new card" so held bamboo can become FG. Also decide whether open residual holds should appear on a register and at month-end.
5. **V1 cards before go-live:**
   - (a) move every running V1 card to batch entry where allowed;
   - (b) require a reason when a V1 stage completes below plan, and limit V1 completion to the Plant Manager;
   - (c) make V1 force close and the commercial short-close respect QC holds and readings, and stop setting the card COMPLETED mid-route.
6. **List tabs:** should a force-closed card that is still producing stay under Running / Ready to dispatch, with a "closed early" chip, instead of the closed "Closed early" tab?
7. **Hold rule for dispatch:** should an advisory or batch-level hold block the challan, as it does today, or only movement-blocking holds, as for stage close?
8. **Reopen after a short close:** restore downstream targets automatically, or require them to be set by hand? Today they stay cut and later cap dispatch.
9. **Planner load after an early close:** should downstream slots shrink to the new target automatically (V1 trims only the next stage; V2 trims none)?
10. **One vocabulary:** the system has stage short close, card commercial short-close, order short close, force close and cancel. Decide which two or three the floor and office should see, and retire or hide the rest. Operations Control is currently reachable only from Masters and Reports.
