# Live-readiness review: job card close, partial dispatch, reasons, packing and challan

Read-only review of code at `3c85b67`, 1 Nov 2026, with read-only checks on the local season databases. **Nothing was changed.** The detailed findings, with file and line references, are in:
- `01-job-card-close-and-dispatch.md`
- `02-reasons-master-vs-typed-text.md`
- `03-packing-consumption-and-challan.md`

Card types: **V2** = batch-entry card (every new release; 248 of 340 local cards). **V1** = old-form card (older releases still running).

---

## Verdict

The stack is usable for daily floor logging, QC and planning. It is **not yet ready to sign off for live production** on four points. Each needs a decision, and then a change.

1. **A short close at a stage never gives the balance back to the order** (V2). The order then stays "Partly dispatched" forever and cannot be short-closed. The close dialog and the help guide say the opposite.
2. **Partial Process output cannot be dispatched.** Only a closed Process stage makes stock dispatchable. Closing Process early ends the card: the rest cannot be made on it.
3. **The challan's packing data is wrong for most cards.** It ignores the spec's box and pcs per box and prints "1 Bundle of 400 pcs". Packing material such as putha is not tracked anywhere.
4. **Reasons are inconsistent.** Order cancel, short close and hold use the master. Job card close, cancel and stage short close use typed text. The production short-close list starts empty, which blocks the final-QC shortage panel.

---

## 1. Job card close: what happens today

### Scenario: 1,000 pcs card, 400 pcs wound and logged, closed early at the Winder

| | V2 batch entry (all new cards) | V1 old form, Force close | V1 old form, "Complete Winding" at 400 |
|---|---|---|---|
| How you do it | **Close Winding short** on the card page (Plant Manager, reason typed). Force close is **refused** once anything is logged. | Job card manager > Force close (planner roles, reason typed) | Stage form "complete" (an Operator can do it; **no reason**) |
| The 400 already made | **Carry on** to Oven and Process on the same card. Downstream targets drop to 40 bamboo / 400 pcs automatically. | Carry on. Oven is trimmed to 400. **Process, Packing, QC and Dispatch keep the old qty** (stale). | Carry on. The next stage's input becomes 400, but a new Oven segment may be created for the full 1,000. |
| The 600 balance | **Stays on the card.** It is not returned to the order, cannot be released again, and blocks order short close. **The order never closes.** | **Returned to the order** automatically. It can be released again or short-closed on the order. | Not returned. Same stuck order as V2, unless someone force-closes the card afterwards. |
| QC | 2 readings per check are still needed to close. Holds block. | **Skipped**: no hold check and no readings gate on force close. | 2 readings needed. A hold stores the output as restricted. |
| Stock | No WIP stock. FG is posted once at Process close for good pcs. Unused bamboo becomes a "residual" HOLD/SCRAP row with no report. | FG at Packing/QC completion | Same as force close |
| Planner | Unstarted Winder slots are cleared. **Oven/Process slots keep the full qty** (stale load). | Only the next stage is trimmed | Not trimmed |
| What screens show | Card history says "Winding closed", not "closed short". The card keeps 1,000 qty. "Back to order" shows 0. | Card moves to the **Closed early** tab while its 400 is still in production. It never shows under Ready to dispatch. | — |

The only way to free a stuck V2 balance today is **Operations Control > short-close**. It works only after Process has closed, and it is linked only from Masters and Reports > Operations. There it can be carried forward to a new card (from Winding again) or dropped from the order.

### Other close paths found
- **V1 commercial short-close** (Operations Control) sets the card COMPLETED at any stage. Anything made but not yet packed is stranded, and the "produced" qty is typed, not checked.
- **V2 reopen bug.** Reopening a short-closed stage keeps the cut-down downstream targets. Dispatch is then capped at the old short qty, and good FG has to be "retained".
- **V2 card with all bamboo scrapped** cannot close Oven or Process without logging QC readings. It cannot be cancelled either, because it has entries.
- **Hold rules disagree.** Stage close and FG posting ignore advisory holds; challan sealing blocks on them. A card can close and post FG and then fail to ship.
- Split takes only unstarted first-stage qty, so it cannot split off a running card's balance.
- The V1 to V2 switch drops the live running log from the card (the audit keeps it).

## 2. Partial dispatch

