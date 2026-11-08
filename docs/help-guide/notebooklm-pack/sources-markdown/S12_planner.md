HARI OM TUBEOS HELP GUIDE - Chapter 12: Planner
Section: Production, quality and dispatch. Accurate as of 8 November 2026. Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).
Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter 12.

# Planner

> **What it is:** Where the planner puts released job cards on machines and shifts (Winder, Oven, Process, Slitting), and the Planning overview that compares every planned slot with what the floor actually logged.
> **Who uses it:** Planner and Plant Manager (Owner and Admin also see it).
> **Where:** Sidebar > Operations > Planner (/planning/board), with sub-pages **Planning overview** (/planning/overview), **Winder planning** (/planning/winder), **Oven planning** (/planning/oven), **Process planning** (/planning/process), **Slitting planning** (/planning/slitting)

## At a glance
- **Planning is only the plan; the job card log is the truth.** Nothing in planning blocks the floor. A run on an unplanned stage still saves and is flagged "Run before planning".
- A card's **Oven** opens for planning only once its **Winding** has a slot, and **Process** only once Oven has one. This lock is on the planner side only.
- A planned slot with nothing logged goes back to the queue **36 hours after its shift ends** (a "missed slot"). If the run did happen, logging it late puts the slot back.
- Drag cards from the **Open queue** onto a machine and shift. Tick several cards to move them together (up to 50). Over-capacity drops ask first and split the rest into the next shift.
- **Split plan** cuts one card's plan into two time slots; the card stays one card. To make a separate card, use **Split into a new card** in the Job card manager.

## The flow

Flow diagram: Planning a card
Steps: 1. Card released (done by Sales) -> 2. Open queue -> 3. Plan Winding (done by Planner) -> 4. Plan Oven (done by Planner) -> 5. Plan Process (done by Planner) -> 6. Print planning sheets (done by Planner) -> 7. Floor logs runs (done by Operator)
If it goes wrong after 'Plan Winding': 1. Over capacity -> 2. Schedule and split (done by Planner) - rest goes to next shift
If it goes wrong after 'Floor logs runs': 1. Matched to slot - Done in slot / Partly / Moved



Flow diagram: Missed slot (36 hours)
Steps: 1. Slot planned (done by Planner) -> 2. Shift ends -> 3. Nothing logged for 36 h -> 4. Back to the queue - Missed slot chip -> 5. Re-plan (done by Planner)
If it goes wrong after 'Back to the queue': 1. Late run logged (done by Operator) -> 2. Slot restored

The missed-slot check runs by itself about every 10 minutes and also when the Job cards list or the manager is opened. Only slots whose 36 hours have passed go back; a later part of a split plan stays planned.

## Screen tour

[Screenshot "planner-overview": Planning overview with period chips, stage chips, KPI tiles and the What needs action list]
*Figure: The Planning overview for 30 Oct to 5 Nov. Filters across the top, eight KPI tiles, then "What needs action" and "Waiting to be planned".*

What you see:

