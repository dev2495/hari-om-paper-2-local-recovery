HARI OM TUBEOS HELP GUIDE - Chapter 20: Purchase orders, PO approvals and requisitions
Section: Purchasing, stores and inward. Accurate as of 8 November 2026. Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).
Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter 20.

# Purchase orders, PO approvals and requisitions

> **What it is:** the purchase desk, where purchase orders (POs) are made, approved by the Owner or an Admin, sent to the vendor and followed until the goods come in. Requests for tools and spares start here as requisitions.
> **Who uses it:** Store and the Plant Manager make POs. Store, Planner and Plant Manager submit, send and record vendor dates. The Owner or an Admin approves POs. Only the Owner approves requisitions. Anyone can raise a requisition.
> **Where:** Sidebar > Purchasing > Purchase orders (/purchase), Create purchase order (/purchase/new), PO approvals (/purchase/approvals), Purchase requisitions (/purchase/requisitions)

## At a glance
- **Every PO goes through approval.** A PO the desk makes by hand is a **Draft** until someone uses **Submit for approval**. The Owner or an Admin then approves or rejects it. Only an approved PO can be received on a GRN.
- **Drafts the Owner scheduled skip the second approval.** When the Owner approves arrivals on the RM inward calendar, the system makes draft POs tagged **Scheduled by Owner**. If nobody changes them, **Send to vendor** approves and sends them in one step.
- **PO numbers are automatic.** The system gives the next number in the series when you save: **RP-PM/53** for raw and packing material, **OT/07** for other purchases (tools, spares). You cannot type or change the number, and you cannot change the series later.
- **Every line needs incoming QC.** The PO has no "QC required" tick any more. Each line is marked for incoming QC by the system, and QC checks each delivery against the material standard.
- **Changing an approved PO makes a new revision.** The old approved version stays in **Revision history**, and the new revision needs approval again.

## The flow

Flow diagram: Hand-made purchase order
Steps: 1. Create PO (done by Store/Plant Manager) -> 2. Save PO draft - number given -> 3. Submit for approval (done by Store/Planner/Plant Manager) -> 4. Approve (done by Owner/Admin) -> 5. Send to vendor (done by Purchase desk) -> 6. Vendor confirms dates (done by Purchase desk) -> 7. Receive goods (done by Store/GRN) - GRN
If it goes wrong after 'Approve': 1. Reject with reason code (done by Owner/Admin) -> 2. Sent back by Owner -> 3. Edit / vendor change (done by Purchase desk) -> 4. Submit for approval



Flow diagram: Draft scheduled by the Owner
Steps: 1. Approve arrivals (done by Owner) - RM inward calendar -> 2. Draft PO, Scheduled by Owner -> 3. Check & send (done by Purchase desk) - no second approval -> 4. Vendor confirms dates -> 5. Receive goods - GRN
If it goes wrong after 'Draft PO, Scheduled by Owner': 1. Desk changes qty, date, vendor or rate -> 2. Submit for approval -> 3. Approve PO (done by Owner) -> 4. Send to vendor



Flow diagram: Tools, spares and other purchases
Steps: 1. Submit requisition (done by Anyone) -> 2. Approve request (done by Owner) -> 3. Create linked PO (done by Store/Plant Manager) - OT series -> 4. Submit for approval -> 5. Approve (done by Owner/Admin) -> 6. Send to vendor
If it goes wrong after 'Submit requisition': 1. Reject (done by Owner) - reason saved in history


The purchase desk is Store, Planner and Plant Manager (the Owner can do every step too). The PO is the document the vendor receives. After the vendor confirms the dates, the goods are received on a GRN, described in the Goods inward chapter.

## Screen tour

[Screenshot "po-list": Purchase orders page with five summary tiles, queue tabs and scheduled draft cards]
*Figure: The Purchase orders page. Five tiles at the top show Drafts to send (13), Waiting approval (3), Sent, waiting delivery (23), Requisitions to approve (0) and Open to receive (839 pcs and 5,760.5 kg). Below are queue tabs and cards for the scheduled drafts, each with a Check & send button.*

What you see:

1. **New purchase order** and **Export full register**: the first opens the PO form (only for Store, Plant Manager, Owner and Admin). The second downloads the PO line register in Excel.
2. **Summary tiles**: **Drafts to send** (drafts the Owner scheduled), **Waiting approval** (the Owner opens PO approvals from it; others see the Waiting approval tab), **Sent, waiting delivery**, **Requisitions to approve**, and **Open to receive**, shown per unit (kg and pcs are never added together). Click a tile to open its list.
3. **Queue tabs**: **Scheduled drafts to send**, **Waiting approval**, **Sent back by Owner** (shown only when there is one), **Approved – not sent**, **Sent – waiting delivery** and **All**. Counts sit beside each tab; an amber warning icon marks a queue that needs action. The page opens on Scheduled drafts when there are any, otherwise on All.
4. **Search PO, vendor or material**: filters the list as you type.
5. **Scheduled draft cards**: PO number, vendor, a violet **Scheduled by Owner · date** badge, quantity, number of materials, arrival dates as chips (for example "6 Jan · Kraft 230 GSM · 23 kg"), the send state ("Unchanged since the Owner approved: ready to send" or "Rate needed for …"), the value and the week. The button says **Check & send**, **Fill the rate**, **Open & submit** or (for the Owner) **Open & approve**.
6. **Order table** (all other tabs): columns **PO**, **Vendor** (with PO date), **Materials**, **Next delivery** ("Confirmed" or "To confirm"), **Status**, **Sent** (channel and date, or "Not sent"), **Amount** and a button. Approved and partly received POs show **Receive**; the others show **Open**. Click anywhere on a row to open the PO.
7. **Shortcut cards** at the bottom: RM inward calendar, Expected arrivals, Goods inward (GRN) and Rate review.

[Screenshot "po-new": Create purchase order form with requisition, document and vendor, material lines and terms]
*Figure: The Create purchase order form. From top: Approved requisition (PR reference), Document and vendor (Series, PO number "Assigned after save", PO date, Expected date, Vendor, Contact, GSTIN, Vendor address), Material lines with Add line, a sticky Draft total bar with Save PO draft, and Terms and authorization.*

What you see:

1. **Approved requisition**: **PR reference** list. Leave it on "No requisition · RM / PM purchase" for paper, adhesive, parchment and packing. Pick an approved requisition for a tool or other purchase; the series changes to OT and the line is filled from the request.
2. **Document and vendor**: **Series** (RP-PM · Raw / packing or OT · Other), **PO number** (server owned, "Assigned after save"), **PO date**, **Expected date**, **Vendor**, **Contact**, **GSTIN**, **Vendor address**. Choosing a vendor fills contact, GSTIN, address and payment terms from the vendor master. A grey line under the fields shows the legal name, PAN, state and MSME number saved in the master, or says to add them in Masters › Vendors.
3. **Material lines**: one card per material with **Material**, **Description**, **Ordered quantity** (in the material's unit), **Rate / kg** (or / piece), **Arrives on** (optional date for that line) and the **Line amount**. **Add line** adds another material; the bin icon removes one.
4. **Draft total** bar: lines, quantity per unit and rupee value, with **Save PO draft**.
5. **Terms and authorization**: **Payment terms**, **Freight terms**, **Tax terms**, **Delivery terms**, **Test report terms**, **Special instruction** and **Internal notes**. They come pre-filled (for example "60 days from invoice date.", "Attach PB/GSM/RCT/COBB test report with each delivery.") and print on the PO.

[Screenshot "po-detail": PO detail page for a scheduled draft with send button, delivery dates and the saved purchase document]
*Figure: The page of RP-PM/53 for Umiya Paper Mills. Buttons at the top: Send to vendor, Print PO, Saved PDF, Edit / vendor change. A violet banner says the Owner scheduled it on 30 Oct 2026 and nothing changed since. A strip shows Ordered 23 kg, Received 0 kg, Open to receive 23 kg, Physical lots 0. Below: Delivery dates (6 Jan 2027, Kraft 230 GSM, 23 kg, To confirm) and the Saved purchase document.*

What you see:

1. **Top buttons** (they change with the status): **Send to vendor** or **Send again**, **Fill the rate**, **Submit for approval**, **Approve PO**, **Receive goods (GRN)**, **Print PO**, **Saved PDF** and **Edit / vendor change**.
2. **Badges**: source (**Scheduled by Owner**, **Requisition**, **Hand-made**, **Workbook import**, **Month plan**), a **Sent on WhatsApp · date** chip, **Vendor confirmed** and the send state in words.
3. **Scheduled banner** (Owner-scheduled POs only): who scheduled it, the arrival dates, and a list headed "Changed since the Owner approved it" when the desk changed something.
4. **Quantity strip**: **Ordered**, **Received**, **Open to receive**, **Physical lots** (reels and coils received so far).
5. **Delivery dates**: one row per dated arrival with its state (**To confirm**, **Confirmed**, **Received**). After sending, the desk records the vendor's date with **Confirm** or **Vendor confirmed all**. **Make GRN** opens goods inward for that line. GRN fills the oldest date first.
6. **Saved purchase document**: exactly what the vendor gets: supplier block (name, address, GSTIN, PAN, state, MSME, contact), lines with rate and amount ("Rate needed" in amber when a rate is missing), delivery dates, terms, "Prepared / checked by" and "Approved by … on …".
7. Further down: **Approval** panel (status, what is next, decision reason, close and cancel buttons) and **Revision history** (every revision, who made it, who approved it).

[Screenshot "po-approvals": PO approvals page with waiting count, RM arrivals to approve, requisitions and the approval inbox]
*Figure: PO approvals as the Owner sees it. Tiles: Waiting 3, Value to review ₹10,700, Who approves "Owner or Admin". Panels: RM arrivals to approve (two arrivals with "no vendor yet" and a disabled Approve all with a vendor button), Requisitions waiting for your decision, and Purchase order approval inbox.*

What you see:

1. **Tiles**: **Waiting** (submitted revisions), **Value to review** and **Who approves**.
2. **RM arrivals to approve** (Owner only): arrivals proposed on the RM inward calendar, with **Review on the calendar** and **Approve all with a vendor**. An arrival with "no vendor yet" cannot be approved until a vendor is picked.
3. **Requisitions waiting for your decision** (Owner only): each request with an **Approval note (optional)**, a **Reason to reject** picker, **Approve** and **Reject**.
4. **Purchase order approval inbox** ("Step 3 of purchasing. Open the full saved PO before deciding. Sending one back needs a reason from the list."): each submitted PO with its revision, vendor, materials, quantity and value, an **Approval note** (optional), a **Reason to send back** picker (list **Purchase approval rejected**), **Approve** and **Reject**. Click the PO number to read the full PO first.

[Screenshot "po-requisitions": Purchase requisitions page with a new request form and the requests list]
*Figure: Purchase requisitions. A New request panel has Request date, Material or tool (grouped by type), Quantity and "Why is this needed?", with Submit requisition. Below, Requests and decisions lists the requests.*

What you see:

1. **New request**: **Request date**, **Material or tool** (grouped as Paper, Adhesive, Parchment, Packaging, Tools / spares, Other materials), **Quantity** (unit from the master) and **Why is this needed?**. A link explains how to add a missing item under Inventory → Material items with type Tool or Other.
2. **Requests and decisions** (Owner) or **Requisition register** (others): each request shows its PR number, material, quantity, date, requester, status and reason. Approved ones show **Create linked PO**; converted ones show **Open linked PO**. **History** lists every step. Roles other than Owner, Admin, Store, Planner and Plant Manager see only their own requests.

## Step by step

### How to create a purchase order
Roles: Store, Plant Manager, Owner, Admin. (A Planner who opens the page is told to propose the arrival on the RM inward calendar instead.)

1. Click **New purchase order** on the Purchase orders page, or **Create purchase order** in the sidebar.
2. For paper or packing, leave **PR reference** on "No requisition". For a tool or spare, pick the approved requisition.
3. Check **Series** (RP-PM or OT), **PO date** and **Expected date**.
4. Pick the **Vendor**. Contact, GSTIN, address and payment terms fill in; correct them if needed.
5. In **Line 1**, pick the **Material**, type the **Ordered quantity** and **Rate**. Add **Arrives on** if this line comes on a different day from the expected date.
6. Click **Add line** for each further material. The **Draft total** updates.
7. Check the terms, then click **Save PO draft**. The system checks every line has a material, a quantity above 0 and a rate of 0 or more; otherwise you see "Select a vendor and complete every material, quantity and rate before saving." The PO opens with its new number, status **Draft**, and one dated delivery row per line.

### How to submit a PO for approval
Roles: Store, Planner, Plant Manager (Owner and Admin also can).

1. Open the draft PO.
2. If a line shows "Rate needed", click **Fill the rate** and enter it. Submit opens only when every line has a rate.
3. Optionally type a **Note for the Owner** in the Approval panel.
4. Click **Submit for approval**. The status becomes **Waiting approval**, and the PO appears in the Owner's PO approvals inbox.

### How to approve or reject a PO
Roles: Owner or Admin. They may also approve a revision they made themselves; the history then says "approved by the same person".

1. Open **PO approvals**, or open the PO itself.
2. Click the PO number and read the saved document and the revision history.
3. To approve, optionally type an **Approval note** and click **Approve**. The PO becomes **Approved**; the desk sends it next, and GRN can now receive against it.
4. To reject, pick the **Reason to send back** from **Purchase approval rejected** (PJ-RATE-HIGH Rate too high, PJ-NOT-NEEDED Not needed now, PJ-STOCK-OK Enough stock in hand, PJ-WRONG-VENDOR Wrong supplier, PJ-WRONG-ITEM Wrong item or quantity, PJ-BUDGET Over budget, PJ-OTHER), add a note if useful, and click **Reject**. The PO becomes **Rejected** and appears under **Sent back by Owner**. On the RM inward calendar its arrivals show **PO rejected** and no longer count as cover.

### How to send a PO to the vendor
Roles: Store, Planner, Plant Manager, Owner.

1. Open the approved PO (or an unchanged Owner-scheduled draft) and click **Send to vendor**.
2. Pick **WhatsApp**, **Email**, **Download PDF** or **Print**. The send is recorded with your name and time. WhatsApp shares the PDF on a phone, or downloads it and opens WhatsApp on a computer; Email opens a ready message and downloads the PDF to attach.
3. The sheet shows the **Message the vendor gets**, for example "Purchase order RP-PM/54 (revision 1) from Amigo Industries Unit-2 to Bharat Paper Mills. … Please confirm the dates. The PO PDF is attached."
4. Already sent it by phone or by hand? Open **Already sent it outside TubeOS? Record it** and click the channel used. Nothing is downloaded; only the send is noted.
5. To send again after a revision, use **Send again**.

### How to record the vendor's confirmed dates
1. On the PO, under **Delivery dates**, change the date if the vendor gave a different one (today or later) and click **Confirm**, or click **Vendor confirmed all**.
2. The row turns **Confirmed** and shows "was 6 Jan" if the date moved. You can also do this from Expected arrivals.

### How to change an approved PO (revision)
Roles: Store, Planner, Plant Manager, Owner, Admin.

1. Click **Edit / vendor change**.
2. Type the **Change reason** (required, at least 3 characters).
3. Change vendor, quantity, rate or terms. You cannot remove a line that has goods received, lower a quantity below what was received, or change the material of a received line.
4. Click **Save revision for reapproval**. A new revision number is made with status **Draft**; submit it for approval again. If it had been sent, the PO must be sent again.

A draft that was never approved or sent is just edited: the button says **Save draft** and no reason is needed.

### How to short-close or cancel a PO
Roles: Plant Manager, Owner (Admin also passes).

1. **Short-close**: on an approved or partly received PO, pick the **Close reason** from **PO cancel / short close** (PC-SUPPLIER-CANNOT Supplier cannot supply, PC-NOT-NEEDED Balance not needed, PC-RATE Rate changed or not agreed, PC-DELAY Supplier delayed too long, PC-QUALITY Quality problems with the supplier, PC-DUPLICATE Duplicate PO, PC-ENTRY-ERROR PO made by mistake, PC-OTHER) and click **Short-close remaining quantities**. The open balance is closed and its delivery rows are cancelled.
2. **Cancel**: on a Draft, Waiting approval, Rejected or Approved PO with nothing received, pick the reason from the same list and click **Cancel unreceived PO**. History is kept.

### How to raise and approve a requisition
1. Anyone: open **Purchase requisitions**, fill **Material or tool**, **Quantity** and **Why is this needed?**, then click **Submit requisition**. A PR number like PR-261031-001 is given and the Owner is notified.
2. Owner: open the requisition (or PO approvals). To approve, add an optional note and click **Approve request**; to reject, pick a **Reason to reject** (list **Purchase approval rejected**) and click **Reject**.
3. Store or Plant Manager: click **Create linked PO**. The PO form opens with the OT series and the requested material and quantity. Add the vendor and rate, save and submit.

### How to print or download a PO
- **Print PO** prints the page. **Saved PDF** opens the PDF of the current revision. **Export full register** (list page) and **Print and exports** go to the purchase registers.

## Rules the system enforces
- **BLOCKS:** only Store, Plant Manager, Owner and Admin can create a PO. Only the Owner or an Admin can approve or reject one ("Only the Owner or an Admin may decide purchase order approval").
- **BLOCKS:** a rejection needs a **Purchase approval rejected** code; short-close and cancel need a **PO cancel / short close** code. Codes with OTHER need a note of at least 5 characters, and free text alone is refused. The **Change reason** of a PO revision is still typed in words (at least 3 characters).
- **BLOCKS:** a scheduled draft with a missing rate cannot be approved: "Fill the rate for … first (Edit / vendor change)."
- **BLOCKS:** paper lines must be in kg ("Paper PO line 1 must use KG"). Each line's unit must match the material master.
- **BLOCKS:** a PO of the OT series, or with a Tool or Other item, needs an Owner-approved requisition ("Tools and other purchases require an Owner-approved requisition before PO creation"). The PO must match the requisition's material, unit and quantity. A requisition becomes a PO only once.
- **BLOCKS:** the series cannot change after the number is given. The vendor cannot change after any inward; short-close the balance and make a new PO.
- **BLOCKS:** a closed PO (Received, Cancelled, Short-closed) cannot be revised. A PO with goods received cannot be cancelled; use short-close.
- **BLOCKS:** if someone else changed the PO while you had it open, you see "Purchase order changed; reload before …". Reload and try again.
- **AUTOMATIC:** the PO number (RP-PM/NN or OT/NN), incoming QC on every line, one dated delivery row per line (the line's own date, else the expected date), and a snapshot of vendor details and terms on every revision.
- **AUTOMATIC:** sending an unchanged Owner-scheduled draft approves it on the Owner's schedule approval. Any change to quantity, date, vendor or rate means the Owner must approve again; a change the Owner makes himself counts as his approval.
- **AUTOMATIC:** a revision of a sent PO clears the "sent" state; the PO shows "Send again".
- **WARNS:** a revision saved without a GSTIN shows an amber note when the vendor master now has one, asking for a new revision so it prints.

## Sample
Store makes a PO for Bharat Paper Mills on 31 Oct 2026.

| Line | Material | Ordered | Rate | Amount |
|---|---|---|---|---|
| 1 | Kraft 230 GSM | 2,000 kg | ₹44.50 / kg | ₹89,000 |
| 2 | Kraft 300 GSM | 1,500 kg | ₹46 / kg | ₹69,000 |

**Save PO draft** gives **RP-PM/54**, Draft, total "2 lines · 3,500 kg · ₹1,58,000". Store clicks **Submit for approval**. The Owner approves it with the note "Rates as agreed on call". Store clicks **Send to vendor** › **WhatsApp**; the chip reads "Sent on WhatsApp · 31 Oct". Bharat Paper Mills confirms 6 Nov for line 1 and 10 Nov for line 2; Store records both. On 6 Nov the truck brings 2,012 kg of Kraft 230 GSM, which Store receives with **Make GRN** (see the Goods inward chapter).

## Common questions
**Q: Why can't I see the New purchase order button?** A: Only Store, Plant Manager, Owner and Admin make POs. A Planner proposes arrivals on the RM inward calendar; when the Owner approves them, the draft PO is made automatically.

**Q: Where do I type the PO number?** A: You don't. The system gives the next RP-PM or OT number when you save the draft, and it never changes, even after revisions.

**Q: Where is the "Incoming QC required" tick?** A: It was removed. Every PO line now needs incoming QC, and QC checks each delivery against the material standard.

**Q: A scheduled draft says "Rate needed". What do I do?** A: Click **Fill the rate**, enter the vendor's rate and save. If the Owner did not make this change himself, the PO then goes to him for approval before it can be sent.

**Q: The Owner rejected my PO. Can I fix it?** A: Yes. Open it from **Sent back by Owner**, read the reason in the history, click **Edit / vendor change**, fix it and submit again. Or cancel it.

**Q: Can an Admin approve a PO they made?** A: Yes. The Owner and an Admin may approve their own PO; the history records "approved by the same person". RM arrivals and requisitions are approved by the Owner only.

**Q: Can I receive goods on a PO that is still waiting approval?** A: No. Goods inward lists only approved POs with an open balance. Ask the Owner or an Admin to approve it.

**Q: The vendor will not send the last 120 kg. How do I close the PO?** A: The Plant Manager or Owner picks a close reason (for example PC-SUPPLIER-CANNOT) and clicks **Short-close remaining quantities**.

**Q: I changed a sent PO. Does the vendor get it automatically?** A: No. The PO shows "Revision 2 approved; send it again". Use **Send again**.

## Related chapters
- RM inward calendar and expected arrivals
- Goods inward, GRN register and labels
- Invoice differences, debit notes and purchase reports
- Vendors and other masters
- Dashboard and inbox
