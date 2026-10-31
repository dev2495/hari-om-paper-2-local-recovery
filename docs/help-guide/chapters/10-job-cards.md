# Job cards

> **What it is:** The list of every job card in the plant and the one page per card that shows its stages, runs, QC, plan, material, dispatch and full history.
> **Who uses it:** Planner, Plant Manager, Operator, QC and In-process QC, Sales, Dispatch, Owner and Admin.
> **Where:** Sidebar > Operations > Job Cards (/production/job-cards); one card opens at /production/job-cards/<card>

## At a glance
- A job card is made when a sales order line is released. Its number is year/month/running number, for example **26/10/315**. A card split off it gets a letter: **26/10/315-A**.
- The **Job cards** list tracks where every card is. Click a row to open the card page. Lifecycle changes (split, edit, force close, cancel, emergency) are done in the **Job card manager**, not here.
- The card page is where the day's work happens: **Log output**, **Log QC**, **Close stage**, **Print card**, **Phone link**.
- Planning never blocks the floor. A card that is not on the planner can still take runs; such runs are only flagged "run before planning". Card start and end times never block a save.
- A QC reading outside its band is saved and **flagged, not held**. Only a hold raised by QC on the Quality pages stops the next stage and dispatch.

## The flow
```flow
title: Life of a job card
Release order line [Sales] -> Card in queue (Queue) -> Plan the stage [Planner] (Scheduled) -> Log runs and QC [Operator] (Running) -> Close stage [Plant Manager] -> Close Process [Plant Manager] (Ready to dispatch) -> Seal challan [Dispatch] (Done)
after Card in queue: Log runs before planning [Operator] (flagged) -> Close stage [Plant Manager]
after Log runs and QC: QC hold [QC] (On hold) -> Release hold [Plant Manager/Owner/Admin] -> Log runs and QC [Operator]
after Card in queue: Force close or cancel [Planner] (Closed early)
```
A card moves Winding, then Oven, then Process. Packing and the final QC close automatically with Process, so the floor sees only W, O, P and D (Dispatch). Closing Process posts the finished goods and the card becomes **Ready to dispatch**.

```flow
title: Batch entry (V2) versus old form (V1)
Card released [Sales] -> Batch entry card (V2) -> Log output and Log QC forms [Operator] -> Close stage [Plant Manager]
after Card released: Old-form card (V1) -> Old form tab [Supervisor] -> Move to batch entry [Planner/Supervisor] (only if no stage closed)
```
Every new release is a batch-entry card. Old-form cards are cards released before batch entry; they keep their stage form until they finish or are moved to batch entry.

## Screen tour

![Alt: Job cards list with KPI tiles, status tabs, filters and the card table](../screens/jobcards-list.jpg)
*Figure: The Job cards list. Tiles across the top count open, priority, overdue, QC-hold and dispatch-ready cards and the cards at each stage; below are status tabs, search and filters, and a table with one row per card.*

