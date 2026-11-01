HARI OM TUBEOS HELP GUIDE - Chapter 06: A day in the life
Section: Start here, sales and design. Accurate as of 31 October 2026. Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).
Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter 06.

# A day in the life

> **What it is:** One short routine per role: what to open first, the pages you use in order, and the mistakes to avoid.
> **Who uses it:** Every role; new staff on their first week.
> **Where:** Your start page after sign-in (see Getting started)

## At a glance
- Start every day on your start page and the **Inbox** (or the bell). Work the **Needs action** items first.
- Check the **plant** and **season pill** in the header before entering anything.
- The job card is the floor's truth; planning never blocks the floor; job card QC flags (never holds), incoming QC holds.
- Finished pcs are packed in labelled boxes as Process runs get their readings; boxes ship as soon as they are in stock.
- Every "why" is a reason code picked from a list, with an optional note.
- Nothing returns from the floor; issued material counts as used.
- When a button is grey, hover over it or read the small text under it: it always says why.

## The flow


Flow diagram: One order through the desks in a day
Steps: 1. Sales enters SO (done by Sales) -> 2. Planner approves and releases (done by Planner) -> 3. Planner places card (done by Planner) -> 4. Store issues reels (done by RM issue) -> 5. Floor logs runs and QC (done by Operator) -> 6. Boxes packed and labelled (done by Operator) -> 7. Plant head closes stages (done by Plant Manager) -> 8. Dispatch ships boxes (done by Dispatch)
If it goes wrong after 'Plant head closes stages': 1. Stage closed short -> 2. Balance back to the order -> 3. Release again or short close (done by Sales)
If it goes wrong after 'Store issues reels': 1. Lot not cleared -> 2. Inward QC inspects (done by Inward QC) -> 3. Released or held


Each desk hands work to the next through the Inbox. If your inbox is empty but a count on your dashboard is not, open the count: the list behind it is the work.

## Screen tour

[Screenshot "m-job-cards": Phone Job cards page with Open cards 303, Priority 0 and Overdue 3 tiles, a quality hold warning and state tabs]
*Figure: Job cards on a phone, the page most floor roles open many times a day. Buttons Print list, Export CSV, Planner board and Job card manager. Tiles Open cards 303 (whole plant), Priority · 3 days 0, Overdue 3. A red note: "7 open cards have an active quality hold. Quality desk before dispatch." Tabs All 324, Queue 106, Scheduled 20, Running 103, On hold 0, Ready to dispatch 71, Closed early 7, Done 17, a search box and filters Group by, Plan: any, QC: any, View: All cards.*

What you see:

1. **Tiles**: open, priority (due in 3 days) and overdue cards; tap to filter.
2. **Quality hold note**: cards with an active hold need the QC desk before dispatch.
3. **Tabs and filters**: narrow to your stage, plan state or QC flags.

## Step by step

### Sales
Morning: open **Orders** (your start page). Check tiles **Overdue** and **Due in 3 days**, then the **Draft** and **Waiting approval** tabs.

1. **Orders** › **New sales order** for each new customer PO (or internal order if the PO is not in yet).
2. **Send for approval** on your own orders; approve colleagues' orders (Sales may approve).
3. **Release** approved orders: pick colour and winder queue per card.
4. Expand rows to answer customers: job card stage dots, made and dispatched.
5. **Add customer PO** on internal orders when the PO arrives.
6. **Customer hold & close**, **Short close** or **Cancel order** with a reason code when the customer changes plans; **Resume** with an **Order hold lifted** code.
7. Look for pcs **not released** that came back from job cards (a stage closed short, or a card closed early). Release them again or short close the order with a reason.
8. Reports › **Sales pulse** (including **Cancelled / short-closed by reason**) and **Customer 360** once a week.

Avoid: typing a rate without checking the **Last rate** hint; releasing without a colour decision from the customer; cancelling when work has started (use Short close).

### Planner
Morning: **Planner** › **Planning overview** (Yesterday → +5 days). Read **Not run**, **Going back to the queue** and **Waiting to be planned**.

1. **Orders**: approve drafts and release what production needs now.
2. **Winder planning**: drag cards from the queue to machine and shift; use **Split plan** for one card over several shifts.
3. **Oven planning** and **Process planning** (they open once the earlier stage has a slot).
4. **Print** shop-floor sheets for each stage.
5. **Job cards**: check "not planned yet" and "slot passed" plan statuses.
6. **RM inward calendar**: read rose shortage cells; **Suggest arrivals** or add arrivals for the Owner to approve.
7. Reports › **Plan vs actual** and **Planning performance**.

Avoid: treating a missed slot as an error on the floor (the run is the truth); planning Oven before Winding has a slot (it is locked); using **Split into a new card** when you only meant **Split plan**.