| Question | Today (V2 and V1) |
|---|---|
| Process has 600 of 1,000 packed and is still running: can Dispatch ship the 600? | **No.** The card is not even listed on the dispatch register until Process closes. Sealing says "Close the Process stage first". |
| When is FG posted? | Once per card: at Process close (V2, by the background worker) or Packing/QC completion (V1). Never per run. |
| Can a challan be partial? | **Yes, after Process close.** Several challans are allowed, each limited to FG left. The order goes Partly dispatched, then Closed. |
| Ship 600 now and keep making 400 on the same card? | **Not possible.** Closing Process short posts FG for 600. The card cannot be reopened after FG posts. Unused Oven bamboo is stranded on hold. The 400 balance stays on the order (point 1). |
| Over-production | FG above the released qty can only be "retained surplus": it stays in stock with no way to ship it on that card. |

## 3. Reasons: master or typed text

| Action | Reason captured as | Server checks the master? |
|---|---|---|
| Sales order cancel / short close / customer hold & close | **Master** (Order close reasons, SO_CLOSE), plus note; OTHER needs a note | Yes, in the web gateway. The sales service itself accepts any code. |
| Job card force close / cancel / bulk close | **Typed text** (3+ chars, quick buttons fill example text) | No |
| V2 stage short close (Close Winding/Oven/Process short) | **Typed text** | No |
| Leftover input at stage close (hold/scrap) | Typed text | No |
| V2 shortage at final QC (Dispatch tab panel) and Operations Control short-close | **Master** (Reason codes, SHORT_CLOSE) | Yes, strict. **The list starts empty, so this panel is blocked until codes are added.** |
| Split / edit qty / emergency insert | Typed text (server: optional for split and edit) | No |
| Run rejected qty | Fixed list of 11 codes built into the screen | No: the server accepts no code. 12 of 23 local rejects have none. |
| QC hold / release | Typed text (release can be sent with no reason at all) | No |
| Customer complaint | Master (CUSTOMER_COMPLAINT) | No: any string accepted. CC-OTHER needs no note. |
| Stock correction, manual FG | Fixed lists in code | Yes (list check) |
| All purchase actions (PO reject/cancel/short close/revision, requisition, debit note, invoice difference) | Typed text | n/a |
| Machine downtime | Master (DOWNTIME), but the list starts empty | On create only, not on edit |

Other findings:
- Five reason categories (SCRAP, QC_REJECT, RM_ISSUE, RETURN, OTHER) appear on the Reason codes page but drive nothing.
- A customer hold reason is erased on resume, cancel or short close (only the audit keeps it), and resume asks for no reason.
- There is no report or filter by order close reason, and the order timeline does not show why a card was force-closed.
- The local database has active test reasons in the order close list, and one order uses a code that no longer exists in the master.

## 4. Packing, packing consumption and the challan

| Requirement | Today | Gap |
|---|---|---|
| Box from the box master | The spec picks box code from the Packaging master | Most spec box codes (R.125 on 101 cards, R.150, N-225, S-300, EXPORT) are **not in the box master or stock**. The box master has no pcs-per-box field. Packing is optional on a spec. |
| Pcs per box from the spec | `qty_per_box` is on the spec and frozen into the card at release | Used only for month-end theory and the close preview. Not on the floor, not on the challan. |
| Putha / partitions / tape / poly bags inside the box | Packaging master has Boxes, Plastic sheets and Fadda only | No master, no spec field and no stock link for putha and the others. (Is fadda the same as putha? Please confirm.) |
| Packing logged | V2: closing Process auto-closes Packing; nothing is recorded. V1: free fields. | No boxes filled, loose pcs, packer or box labels. Box count is always worked out, never counted. |
| Packing consumption posted | Stock goes out only when the store issues packing to the floor ("used in full"). At Process close a theory figure (boxes = pcs ÷ qty per box, rounded up; plastic/fadda per box) is written for month-end, quantity only. | No per-card stock posting and no value. Theory rows are dropped silently when the SKU or unit weight is missing (no local card has a plastic unit weight). Theory under R.125 can never match issues under R-150. |
| Challan shows correct packing | Packing = "Bundle" (hard-coded); PCS/Unit defaults to the **whole shipment**; units = pcs ÷ PCS/Unit | **13 of 23 sealed local challans say "1 Bundle"** (for example 400 pcs where the spec says 48 per box: correct is 8 boxes + 16 loose). V1's typed qty per bundle is saved under another name and never reaches the challan. Each partial challan rounds its last box up. No box type, loose pcs, packing materials, gross weight or HSN. |

---

## 5. Decisions to finalise (with a recommended option)

**Must decide before go-live**