What you see:
1. **Header buttons**: **Print list**, **Export CSV**, **Planner board** and **Job card manager**.
2. **Tiles** (whole plant): **Open cards**, **Priority · 3 days** (due in the next 3 plant days), **Overdue** (due before today), **QC holds** (active holds), **Dispatch ready**, then one tile per stage (**Winding**, **Oven**, **Process**, and **Slitting** when it has cards). Click a tile to filter the list; click it again to clear.
3. **Red banner**: "N open cards have an active quality hold. Quality desk before dispatch." It shows only when holds exist.
4. **Status tabs** with counts: **All**, **Queue** (released, not on the planner), **Scheduled** (on the board with date, shift and machine), **Running** (runs being logged), **On hold** (active quality hold), **Ready to dispatch** (Process closed, waiting for a challan), **Closed early** (force-closed or cancelled), **Done**.
5. **Search** (press **/** to jump to it): card, order, customer, PO, size or colour.
6. **Group by**: **None**, **Sales order**, **Stage**, **Status**, **Machine**. Each group line shows the card count and total pcs.
7. **Plan filter**: **Plan: any**, **Planned**, **Not planned yet**.
8. **QC filter**: **QC: any**, **Flagged readings (N)**, **On hold (N)**.
9. **View** menu: saved views (see How to save a view). On the right, "324 of 324 cards" tells how many rows match.
10. **Table columns**: **Card · size · colour**; **Order · customer**; **Qty** (pcs, with bamboo or kg under it); **Status · machine** (status badge, current stage and machine, a thin stage bar); **Plan status** (hover for detail and **Open in planner**; "released 30 Oct" under it); **Due** ("No date" when the order has none); **QC** (**Hold** in red or **Flagged · N runs** in amber).
11. **Row menu (…)**: **Open**, **Log output**, **Log QC**, **Print card (A4)**, **Manage card**, **Plan / reschedule**, **Material genealogy**, **Sales order**.

Plan status words you may see: planned (date and shift), running, plan in parts, slot passed, missed (went back to the queue after 36 hours), not planned yet, waiting for the previous stage's plan, nothing to plan (packing and QC follow Process), all done. It is information only.

![Alt: Job card page for card 26/10/315 with header, action bar, stage stepper and Overview tab](../screens/jobcard-detail.jpg)
*Figure: The job card page for 26/10/315. The header gives the card's identity and bamboo math; an action bar holds Log output, Log QC, Print card, Phone link and Manage card; a stepper shows Winding, Oven, Process and Dispatch; the Overview tab shows today's numbers, holds and flags, the next step and card details.*

What you see:
1. **Header**: card number, lifecycle badge (**In queue**, **Scheduled**, **Running**, **Completed**, **Force-closed**, **Cancelled**), family chip ("no split", or "split of 26/10/315" with links), amber chips for **N flagged readings** and **N count gap** (Process pieces not matching bamboo × pcs per bamboo), then order and line, customer, PO and due date. Second line: size, colour, "Qty 900 pcs = 90 bamboo × 10 pcs", "Winding · Oven in bamboo, Process onwards in pcs", release date and plan status.
2. **Action bar**: **Log output**, **Log QC** (with "N waiting" when runs need readings), **Close <stage>** (shows a lock and "plant manager" or "QC short" when you cannot close), **Print card**, **Phone link** (QR and link to open this card on a phone), **Manage card**. A greyed button shows why on hover, for example "Card is closed" or "Your role cannot log runs".
3. **Stage stepper**: each stage with good/target (for example 90 / 90 bamboo), status chip and flag count, and who closed it and when. Click a stage to jump to its runs.
4. **Tabs**: **Overview**, **Output log** (old-form cards show **Old form** instead), **QC**, **Plan**, **Material**, **Dispatch**, **History & audit**.
5. **Overview** tiles: **Runs today**, **Made today**, **Flagged readings** ("outside the band · accepted, not held"), **Waiting**. Then **Numbers per stage** (Target, Made, Good, Rejected, %, Status, Closed), **Today on this card**, **Open holds and flags**, **Next step** and **Card details** (order, customer, size, colour, quantity, bamboo math, released, due, priority, lot).

The other tabs:
- **Output log**: every run with who, when, machine, made, good, rejected, QC state and plan match. Stage chips filter it. Buttons: **Export** (Excel), **Whole printed card** (plant manager types a full paper card at once), **Reopen stage…** (Owner and Admin), **Log output**. The footer lists rejection codes: WL Winding loose, PG Pasting/glue, ID I.D. out, OD O.D. out, LN Length, WT Weight, CS C.S., DM Damage, MS Moisture, NT Notch, OT Other.
- **QC**: samples per stage, **Waiting for QC**, **Limits on this card** (frozen at release, with rule version and season) and **Flags and holds** with a link to the **QC flags register**.
- **Plan**: each planner slot with what was logged in it. "The plan is never moved by the floor."
- **Material**: reels issued to the winder, issued versus theory, and what was posted to stock.
- **Dispatch**: packing posted at Process close and the dispatch slips (challans) from this card.
- **History & audit**: every event, filter chips **All**, **Card**, **Output**, **QC**, **Stages**, **Planning**, **Dispatch**, **Other**, a search box and an Excel export.

![Alt: Print page of a job card, A4 portrait, with page choices and the Print Job Card button](../screens/jobcard-print.jpg)
*Figure: The printed job card. A panel lists the pages (front, back, optional page 3) with a Print Job Card button; below is the A4 portrait front with the header, QR code, and the winder, oven and process sections.*

What you see:
1. **Page list**: **Page 1 · front** (header, then winding, oven, process line, dispatch and tolerances one below the other), **Page 2 · back** (the order's spec sheet, turned to fit the portrait page), and a tick box for **Page 3** (production and QC log: every run and every reading; ticked by default once the card has runs).
2. Print hint: "A4 portrait · two-sided, flip on long edge · scale 100%" and the **Print Job Card** button.
3. **Front header**: plant logo, "JOB CARD" (with Hindi), JC No., SO number, colour, and a **QR code**. Scanning the QR with a phone opens this card's floor entry page.
4. **Header grid**: Date, Customer, Mandrel, Lot Number, Size, Colour, Order Qty, Denier, Weight / Pc, Required C.S, Pcs / Bamboo, Remarks.
5. **Stage blocks** (Winder, Oven, Process line, Dispatch, Stage QC): shift, operator, supervisor sign, output, reject and accepted qty, start and end time, cycle time, and reading rows with the allowed band printed above each column.
6. **Footnotes**: "†" marks a run entered before the planner placed the stage, on another machine, or before the slitting record; "✗" marks a reading outside its limit, "saved and flagged for QC, not held".

## Step by step

### How to find a card
1. Open **Job Cards**. Roles: everyone listed above.
2. Type part of the card number, order, customer, PO, size or colour in the search box. The list filters as you type.
3. Or click a tile (for example **Overdue**) or a status tab (for example **Running**).
4. Click the row to open the card. Ctrl-click (Cmd-click on Mac) opens it in a new tab.

### How to save and reuse a view
1. Set the tab, group, plan filter, QC filter and search you want.
2. Open the **View** menu and save the current filters with a name.
3. Next time, open **View** and pick it. Touching any filter by hand leaves the saved view. **Clear all** resets every filter.

### How to print or export the list
1. Filter the list to what you need.
2. Click **Print list**. All matching rows print, not only the first 60 shown on screen.
3. Or click **Export CSV**. The file "job-cards-<date>.csv" holds the matching rows.

### How to open a card's next step
1. Open the card. Read **Next step** on the Overview tab.
2. It tells you what is pending: runs with the supervisor to submit, runs waiting for QC, how much is left to make on the current stage, or that the stage is ready to close.
3. Click the button in that box (**Log output**, **Log QC**, **Close stage**, **Dispatch**). Logging is explained in "Log output and QC entry".

### How to close a stage (batch-entry card)
Roles: Plant Manager, Owner, Admin. No supervisor needs to be picked; your login is recorded as the one who closed it.
1. On the card, click **Close <stage>** in the action bar.
2. The dialog shows "N of target good". If the stage is short of target, closing is a short close and needs a reason; the balance goes back to the order.
3. If it says **Cannot close yet**, it lists what is missing: runs still with the supervisor, or QC readings (for example "I.D. — 1 of 2 readings"). Click **Log QC on <stage>** to fix it.
4. If unused input is left from the stage before, choose **Hold for follow-up** or **Scrap with reason**, and write the reason.
5. When closing **Process**, the dialog shows what will happen: pcs become finished goods (item created if new), packing from the spec sheet is consumed (boxes, plastic, fadda), theoretical paper, adhesive and parchment are posted for the month. You may pick the **Finished-good item** (default: automatic from the product code) and **Stock location**.
6. Click **Confirm close** (or **Confirm short close**). Closing Process completes the card and opens the **Dispatch** tab.

### How to reopen a closed stage
Roles: Owner and Admin.
1. Open **Output log**, pick the stage chip, click **Reopen stage…**.
2. Type the reason. Posted stock or tool use needs a governed reversal or an extra card.

### How to print a card
1. Click **Print card** on the card (or **Print card (A4)** in the list row menu).
2. Untick **Page 3** if you do not want the run and QC log.
3. Click **Print Job Card**. Print A4 portrait, two-sided, flip on long edge, scale 100%.

### How to move an old-form card to batch entry
Roles: Owner, Admin, Plant Manager, Planner, Operator.
1. Open the card's **Old form** tab.
2. If no stage other than slitting has closed, a blue box offers **Move to batch entry**. Click it.
3. What was typed on the old form is kept and shown on the **Material** tab under "Typed on the old form before the move — enter it again as a batch".
4. If a stage was already closed on the old form, the card finishes on the old form. The server says "<stage> was already closed on the old form; finish this card there."

## Rules the system enforces
- **Planning never blocks.** A run on a stage with no planner slot saves and is flagged "Run before planning"; the card shows it and it appears in Reports › Plan vs actual. (Flag only.)
- **Card times never block.** Start and end times are optional. An end time before the start time is saved and flagged "End time is before start time; check the date written on the card. Saved and flagged." (Flag only.)
- **Good is worked out, never typed twice.** On batch-entry forms you type Made and Rejected; Good = Made − Rejected. On the old form you type produced and accepted; Reject Qty = produced − accepted. (Automatic.)
- **Out-of-band QC is flagged, not held.** The run is accepted and the next stage can take it. (Flag only.)
- **2 readings per required check.** A run goes to the next stage only once it has at least 2 readings on every required check (moisture is optional). A stage, including a short close, cannot close until it has them. (Blocks the close and the next stage.)
- **Runs with the supervisor block the close.** "N runs still with the supervisor must be submitted or voided first." (Blocks.)
- **Short close needs a reason.** Also when input is left unused. (Blocks until written.)
- **Who closes**: Plant Manager, Owner or Admin. **Who reopens**: Owner or Admin.
- **QC hold stops the card.** An active hold puts the card **On hold**; the next stage cannot take it and a challan cannot be sealed. Holds are released only by the plant head, Owner or Admin.
- **Missed slot.** A scheduled card with no floor entry 36 hours after its shift ended goes back to the planner queue and shows a **Missed slot** chip (×2 if it happened twice).
- **Closed cards.** A completed card takes no more runs, but late QC readings can still be added. A cancelled card takes nothing.
- **Closed month.** Runs dated in a month the Owner has closed are refused: "<Month> is closed. Ask the owner to re-open it."
- **Limits are frozen.** The QC bands on a card are frozen at release; a new band version never changes an existing card.

## Sample
Sharma Tubes Pvt Ltd orders 900 pcs of 76.4 x 81 x 150, BLUE, on SO/26/10/408. Sales releases it; card **26/10/315** is made with 900 pcs = 90 bamboo × 10 pcs, bamboo 1,540 mm.

| Stage | Target | Made | Good | Rejected | Status |
|---|---|---|---|---|---|
| Winding | 90 bamboo | 90 | 90 | 0 | Done, 1 flagged |
| Oven | 90 bamboo | 90 | 90 | 0 | Done, 1 flagged |
| Process | 900 pcs | 893 | 893 | 0 | Done, 1 flagged |
| Dispatch | 893 pcs | 893 | 893 | 0 | Done |

A Process reading of I.D. 76.3 mm against a band of 76.4–76.6 was saved as "Flagged · I.D. 76.3 mm · not held". The card still moved on. Closing Process posted 893 pcs as finished goods; the card showed **Ready to dispatch**, and after the challan was sealed, **Done**.

## Common questions
**Q: Why is Log output greyed out?** A: Hover over it. Common reasons: "Card is closed", "Old entry form — use the Old form tab", "No open stage takes runs", or "Your role cannot log runs".

**Q: The card is not planned. Can the operator still log a run?** A: Yes. The run saves and is flagged "run before planning". Planning is only the plan; the job card log is the truth.

**Q: What does "Flagged · 3 runs" mean in the QC column?** A: Three runs have at least one reading outside its band. They were accepted and not held. Click the flag to open the card's QC tab.

**Q: What is the difference between a flag and a hold?** A: A flag is information; nothing stops. A hold is raised by QC on the Quality pages; it stops the next stage and dispatch until the plant head, Owner or Admin releases it.

**Q: Why can't I close the stage?** A: The close dialog says why. Usually QC readings are short ("I.D. 1/2") or runs are still with the supervisor. Only Plant Manager, Owner or Admin can confirm a close.

**Q: What does "Missed slot ×2" mean?** A: The card was planned twice and nothing was logged within 36 hours after each shift, so it went back to the planner queue. Plan it again, or log the run if it did happen.

**Q: What is a "count gap"?** A: On Process, the pieces counted (made + cutting loss + held) do not match bamboo × pcs per bamboo. The run is saved and flagged for the owner; nothing has to be written for it.

**Q: How do I split, edit or cancel a card?** A: Click **Manage card**. That opens the Job card manager (see the next chapter).

**Q: Where are the old "Supervisor entry" and "EOD entry" pages?** A: They now open Log output. See "Log output and QC entry".

## Related chapters
- Job card manager
- Planner
- Log output and QC entry
- Quality
- Dispatch
- Sales orders
