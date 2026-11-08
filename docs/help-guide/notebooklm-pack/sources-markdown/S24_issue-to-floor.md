HARI OM TUBEOS HELP GUIDE - Chapter 24: Issue to the floor: reels, coils and materials
Section: Purchasing, stores and inward. Accurate as of 8 November 2026. Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).
Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter 24.

# Issue to the floor: reels, coils and materials

> **What it is:** the two store desks that send raw material to the production floor, the history of every issue, and the genealogy page that traces a reel from inward to dispatch. Reels and coils are issued by their label (the plant's AIT serial, or the AT number on older reels); adhesive, parchment and packing are issued by quantity.
> **Who uses it:** the RM issue desk (RMIssue role), Store and the Plant Manager issue (Owner and Admin too). The store writes the slitting card from the slitter's figures. Planner and GRN read the issue history. Many roles read genealogy.
> **Where:** Sidebar > Stores & inventory > Reel & coil issue (/inventory/reels/issue), Material issue (/inventory/production-issue), Issue history (/inventory/issue-history), Genealogy (/inventory/genealogy)

## At a glance
- **Issue to the floor, never to a machine or job card.** You pick only what goes out. The shift and date come from the clock when you press Issue: **Shift A** 08:00–20:00, **Shift B** 20:00–08:00 next morning, dated on the day the shift started.
- **Everything issued is used in full. Nothing comes back from the floor.** A reel or coil goes out whole (its full current weight). The job card records production and the stock count settles consumption.
- **Only stock that passed incoming QC can go.** Reels and lots waiting for QC, failed or rejected are listed separately with the reason. Invoice or rate questions never hold stock back.
- **A reel goes to the slitter and gets a slitting card; a coil goes straight to the winders.** The slitting card records coils made and wastage and feeds the slitting report.
- **Reel numbers.** New reels carry the plant's serial, for example **AIT 06281**; coils made from a reel carry the reel's serial plus -1, -2 (AIT 06281-1). Older reels keep AT-… numbers. The desk finds both: scan the QR, or type the serial in any form ("ait 6281", "AIT-06281-1").
- **Boxes for finished goods** are issued here by pieces like any packing. The month's packing theory comes from the boxes packed on job cards (1 box plus the spec's plastic and fadda per box), so the stock count compares what was issued with what the boxes used.
- **Parchment is issued by colour and kg**, oldest cleared coil first, on the material desk, not by coil number. Plastic is issued in kg, boxes in pieces.

## The flow

Flow diagram: Reel and coil issue
Steps: 1. Scan or pick reel (done by RM issue/Store) -> 2. Issue N to floor - shift from clock -> 3. Reel goes to slitter -> 4. Write slitting card (done by RM issue/Store) - coils made, wastage -> 5. Slitting report
If it goes wrong after 'Issue N to floor': 1. Coil goes to winders -> 2. Used by the job cards
If it goes wrong after 'Scan or pick reel': 1. Not cleared by QC -> 2. Inspect now (done by QC) -> 3. Ready for the floor



Flow diagram: Material issue
Steps: 1. Pick material or scan lot (done by RM issue/Store) -> 2. Choose lot - optional, oldest first -> 3. Enter quantity -> 4. Issue to floor - shift from clock -> 5. Issue history and stock book



Flow diagram: Wrong reel issued
Steps: 1. Wrong reel issued -> 2. Issue the right reel (done by RM issue/Store) -> 3. Stock count finds wrong reel (done by Any role) - Issued, but found in store -> 4. Owner decides (done by Owner) - leave as used, or add back on QC hold


Issue is the last store step before production. Goods arrive through Goods inward and are cleared by Incoming QC; what was issued is checked against the stock book in the stock counts chapter.

## Screen tour

