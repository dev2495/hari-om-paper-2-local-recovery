# Dispatch

> **What it is:** The dispatch register of packed job cards and the delivery challan: make a draft, seal it (stock goes out and the sales order counts the delivery), and print it.
> **Who uses it:** Dispatch (makes and seals challans), Store, Plant Manager, Supervisor and Logistics (save drafts), Sales (views and prints sealed challans), Owner and Admin.
> **Where:** Sidebar > Stores & inventory > Dispatch (/logistics/dispatch). A new challan opens at /logistics/dispatch/new?job_card_id=<card>; a sealed challan prints at /logistics/dispatch/<card>/print.

## At a glance
- A card is ready to ship when **Process is closed**. Closing Process also closes packing and the final QC, and posts the finished goods to stock. There is no separate packing or final QC step on batch-entry cards.
- **Sealing** a challan takes the pieces out of stock and counts them as dispatched on the sales order. Sealing is done by **Dispatch, Owner or Admin**. Others with access can save a draft.
- **An active QC hold blocks sealing.** Flagged readings do not.
- One card can ship in **several challans** (partial dispatch). Each seal ships only its own quantity; "left to ship" goes down each time.
- The challan reads the plant's legal name, address and GSTIN and the customer's ship-to address from the masters. Vehicle number, transporter, quantity and net weight are typed on the challan.

## The flow
```flow
title: From packed card to sealed challan
Close Process [Plant Manager] (FG posted) -> Ready for a challan -> Make challan [Dispatch] -> Save draft [Dispatch/Store] -> Seal & print challan [Dispatch/Owner/Admin] -> Challan sealed (stock out, order delivered)
after Ready for a challan: On QC hold -> Release hold [Plant head/Owner/Admin] -> Make challan [Dispatch]
after Challan sealed: Pieces left -> Make next challan [Dispatch] (partial dispatch)
after Challan sealed: Extra pieces left -> Retain surplus FG [Dispatch/Owner/Admin] (card closes)
```
The card completes after all accepted finished goods are shipped, or the extra pieces are retained in stock.

## Screen tour

![Alt: Dispatch register with filters and a table of job cards, their pieces, challan state and action buttons](../screens/dispatch.jpg)
*Figure: The Dispatch register with 93 job cards. Filters for customer, job card and challan; a table showing for each card its pieces accepted, shipped and left, the challan or stage state, and Make challan or View challan.*

What you see:
1. **Header**: "Finished-goods handoff", **Dispatch register**, and the number of job cards shown. "Make, continue or view the delivery challans of packed job cards. Sealing a challan takes the pieces out of stock and counts them as dispatched on the order."
2. **Filters**: **Customer**, **Job card**, **Challan** (**All**, **No challan yet**, **Draft challan**, **Sealed**), **Clear**.
3. **Job card · plant**: card number and plant.
4. **Customer · size**: customer and tube size (for example 81 OD × 76.2 ID × 149.8 mm).
5. **Pieces**: "893 accepted · 0 left to ship" and "893 shipped · 0 can ship now"; also "N rejected at QC" when there are rejects. Hover for "Released 900 pcs · up to 893 pcs may ship (with the allowed extra)".
6. **Challan · stage**: **Sealed**, **Draft challan**, or the state in words:
   - **Waiting for Process to close** (with "Now at Packing" or the current stage),
   - **Waiting for the stock posting** (Process closed, finished goods not posted yet),
   - **On QC hold**,
   - **Nothing accepted at final QC**,
   - **Extra pieces kept in stock**,
   - **Ready for a challan**,
   - **Challan sealed**.
7. **Action**: **Make challan** (or **Edit draft challan**) when pieces can ship; links **Challan 1: 893 pcs**, **Challan 2: …** to each sealed challan; **View challan**; and **Retain surplus FG** when the allowed quantity is shipped but accepted pieces remain.

