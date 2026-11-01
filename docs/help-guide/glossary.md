# Hari Om TubeOS glossary: words you will see in the system

Accurate as of 1 November 2026. Hari Om TubeOS is the ERP of a paper tube plant. The words below are used on its screens. Look here first if a word is unfamiliar. The full status lists and number formats follow after the glossary.

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
- **AIT serial**: the plant's own reel number, "AIT", a space and 5 digits, for example AIT 06243. One running series per plant and financial year; it starts again at AIT 00001 on 1 April. The Owner or Admin sets the next number once (System › Plants) to carry on from the plant's printed series; after that it can only go up. Older reels keep AT-yymmdd-nnn numbers, which still scan and search.
- **Coil suffix**: a coil made from a reel carries the reel's serial plus -1, -2 and so on, for example AIT 06243-1, with the coil's own weight.
- **Reel label**: the plant's own label layout with a QR added: label heading, MILL NAME, invoice no., date, PLYBOND, VARIETY, GSM, ROLL NO., the AIT serial in very large letters, and WEIGHT.
- **Label heading**: the first line of reel, coil and box labels, set per plant (for example AMIGO INDUSTRIES UNIT II). Blank prints the plant's legal name.
- **Mill name (short name)**: the vendor's short name printed as MILL NAME on reel labels (for example AKSHAT). Set on the vendor in Masters › Vendors.
- **Slitting**: cutting a wide reel into narrow coils. Each reel issued to the floor gets a slitting card.
- **Winder, Oven, Process**: the three production areas, in that order. Planning has a page for each, plus Slitting.
- **Plan / planned**: the machine, day and shift a card is placed on in the Planner. Planning is only the plan: it never stops the floor from logging a run.
- **Split plan**: cuts one card's plan into two time slots. The card stays one card. To make a separate card, use Split into a new card in the Job card manager.
- **Missed slot**: the planned slot passed with nothing logged, so the card is back in the queue.
- **Shift**: Shift A runs 08:00 to 20:00 and Shift B runs 20:00 to 08:00 (India time). A run belongs to the day its shift started, so a run at 01:30 on 31 Oct is Shift B of 30 Oct.
- **Season**: the production season (such as monsoon or rest of year) shown in the header. Specifications have a recipe per season, versioned on their own.
- **Specification (spec)**: the recipe and size sheet of a product: papers, adhesive, parchment, tube size, mandrel and weights.
- **Mandrel**: the steel former a tube is wound on.
- **Challan / dispatch**: the delivery document made at Dispatch when finished pieces leave the plant. For a box card it is built from boxes and lists every box code, the box count, pcs per box, total pcs and the spec's packing.
- **Partial dispatch**: sending part of an order now and the rest later. The order shows Partly dispatched. On a job card, it means shipping some of its boxes, even while Process is still running.
- **Box**: the packed, labelled unit of finished tubes and the dispatch unit. Process good pcs whose QC readings are done are packed into boxes of the spec's qty per box. Each box is its own finished-goods lot in stock and ships whole.
- **Box code**: the number of a box: B, the job card number without slashes, a dash and 3 digits. Card 26/10/315 gives B2610315-001, B2610315-002 and so on; a split card 26/10/315-A gives B2610315A-001.
- **Part box**: the last box of a job card, packed when Process closes, holding the pcs that did not fill a full box. Its label says PART BOX.
- **Box label**: the sticker on a box: plant heading, customer, product, size and colour, job card, order and customer PO, the box code in big letters, the pcs (PART BOX marked), packed date, shift and operator, and a QR that opens the box page. Printing or reprinting never adds stock.
- **Box page**: the page a box label's QR opens (/production/boxes/<box code>): pcs, status, stock posting, QC flags, who packed it, the runs in it and its packing.
- **Qty per box**: the whole pcs a full box holds, set in the spec's packing.
- **Kept as surplus (retain surplus)**: leftover boxes that no longer fit in the released quantity stay in stock with their labels when Dispatch retains the surplus with a reason; the card closes and any unshipped released quantity goes back to the order.
- **Stage short close**: closing Winding, Oven or Process below its target, with a reason code. The pcs not made go back to the sales order at once, the later stages are cut to what was passed on, and the card carries on.
- **Balance returned**: the pcs a job card gives back to its sales order line (from a stage short close, a force close, a cancel or a surplus retention). They show as not released again; Sales releases them again or short closes the order. Reopening the stage takes them back if the order still has them.
- **Back to order**: the tile in the Job card manager showing the pcs a card has given back to its order.
- **Reopen stage**: the Owner or Admin opens a closed stage again with a reason code; a short close is taken back from the order where it still can be.
- **Packing setup**: the temporary Owner/Admin page that sets box, qty per box, plastic and fadda on every active spec without re-approval, and updates open job cards that have not packed a box yet.
- **Fadda**: the sheet put inside a box (putha). A Packaging master of its own kind, with a weight per piece.