| # | Decision | Options | Recommended |
|---|---|---|---|
| D1 | What a V2 stage short close does to the order | (a) Return the unmade balance to the order line at once. (b) Keep it on the card; at Process close ask "remake on a new card / drop from order / decide later". (c) Leave it and fix the wording. | **(a) at Winding** (planned − wound pcs goes back to the order, as the dialog promises; it can be released again or short-closed on the order). **(b) at Process close** for losses after winding: bring the Operations Control choice onto the card page. Not (c): orders would never close. |
| D2 | Partial dispatch while Process is running | (a) Keep "Process must close". (b) Post FG per QC-accepted Process batch (a "part close"), so it becomes dispatchable while Process stays open. (c) Split a running card at Process. | **(b)**, as you described: packing is done when Process is complete for that batch, and it can ship in part. This is the biggest build of the list. |
| D3 | Reason for job card close / cancel / stage short close | (a) Typed text. (b) Code from the master (SHORT_CLOSE, or a new "Job card close" category) plus an optional note; OTHER needs a note. (c) SO_CLOSE for customer-driven cancels, SHORT_CLOSE for floor shortages. | **(b)** with (c) for customer-driven card cancels. Keep the typed note. |
| D4 | First reason lists | Who writes SHORT_CLOSE and DOWNTIME (and a CUSTOMER_COMPLAINT starter list)? | **You give the list. It is seeded like SO_CLOSE.** Without SHORT_CLOSE codes the final-QC shortage panel is blocked. |
| D5 | Packing items inside the box | (a) Box + plastic + fadda only (confirm fadda = putha). (b) Add a general packing-item list (putha, partition, separator, tape, poly bag, label, strap) with unit, stock link and "qty per box" on the spec. | **(b)** |
| D6 | Box codes on specs | Create masters for R.125 / R.150 / N-225 / S-300 / EXPORT, or correct the specs. Make box + qty per box compulsory before a spec goes live? | **Map all to masters and make packing compulsory for new specs.** |
| D7 | Challan packing block | Packing = box code; PCS per box from the spec; "N boxes × X pcs + Y loose"; packing materials; gross weight; HSN; editable with reason? | **Default everything from the spec and show "N boxes × X + Y loose" and the box code. Allow edit with a reason. Add gross weight and HSN only if your customers need them.** |
| D8 | Packing consumption posting | (a) Keep "issue to floor = used" and fix month-end theory. (b) Post per card at Process close from floor stock. (c) Post at dispatch. Value at GRN rate? | **(a) plus fixes** (correct units, warn on missing SKU/unit weight, value at GRN rate) avoids double counting with the issue desk. Choose (b) only if you want true per-card stock, which also means changing packing issue from "used in full" to "floor stock". |
| D9 | Data clean-up before go-live | Deactivate test reasons; clean test cards (CHK3/CHK4, cancelled 26/10/70 with entries); fix stuck orders such as those from 26/10/14 and 26/10/11. | **Do it on the live database before go-live** (needs a reviewed script). |

**Can follow soon after go-live**

| # | Decision | Recommended |
|---|---|---|
| D10 | V1 cards | Move every running V1 card to batch entry where allowed. Otherwise require a reason and Plant Manager for below-plan completion, and make V1 force close respect QC holds and readings. |
| D11 | Reopen after short close | Restore downstream targets automatically. |
| D12 | Planner load after an early close | Shrink downstream slots to the new target automatically. |
| D13 | Hold rule for dispatch | One rule: only movement-blocking holds block the challan. Advisory holds show as a warning. |
| D14 | Job cards list | A force-closed card still producing stays under Running / Ready to dispatch, with a "closed early" chip. |
| D15 | Unused input (residual bamboo) | Keep hold/scrap. Add a residual register and a month-end line. Later, allow "carry to a new card". |
| D16 | One vocabulary | Floor sees "Close stage short". Office sees "Order: cancel / short close / hold" and "Card: split / edit / insert / cancel". Fold the Operations Control short-close into the card's shortage panel. |
| D17 | Reason hygiene | Server-side code checks in sales and inventory. Rejection codes move into the SCRAP category and become required when rejected > 0. Keep hold history after resume. Hide unused categories. Add a "cancelled / short-closed by reason" report. |
| D18 | Purchase and QC reasons | Typed text is acceptable for now. Revisit if you want supplier scorecards by reason. |
| D19 | Partial-dispatch loose boxes | Carry loose pcs as "loose" until a later challan completes the box, instead of rounding each challan up. |
| D20 | Plastic unit | Confirm kg. If kg, the spec must carry a plastic unit weight, and old PCS stock items (PS-150) need correcting. |

Once D1 to D9 are agreed, the changes can be scoped and built as one release, then checked against these scenarios before the stack is signed off.
