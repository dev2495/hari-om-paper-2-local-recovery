# Hari Om TubeOS glossary: words you will see in the system

Accurate as of 31 October 2026. Hari Om TubeOS is the ERP of a paper tube plant. The words below are used on its screens. Look here first if a word is unfamiliar. The full status lists and number formats follow after the glossary.

## Everyday words

- **Sales order (SO)**: the system record of a customer's purchase order (PO). Number format SO/YY/MM/NN, for example SO/26/10/412.
- **Customer PO**: the purchase order the customer sent. Its number is kept on the sales order. An internal order can wait for the customer PO.
- **Approve**: a second person checks and approves a sales order. The Owner and Admin may approve their own.
- **Release**: send approved order lines to the winder queue. Each release row becomes one job card. A parchment colour is compulsory.
- **Job card**: the floor record for one batch: one colour, one lot. It carries the stages Winding, Oven, Process and Dispatch, the runs, the QC readings and the history. Number format YY/MM/NN, for example 26/10/315. The job card is the floor's truth.
- **Stage**: one step of making: Winding, Oven, Process (which includes packing and the final check), then Dispatch.
- **Run**: one logged piece of output at a stage (shown as W#1, W#2 and so on) with date, shift, made, good and rejected quantities.
- **Bamboo**: a long wound tube that is cut into pieces. On a card you may see "8 bamboo x 10 = 80 pcs", meaning 8 bamboo of 10 pieces each.
- **Pcs**: pieces, the unit of tubes ordered and made.
- **Parchment**: the coloured paper layer of the tube. Every job card has exactly one parchment colour (for example BLUE or RED).
- **Adhesive**: the glue used in winding. Issued from stores like any other material.
- **GSM**: grams per square metre, the weight grade of paper (for example Kraft 300 GSM).
- **Reel / coil**: a roll of paper as received. A reel is slit into coils for the winders. Every physical reel or coil has its own label.
- **Slitting**: cutting a wide reel into narrow coils. Each reel issued to the floor gets a slitting card.
- **Winder, Oven, Process**: the three production areas, in that order. Planning has a page for each, plus Slitting.
- **Plan / planned**: the machine, day and shift a card is placed on in the Planner. Planning is only the plan: it never stops the floor from logging a run.
- **Split plan**: cuts one card's plan into two time slots. The card stays one card. To make a separate card, use Split into a new card in the Job card manager.
- **Missed slot**: the planned slot passed with nothing logged, so the card is back in the queue.
- **Shift**: Shift A runs 08:00 to 20:00 and Shift B runs 20:00 to 08:00 (India time). A run belongs to the day its shift started, so a run at 01:30 on 31 Oct is Shift B of 30 Oct.
- **Season**: the production season (such as monsoon or rest of year) shown in the header. Specifications have a recipe per season, versioned on their own.
- **Specification (spec)**: the recipe and size sheet of a product: papers, adhesive, parchment, tube size, mandrel and weights.
- **Mandrel**: the steel former a tube is wound on.
- **Challan / dispatch**: the delivery document made at Dispatch when finished pieces leave the plant.
- **Partial dispatch**: sending part of an order now and the rest later. The order shows Partly dispatched.

## Quality words

- **QC**: quality control. **Incoming QC** checks raw material that arrives. **In-process QC** checks tubes at Winding, Oven and Process.
- **Band**: the allowed range for a reading, for example I.D. 76.2 to 76.5 mm. A reading inside the band is green; outside is amber with a flag.
- **Flagged**: a reading outside the band at in-process QC. It is saved and flagged for managers. It does **not** stop the card.
- **Held / hold**: a lot or card that cannot move on. Incoming material outside its band is held and cannot be issued. Managers can also place manual holds.
- **Two-reading rule**: each check needs at least 2 readings (S1 and S2) before a stage can close.
- **Concession**: the plant head accepts a failed lot anyway, with a reason.
- **Return to supplier**: a failed lot goes back to the vendor.
- **Customer complaint**: a returned or complained batch, followed to closure in Quality.

## Purchasing and stores words

- **Purchase order (PO)**: an order to a vendor. Number formats RP-PM/NN (raw and packing material) or OT/NN (other items).
- **Requisition**: a request for a tool or material that the Owner approves.
- **RM inward calendar**: the day-by-day view of raw material demand against stock and arrivals. Arrivals the Owner approves become draft POs.
- **Expected arrivals**: what vendors should deliver, grouped overdue, today, this week and later, each with a Make GRN button.
- **GRN (goods received note)**: the inward receipt made in Goods inward. Number formats P/YY/NNN (paper), A/YY/NNN (adhesive) and IN/YY/NNN (everything else), by financial year starting 1 April.
- **Invoice difference**: the vendor invoice differs from the PO in rate, quantity or specification. It goes to Accounts.
- **Debit note**: a claim on the vendor for a difference, approved and settled.
- **Issue**: giving material to the floor by shift. Reels and coils are issued by Reel & coil issue; adhesive, parchment and packing by Material issue. Issue is to the floor, not to a machine or card. Nothing returns from the floor.
- **Genealogy**: the family tree of a reel: its slit coils, issue scans and where it was used.
- **Stock count (spot / month-end)**: counting stock racks to compare with the book. Differences are settled by corrections.
- **Stock book**: the ledger of every stock movement.
- **Location / rack**: where stock sits. Racks and lots have printed labels.
- **Opening stock**: stock already in the plant at go-live, entered in batches with new labels.
- **Month-end close**: counting the store, checking material use against spec, then closing the month. A closed month refuses entries dated in it until the Owner re-opens it.
- **Manual FG inward**: finished goods entered by hand (rework yield, returns, adjustments) outside the normal job-close flow.

## Access words

- **Role**: what you are allowed to see and do (Sales, Planner, Plant Manager, Operator, QC, Store, Dispatch, Accounts, Owner, Admin and so on). Each role sees its own sidebar pages.
- **Plant scope**: the plant you are working in, chosen at the top right. Many pages say "select one plant" when the scope is All Visible Plants.
- **Owner / Admin**: can open every page. Only the Owner can open Production season.
- **Maker-checker**: the person who enters something may not approve it (the Owner and Admin are the exception for sales orders).
- **Inbox**: your own work queue and every handoff, hold and approval that involves you. The bell in the header shows new messages.
- **Jump to workspace**: the search box in the header. Press Ctrl+K (Cmd+K on Mac) and type a page name.


## Status cheat sheet (from chapter 00)

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
| Running | The floor is logging runs. |
| Ready to dispatch | Process closed; packed pieces wait for a challan. |
| Completed (tab **Done**) | All stages done. |
| Force-closed (tab **Closed early**) | Closed at the quantity made; the balance went back to the order. |
| Cancelled | Nothing made; the whole quantity went back to the order. |

**Plan status** words: "planned 30 Oct · Shift A", "running · planned …", "plan in 2 parts · next …", "slot … passed", "slot passed with nothing logged, back in the queue", "not planned yet", "waiting for the winding plan", "follows Process", "Finished".

**Purchase order**: **Draft**, **Waiting approval**, **Approved**, **Partly received**, **Received**, **Short-closed**, **Rejected**, **Revision needed**, **Withdrawn**, **Cancelled**.

**GRN line, incoming QC**: **Waiting for QC**, **QC passed**, **QC failed**, **Cleared** (no inspection needed, for example go-live opening stock). Stock words: **On QC hold**, **Usable**. Commercial words on the GRN: "rates match the PO", "invoice to follow", "differs from the PO · goes to Accounts", "manual GRN · goes to Accounts".

**In-process QC**: "Still needs QC" (run without its readings), "needs more readings" (fewer than 2 per check), **Flagged QC · N runs** (reading outside the band, saved and flagged).

**Specification**: **Draft**, **Review**, **Trial**, **Approved**, **Obsolete**; each season's recipe shows **Ready** or **Needs attention**.


## Numbering formats (from chapter 00)

| Document | Format | Example | Rule |
|---|---|---|---|
| Sales order | SO/YY/MM/NN | SO/26/10/412 | Restarts every month; grows past 99. Older orders kept their old numbers. |
| Job card | YY/MM/NN | 26/10/315 | Restarts every month (India time). A split or top-up card keeps the root and adds a letter: 26/10/315-A. |
| Purchase order | RP-PM/NN or OT/NN | RP-PM/68 | RP-PM for raw and packing material, OT for other items; per plant. |
| GRN (inward) | P/YY/NNN, A/YY/NNN, IN/YY/NNN | P/26/001 | P paper, A adhesive, IN everything else. Restarts on 1 April: P/26/… is financial year 2026-27, so January to March 2027 is still P/26/…; 1 April 2027 starts P/27/001. |
| Reel / coil label | AT number | one per physical reel or coil | Printed at inward; reprints never create stock. |