## Quality words

- **QC**: quality control. **Incoming QC** checks raw material that arrives. **In-process QC** checks tubes at Winding, Oven and Process.
- **Band**: the allowed range for a reading, for example I.D. 76.2 to 76.5 mm. A reading inside the band is green; outside is amber with a flag.
- **Flagged**: a reading outside the band at job card QC (in-process or final). It is saved and flagged on the run, the box and the card for managers. It does **not** stop the card and never blocks dispatch.
- **Held / hold**: a lot or card that cannot move on. Incoming material outside its band is held automatically and cannot be issued. On job cards, only holds placed on purpose by QC, the plant head, Owner or Admin exist; they stop the next stage and dispatch until the plant head, Owner or Admin releases them.
- **Two-reading rule**: each check needs at least 2 readings (S1 and S2) before a stage can close, before the next stage takes the run, and before its Process pcs are boxed.
- **QC-cleared**: a run whose readings are done (2 per required check), in band or not.
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
- **Manual FG inward**: finished goods entered by hand (rework yield, adjustments, opening stock) outside the normal box flow, with a Manual FG inward reason code. Customer returns go to Customer complaints instead.
- **Packing theory**: the packing material the month expects: per box packed, 1 box plus the spec's plastic and fadda per box, in kg from the master weights. A row that cannot be costed is kept with a warning.

## Access words

- **Role**: what you are allowed to see and do (Sales, Planner, Plant Manager, Operator, QC, Store, Dispatch, Accounts, Owner, Admin and so on). Each role sees its own sidebar pages.
- **Plant scope**: the plant you are working in, chosen at the top right. Many pages say "select one plant" when the scope is All Visible Plants.
- **Owner / Admin**: can open every page. Only the Owner can open Production season.
- **Maker-checker**: the person who enters something may not approve it (the Owner and Admin are the exception for sales orders).
- **Inbox**: your own work queue and every handoff, hold and approval that involves you. The bell in the header shows new messages.
- **Jump to workspace**: the search box in the header. Press Ctrl+K (Cmd+K on Mac) and type a page name.

## Reasons and people

- **Reason code**: a fixed code from Masters › Reason codes picked wherever the system asks why (for example SS-MATERIAL-SHORT "Paper or input short"). Each code belongs to one list (category) such as Stage closed short, Floor rejection, QC hold placed or PO cancel / short close. Free text alone is never accepted; a note is optional. Records keep the code, its label at that moment and the note.
- **Reason list (category)**: one list of reason codes for one kind of action. Lists are grouped as Sales, Job cards and floor, Quality, Stores and stock, Purchase and Dispatch.
- **OTHER code**: the catch-all code of each list (SO-OTHER, RJ-OTHER, QH-OTHER…). It always needs a note of at least 5 characters.
- **Order close reasons**: the Sales list of reason codes for cancel, short close and customer hold, managed on its own page by the Owner and Admin.
- **Operator (floor log)**: the employee named on a run or QC entry. Only active employees whose department in Masters › Employees is the stage (WINDER, OVEN, PROCESS) can be picked.
- **Employee performance**: the report of runs, made, good, rejected, reject %, flagged QC readings and shifts worked per operator.