### Plant Manager
Morning: **Job cards** (start page). Check **Overdue**, **QC holds** and the red quality-hold note.

1. **Inbox** › **Needs action**: holds and runs waiting for you.
2. **Job cards** › open a card: submit runs operators logged, **Close** stages when both QC readings are in. If a stage cannot reach its target, close it short with a **Stage closed short** code: the balance goes back to the order and the later stages carry on.
3. **Quality** › **In-process QC**: read flagged readings (they never stop a card); **Holds & inspections**: place a hold only when goods must stop, and decide holds with a **QC hold release** code (only the plant head, Owner or Admin release a job-card hold).
4. **Job card manager**: split, edit qty or colour, force close or cancel, with a reason code.
5. Reports › **Employee performance**: runs, reject % and flagged readings per operator.
6. **GRN register & labels** and **Invoice differences**: approve manual GRNs and rate differences (not ones you made).
6. **Month-end close**: write notes on OVER or UNDER items after the count is approved.

Avoid: force-closing a card to "fix" numbers (use edit with a reason); approving a GRN you created yourself (the system refuses).

### Operator
Morning: your start page shows **Your work**: **Log output**, **Job cards**, **Log QC**, **Scan a label**.

1. Scan the job card QR with the phone camera (or **Log output** › type 26/10/315).
2. Pick your stage tab, **Log output**: machine, your name in **Operator** (only your department is listed), quantities, and a **Floor rejection** code for any rejected pcs.
3. **Log QC**: at least 2 readings for every required check, for every run.
4. Check the amber **Still needs QC** list before the shift ends; it should be empty.
5. **Scan another card** for the next card.
6. On Process: when boxes are packed, print their labels from the card's **Dispatch** tab (**Box labels**) and stick one on each box. The part box label says PART BOX.

Avoid: logging on a card from memory instead of scanning it; skipping the second reading (the stage cannot close and the next stage cannot take the run); typing rejected pieces by hand (the system works them out).

### Inward QC
Morning: **Incoming QC** (start page). Lots waiting are listed by GRN.

1. **Incoming QC** › **Inspect** each lot; reels of one line can be entered reel by reel.
2. A reading outside the band holds that reel; inside every band releases it.
3. **Holds & inspections**: held lots and their decisions (re-inspect, concession, return to supplier).
4. **GRN register & labels**: receipts still waiting for QC.
5. **Material standards**: the checks per material type.

Avoid: passing a reel to "help production" when a reading is out of band; worrying about invoice questions (they go to Accounts and never hold material).

### In-process QC
Morning: **QC desk**, then **In-process QC**.

1. **In-process QC**: runs still waiting for their 2 readings, and flagged readings by stage.
2. **Log QC**: scan the card, pick the run, enter readings.
3. **Holds & inspections**: holds waiting for the plant head.
4. Reports › **Quality analytics** weekly.

Avoid: expecting a flagged reading to stop the card (it does not; tell the plant head if it needs action).

### Store and GRN
Morning: GRN starts on **Goods inward**; Store on **Inventory** (stock overview).

1. **Expected arrivals**: what is due today; **Make GRN** opens Goods inward for that PO line.
2. **Goods inward**: supplier challan number, invoice (or invoice pending), net kg and width per reel; post once.
3. Print the reel labels (one per reel or coil) and put them on before the reel leaves the dock.
4. **GRN register & labels**: attach invoices, reprint labels with a reason.
5. **Stock counts & book**: rack and spot counts; **Locations** for rack labels.
6. Store also: **Purchase orders** (send scheduled drafts), **Dispatch** (view).

Avoid: weighing several reels together (one reel = one lot = one label); receiving more than the PO open quantity without a written reason.

### RM issue
Morning: **Reel & coil issue** (start page). Tiles: Ready for the floor, Not cleared yet, Slitting cards to write.

1. Scan each reel or coil going to the floor and press **Issue** (shift and date come from the clock).
2. Write the **slitting card** (coils made, wastage kg) for every reel sent to the slitter.
3. **Material issue**: adhesive, parchment (by colour and kg) and packing for the shift.
4. **Issue history**: check today's issues.

Avoid: issuing to a machine or job card (issue is to the floor by shift); taking anything back from the floor.

### Dispatch
Morning: **Dispatch** desk (start page). Check **Ready to dispatch**.

1. Pick a job card with **Boxes ready for a challan** (Process may still be running; no manual hold).
2. **Make challan from boxes**: scan each box label (or tick boxes, or **Select all ready**), then vehicle, transporter, LR. Net weight comes from the spec and can be edited.
3. Seal once; print the challan. It lists every box code, the box count, pcs per box and total pcs.
4. After Process closes, ship the part box with the last boxes, or keep leftover boxes with **Retain surplus FG** and a reason code.
5. **Orders** › **Partly dispatched** to see balances still to send.

