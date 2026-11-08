HARI OM TUBEOS HELP GUIDE - Chapter 23: Goods inward, GRN register and labels
Section: Purchasing, stores and inward. Accurate as of 8 November 2026. Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).
Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter 23.

# Goods inward, GRN register and labels

> **What it is:** the store's receiving desk. **Goods inward** records what came on the truck, against an approved PO or as a manual GRN, with every reel and coil weighed and given its own QR label. The **GRN register** keeps every saved receipt: attach late invoices, approve manual receipts, open incoming QC and reprint labels.
> **Who uses it:** GRN, Store and Plant Manager receive goods and print labels (Owner and Admin too). Inward QC and QC open receipts to inspect. The plant head or Accounts approves manual receipts.
> **Where:** Sidebar > Stores & inventory > Goods inward (/purchase/inward) and GRN register & labels (/purchase/receipts; one receipt at /purchase/receipts/<id>)

## At a glance
- **Weigh every reel and coil.** Paper is received reel by reel: vendor reel number, **net kg**, width and form (reel or coil). Stock, the PO balance and the invoice all go by net kg. There is no gross or tare at inward.
- **Each reel gets the plant's own serial and label.** New reels are numbered in the **AIT series**, for example **AIT 06243**: "AIT", a space and 5 digits, one running series per plant and financial year, starting again at AIT 00001 on 1 April. Coils slit from a reel carry the reel's serial plus -1, -2 (AIT 06243-1). Older AT-… numbers stay valid and can still be scanned and searched.
- **The reel label matches the plant's own printed label**, with a QR added: plant heading, MILL NAME, invoice number, date, PLYBOND, VARIETY, GSM, ROLL NO., the AIT serial in very large letters, and WEIGHT.
- **The inward number is automatic** and restarts every financial year on 1 April: **P/26/021** for paper, **A/26/005** for adhesive, **IN/26/030** for everything else or a mix (26 = 2026-27).
- **Everything received waits for incoming QC.** New lots show **Waiting for QC** and cannot be issued until QC passes them. An invoice that is pending or a rate that differs never holds them.
- **At the gate first.** The watchman photographs the bill or challan when the truck arrives. It shows on Goods inward under **At the gate**. Pick it to make its GRN with the photo docked beside the form; posting links the photos to the GRN and every reel. A GRN without a gate photo is still allowed; the register shows **No gate photo**.
- **Everything received is weighed again at incoming QC.** QC types the actual weight of each reel; stock stays on the net kg you entered here (the bill weight).
- **Validate, then post once.** **Validate receipt** checks everything first; **Post goods inward** saves it once, even if you click twice or the line drops.

## The flow

Flow diagram: Truck to store
Steps: 1. Truck arrives (done by GRN/Store) -> 2. Make GRN or Goods inward - PO filled in -> 3. Enter challan, invoice, reels (done by GRN/Store) -> 4. Validate receipt -> 5. Post goods inward - P/26/021, AIT serials -> 6. Print reel labels (done by GRN/Store) -> 7. Incoming QC (done by QC) -> 8. Usable for issue
If it goes wrong after 'Enter challan, invoice, reels': 1. Invoice pending - challan only -> 2. Attach invoice later (done by Store) - GRN register
If it goes wrong after 'Post goods inward': 1. Rate differs from PO -> 2. Rate case (done by Plant Manager/Accounts) - does not hold the reels



Flow diagram: Bill photographed at the gate
Steps: 1. Watchman photographs the bill (done by Watchman) - GE-2611-020 -> 2. At the gate on Goods inward (done by Store/GRN) -> 3. Pick it - photo docked, vendor filled -> 4. Enter challan, invoice, reels -> 5. Post goods inward -> 6. Photos linked to the GRN and every reel - Linked to GRN
If it goes wrong after 'At the gate on Goods inward': 1. GRN already posted without it -> 2. Link gate entry on the GRN (done by Store/GRN)



Flow diagram: Manual GRN (no PO)
Steps: 1. Manual GRN with reason code (done by GRN/Store) -> 2. Validate and post -> 3. Attach invoice -> 4. Approve manual purchase (done by Plant Manager/Accounts) -> 5. Incoming QC (done by QC)


Approved POs come from the Purchase orders chapter. After posting, inspection happens in the Incoming QC chapter; issue to the floor is in the Issue to floor chapter.

## Screen tour