[Screenshot "reel-issue": Reel and coil issue desk with four tiles, the ready list with scan box, and the not cleared list]
*Figure: Reel & coil issue to floor. Tabs: Reels & coils → floor, Adhesive / parchment / packing → floor, Issue history. Tiles: Ready for the floor 18 (7,741.634 kg), Not cleared yet 57, Slitting cards to write 24, Issued · 31 Oct 0. The Ready for the floor panel has a scan box with Add and Camera, a search box, All / Reels → slitter / Coils → winders filters and reel rows such as "AT-261028-029 · SHARMA_300 · Kraft 300 GSM, Pick from GoLive rack B1A6, 300 GSM, old mark …, 250 kg, Reel → slitter". The shift strip reads "Shift A · 31 Oct (now 11:50)". The Not cleared yet list on the right shows reels "Waiting for incoming QC" with Inspect now.*

What you see:

1. **Desk tabs**: **Reels & coils → floor**, **Adhesive / parchment / packing → floor**, **Issue history**. Under them: "Issued material is consumed in full on the floor; the job card records production and the stock count settles consumption."
2. **Tiles**: **Ready for the floor** (count and kg), **Not cleared yet** (QC decides), **Slitting cards to write** and **Issued · date** (today's count and kg).
3. **Ready for the floor** panel: a scan box "Scan QR or type AT / vendor reel no." with **Add** and **Camera**, a search box (paper, AT or AIT number, vendor reel), the filter **All**, **Reels → slitter**, **Coils → winders**, and the list. Each row shows a tick circle, the reel number (AIT serial on new reels, AT number on older ones), material, **Pick from** rack, GSM, width, vendor reel or old mark, weight and a chip saying where it goes.
4. **Shift strip**: "Shift A · 31 Oct (now 11:50) · Shift and date are taken from the clock when you press Issue."
5. **Issue button**: "Pick reels or coils to issue" until something is picked, then **Issue 3 to floor · 1,960 kg**.
6. **Not cleared yet** (right): reels in stock but not passed by incoming QC, each with its reason (**Waiting for incoming QC**, **Failed incoming QC**, **Rejected by QC**) and **Inspect now** (QC, Store, Plant Manager, Owner, Admin) or **Ask QC to inspect**.
7. Further down: **Slitting cards to write** (each issued reel with **Write card**), **Issued today** (columns **Reel / coil**, **Went to** (Slitter or Winders), **Shift · time**, **Weight**, **Slitting card**), **Stock on hand** by paper (**Paper**, **Ready**, **Ready kg**, **Not cleared kg**) and, only if any exist, **Older open issues** from before floor issue started.

[Screenshot "m-reel-issue": Phone view of the reel and coil issue desk]
*Figure: The same desk on a phone. The title and rules come first, the three desk tabs stack as large buttons, and the four tiles sit two by two (18 ready, 57 not cleared, 24 slitting cards, 0 issued today). Ready for the floor follows below. After a scan, the page scrolls to the Issue button so one tap issues it.*

[Screenshot "material-issue": Material issue desk with tiles, the material picker and the issue form]
*Figure: Material issue to floor. Tiles: Materials in stock 8 (of 9 adhesive, parchment and packing items), Issued · 31 Oct 0, Out of stock 1. Panel 1 · Pick the material has a lot scan box with Find lot and Camera, a search box, kind filters All 9 / Adhesive 3 / Parchment 2 / Packing 4 and material cards such as "E2E PVA adhesive, ADH46A4F, 788 kg" and "Parchment RED · SAGAR POLY…, 37.5 kg, by colour · kg". Panel 2 · Issue to the floor says "Pick a material on the left first."*

What you see:

1. **Tiles**: **Materials in stock**, **Issued · date**, **Out of stock** ("inward or pass incoming QC to issue").
2. **1 · Pick the material**: scan box "Scan lot QR or type the lot / Amigo inward no." with **Find lot** and **Camera**; search box; kind filter **All**, **Adhesive**, **Parchment**, **Packing**; material cards with the cleared quantity and unit ("by colour · kg" for parchment, "pieces" for boxes). Only stock that passed incoming QC is counted.
3. **2 · Issue to the floor** (after picking): the material and "Cleared for issue: 788 kg in 3 lots"; **Lot (Amigo inward no.)** choices, with **Oldest first (FIFO)** selected by default and each lot's rack and inward date; a **Pick from** line with the rack; **Quantity** with "… available" and quick-quantity buttons; the shift strip; **Note** (optional); and **Issue 25 kg to floor**. For parchment, instead of lots it shows "Coils this issue takes", oldest first.
4. **Issued to the floor today**: by material and shift; parchment shows the coil it came from. **Issue history** link.

[Screenshot "issue-history": Issue history with filters, two tiles and the issues table with CSV button]
*Figure: Issue history for 25–31 Oct 2026. Filters: From, To, Shift (Both shifts), Kind (Everything), Item, Card, Issued by (Anyone), Show and a reset button, plus Today / Last 7 days / This month. Tiles: Issues 79, Issued 14,328.317 kg · 840 pcs with a link "Same figures in the stock book, Issued". The table lists issues newest first, for example "31 Oct 2026 00:30 · Shift B of 30 Oct 2026 · E2E PVA adhesive · GL-ADH-B1A6 Lot · 3 kg · Floor · Test RMIssue · RM store".*

What you see:

1. **Filters**: **From**, **To** (business days), **Shift** (Both shifts, Shift A (08:00–20:00), Shift B (20:00–08:00)), **Kind** (Everything, Paper reels & coils, Adhesive, parchment, packing), **Item** (material code or name, AT or lot number), **Card** (job card, older issues only), **Issued by**, **Show** and reset. Quick buttons **Today**, **Last 7 days**, **This month**.
2. **Tiles**: **Issues** (count and dates) and **Issued** (total per unit), with a link to the same figures in the stock book.
3. **Issues** table with **CSV**: **Date · time**, **Shift** ("Shift B of 30 Oct 2026"), **Material**, **Reel / lot**, **Quantity**, **Went to**, **Issued by**, **Picked from** (rack, or "No rack").

[Screenshot "genealogy": Genealogy and traceability page with job card trace tiles and the job-card genealogy panel]
*Figure: Genealogy & traceability. An Active Trace card shows the chosen job card (COMPLETED at DONE). Tiles: Flow Complete 6/7, Quality Holds 0, FG Ledger Proof 1, Trace Gaps 2. The Job-card genealogy panel lists job cards on the left and shows Packed FG 893, Quality Clear, Material Issues 0 and Dispatch SEALED for the selected card.*

What you see:

1. **Active Trace** card and tiles: **Flow Complete** (steps done out of 7: sales, planner, output, quality, FG, dispatch), **Quality Holds**, **FG Ledger Proof** and **Trace Gaps**.
2. **Job-card genealogy**: search box and job card list; for the chosen card, panels such as **Packed FG**, **Quality**, **Material Issues** and **Dispatch**.
3. Further down (reel trace): **Reel selector** ("Scan the label or search reel code..."), **Genealogy chain** with five steps (**Inward reel** with kg received and vendor or "Opening stock (date)", **Slitting lineage** with parent or child reel, **Production issue** with kg issued and consumed, **Scan proof**, **FG and dispatch bridge**), **Linked reel issues**, **Scan and slit timeline** and **Genealogy exceptions** (trace gaps to fix before audit).

## Step by step

### How to issue reels and coils to the floor
Roles: RMIssue, Store, Plant Manager, Owner, Admin.

1. Open **Reel & coil issue**.
2. Scan the reel's QR label with the scanner or **Camera**, or type its AIT serial (or older AT number), vendor reel number or old mark in the scan box and press **Add**. Case, spaces and dashes do not matter; "ait 6281" finds AIT 06281. You can also tap rows in the **Ready for the floor** list.
3. The message confirms: "AIT 06281 added · reel → slitter." If the number fits several reels, a short list appears; tap the one in your hand.
4. Repeat for every reel and coil going out. A reel scanned twice stays picked once.
5. Check the shift strip, then click **Issue 3 to floor · 2,012 kg**. Each reel goes out at its full weight.
6. The message says "3 issued to the floor · Shift A · 6 Nov. Write the slitting card for the 3 reels once slit." with an **Issue history** link. Reels move to **Issued today**; reels sent to the slitter appear under **Slitting cards to write**.

### How to write a slitting card
Roles: RMIssue, Store, Plant Manager (Owner and Admin too).

1. Under **Slitting cards to write**, click **Write card** on the reel.
2. Fill **Coils made** (a whole number above 0), **Wastage kg** (0 up to the reel's weight), and if known **Coil width mm**, **Slitter operator** and **Notes**.
3. Click **Save slitting card**. The message says "Slitting card saved for AIT 06281: 7 coils, 12 kg wastage." The card feeds the slitting report.
4. A saved card can be corrected only by the Plant Manager, Owner or Admin, with a reason.

### How to issue adhesive, parchment or packing
Roles: RMIssue, Store, Plant Manager, Owner, Admin.

1. Open **Material issue** (or the **Adhesive / parchment / packing → floor** tab).
2. Tap the material card, or scan the lot label / type its Amigo inward number. Scanning picks both the material and the lot.
3. Leave **Oldest first (FIFO)** or tap a specific lot. Read the **Pick from** rack.
4. Type the **Quantity** (whole pieces for boxes) or tap a quick quantity.
5. Optionally add a **Note** (for example "for the night shift") and click **Issue 25 kg to floor**.
6. The message says, for example, "25 kg of E2E PVA adhesive issued to the floor · Shift A · 6 Nov. 763 kg left in stock."
7. For parchment, pick the colour and type the kg; the desk shows which coils the issue takes, oldest first.

### How to find and export past issues
Roles: Store, Plant Manager, RMIssue, Planner, GRN (Owner and Admin too).

1. Open **Issue history**.
2. Set **From** and **To**, or click **Today**, **Last 7 days** or **This month**. Narrow by **Shift**, **Kind**, **Item** or **Issued by** and click **Show**.
3. Click **CSV** to download the rows (date and time in India time, shift day, shift, material code and name, reel or lot, quantity, where it went, who issued it and the rack).

### How to trace a reel
1. Open **Genealogy**, or scan the reel's QR from the scan page.
2. In **Reel selector**, scan the label or type the reel code and pick the reel.
3. Read the **Genealogy chain**: where it came from, slit parent or children, issues, scans and whether consumption is closed. Check **Linked reel issues** and the **Scan and slit timeline** for the details.
4. To trace an order instead, pick a job card in **Job-card genealogy**.

### What to do if the wrong reel was issued
There is no undo: an issue to the floor is final and the reel counts as used.

1. Issue the correct reel normally.
2. If the wrong reel is still physically in the store, tell the Store in-charge. At the next stock count it is scanned and shows as **Issued, but found in store**.
3. The Owner decides when approving the count: **Leave as used (no change)** or **Add as new stock on QC hold**. Added stock must pass incoming QC again before it can be issued.

## Rules the system enforces
- **BLOCKS:** only stock with a cleared QC status can be issued. A held reel shows "AIT 06290 cannot go to the floor yet: waiting for incoming QC." A held lot shows "Lot … cannot be issued: it has not passed incoming QC yet. Only QC-cleared lots go to the floor."
- **BLOCKS:** a reel goes out whole ("… goes to the floor whole: issue its full 702 kg"). A reel already issued is refused ("… was already issued to the floor (Shift A, 6 Nov) and is used up. Nothing is left to issue."). Scrapped reels and reels with no weight cannot be issued.
- **BLOCKS:** parchment coils are not issued by coil number on the reel desk ("Parchment is issued by colour and kg, not by coil number."). Paper reels are not issued on the material desk ("Use reel/coil issue so physical identities and mandatory slitting are preserved."). Finished goods are never issued to the floor; they leave on a dispatch.
- **BLOCKS:** a quantity above the cleared stock is refused ("Only 40 kg of … is in stock and cleared for issue. You asked for 50 kg."; "Not enough cleared stock of … to issue …"). A chosen lot cannot give more than it holds.
- **BLOCKS:** labels from another plant ask you to switch plant; a rack, tool or job card label is refused with what it is.
- **BLOCKS:** no issue can be dated inside a month that has been closed.
- **BLOCKS:** a slitting card needs coils made above 0 and wastage between 0 and the reel weight; a written card is corrected only by the Plant Manager, Owner or Admin with a reason.
- **BLOCKS:** material issued to the floor cannot be returned ("Material issued to the floor is consumed in full; nothing comes back. Record the slitting card instead.").
- **AUTOMATIC:** shift and business date from the clock; reel → slitter and coil → winders; oldest cleared lot or coil first unless a lot is chosen; each issue saved once even if the button is pressed twice; the issue counts as **Issued** in the stock book.
- **FLAGS:** **Genealogy exceptions** lists slit children heavier than their parent reel, or children on QC hold, blocked or scrapped.

## Sample
Friday 7 Nov 2026, 10:15 (Shift A). Ramesh on the RM issue desk scans three reels of Kraft 230 GSM from GRN P/26/021 that QC passed yesterday, and one coil.

| Label number | Form | Weight | Went to |
|---|---|---|---|
| AIT 06281 | Reel | 702 kg | Slitter |
| AIT 06282 | Reel | 655.5 kg | Slitter |
| AIT 06283 | Reel | 654.5 kg | Slitter |
| AT-261104-011 (older reel number) | Coil | 98 kg | Winders |

He clicks **Issue 4 to floor · 2,110 kg**. At 13:00 Ramesh writes the slitting card for AIT 06281 from the slitter's figures: 7 coils, 12 kg wastage. Ramesh then issues 25 kg of PVA adhesive (oldest lot A/26/005) and 400 pcs of Box R-150 to the floor. In **Issue history** for 7 Nov, Shift A, the six issues appear with Ramesh's name and the racks they came from; the CSV matches the stock book's **Issued** column.

## Common questions
**Q: The label says AIT 06281 but the desk asks for an AT number. Which do I type?** A: Type what is on the label. New labels carry the AIT serial; older ones the AT number. Both are found.

**Q: Why isn't there a shift or date box?** A: The shift and date come from the clock when you press Issue. An issue at 01:30 on 7 Nov is Shift B of 6 Nov.

**Q: A reel is in the store but not in Ready for the floor. Why?** A: It has not passed incoming QC. It is under **Not cleared yet** with the reason. Ask QC to inspect it, or use **Inspect now** if you have QC access.

**Q: Can I issue half a reel?** A: No. A reel or coil goes to the floor whole. Material issue (adhesive, packing, parchment) is by quantity.

**Q: The floor did not use all the adhesive. Can I take it back into stock?** A: No. Nothing comes back from the floor; the stock count settles what was really used.

**Q: I issued the wrong reel. How do I undo it?** A: You cannot undo an issue. Issue the right reel. If the wrong one is still in the store, the next stock count shows it as "Issued, but found in store", and the Owner decides whether to add it back on QC hold.

**Q: I scanned a parchment coil on the reel desk and got a message.** A: Parchment is issued by colour and kg on the material desk. Click **Open material issue** in the message.

**Q: What does the RMIssue role allow?** A: Raw material issue only: issue reels, coils and materials to the floor, write slitting cards, read issue history and genealogy, and take part in stock counts. Its home page is Reel & coil issue.

**Q: What are "Older open issues"?** A: Reels issued to a machine before floor issue started. Close each once with **Used kg**, or **Back to stock, then issue to floor** to return it unchanged and issue it again. New issues never appear here.

**Q: Why does the desk say "Stock is still loading"?** A: You scanned before the stock list finished loading. The label is checked as soon as it is ready; you do not need to scan again.

## Related chapters
- Goods inward, GRN register and labels
- Incoming QC
- Stock counts, stock book, locations and opening stock
- Reports (slitting report)
- Using TubeOS on a phone (scanning labels)
- Job cards