Avoid: opening a box to ship part of it (boxes ship whole); shipping a card with an active hold; sealing twice for a retry (the system does not post stock twice, but check the list first).

### Purchase accounts work (Plant Manager, Owner, Admin)
Invoice checks and debit notes are handled by the Plant Manager, Owner or Admin logins.

1. **Invoice differences**: rate or quantity differences between invoice and PO; decide each.
2. **GRN register & labels** › **Invoice pending**: attach invoices; the invoice rate stays editable while pending.
3. **Debit notes**: create one per vendor for positive rate differences, approve, settle.
4. **Purchase reports**: Excel registers.

Avoid: holding material for a price question (QC is the only gate for issue); deciding a difference on a GRN you made.

### Owner and Admin
Owner morning: **Dashboard** › **Action center**. Admin morning: **System health**.

1. Approve sales orders, **PO approvals** (POs and requisitions) and **RM arrivals** on the RM inward calendar.
2. **Quality holds** and **Blocked & overdue job cards** lanes.
3. **Specifications**: approve new specs and seasonal revisions; Owner switches the **Production season**.
4. **Stock counts & book**: approve counts and corrections (Owner).
5. **Month-end close**: close the month (Owner) after the count is approved and notes are in.
6. Admin: **System** › Users, Roles & access, Plants, Machines, Background jobs; **Masters**; **Audit**.

Avoid: working in **All Visible Plants** and wondering why a page will not save (pick one plant); approving your own order without checking it (you may, and the history records it).

## Rules the system enforces
- Each role sees only its pages; buttons a role cannot use are hidden or greyed with the reason (BLOCKS).
- Maker-checker on sales orders, manual GRNs and commercial differences (BLOCKS the maker; Owner and Admin may approve their own sales orders and POs).
- Two QC readings per required check before a stage closes (BLOCKS close). Out-of-band job card readings flag only; only holds placed on purpose stop a card.
- Every reason is a code from Masters › Reason codes (BLOCKS free text alone).
- Floor forms list only the stage department's operators (BLOCKS others).
- Only QC-cleared stock can be issued (BLOCKS). Issue shift and date come from the clock (automatic).
- Closed months refuse entries dated in them (BLOCKS).

## Sample
Thursday 31 Oct, Plant A:

- 08:10 Priya (Sales) enters SO/26/10/418 for Sharma Tubes Pvt Ltd, 2,000 pcs RED, and sends it for approval.
- 08:30 Ramesh (Planner) approves and releases it: job card 26/10/320 in the SHARMA_WINDER-1 queue; he places it on Shift A.
- 08:45 Anil (RM issue) scans reel AIT 06281 (cleared) and issues it; it shows under Slitting cards to write.
- 09:00 Suresh (Operator, Winder department) scans 26/10/320, logs 180 bamboo on Winding, and two readings per check.
- 13:30 Meena (Plant Manager) submits the runs. Paper ran out, so she closes Winding short at 180 of 200 bamboo with SS-MATERIAL-SHORT. 200 pcs go back to SO/26/10/418 at once; Priya releases them again the next morning.
- Next day Process logs its runs; boxes of 50 are packed as the readings are saved, and Kiran prints their labels. Ravi (Dispatch) ships 20 boxes (1,000 pcs) before lunch. Process closes at 1,790 good pcs: 35 full boxes and a part box of 40, and 10 pcs go back to the order. Ravi ships the other 16 boxes (790 pcs) in the evening.

## Common questions
**Q: I am new. Which page do I open first?** A: Your start page (it opens after sign-in), then the Inbox.

**Q: Two people do my job. Do we share work?** A: Yes. Queues and lists are per plant and role, not per person.

**Q: I cover two roles.** A: Ask the Admin to add both roles to your login and use the role switcher.

**Q: Who do I ask when a button is grey?** A: Read its reason first. If it is a role or plant reason, ask the Owner or Admin.

**Q: Can I fix a mistake myself?** A: Usually yes, with a reason: edit the run, change the colour on the order, raise a stock correction. Approved and closed records need the Owner.

## Related chapters
- Getting started
- Dashboard and inbox
- Using TubeOS on a phone
- Sales orders
- Specifications
- Job cards
- Job card manager
- Planner
- Log output and QC entry
- Quality
- Purchase orders, PO approvals and requisitions
- RM inward calendar and expected arrivals
- Invoice differences, debit notes and purchase reports
- Goods inward, GRN register and labels
- Issue to the floor: reels, coils and materials
- Stock counts, stock book, locations and opening stock
- Reports
- Welcome to Hari Om TubeOS: the big picture