![Alt: New dispatch page with no job card selected](../screens/dispatch-new.jpg)
*Figure: The new challan page opened without a card. It says only "No Job Card selected." Open it from Make challan on the register, or from the card's Dispatch step, so the card is filled in.*

With a card selected, the challan page shows (described in words; no screenshot):
1. **Title**: **Delivery challan (draft)** or **Sealed delivery challan**; "Job card 26/10/315. Plant and customer details come from their masters." Buttons **Save draft** and **Seal & print challan**.
2. **Role note**: "You can save this as a draft. Dispatch, Owner or Admin seal it." Sales sees "View only…".
3. **Cannot be sealed yet** box (red) when something is missing, each line with where to fix it: plant legal name, plant address, plant GSTIN (fix in **Plants**), customer ship-to address (fix in **Customers**), vehicle number, transporter name, shipment quantity, net weight (fix on the challan). "After saving the master, come back to this tab: the challan reloads the details by itself."
4. **Details from the masters**: a **Plant** card (Legal name, Address, GSTIN) and a **Customer** card (GSTIN and Billing optional, **Dispatch to**), each marked **Ready** or **Details missing**, with **Edit in Plants / Fill in Plants** and **Edit in Customers / Fill in Customers** (Owner and Admin), and **Reload**.
5. **Shipment**: **Shipment quantity (pcs)** ("Up to 893 pcs"), **Pieces per bundle** ("9 bundles; the last one may hold fewer"), **Net weight (kg)**. Under it: "893 pcs × 33.78 g (spec) = 30.166 kg"; the weight can be changed, and **Use 30.166 kg** puts the worked-out value back. If the spec has no tube weight, type the net weight.
6. **Challan document**: plant name, address and GSTIN; customer; **Challan No** ("Given on sealing"), **Challan Date**, **Job Card Ref**; **Transport Details**: **Vehicle No** (e.g. GJ15AB1234), **LR No**, **Transporter**; the packing table (Description, Units, PCS/Unit, Total PCS, Net weight (kg), Remarks); **Dispatch Notes**; signature boxes **Prepared By**, **Supervisor**, **Transporter's Sign**, **Receiver's Sign**.

## Step by step

### How to make and seal a challan
Roles: drafts by Dispatch, Store, Plant Manager, Supervisor, Logistics, Owner, Admin; sealing by Dispatch, Owner, Admin.
1. Open **Dispatch**. Find the card (filter by customer or card number). It must say **Ready for a challan**.
2. Click **Make challan**. (From the job card page, **Next step** shows "Create dispatch slip · N pcs ready" with a **Dispatch** button that opens the same page.)
3. Check the **Plant** and **Customer** cards. If one says **Details missing**, an Owner or Admin fills it in the master, then press **Reload**.
4. Type **Shipment quantity (pcs)** (up to the number shown), **Pieces per bundle**, and check **Net weight (kg)**.
5. Type **Vehicle No**, **Transporter** and, if you have it, **LR No**. Add **Dispatch Notes** if needed.
6. Click **Save draft** to keep it for later, or **Seal & print challan**.
7. The dialog **Seal this challan?** repeats Quantity, Customer, Dispatch to, Vehicle and Job card. Click **Confirm and seal** (or **Keep editing**).
8. "Sealed and locked. Opening the challan to print…". The challan gets its number, stock goes out, and the sales order counts the delivery.

### How to ship part of a card (partial dispatch)
1. Make a challan for part of the pieces (for example 500 of 893). Seal it.
2. The register shows "393 left to ship" and a link **Challan 1: 500 pcs**.
3. When the next truck goes, click **Make challan** again for the rest. It becomes **Challan 2**.

### How to print or reprint a challan
1. On the register, click **Challan 1: … pcs** or **View challan**.
2. Use the print button on the challan page. Sales can print sealed challans too.

