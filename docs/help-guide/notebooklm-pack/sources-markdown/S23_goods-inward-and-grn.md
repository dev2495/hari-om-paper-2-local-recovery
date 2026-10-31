HARI OM TUBEOS HELP GUIDE - Chapter 23: Goods inward, GRN register and labels
Section: Purchasing, stores and inward. Accurate as of 31 October 2026. Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).
Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter 23.

# Goods inward, GRN register and labels

> **What it is:** the store's receiving desk. **Goods inward** records what came on the truck, against an approved PO or as a manual GRN, with every reel and coil weighed and given its own QR label. The **GRN register** keeps every saved receipt: attach late invoices, approve manual receipts, open incoming QC and reprint labels.
> **Who uses it:** GRN, Store and Plant Manager receive goods and print labels (Owner and Admin too). Inward QC and QC open receipts to inspect. The plant head or Accounts approves manual receipts.
> **Where:** Sidebar > Stores & inventory > Goods inward (/purchase/inward) and GRN register & labels (/purchase/receipts; one receipt at /purchase/receipts/<id>)

## At a glance
- **Weigh every reel and coil.** Paper is received reel by reel: vendor reel number, **net kg**, width and form (reel or coil). Stock, the PO balance and the invoice all go by net kg. There is no gross or tare at inward.
- **Each physical unit gets its own AT number and QR label**, for example **AT-261106-004**, dated by the receipt date.
- **The inward number is automatic** and restarts every financial year on 1 April: **P/26/021** for paper, **A/26/005** for adhesive, **IN/26/030** for everything else or a mix (26 = 2026-27).
- **Everything received waits for incoming QC.** New lots show **Waiting for QC** and cannot be issued until QC passes them. An invoice that is pending or a rate that differs never holds them.
- **Validate, then post once.** **Validate receipt** checks everything first; **Post goods inward** saves it once, even if you click twice or the line drops.

## The flow

Flow diagram: Truck to store
Steps: 1. Truck arrives (done by GRN/Store) -> 2. Make GRN or Goods inward - PO filled in -> 3. Enter challan, invoice, reels (done by GRN/Store) -> 4. Validate receipt -> 5. Post goods inward - P/26/021, AT labels -> 6. Print QR labels (done by GRN/Store) -> 7. Incoming QC (done by QC) -> 8. Usable for issue
If it goes wrong after 'Enter challan, invoice, reels': 1. Invoice pending - challan only -> 2. Attach invoice later (done by Store) - GRN register
If it goes wrong after 'Post goods inward': 1. Rate differs from PO -> 2. Rate case (done by Plant Manager/Accounts) - does not hold the reels



Flow diagram: Manual GRN (no PO)
Steps: 1. Manual GRN with reason (done by GRN/Store) -> 2. Validate and post -> 3. Attach invoice -> 4. Approve manual purchase (done by Plant Manager/Accounts) -> 5. Incoming QC (done by QC)


Approved POs come from the Purchase orders chapter. After posting, inspection happens in the Incoming QC chapter; issue to the floor is in the Issue to floor chapter.

## Screen tour

[Screenshot "goods-inward": Receive materials form with vendor and receipt source, supplier challan and invoice, and Material 1 panel]
*Figure: The Receive materials page. Vendor & receipt source has Receipt source "Against approved system PO", Vendor, Approved purchase order and "Inward date · automatic 31 Oct 2026", with a note on net weight and inward numbers. Supplier challan & invoice has Supplier challan number (required), Invoice number, Invoice date and a "Challan received · invoice pending" tick. Material 1 has PO material / variety, Put in location "RM store (default)", Approved PO rate · locked, Invoice rate / kg and Invoice quantity. A bottom bar shows "1 material · 0 kg received" with Validate receipt and Post goods inward.*

What you see:

1. **GRN register** button (top right).
2. **Vendor & receipt source**: **Receipt source** ("Against approved system PO" or "Manual GRN · without PO"), **Vendor**, **Approved purchase order** (each shows its PO number and revision) or, for manual, **Reason for no PO**, and **Inward date · automatic** (today, cannot be changed). After you pick a vendor, a grey line shows its **GSTIN** (or "not in vendor master"), city and state, and contact.
3. **Net weight only** note and the **Inward number** rule (P/26/001 paper, A/26/001 adhesive, IN/26/001 everything else; restarts on 1 April).
4. **Supplier challan & invoice**: **Supplier challan number** (required), **Invoice number**, **Invoice date** and **Challan received · invoice pending**. When ticked, the invoice fields are disabled and a note says the invoice is added later in the GRN register.
5. **Material 1** panel: **PO material / variety** (only lines of the chosen PO; each PO line once), **Put in location** (required; defaults to the RM store), **Approved PO rate · locked**, **Invoice rate / kg** (called **Challan / invoice rate** when the invoice is pending; it starts at the PO rate and can be edited) and **Invoice quantity** (defaults to the weighed quantity). **Remove material** drops the panel.
6. **PO balance strip** (after you pick a PO line): "PO ordered … · received …", "Open before this receipt", "This receipt … · balance after …" (red with "reason needed below" when you receive more than open) and, for reels, "Reels / coils 12 of about 14 expected".
7. **Rate warning** (amber, when the rate you typed differs from the PO): for example "Invoice rate is ₹0.75 per kg more than the PO (₹1,509.00 more for this receipt). A review case opens automatically; the approved PO stays unchanged."
8. **Reel / coil grid** (paper and parchment): 10 empty rows with columns **#**, **Vendor reel / coil no.**, **Net kg**, **Width**, **Unit** (mm or cm), **Form** (Reel or Coil) and a bin icon. Above it: "12 reels / coils entered · 8,418 kg net", **Add reel / coil** and **Add 10 more**. **Paste measured lot rows from Excel** takes rows of vendor reel number, net kg, width mm, REEL/COIL. Empty rows are left out.
9. For bulk materials (adhesive, boxes, plastic): **Received quantity** (filled with the PO's open quantity; change it to what came) and **Batch number · optional**.
10. **Add another material**, the **More than the PO** panel (when needed), the **Validation result**, and the sticky bottom bar with the totals, value, "Each physical unit gets one QR label", **Validate receipt** and **Post goods inward**.

[Screenshot "grn-register": GRN register listing receipts with inward number, vendor, source, challan, invoice, lots and commercial state]
*Figure: The GRN register ("GRNs, invoices & lot labels"). A search box and an "All receipts" filter sit above the Receipt register: 60 matching receipts, with Full Excel, Print register, Previous and Next. Rows such as IN/26/029, 30 Oct 2026, GoLive Test Paper Vendor with GSTIN, source RP-PM/65, challan DC-GL-B1A6, invoice Pending, 3 lots, commercial "Invoice pending", with Open and Inspect buttons.*

What you see:

1. **New inward** (top right).
2. **Search** (inward number, vendor, PO, challan or invoice) and the filter: **All receipts**, **Against PO**, **Manual GRNs**, **Invoice pending**.
3. **Receipt register** with **Full Excel**, **Print register**, **Previous**, **Next** (100 per page).
4. Columns: **Inward no. / date**, **Vendor** (with GSTIN), **Source** (PO number or "Manual GRN"), **Challan**, **Invoice** ("Pending" until attached), **Lots**, **Commercial** (Invoice pending, Clear, Review required, Manual review, Released with claim) and buttons **Open** and **Inspect** (Inspect shows for QC roles while a lot waits for QC; Store and the plant head see **View QC**).

[Screenshot "grn-detail": One GRN page showing header facts, two material lines with QC passed and the attach invoice panel]
*Figure: GRN IN/26/029 against RP-PM/65. Header: Inward no. IN/26/029, Received 30 Oct 2026, Supplier challan no. DC-GL-B1A6, Invoice Pending, Vendor with "Vapi, Gujarat", Vendor GSTIN. Two lines: "SHARMA_300 · Kraft 300 GSM, 805.5 kg · PO rate ₹50 / kg · Challan rate ₹52 / kg · invoice to follow" with a link "Rate differs from the PO · review case open in Invoice differences", and an adhesive line, both "QC passed" with See QC result. Below: Commercial review reason and the Attach supplier invoice panel.*

What you see:

1. **All GRNs & invoices** (back to the list) and **New inward**.
2. **Header**: **Inward no.**, **Received**, **Supplier challan no.**, **Invoice** (number and date, or Pending), **Vendor** (with place) and **Vendor GSTIN** (from the PO, else the vendor master).
3. **Manual receipt reason** (manual GRNs only).
4. **Material lines**: code and name, quantity, PO rate, challan or invoice rate; a rate-case link when the rate differs; a QC badge (**Waiting for QC**, **QC passed**, **QC failed**, **Cleared**) and a button **Inspect in incoming QC**, **View in incoming QC** or **See QC result**.
5. **Commercial review reason**, **Approve manual purchase and invoice rates** (manual receipts under review), **Review invoice differences** and **Approval history**.
6. **Attach supplier invoice** (while pending): **Invoice number**, **Invoice date**, and for each line its invoice quantity and invoice rate (filled from the challan rate), then **Attach and validate invoice**.
7. **Label printing** (further down): **Label sheet** (A4 · 8 labels per sheet, or Thermal · 4 × 2 inch), **Copies** (1 to 20), **Reprint reason** ("if printed before"), **Prepare N labels**, then **Open A4 sheet PDF · print at actual size**. The label previews show under it.

## Step by step

### How to receive goods against an approved PO
Roles: GRN, Store, Plant Manager, Owner, Admin.

1. Open the arrival in **Expected arrivals** and click **Make GRN** (or **Receive goods (GRN)** on the PO, or **Receive** in the PO list). The form opens with vendor, PO and material line filled: "Receiving against RP-PM/54 · Bharat Paper Mills." The form stays locked for a moment while the PO lines load. You can also open **Goods inward** and pick **Vendor** and **Approved purchase order** yourself.
2. Type the **Supplier challan number** exactly as printed.
3. Type the **Invoice number** and **Invoice date**. If only the challan came, tick **Challan received · invoice pending**.
4. In **Material 1**, check the **PO material / variety** and **Put in location** (leave the RM store unless the goods go to another rack).
5. Check the **Invoice rate**. It starts at the PO rate; change it to the rate on the invoice or challan.
6. For paper: weigh each reel and type one row per reel: **Vendor reel / coil no.**, **Net kg**, **Width** and **Form**. Press Enter in the last field to add a row, or use **Add 10 more**. To paste from a weighing sheet, open **Paste measured lot rows from Excel**, paste and click **Append pasted lots**.
7. For bulk material: type the **Received quantity** in its unit.
8. Click **Add another material** for each further PO line on the same truck.
9. If the total is more than the PO has open, fill **Reason for receiving more than the PO**.
10. Click **Validate receipt** and read the **Validation result** (each line with its quantity and reels, and words such as "rates match the PO", "invoice to follow" or "differs from the PO · goes to Accounts"). Warnings such as a reused challan number appear in amber; you can still post if it is a different delivery.
11. Click **Post goods inward**. The message gives the inward number: "Inward P/26/021 saved (challan BPM/2231). 12 lots recorded. Incoming QC decides when the lots can be issued."
12. Print the labels (next task), then click **Start next receipt**.

### How to make a manual GRN (no PO)
Roles: GRN, Store, Plant Manager.

1. Set **Receipt source** to **Manual GRN · without PO** and pick the **Vendor**.
2. Write the **Reason for no PO** (for example "approved urgent local purchase").
3. Fill the challan and invoice, pick each **Material / variety** from the master and enter the reels or quantity and the invoice rate.
4. Validate and post. The receipt shows **Manual review**.
5. The plant head or Accounts (not the person who made it) opens it in the GRN register, attaches the invoice if pending, types a **Commercial review reason** and clicks **Approve manual purchase and invoice rates**.

### How to print or reprint QR labels
Roles: GRN, Store, Plant Manager, Owner, Admin.

1. Right after posting, use the label controls on the **Receipt saved** panel; later, open the receipt from the GRN register.
2. Pick the **Label sheet** (A4 with 8 labels, or a 4 × 2 inch thermal label) and **Copies**.
3. If these labels were printed before, type a **Reprint reason** (for example "Damaged label").
4. Click **Prepare N labels**, then **Open … PDF** and print at actual size. Stick one label on each reel, coil or lot.

Each reel label shows the AT number and QR code, the material, the PO and inward number, GSM, BF and Polybond (from the reel's incoming QC readings, otherwise the material master), width, weight, vendor and the received date. The QR opens the lot in the phone camera; scanning it later tells the issue desk whether QC has passed it.

### How to attach an invoice that came later
Roles: GRN, Store, Plant Manager.

1. In the GRN register, set the filter to **Invoice pending** and click **Open** on the receipt.
2. In **Attach supplier invoice**, type the **Invoice number** and **Invoice date**.
3. Check each line's invoice quantity and rate (filled from the challan rate) and correct them to the invoice.
4. Click **Attach and validate invoice**. Any rate or quantity difference opens a case in Invoice differences.

### How to open incoming QC from a receipt
Roles: QC and Inward QC enter readings; Store and the Plant Manager can view.

1. Click **Inspect in incoming QC** on the posted receipt, or **Inspect** in the register row.
2. The QC entry form opens on the first lot still waiting. Inspection is explained in the Incoming QC chapter.

### How to export or print the GRN register
- Click **Full Excel** or **Print register** above the receipt list. The same register is in Purchase reports.

## Rules the system enforces
- **BLOCKS:** a supplier challan number is required. Invoice number and date are required unless **invoice pending** is ticked, and an invoice number must not be typed while it is ticked.
- **BLOCKS:** an invoice rate is required for every material unless the invoice is pending (then it may be left empty or typed from the challan). An invoice number already used with a different date is refused.
- **BLOCKS:** only an approved PO with an open balance can be received ("Only an approved purchase order can receive material"). Each PO line may appear only once per receipt.
- **BLOCKS:** each filled reel row needs its own vendor reel number, net kg and width. A vendor reel number used twice in a receipt, or already received before, is refused ("Vendor reel BPM-7781 is already inwarded as AT-261029-003").
- **BLOCKS:** receiving more than the PO line has open needs a reason ("Line 1 (KRAFT230): 2100 kg is more than the 2000 kg still open on the PO. Enter a reason to receive more than the PO.").
- **BLOCKS:** goods must go to an active store location of this plant, not a floor or closed location. Parchment is received as coils. Paper lines are in kg.
- **BLOCKS:** **Post goods inward** works only after **Validate receipt**, and only if nothing changed since ("Receipt details changed. Validate them again before posting."). Posting is saved once even if repeated.
- **BLOCKS:** a manual GRN needs a reason, cannot be used for tools or other items (they need a requisition and PO), and is approved by someone other than its maker, after the invoice is attached.
- **BLOCKS:** reprinting labels already printed needs a reprint reason ("A reprint reason is required for previously printed lots"). Copies are 1 to 20.
- **WARNS:** a challan number this vendor already used on another inward: "Challan … was already used by this supplier on P/26/018 (30 Oct 2026). Check this is not the same delivery entered twice." It does not block.
- **AUTOMATIC:** inward number per plant and financial year (P, A or IN series; Jan–Mar 2027 stay under 26, and 1 April 2027 starts P/27/001); AT number per reel; QC hold and an incoming QC task for every lot; PO balance and dated delivery rows updated (oldest date first); rate, quantity and specification cases opened; the plant head and Accounts notified of rate cases.

## Sample
Bharat Paper Mills delivers on 6 Nov 2026 against **RP-PM/54**, challan BPM/2231, invoice BPM/INV/884 dated 6 Nov.

| Vendor reel no. | Net kg | Width | Form |
|---|---|---|---|
| BPM-7781 | 702 | 1,000 mm | Reel |
| BPM-7782 | 655.5 | 1,000 mm | Reel |
| BPM-7783 | 654.5 | 1,000 mm | Reel |

Total 2,012 kg of Kraft 230 GSM; PO open 2,000 kg, so the strip shows "more than the PO by 12 kg — reason needed below". Store types "Last reels of the order, supplier confirmed extra kg". Invoice rate ₹45.25 / kg against PO ₹44.50 / kg: an amber note shows ₹1,509.00 more. Store validates and posts: **P/26/021**, 3 lots, AT-261106-001 to AT-261106-003, all **Waiting for QC**. A rate case opens for the plant head. Store prints three A4 labels. QC passes the reels the same afternoon and they appear under **Ready for the floor** on the reel issue desk.

## Common questions
**Q: The vendor sent only the challan. Can I still receive?** A: Yes. Tick **Challan received · invoice pending**, type the challan rate if you have it, and attach the invoice later in the GRN register. The reels are not held for the invoice.

**Q: Why doesn't my PO appear in Approved purchase order?** A: Only approved POs of that vendor with an open quantity are listed. It may still be waiting approval, fully received or closed.

**Q: Do I enter gross weight and tare?** A: No. Enter only the net kg of each reel or coil (paper alone).

**Q: I typed the wrong weight and already posted. How do I fix it?** A: A posted GRN cannot be edited. Raise a stock correction with the reason "Wrong GRN weight"; the Owner approves it (see the stock counts chapter).

**Q: Why does the inward number start with IN and not P?** A: P is used only when every line is paper, A only when every line is adhesive. Anything else, or a mix, uses IN.

**Q: It is January 2027. Why is the number still P/26/…?** A: The number follows the financial year, April to March. 26 means 2026-27; it changes to P/27/001 on 1 April 2027.

**Q: The label got wet. How do I print a new one?** A: Open the receipt in the GRN register, type a **Reprint reason** and click **Prepare 1 label**.

**Q: Can the reels go to the floor before QC?** A: No. They show **Waiting for QC** until incoming QC passes them. Rate and invoice questions never hold them, but QC does.

## Related chapters
- Purchase orders, PO approvals and requisitions
- RM inward calendar and expected arrivals
- Invoice differences, debit notes and purchase reports
- Incoming QC
- Issue to the floor (reels, coils and materials)
- Stock counts, stock book, locations and opening stock
