HARI OM TUBEOS HELP GUIDE - Chapter 00: Welcome to Hari Om TubeOS: the big picture
Section: Start here, sales and design. Accurate as of 31 October 2026. Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).
Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter 00.

# Welcome to Hari Om TubeOS: the big picture

> **What it is:** TubeOS is the plant's one system for paper tube orders, production, quality, stores, purchasing and dispatch, from the customer PO to the delivery challan.
> **Who uses it:** Everyone: Sales, Planner, Plant Manager, Operator, QC (inward and in-process), Store, GRN, RM issue, Dispatch, Accounts, Owner and Admin.
> **Where:** Sign in at the TubeOS address. Each role lands on its own start page (see Getting started).

## At a glance
- TubeOS runs two loops that meet on the floor: **SELL → MAKE → SHIP** (customer order to dispatch) and **BUY → STORE → FEED** (raw material planning to issue on the floor).
- The **job card** is the floor's truth. Planning is only the plan: nothing in planning stops the floor from logging a run.
- Quality has two different rules. **Incoming QC** holds a lot whose reading is outside its band, and a held lot cannot be issued. **Job card QC** (winding, oven, process and final) only **flags** an out-of-band reading; it never holds or rejects the card and never blocks dispatch. Only a hold that the plant head, QC, Owner or Admin places on purpose stops a card.
- **Finished tubes are packed in boxes.** Process good pcs fill boxes of the spec's qty per box; each box has a code and a QR label, goes into stock on its own, and ships whole on a challan. The last pcs go into a **part box**.
- **Any stage can close short.** The pcs not made go back to the sales order at once; Sales releases them again or short closes the order.
- **Every "why" is a reason code** picked from Masters › Reason codes, with an optional note.
- Numbers are made by the system: SO numbers, job card numbers, PO numbers, GRN (inward) numbers and reel labels. You never type them.
- Every page shows plain status words (for example **Ready to release**, **Running**, **Waiting for QC**). The cheat sheet below lists them.

## The flow


Flow diagram: SELL → MAKE → SHIP
Steps: 1. Customer PO (done by Sales) -> 2. Sales order (done by Sales) -> 3. Approve (done by Sales/Planner/Owner/Admin) -> 4. Release lines (done by Sales/Planner) - job cards are made -> 5. Plan (done by Planner) -> 6. Winder, Oven, Process (done by Operator) -> 7. QC readings (done by Operator/QC) -> 8. Dispatch challan (done by Dispatch)
If it goes wrong after 'Approve': 1. Hold or Cancel (done by Sales/Owner) -> 2. Short close (done by Sales/Plant Manager)
If it goes wrong after 'Winder, Oven, Process': 1. Reading out of band (done by Operator) -> 2. Flagged, card continues
If it goes wrong after 'Winder, Oven, Process': 1. Stage closed short (done by Plant Manager) -> 2. Balance back to the order (done by Sales)


The customer's PO becomes a **sales order**. A second person approves it (the Owner and Admin may approve their own). Releasing a line makes one **job card per line and parchment colour** in the winder queue. The planner places the cards on machines and shifts; the floor logs runs and at least two QC readings per check at each stage. As Process good pcs get their readings, they are packed into labelled boxes that go into stock and can ship at once, even while Process runs. When Process closes, packing and the final check close with it and the pcs left become a part box. A stage that cannot reach its target closes short; its balance goes back to the order.


Flow diagram: BUY → STORE → FEED
Steps: 1. RM inward calendar (done by Planner/Store) -> 2. Owner approves arrivals (done by Owner) - draft PO -> 3. Purchase order (done by Store) -> 4. PO approval (done by Owner/Admin) -> 5. Goods inward / GRN (done by GRN/Store) - one label per reel -> 6. Incoming QC (done by Inward QC) -> 7. Stock - usable -> 8. Reel and material issue (done by RM issue) -> 9. Floor
If it goes wrong after 'Incoming QC': 1. Reading out of band -> 2. Lot held -> 3. Re-inspect, concession or return to supplier (done by QC/Plant Manager)