### How to keep extra pieces in stock (Retain surplus FG)
Roles: Dispatch, Owner, Admin. Batch-entry cards only.
1. When the allowed quantity is shipped but accepted pieces remain, the register shows **Retain surplus FG**.
2. Click it, read the settlement, write the **Reason** and click **Confirm retention and close** (or **Keep card open**).
3. The register shows **Extra pieces kept in stock** and the card closes. Shipping that stock later needs a new allocation.

### How to finish an interrupted shipment
If the connection dropped while sealing, the challan shows "This shipment was interrupted." Click **Retry shipment** (or **Resume shipment**). It finishes the stock and sales posting once; never make a second challan for the same pieces.

## Rules the system enforces
- **Process must be closed** on batch-entry cards: "Close the Process stage first (packing and its final QC close with it), then seal the challan." (Blocks.)
- **Finished goods must be posted**: "The finished goods of this card are not in stock yet (packing has not posted them)…" and "Nothing is packed on this card yet." (Blocks.)
- **Old-form cards** need their Final QC recorded before sealing ("Final QC has not passed for this card. Record a passing final QC inspection, then seal the challan."). (Blocks.)
- **No active QC hold**: "N quality hold(s) are open on this card. Clear them in Quality before sealing." Flagged readings do not block. (Blocks.)
- **Quantity limits**: not more than the accepted finished goods left on the card, and not more than the card's remaining released allocation ("…more than this card's remaining released allocation of N pcs"). (Blocks.)
- **Required to seal**: plant legal name, address and GSTIN; customer dispatch address; vehicle number; transporter name; shipment quantity; net weight above 0. The server checks the same list. (Blocks.)
- **Who seals**: "Only an Owner, Admin or Dispatch user can seal a challan." (Blocks.)
- **Sealed is final**: "This challan is sealed and cannot be changed." (Blocks.)
- **One shipment at a time per order line**: if another card of the same line has an unfinished shipment, finish that first with **Retry shipment**. (Blocks.)
- **Net weight** is worked out as pcs × tube weight per piece from the spec, and stays editable. (Automatic.)
- **Challan number** is given when sealed (for example DC-20261031-3F9A1C2B). The challan and the stock movement carry the same India business date. (Automatic.)
- **Safe retry**: a retry of the same seal never posts stock twice. (Automatic.)

## Sample
Card 26/10/315 for Sharma Tubes Pvt Ltd closed Process with 893 good pcs (released 900). Tube weight on the spec: 33.78 g.

| Challan | Pcs | Bundles (100 per bundle) | Net weight | Vehicle | Left to ship |
|---|---|---|---|---|---|
| Challan 1 | 500 | 5 | 16.890 kg | GJ15AB1234 | 393 |
| Challan 2 | 393 | 4 (last holds 93) | 13.276 kg | GJ15CD5678 | 0 |

After Challan 2 is sealed, the card shows **Done** and the order line SO/26/10/408 counts 893 pcs delivered.

## Common questions
**Q: Why is there no Make challan button on my card?** A: Read the state: "Waiting for Process to close", "Waiting for the stock posting" or "On QC hold". The button appears only when pieces can ship and your role can prepare challans.

**Q: The seal says the plant GSTIN is missing.** A: Ask an Owner or Admin to fill it in **Plants** (System). Then press **Reload** on the challan.

**Q: Can Sales seal a challan?** A: No. Sales can view and print sealed challans. Dispatch, Owner or Admin seal.

**Q: The card has QC flags. Can I still ship?** A: Yes. Flags do not block. Only an active QC hold blocks sealing.

**Q: I sealed the wrong quantity.** A: A sealed challan cannot be changed. Speak to the Owner or Admin about a correction; do not make a second challan for the same pieces.

**Q: Why can only 893 ship when the order released 900?** A: Only accepted finished goods can ship. Process made 893 good pieces, so 893 is the most that can ship.

**Q: The net weight is empty.** A: The spec has no tube weight. Type the net weight in kg.

## Related chapters
- Job cards
- Quality
- Sales orders
- Masters
- Inventory, material items, manual FG, stock alerts and RM costing