[Screenshot "goods-inward": Receive materials form with vendor and receipt source, supplier challan and invoice, and Material 1 panel]
*Figure: The Receive materials page. Vendor & receipt source has Receipt source "Against approved system PO", Vendor, Approved purchase order and "Inward date · automatic 31 Oct 2026", with a note on net weight and inward numbers. Supplier challan & invoice has Supplier challan number (required), Invoice number, Invoice date and a "Challan received · invoice pending" tick. Material 1 has PO material / variety, Put in location "RM store (default)", Approved PO rate · locked, Invoice rate / kg and Invoice quantity. A bottom bar shows "1 material · 0 kg received" with Validate receipt and Post goods inward.*

What you see:

1. **GRN register** button (top right).
2. **Vendor & receipt source**: **Receipt source** ("Against approved system PO" or "Manual GRN · without PO"), **Vendor**, **Approved purchase order** (each shows its PO number and revision) or, for manual, **Reason for no PO** (a code from the list **Receipt without PO**: MR-URGENT Urgent buy, PO to follow, MR-SAMPLE Free sample from the supplier, MR-RETURNABLE Returnable / job-work material, MR-CASH Cash purchase, MR-CUST-SUPPLIED Customer-supplied material, MR-OTHER), and **Inward date · automatic** (today, cannot be changed). After you pick a vendor, a grey line shows its **GSTIN** (or "not in vendor master"), city and state, and contact, and **Mill name on reel labels** (the vendor's mill / short name, or "not set, labels print the vendor name (Masters › Vendors)").
3. **Net weight only** note and the **Inward number** rule (P/26/001 paper, A/26/001 adhesive, IN/26/001 everything else; restarts on 1 April).
4. **Supplier challan & invoice**: **Supplier challan number** (required), **Invoice number**, **Invoice date** and **Challan received · invoice pending**. When ticked, the invoice fields are disabled and a note says the invoice is added later in the GRN register.
5. **Material 1** panel: **PO material / variety** (only lines of the chosen PO; each PO line once), **Put in location** (required; defaults to the RM store), **Approved PO rate · locked**, **Invoice rate / kg** (called **Challan / invoice rate** when the invoice is pending; it starts at the PO rate and can be edited) and **Invoice quantity** (defaults to the weighed quantity). **Remove material** drops the panel.
6. **PO balance strip** (after you pick a PO line): "PO ordered … · received …", "Open before this receipt", "This receipt … · balance after …" (red with "reason needed below" when you receive more than open) and, for reels, "Reels / coils 12 of about 14 expected".
7. **Rate warning** (amber, when the rate you typed differs from the PO): for example "Invoice rate is ₹0.75 per kg more than the PO (₹1,509.00 more for this receipt). A review case opens automatically; the approved PO stays unchanged."
8. **Reel / coil grid** (paper and parchment): 10 empty rows with columns **#**, **Vendor reel / coil no.**, **Net kg**, **Width**, **Unit** (mm or cm), **Form** (Reel or Coil) and a bin icon. Above it: "12 reels / coils entered · 8,418 kg net", **Add reel / coil** and **Add 10 more**. **Paste measured lot rows from Excel** takes rows of vendor reel number, net kg, width mm, REEL/COIL. Empty rows are left out.
9. For bulk materials (adhesive, boxes, plastic): **Received quantity** (filled with the PO's open quantity; change it to what came) and **Batch number · optional**.
10. **Add another material**, the **More than the PO** panel (when needed), the **Validation result**, and the sticky bottom bar with the totals, value, "Each physical unit gets one QR label", **Validate receipt** and **Post goods inward**.

[Screenshot "goods-inward-at-the-gate": Goods inward with the At the gate strip of photographed bills and the gate photo docked beside the GRN form]
*Figure: Goods inward with a gate bill picked. A blue note: "Making the GRN for gate entry GE-2611-001 (Sample Paper Mills). Posting links its photos to this GRN and every reel. Pick the vendor: the name from the gate is not in the vendor master." **At the gate (7)**: cards with a photo thumbnail, vendor, GE- number and vehicle, time and "over 24 h · 1 photo" in amber. On the right, **Gate photo · GE-2611-001** (Main gate, time, vehicle, vendor) with page, zoom, fit, rotate, open and download buttons and the bill page.*

What you see (At the gate):

1. **At the gate (N)**: material bills the watchman photographed that have no GRN yet, oldest first. Each card: photo thumbnail (or "photo uploading"), vendor ("Vendor not given"), GE- number, vehicle, time, number of photos. A card older than 24 hours is amber with "over 24 h".
2. **Pick a card** to make its GRN: the card is outlined, the note says which entry you are working on, and the vendor is filled when its name matches the vendor master. Click it again (x) to unpick.
3. **Gate photo** panel beside the form: one tab per bill (Bill 1, Bill 2 · 2 pages), with the viewer, so you can read the challan number, invoice number and reel list while you type. "The photos are still uploading from the gate phone" when they have not arrived yet.

[Screenshot "grn-register-gate-chips": GRN register rows with gate chips GE-2611-016 and No gate photo]
*Figure: The GRN register with gate chips under the inward number: P/26/027 with **GE-2611-016**, P/26/026 with GE-2611-014, and P/26/024 and P/26/023 with **No gate photo**.*

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
5. **Gate entry** panel: the gate chip (**GE-…**, or **No gate photo**) and **Link gate entry** (Store, GRN, Plant Manager, Owner, Admin). Below it the **Documents** panel: the vendor's bill and challan photos linked to this GRN, with a type picker, **Take photo** and **Photo or PDF**. See the Doc Vault chapter.
6. **Commercial review reason**, **Approve manual purchase and invoice rates** (manual receipts under review), **Review invoice differences** and **Approval history**.
7. **Attach supplier invoice** (while pending): **Invoice number**, **Invoice date**, and for each line its invoice quantity and invoice rate (filled from the challan rate), then **Attach and validate invoice**.
8. **Label printing** (further down): **Label sheet** (A4 · 8 labels per sheet, or Thermal · 4 × 2 inch), **Copies** (1 to 20), **Reprint reason** ("if printed before"), **Prepare N labels**, then **Open A4 sheet PDF · print at actual size**. The label previews show under it.

[Screenshot "reel-label": Reel label in the plant layout with the AIT serial in large letters and a QR]
*Figure: A printed reel label. One bordered label: the heading AMIGO INDUSTRIES UNIT II across the top; a row with MILL NAME (AKSHAT), the invoice number and the date 28-Oct-26; a row of headers PLYBOND, VARIETY, GSM with 400, 351, 351 under them; ROLL NO. 65686; the serial AIT 06243 in very large bold letters; WEIGHT 1161; and the QR code at the side.*

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
9. If the total is more than the PO has open, pick the **Reason for receiving more than the PO** from the list **Receiving more than the PO** (OR-ROLL-WEIGHT Full reel weighs more, OR-MIN-LOT Supplier minimum lot, OR-NEEDED Extra needed for production, OR-TOLERANCE Within agreed tolerance, OR-OTHER) and add a note if useful.
10. Click **Validate receipt** and read the **Validation result** (each line with its quantity and reels, and words such as "rates match the PO", "invoice to follow" or "differs from the PO · goes to Accounts"). Warnings such as a reused challan number appear in amber; you can still post if it is a different delivery.
11. Click **Post goods inward**. The message gives the inward number: "Inward P/26/021 saved (challan BPM/2231). 12 lots recorded. Incoming QC decides when the lots can be issued." Each reel gets the next AIT serial of the year (for example AIT 06281, AIT 06282…).
12. Print the labels (next task), then click **Start next receipt**.

### How to make the GRN of a bill photographed at the gate
Roles: GRN, Store, Plant Manager, Owner, Admin.

1. You get "Material at the gate · GE-2611-020" in the Inbox with **Make GRN**, or open **Goods inward** and look at **At the gate**.
2. Click the card (or **Make GRN** on the notification). The gate photo opens beside the form and the vendor is filled if its name is in the vendor master; otherwise pick the vendor.
3. Fill the GRN as usual from the photo: PO, supplier challan number, invoice number and date (or invoice pending), and the reels.
4. Validate and post. The gate entry becomes **Linked to GRN** and its photos are linked to the GRN and to every reel and lot (QC sees them on the bill sheet).
5. A material bill not made into a GRN in 24 hours sends a reminder to Store, GRN and the plant head.

### How to link a gate photo to a GRN posted without it
1. Open the GRN from the register. The **Gate entry** panel says "This GRN was posted without a gate photo."
2. Click **Link gate entry** and pick the bill from the list of bills at the gate. The chip shows the GE- number.
3. If the watchman put the bill under the wrong kind (for example Electricity), ask for **Wrong type? Move it** in the Bills inbox first; only material bills can be linked.

### How to make a manual GRN (no PO)
Roles: GRN, Store, Plant Manager.

1. Set **Receipt source** to **Manual GRN · without PO** and pick the **Vendor**.
2. Pick the **Reason for no PO** (for example MR-URGENT Urgent buy, PO to follow) and add a note such as "approved urgent local purchase".
3. Fill the challan and invoice, pick each **Material / variety** from the master and enter the reels or quantity and the invoice rate.
4. Validate and post. The receipt shows **Manual review**.
5. The plant head or Accounts (not the person who made it) opens it in the GRN register, attaches the invoice if pending, types a **Commercial review reason** and clicks **Approve manual purchase and invoice rates**.

### How to print or reprint QR labels
Roles: GRN, Store, Plant Manager, Owner, Admin.

1. Right after posting, use the label controls on the **Receipt saved** panel; later, open the receipt from the GRN register.
2. Pick the **Label sheet** (A4 with 8 labels, or a 4 × 2 inch thermal label) and **Copies**.
3. If these labels were printed before, type a **Reprint reason** (for example "Damaged label").
4. Click **Prepare N labels**, then **Open … PDF** and print at actual size. Stick one label on each reel, coil or lot.

Each reel or coil label is one bordered label in the plant's own layout (from the plant's "REEL PRINT." sheet), in big clear black letters, with a QR added. Nothing else is printed: no PO, GRN, vendor or QC words. A lot that is not a reel (adhesive, parchment, packing) keeps the plain lot label with its code and QR. The QR opens the lot in the phone camera; scanning it later tells the issue desk whether QC has passed it.

| Row | What it shows | Example |
|---|---|---|
| 1 | Label heading of the plant (System › Plants) | AMIGO INDUSTRIES UNIT II |
| 2 | MILL NAME · supplier invoice no. · received date (dd-Mon-yy) | AKSHAT · VPI/1686/2026-27 · 28-Oct-26 |
| 3 | Headers PLYBOND · VARIETY · GSM | |
| 4 | Polybond · variety (paper code) · GSM | 400 · 351 · 351 |
| 5 | ROLL NO. · the mill's roll / reel number | 65686 |
| 6 | The AIT serial, very large and bold | AIT 06243 |
| 7 | WEIGHT · net kg | 1161 |

Where the values come from: **MILL NAME** is the vendor's mill / short name (else the vendor name). **Inv No.** is the invoice number typed at inward, else the invoice attached later, else the challan number while the invoice is pending. **PLYBOND** is the incoming QC reading when measured, else the PO line or paper master. **GSM** is the GSM measured at incoming QC when there is one; otherwise it prints the variety number, as the plant does. A value nobody gave stays blank, never 0. A coil label has the same layout with the coil's own serial (AIT 06243-1) and weight.

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
- **BLOCKS:** each filled reel row needs its own vendor reel number, net kg and width. A vendor reel number used twice in a receipt, or already received before, is refused ("Vendor reel BPM-7781 is already inwarded as AIT 06212").
- **BLOCKS:** receiving more than the PO line has open needs a **Receiving more than the PO** code ("Line 1 (KRAFT230): 2100 kg is more than the 2000 kg still open on the PO. Enter a reason to receive more than the PO."). Codes with OTHER need a note of at least 5 characters; free text alone is refused.
- **BLOCKS:** goods must go to an active store location of this plant, not a floor or closed location. Parchment is received as coils. Paper lines are in kg.
- **BLOCKS:** **Post goods inward** works only after **Validate receipt**, and only if nothing changed since ("Receipt details changed. Validate them again before posting."). Posting is saved once even if repeated.
- **BLOCKS:** a manual GRN needs a **Receipt without PO** code, cannot be used for tools or other items (they need a requisition and PO), and is approved by someone other than its maker, after the invoice is attached.
- **BLOCKS:** reprinting labels already printed needs a reprint reason ("A reprint reason is required for previously printed lots"). Copies are 1 to 20.
- **BLOCKS:** a gate entry can be linked to one GRN only, and only if it is a material bill ("… is already linked to GRN …", "… is not a material bill. Re-categorise it as Material first, or post the GRN without it.").
- **NEVER BLOCKS:** a GRN without a gate photo is allowed; the register shows **No gate photo**.
- **WARNS:** a challan number this vendor already used on another inward: "Challan … was already used by this supplier on P/26/018 (30 Oct 2026). Check this is not the same delivery entered twice." It does not block.
- **AUTOMATIC:** inward number per plant and financial year (P, A or IN series; Jan–Mar 2027 stay under 26, and 1 April 2027 starts P/27/001); AIT serial per reel (one series per plant and financial year, restarting at AIT 00001 on 1 April; the Owner or Admin sets the next number once in System › Plants; numbers are never given twice in a year); coils slit later get the parent serial plus -1, -2; QC hold and an incoming QC task for every lot; PO balance and dated delivery rows updated (oldest date first); rate, quantity and specification cases opened; the plant head and Accounts notified of rate cases.

## Sample
Bharat Paper Mills delivers on 6 Nov 2026 against **RP-PM/54**, challan BPM/2231, invoice BPM/INV/884 dated 6 Nov.

| Vendor reel no. | Net kg | Width | Form |
|---|---|---|---|
| BPM-7781 | 702 | 1,000 mm | Reel |
| BPM-7782 | 655.5 | 1,000 mm | Reel |
| BPM-7783 | 654.5 | 1,000 mm | Reel |

Total 2,012 kg of Kraft 230 GSM; PO open 2,000 kg, so the strip shows "more than the PO by 12 kg — reason needed below". Invoice rate ₹45.25 / kg against PO ₹44.50 / kg: an amber note shows ₹1,509.00 more. Store picks OR-ROLL-WEIGHT with the note "Last reels of the order, supplier confirmed extra kg". Store validates and posts: **P/26/021**, 3 lots, **AIT 06281**, **AIT 06282** and **AIT 06283**, all **Waiting for QC**. A rate case opens for the plant head. Store prints three A4 labels: each reads AMIGO INDUSTRIES UNIT II, MILL NAME BHARAT (the vendor's short name), the invoice number, 06-Nov-26, PLYBOND 400, VARIETY 230, GSM 230 (no QC reading yet), the mill's roll number, the AIT serial in big letters and the weight. QC passes the reels the same afternoon and they appear under **Ready for the floor** on the reel issue desk.

## Common questions
**Q: The vendor sent only the challan. Can I still receive?** A: Yes. Tick **Challan received · invoice pending**, type the challan rate if you have it, and attach the invoice later in the GRN register. The reels are not held for the invoice.

**Q: Why doesn't my PO appear in Approved purchase order?** A: Only approved POs of that vendor with an open quantity are listed. It may still be waiting approval, fully received or closed.

**Q: Do I enter gross weight and tare?** A: No. Enter only the net kg of each reel or coil (paper alone).

**Q: I typed the wrong weight and already posted. How do I fix it?** A: A posted GRN cannot be edited. Raise a stock correction with the reason "Wrong GRN weight"; the Owner approves it (see the stock counts chapter).

**Q: Why does the inward number start with IN and not P?** A: P is used only when every line is paper, A only when every line is adhesive. Anything else, or a mix, uses IN.

**Q: It is January 2027. Why is the number still P/26/…?** A: The number follows the financial year, April to March. 26 means 2026-27; it changes to P/27/001 on 1 April 2027.

**Q: The label got wet. How do I print a new one?** A: Open the receipt in the GRN register, type a **Reprint reason** and click **Prepare 1 label**. The reprint keeps the same AIT serial.

**Q: Why does the new reel say AIT 06281 and not AT-…?** A: New reels follow the plant's own AIT series. Old reels keep their AT numbers; both can be scanned and searched.

**Q: The label shows the vendor name, not the mill name.** A: The vendor has no **Mill / short name**. Ask the Owner or Admin to fill it in Masters › Vendors; the next print uses it.

**Q: Why does the GSM on the label equal the variety?** A: No GSM was measured at incoming QC yet, so the label prints the variety number, as the plant always has. Once QC measures it, a reprint shows the measured GSM.

**Q: Can I find a reel by typing its serial?** A: Yes. Type it any way (ait 6243, AIT-06243, AIT 6243-2); the search reads it as AIT 06243 or AIT 06243-2.

**Q: The bill was photographed at the gate. Do I still type the challan and invoice?** A: Yes. Pick the bill under **At the gate** and read the numbers from the photo beside the form. The photo is linked when you post.

**Q: The At the gate card says "Vendor not given".** A: The watchman did not pick a vendor. Pick the vendor on the form yourself.

**Q: Why does my GRN say No gate photo?** A: It was posted without a gate entry. If the watchman photographed the bill, click **Link gate entry** on the GRN.

**Q: Can the reels go to the floor before QC?** A: No. They show **Waiting for QC** until incoming QC passes them. Rate and invoice questions never hold them, but QC does.

## Related chapters
- Purchase orders, PO approvals and requisitions
- RM inward calendar and expected arrivals
- Invoice differences, debit notes and purchase reports
- Incoming QC
- Gate desk and visitors
- Doc Vault
- Issue to the floor (reels, coils and materials)
- Stock counts, stock book, locations and opening stock