Raw material demand from orders and planned job cards is compared with stock day by day on the **RM inward calendar**. Arrivals the Owner approves become draft POs. Stores receive goods against the approved PO, every reel or coil gets its own label, and the lot waits for incoming QC. Only QC-cleared stock can be issued. Issue is to the floor by shift (never to a machine or a job card) and everything issued is used in full; nothing returns from the floor.


Flow diagram: Where the two loops meet
Steps: 1. Spec recipe (done by Owner/Admin) -> 2. Job card (done by System) - recipe frozen at release -> 3. Floor runs (done by Operator) -> 4. Month-end count (done by Store) -> 5. Month-end close (done by Owner)


The approved specification sets what a tube should use. At month end the system compares the spec, what the store issued and what the count says was used.

## Screen tour

[Screenshot "dashboard-owner": Owner dashboard with greeting, headline sentence and KPI tiles]
*Figure: The Owner's start page. A greeting and one sentence say what needs attention (for example "3 overdue job cards, 7 blocked cards, 8 cards on QC hold and 23 low-stock materials need attention in Plant A"). Below are money and production tiles such as Open order book ₹10.8L and Open job cards 303.*

What you see:

1. **Header bar**: page path, **Jump to workspace**, season pill (**Rest of year**), theme and appearance buttons, month chip (**Close Sep**), role, bell, plant and guide.
2. **Company KPIs / Action center**: two tabs for the Owner; the Action center lists everything waiting for an Owner decision.
3. **KPI tiles**: each tile is a link to the page behind the number. See Dashboard and inbox.

[Screenshot "orders-list": Orders list with KPI tiles, status tabs and order rows]
*Figure: The Orders list. Six tiles at the top (Open pieces 3,52,427 pcs, Not released, Due in 3 days, Overdue, Ready to dispatch, On hold), then status tabs from Draft to All, then one row per sales order with its status and one Next action button (Approve, Release, View).*

What you see:

1. **Tiles**: click one to narrow the list.
2. **Status tabs**: **Draft**, **Waiting approval**, **Ready to release**, **In production**, **Partly dispatched**, **On hold**, **Closed**, **Cancelled**, **All**.
3. **Order rows**: SO number, a fulfilment bar (dispatched · made · released of ordered), customer, due date, status and **Next action**.

[Screenshot "jobcards-list": Job cards list with stage tiles and card rows]
*Figure: The Job cards list. Tiles count open cards, priority, overdue, QC holds and dispatch-ready cards, and how many open cards sit at Winding, Oven and Process. Each row shows the card number (26/10/315), size, colour, order, quantity in pcs and bamboo, state, plan status, due date and QC flags.*

What you see:

1. **State tabs**: **All**, **Queue**, **Scheduled**, **Running**, **On hold**, **Ready to dispatch**, **Closed early**, **Done**.
2. **Plan status**: words such as "not planned yet" or "running · planned 30 Oct · Shift A". Information only.
3. **QC column**: **Flagged · 3 runs** means readings outside the band were saved and flagged.

[Screenshot "planner-overview": Planning overview with period buttons, stage filters and summary tiles]
*Figure: Planning overview. The period (Yesterday → +5 days) and stage buttons (Slitting, Winding, Oven, Process) sit on top, then tiles: Planned slots, Pieces planned, Done in slot, Running now, Not run, Going back to the queue, Waiting to be planned and Machine load.*

What you see:

1. **Header text**: "Planning is only the plan; the job card log is the truth, and nothing here blocks the floor."
2. **Going back to the queue**: a slot with nothing logged returns to the queue 36 hours after its shift.
3. **Waiting to be planned**: a card's Oven opens for planning only once its Winding has a slot; Process once Oven has one.

## Status cheat sheet

**Sales order** (Orders list and Order page)

| Status on screen | Meaning |
|---|---|
| Draft | Entered, not yet approved. |
| Waiting approval | Sent for approval by the person who entered it. |
| Ready to release | Approved; lines can be released to job cards. |
| In production | Some or all lines released to job cards. |
| Partly dispatched | Some pieces already sent to the customer. |
| On hold | Customer hold: the undelivered balance is held until **Resume**. |
| Closed / Closed · short | Everything dispatched / the balance was dropped by short close. |
| Cancelled | Cancelled before anything was released or dispatched. |