1. **Header buttons**: **Open planner board**, **Refresh**, **Excel** (download the slots shown), **Print** (planning sheets).
2. **Period chips**: **Yesterday → +5 days** (default), **Yesterday**, **Today**, **Tomorrow**, **Next 3 days**, **This week**, **Next 7 days**, **Custom**, with the dates shown on the right.
3. **Stage chips** with slot counts: **All stages**, **Slitting**, **Winding**, **Oven**, **Process**. Then **All machines**, the shift switch **Both shifts / Shift A / Shift B**, a search box (card no, customer, code, order or PO) and the view switch **Timeline / Table**.
4. **KPI tiles**: **Planned slots** (cards · days), **Pieces planned** (made in slot so far), **Done in slot** (% with done · partly · moved · not run), **Running now**, **Not run**, **Going back to the queue** (slots return 36 h after a silent shift), **Waiting to be planned** (per stage, and how many wait for the previous stage), **Machine load** (shifts over 100%).
5. **What needs action**: items of five kinds: **Nothing logged**, **Stage order** (a slot before the previous stage's slot), **Planned after due**, **Over capacity**, **Due, not planned**. "Nothing needs action in this period." when clear.
6. **Waiting to be planned**: open cards per stage, pcs waiting, and how many came back from a silent slot.
7. Further down (not in the figure): **Plan by machine and shift** (timeline: machines by stage as rows, days × Shift A/B as columns; each block shows card, customer code, qty and a made-versus-planned bar; split plans read part 1/2) or the **Table** (Job card, Customer, Stage, Machine, Date · shift, Planned, Pcs, Made in slot, Result, Due, Order · PO, Emergency), then **By stage** (Slots, Planned, Made in slot, Done in slot, Load).

Slot results: **Upcoming**, **Running now**, **Done in slot** (95% or more of the plan made in it), **Partly done**, **Ran on another day or shift**, **Not run**, **Not needed** (stage finished earlier), **Logged before planning** (the slot was made from a run logged first). Clicking a slot opens its panel: stage, machine, planned slot, planned qty, due date, size, colour, order, PO, card status, where the card is now, the stage before, "Was due back in queue", the floor runs in this slot and runs of the same card and stage logged elsewhere, with **Add to print**.

[Screenshot "planner-winder": Winder planning board with Open queue, machine rows by shift, and the floating Winder queue panel]
*Figure: Winder planning in Board view for Sat 31 Oct – Sun 1 Nov. The Open queue is on the left, machines and shifts on the right, and a floating "Winder queue" panel shows the queued load.*

What you see:

1. **Top bar**: the stage selector (**Winder planning · 163**), **Month / Board**, previous and next arrows with the date range, **Today**, **2 days / 3 days**, a date box; chips **Open queue**, **Scheduled load** (in the stage's unit), **Priority (3 plant days)**; and **Print →**.
2. **Hint line**: "Drag cards onto a machine and shift · tick several cards to move them together · card actions: manage, edit, split plan · drag a placed card back to the queue to unschedule · Esc returns to the month".
3. **Customer commitments**: customer call-offs and unscheduled order balances in the date window, in pcs.
4. **Open queue**: count and pcs, search, sort (**Due first**), quick chips **All**, **Due ≤3d**, **Overdue**, **Missed slot**, **Emergency**, your saved views as badges, **+ View**, **Filters**, **Select all**. Groups: **Missed slot · re-plan** (slotted on a past date and not finished), **Ready to schedule**, and at the bottom, locked, **Waiting for the previous plan**.
5. **Queue card**: tick box, card number, chips (**Emergency**, **Missed slot ×2**, **Split card**), customer code and name, size, colour or "Plain", load (m for Winder, batch for Oven, tubes for Process), preferred machine, due ("due 9d"), and three icons: manage, edit qty/colour, split; plus a drag handle.
6. **Board**: one row per machine with its capacity per shift (Winder 5,000 m/shift in the sample); one column per day and shift. Each cell shows load used / capacity ("0 / 5,000 m") and "5,000 m available · drop a card".
7. **Floating queue panel** (drag its header to move it, click a bar to filter): **Queue parts**, **Pieces**, queued load; group by **Release winder** or **Planned machine**; unit switch (m or pcs; bamboo or pcs for Oven). "Bars compare queued load, including missed slots. They do not measure machine utilization. Release winder is the job's origin; it does not assign this stage."

[Screenshot "planner-oven": Oven planning board with oven machines and batch capacity]
*Figure: Oven planning. The same layout; capacity is in batch (bamboo per shift) and the queue panel shows "20 ready · 154 upstream", meaning most cards wait for their Winding plan.*

[Screenshot "planner-process": Process planning board with process lines and tube capacity]
*Figure: Process planning. Capacity is in tubes per shift (1,000 tubes/shift in the sample). Cards whose Oven has no slot sit at the bottom of the queue, locked.*

[Screenshot "planner-slitting": Slitting planning with an empty queue]
*Figure: Slitting planning with an empty queue: "Queue is empty — everything released is on the board." Slitting is only used when released work needs reel conversion before winding.*

[Screenshot "planner-board": Planner Month view, a calendar of October 2026 with pcs per day]
*Figure: The Month view (October 2026). Each day shows pcs scheduled and the cards on it; drag a queue card onto a day to place it.*

## Step by step

### How to place a card on a machine and shift
Roles: Planner, Plant Manager, Owner, Admin. Select one plant first ("Select one plant before scheduling").

1. Open the stage page, for example **Winder planning**, in **Board** view.
2. Find the card in **Open queue** (search, **Due ≤3d**, **Overdue**, a saved view).
3. Drag it onto the machine row and shift column. Or focus the card and press Enter to use **Keyboard scheduling** (same move as drag-and-drop).
4. If the slot has room, the card is placed and the cell load goes up.
5. If it does not fit, **Slot will be over capacity** opens: "The planner keeps what fits here and splits the rest into the next shift." Click **Schedule and split**, or **Choose another slot**.

### How to move several cards together
1. Tick the cards (shift-click selects a range; **Select all** takes the whole filter).
2. Drag any ticked card onto a machine and shift, or onto a day in Month view.
3. All of them go in queue order in one step (at most 50). If one cannot be placed, nothing moves and the message names the card and the reason, ending "Nothing was moved."

### How to plan Oven and Process
1. Plan the card's Winding first. Until then its Oven sits in **Waiting for the previous plan** with a lock and cannot be ticked or dragged.
2. Open **Oven planning** and place it. Then **Process planning**.
3. If you try too early the server says, for example: "Plan Winding for 26/10/315 first: Oven planning opens once Winding has a slot."

### How to split a plan (Split plan)
1. On a placed card, click the split icon (title "Split plan: cut this slot into parts").
2. The dialog **Split plan** says: "Cuts this plan into two parts (time slots). The card stays one card; part 2 goes to the next shift."
3. Type **First part (pcs)**, between 1 and total − 1. Confirm. The board shows "part 1/2" and "part 2/2".
4. The floor logs runs as usual; each run is matched to its part by date and shift.

### How to unschedule a card
Drag the placed card back onto the queue ("Drop here to send it back to the queue"), or use **Back to queue** on the card.

### How to save a queue view
1. Click **Filters** (or **+ View**). Set search, sort, release winder, customer, colour, size, quantity range and card flags.
2. Give it a name, choose **Only me** or **Everyone in this plant**, and **This stage** or **All stages**. Save.
3. The view appears as a badge beside **All**, **Due ≤3d** and **Overdue**. Another person's plant view can be applied but changed only by them or a plant head.

### How to read the Planning overview
1. Open **Planning overview**. Pick the period, stages, machine and shift.
2. Check **What needs action** first; then **Not run** and **Going back to the queue**.
3. Click a slot to see what was logged in it. Use **Open planner board** to fix the plan.
4. Click **Excel** to download the slots shown.

### How to print planning sheets
1. Click **Print** on the overview or **Print →** on the board.
2. Tick stages (or **All stages**), days (**Today**, **Tomorrow**, **Next 3 days**, **This week**, **Next 7 days**), shifts and machines. Or select slots on the overview and print only those.
3. Each stage prints on its own A4 sheet: card, customer and code, size, colour, quantity in the stage unit and pcs, due date, a **Made** column and signature lines.

## Rules the system enforces
- **The planner never blocks the floor.** Runs on unplanned stages save and are flagged "Run before planning" (Reports › Plan vs actual). (Flag only.)
- **Oven after Winding, Process after Oven** for planning. (Blocks the planner action only.)
- **Run to slot matching** is automatic: same card and stage, same date and shift, same machine first. Results on the floor form: "As planned", "Planned shift, other machine", "Same day, other shift", "N days later than plan", "N days earlier than plan", "Run before planning". A run on another day keeps the plan; only a stage with no slot at all is "before planning". (Automatic.)
- **Done in slot** = 95% or more of the slot's plan made in it. (Automatic.)
- **Short close shrinks later slots.** When a stage closes short on the card page, the open slots of the later stages shrink to the new target, latest slots first; reopening the stage puts them back. (Automatic.)
- **Missed slot**: no floor entry 36 h after the shift ends (Shift A 08:00–20:00, Shift B 20:00–08:00) sends the slot back to the queue. (Automatic.)
- **Capacity**: Winder in metres per shift, Oven in batch (bamboo) per shift, Process in tubes per shift, from the machine setup. Over-capacity drops ask first and split. (Warns, then splits.)
- **Bulk move** is all-or-nothing, up to 50 cards. (Blocks if any fails.)
- **Planning window**: up to 3 months ahead. (Blocks.)
- **Qty and colour** of a card on the board are locked; edit only queued cards (Job card manager). (Blocks.)

## Sample
Card 26/10/315 (Sharma Tubes Pvt Ltd, 900 pcs = 90 bamboo, bamboo 1,540 mm) needs about 139 m of winding. The planner drags it to Winder 1, 31 Oct Shift A. Oven opens for planning; she places it on Oven 1, 31 Oct Shift B (90 bamboo). Process opens; she places 900 tubes on Line 1, 1 Nov Shift A.

| Stage | Slot | Logged | Result |
|---|---|---|---|
| Winding | 31 Oct · Shift A · Winder 1 | 90 bamboo, 31 Oct Shift A | Done in slot |
| Oven | 31 Oct · Shift B · Oven 1 | 90 bamboo, 1 Nov Shift A | Ran on another day or shift ("1 day later than plan") |
| Process | 1 Nov · Shift A · Line 1 | nothing by 3 Nov 08:00 | Not run → back to the queue (Missed slot) |

On 3 Nov the operator logs the Process run dated 1 Nov Shift A; the slot is restored and shows **Done in slot**.

## Common questions
**Q: Why can't I drag this card onto the Oven board?** A: Its Winding has no slot yet. Plan Winding first; the card shows in **Waiting for the previous plan** with a lock.

**Q: The floor logged a run but the card was not planned. Is that wrong?** A: No. It is allowed and flagged "Run before planning". The overview shows the slot as **Logged before planning**.

**Q: What does "Missed slot ×2" mean?** A: The card was planned twice and nothing was logged within 36 hours after each shift ended. Re-plan it, or have the floor log the run if it happened.

**Q: What is the difference between Split plan and Split into a new card?** A: Split plan keeps one card and cuts its plan into two time slots. Split into a new card (Job card manager) creates a separate card with its own number.

**Q: The capacity bar says 120%. Will it stop me?** A: No. You are asked first; **Schedule and split** keeps what fits and moves the rest to the next shift.

**Q: Why do the queue panel bars not match machine use?** A: They compare queued load only, including missed slots. They do not measure machine utilization.

**Q: Where did the Order tracker go?** A: Old /planning/tracker links open the Orders list with the matching filter. Missed slots are on the Planning overview.

## Related chapters
- Job cards
- Job card manager
- Log output and QC entry
- Reports
- Masters
- Using TubeOS on a phone