**Job card** (state badge)

| Status on screen | Meaning |
|---|---|
| In queue | Released, not on the calendar yet. |
| Scheduled | Placed on a machine and shift. |
| Running | The floor is logging runs. A card with a stage closed short, or force-closed, whose made pcs are still moving stays here with a "closed early" chip. |
| Ready to dispatch | Process closed; its boxes are packed and labelled and wait for a challan. |
| Completed (tab **Done**) | Process closed and every box shipped or kept as surplus. |
| Force-closed (tab **Closed early** once nothing is left to make or ship) | Closed at the quantity made; the balance went back to the order. |
| Cancelled | Nothing made; the whole quantity went back to the order. |

**Plan status** words: "planned 30 Oct · Shift A", "running · planned …", "plan in 2 parts · next …", "slot … passed", "slot passed with nothing logged, back in the queue", "not planned yet", "waiting for the winding plan", "follows Process", "Finished".

**Purchase order**: **Draft**, **Waiting approval**, **Approved**, **Partly received**, **Received**, **Short-closed**, **Rejected**, **Revision needed**, **Withdrawn**, **Cancelled**.

**GRN line, incoming QC**: **Waiting for QC**, **QC passed**, **QC failed**, **Cleared** (no inspection needed, for example go-live opening stock). Stock words: **On QC hold**, **Usable**. Commercial words on the GRN: "rates match the PO", "invoice to follow", "differs from the PO · goes to Accounts", "manual GRN · goes to Accounts".

**In-process QC**: "Still needs QC" (run without its readings), "needs more readings" (fewer than 2 per check), **Flagged QC · N runs** (reading outside the band, saved and flagged).

**Specification**: **Draft**, **Review**, **Trial**, **Approved**, **Obsolete**; each season's recipe shows **Ready** or **Needs attention**.

## Numbering formats

| Document | Format | Example | Rule |
|---|---|---|---|
| Sales order | SO/YY/MM/NN | SO/26/10/412 | Restarts every month; grows past 99. Older orders kept their old numbers. |
| Job card | YY/MM/NN | 26/10/315 | Restarts every month (India time). A split or top-up card keeps the root and adds a letter: 26/10/315-A. |
| Purchase order | RP-PM/NN or OT/NN | RP-PM/68 | RP-PM for raw and packing material, OT for other items; per plant. |
| GRN (inward) | P/YY/NNN, A/YY/NNN, IN/YY/NNN | P/26/001 | P paper, A adhesive, IN everything else. Restarts on 1 April: P/26/… is financial year 2026-27, so January to March 2027 is still P/26/…; 1 April 2027 starts P/27/001. |
| Reel / coil label | AIT serial | AIT 06243; coil AIT 06243-1 | One series per plant and financial year, restarting at AIT 00001 on 1 April. Printed at inward; reprints never create stock. Older reels keep AT-yymmdd-nnn numbers. |
| Finished-goods box | B + card number + 3 digits | B2610315-001 | One per box packed on a job card; the part box is the last one. Label reprints never create stock. |

## How the pages connect

| Sidebar group | Pages | Feeds into |
|---|---|---|
| Overview | Dashboard, Inbox, Guide | Every other page; handoffs arrive in the Inbox. |
| Operations | Orders, Job Cards, Job card manager, Planner, Log output, Log QC, Month-end close | Orders release job cards; Planner places them; Log output and Log QC fill them. |
| Quality | QC desk, Incoming QC, In-process QC, Holds & inspections, Customer complaints, Material standards, Process stage rules, Production season | Incoming QC clears stock for issue; stage rules set floor tolerances. |
| Purchasing | Purchase orders, RM inward calendar, Expected arrivals, Create purchase order, Purchase requisitions, PO approvals, Invoice differences, Debit notes, Purchase reports | Approved POs are received in Goods inward. |
| Stores & inventory | Goods inward, GRN register & labels, Reel & coil issue, Material issue, Issue history, Stock counts & book, Opening stock, Inventory, Genealogy, Manual FG, Stock alerts, RM Costing, Dispatch | Issue feeds the floor; Dispatch ships finished job cards. |
| Design | Specifications | Specs feed sales order lines, job cards and month-end use. |
| Reports | Intelligence and role reports | Read only. |
| Foundation | Masters, System, Audit | Customers, vendors, materials, reasons, users and machines used everywhere. |

## Rules the system enforces
- An order cannot be approved by the person who entered it, unless that person is the Owner or an Admin (BLOCKS; the history records "approved by the same person").
- Every release needs a parchment colour; one job card is one colour (BLOCKS release).
- Planning never blocks the floor. A run logged with no plan is placed on its date and shift and flagged "before planning" (FLAG only).
- Each winding, oven and process run needs at least 2 readings per required check before the stage can close and before the next stage takes it (BLOCKS stage close).
- Out-of-band job card readings are saved and flagged, never held (FLAG only). Out-of-band incoming readings hold the lot (BLOCKS issue). Only holds placed on purpose block a card's next stage and dispatch.
- Every reason is a code from Masters › Reason codes; free text alone is refused, and OTHER codes need a note (BLOCKS).
- A stage short close returns (stage target − stage good) pcs to the order at once; returns + pcs in boxes always equal the pcs released (AUTOMATIC).
- Only QC-cleared stock can be issued; nothing returns from the floor.
- A closed month refuses stock and floor entries dated in it until the Owner re-opens it.

## Sample
Sharma Tubes Pvt Ltd sends PO GOLIVE-PO-118 for 5,000 pcs of 76.4 x 81 x 150 at ₹2.75 per pc: 3,000 BLUE and 2,000 RED.

1. Sales enters **SO/26/10/412**; a planner approves it.
2. Sales releases it: two job cards, **26/10/315** (BLUE, 3,000 pcs) and **26/10/316** (RED, 2,000 pcs), go to the winder queue.
3. The planner places 26/10/315 on a winder, Shift A, 31 Oct. Operators log Winding, Oven and Process runs with two QC readings each.
4. Meanwhile the RM inward calendar shows Kraft 300 GSM running short on 4 Nov. The Owner approves an arrival; PO **RP-PM/68** goes to Bharat Paper Mills, arrives as **P/26/014** with 12 reels, passes incoming QC and is issued to the floor.
5. As 26/10/315's Process runs get their readings, its pcs are packed in boxes of 48. Dispatch ships the first 40 boxes (1,920 pcs) while Process is still running. Process then closes with 2,990 good pcs (10 short of 3,000, reason SS-HIGH-REJECT): 62 full boxes and a part box of 14, and 10 pcs go back to the order. The second challan takes the other 23 boxes (1,070 pcs). The order shows **Partly dispatched** until 26/10/316 ships too.

## Common questions
**Q: Why does my sidebar look different from my colleague's?** A: Each role sees only its pages. See the role table in Getting started.

**Q: The plan says "not planned yet" but the operator already logged a run. Is that wrong?** A: No. Planning never blocks. The run is kept and flagged as before planning.

**Q: A reading was outside the band at Oven. Is the card stopped?** A: No. Job card readings are flagged, not held. The card carries on and its boxes still ship; managers see the flag.

**Q: What is a part box?** A: The last box of a job card, packed when Process closes, holding the pcs that did not fill a full box. Its label says PART BOX.

**Q: Winding could not make the full quantity. What happens to the order?** A: The plant manager closes Winding short with a reason. The unmade pcs go back to the order line at once, and Sales releases them again or short closes the order.

**Q: A reel failed incoming QC. Can the store issue it?** A: No. A held lot cannot be issued until QC re-checks it or the plant head concedes it.

**Q: Why is a GRN in January called P/26/…?** A: GRN numbers follow the financial year (April to March). January to March 2027 belongs to 2026-27.

**Q: Where do I see everything waiting for me?** A: The **Inbox** (sidebar Overview) and the bell in the header.

## Related chapters
- Getting started
- Dashboard and inbox
- Using TubeOS on a phone
- Sales orders
- Specifications
- Job cards
- Planner
- Log output and QC entry
- Quality
- Purchase orders, PO approvals and requisitions
- RM inward calendar and expected arrivals
- Goods inward, GRN register and labels
- Issue to the floor: reels, coils and materials
- Stock counts, stock book, locations and opening stock
- A day in the life
