HARI OM TUBEOS HELP GUIDE - Chapter 32: Doc Vault
Section: Gate and documents. Accurate as of 8 November 2026. Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).
Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter 32.

# Doc Vault

> **What it is:** One place for every bill, challan and photo of the plant: vendor bills and challans, expense bills, Tally bills and our challans photographed at the gate, visitor photos, and a saved copy of every issued debit note. Search, view, link to a GRN, add pages, and void (never delete).
> **Who uses it:** Owner, Admin, Plant Manager (plant head) see everything. Store, GRN, QC and Inward QC see material bills and challans. Dispatch sees outward papers. A watchman sees only the photos they took today.
> **Where:** Sidebar > Stores & inventory > Doc Vault (/documents). The same documents also show in a **Documents** panel on the GRN, on the debit note and on the gate entry.

## At a glance
- **Every paper becomes a document with a DV number** (for example DV-2611-0019) and one or more pages. Several photos of one bill are pages of one document.
- **Documents are never deleted.** A wrong upload is **voided** by the Owner or Admin with a reason. The file and its history stay.
- **Documents are linked to the records they belong to:** a GRN and each of its reels and lots, a gate entry, a visit, a dispatch challan, a debit note. A document can have several links.
- **Photos taken on a phone are shrunk before they are sent** and wait on the phone when the network is weak. They upload by themselves.
- **An issued debit note's PDF is saved in the vault automatically** and linked to the note.

## The flow

Flow diagram: From photo to linked document
Steps: 1. Take photo or add PDF (done by Watchman/Store) -> 2. Waits on the phone if offline -> 3. Saved as DV-2611-0019 -> 4. Linked to the gate entry or GRN -> 5. Found by bill no., GRN, AIT no. or challan (done by anyone allowed)
If it goes wrong after 'Saved as DV-2611-0019': 1. Vendor bill with no GRN -> 2. Unlinked tab -> 3. Link to a GRN (done by Store)
If it goes wrong after 'Saved as DV-2611-0019': 1. Wrong or unreadable photo -> 2. Void with a reason (done by Owner/Admin) - kept in history


Most documents arrive without anyone opening the vault: the watchman's gate photos, the bill photos added on a GRN, and the debit note PDF. The vault is where you find them again.

## Screen tour

[Screenshot "doc-vault": Doc Vault page with search, date filters, tabs All, Vendor bills, Expense bills, Outward, Unlinked and a grid of document thumbnails]
*Figure: **Doc Vault**: "Every bill, challan and photo of the plant in one place. Search by number, party, GRN, AIT reel no. or challan. Documents are never deleted; the Owner or Admin can void one with a reason." Add buttons at the top right, a search box, From and To dates, **Show void**, grid or list layout, tabs with counts, and a grid of thumbnails each with its type, DV number, who saved it and when, and what it is linked to.*

What you see:

1. **Add** buttons (top right): **Take photo** and **Photo or PDF**, with a document type picker (only the types your login may add).
2. **Search**: "DV no., bill no., party, GRN, AIT no. or challan". **From** / **To** dates, **Show void**, and a grid / list switch.
3. **Tabs**: **All**, **Vendor bills**, **Expense bills**, **Outward** (Tally bills and our challans), **Unlinked** (vendor bills and challans not yet tied to a GRN; amber when there are any).
4. **Grid**: one card per document with a thumbnail. **List** shows the columns Doc, Type, Party, No. · date, Linked to ("Not linked" in amber), From (Gate, Stores, Quality, Dispatch or System copy, who and when).
5. The page shows 60 at a time; **Show more** loads up to 200. Narrow the search or dates for older ones.

[Screenshot "doc-vault-viewer": Doc Vault viewer of an expense bill with page controls, details, two gate entry links, Link to a GRN, More pages, history and Void document]
*Figure: Opening a document. Left: the page with **Page 1 of 1**, zoom out, zoom in, fit, rotate, open in a new tab and download. Right: Party, Number · date, Amount, Pages (1 · 41 KB), Saved (Gate · Ramesh (gate) · 8 Nov, 11:43 am), Category GB-ELECTRICITY, **Linked to** (Gate entry GE-2611-019 and Gate entry GE-2611-021: the same photo sent twice was linked, not saved twice), **Link to a GRN**, **More pages** (**Photo of next page**, **Add file**), **History** (Saved, Linked) and **Void document**.*

What you see:

1. **Header**: DV number, type chip, **Void** chip when voided, and party · number · date ("No party or number yet" until someone fills them).
2. **Viewer**: previous / next page, zoom, fit to screen, rotate a quarter turn, open in a new tab, download this page. Keys: arrows for pages, plus and minus to zoom, R to rotate. PDFs open in the viewer.
3. **Details**: **Party**, **Number · date**, **Amount**, **Pages** (count and size), **Saved** (source, who, when), **Category**.
4. **Linked to**: one chip per link (GRN, Reel, Lot, Gate entry, Visit, Dispatch, Debit note, PO, Weight case). The Owner and Admin can remove a link with the x.
5. **Link to a GRN**: search by GRN no., vendor, challan or invoice and pick it.
6. **More pages**: **Photo of next page** or **Add file** adds pages to this same document.
7. **History**: Saved, Added a page, Linked, Unlinked, Corrected, Voided, each with who and when.
8. **Void document** (Owner and Admin): asks "Void DV-…? Nothing is deleted: it is hidden from the vault and the record pages, and stays in the history.", a **Why void** reason, then **Void document** or **Keep it**.

[Screenshot "grn-gate-documents": GRN page with the Gate entry panel showing GE-2611-016 and the Documents panel with the vendor bill photo]
*Figure: The bottom of a GRN page: **Gate entry** with the chip GE-2611-016 ("The bill photographed at the gate is linked to this GRN and to each of its reels and lots") and **Link gate entry**; below it **Documents · 1** with the document type picker, **Take photo** and **Photo or PDF**, and the bill thumbnail.*

## Step by step

### How to add a bill or challan photo
Roles: Store, GRN, QC, Inward QC (material bills and challans), Dispatch (outward papers), Plant Manager, Owner, Admin (all types).

1. On the GRN (Documents panel) or in the vault, pick the document type (**Vendor bill**, **Vendor challan**, **Expense bill**, **Tally bill**, **Our challan**, **Other**).
2. Tap **Take photo** (camera) or **Photo or PDF** (a file). Several files picked together become pages of one document.
3. The photo shows in the upload strip and is saved as the next DV number. Added on a GRN, it is linked to that GRN.
4. To add a page later, open the document and tap **Photo of next page** or **Add file**.

### How to find a document
1. Open **Doc Vault** and type in the search: the DV number, the bill number, the party, the GRN number (P/26/027), an AIT reel number (AIT 06283) or a challan number.
2. Use the tabs and the **From** / **To** dates to narrow it. Tick **Show void** to include voided ones.
3. Tap a card to open it in the viewer.

### How to link a vendor bill to its GRN
Roles: Store, GRN, QC, Inward QC, Plant Manager, Owner, Admin.

1. Open the **Unlinked** tab. It lists vendor bills and challans not tied to a GRN yet.
2. Open the document, tap **Link to a GRN**, type at least 2 letters of the GRN no., vendor, challan or invoice, and pick the GRN.
3. "Linked. The document now shows on the GRN." A bill photographed at the gate is normally linked when Store posts the GRN from **At the gate**, or with **Link gate entry** on the GRN.

### How to void a wrong document
Roles: Owner, Admin.

1. Open the document and tap **Void document**.
2. Pick **Why void** (list **Document void**: DV-DUPLICATE Uploaded twice, DV-NOT-OURS Not our document, DV-UNREADABLE Photo not readable, DV-WRONG-FILE Wrong photo or file, DV-OTHER with a note).
3. Tap **Void document**. "DV-… is void. The file and its history are kept." It disappears from the vault and the record pages unless **Show void** is ticked.

### How to get an issued debit note's PDF
1. When a debit note is issued, its PDF is saved in the vault and linked to the note (source "System copy").
2. Open it from the **Documents** button on the debit note, or search the DN number in the vault.

## Rules the system enforces
- **BLOCKS:** only photos (JPEG, PNG, WebP) and PDF files, at most 10 MB each. A phone photo saved as HEIC is refused ("In the camera settings choose Most Compatible, or send a PDF").
- **BLOCKS:** each role sees and adds only its kinds. Owner, Admin and Plant Manager: everything. Store, GRN, QC, Inward QC: vendor bills and challans. Dispatch: Tally bills and our challans. Watchman: only their own uploads of today (and they can add gate photos).
- **BLOCKS:** visitor photos are seen only by the watchman, the plant head, the Owner and the Admin.
- **BLOCKS:** only the Owner and Admin can void a document or remove a link; void needs a **Document void** reason. Nothing is ever deleted.
- **BLOCKS:** All plants is view-only. Pick one plant at the top to add, link, add pages or void.
- **AUTOMATIC:** numbers are **DV-YYMM-NNNN**, one series per plant and month.
- **AUTOMATIC:** the same file (same bytes) sent again in a plant is not saved twice; the document already saved is linked to the new record.
- **AUTOMATIC:** photos are shrunk on the phone before sending. Photos taken offline wait on that phone (in the browser) and are sent when the network is back; the strip says what is still waiting.
- **AUTOMATIC:** posting a GRN with a gate entry links the gate photos to the GRN and to every reel and lot. An issued debit note's PDF is saved and linked.
- **AUTOMATIC:** visitor photos older than the plant's retention period are blanked and voided with DV-RETENTION.

## Sample
Store wants the invoice of reel AIT 06283. In **Doc Vault** she types "AIT 06283". One card shows: Vendor bill DV-2611-0012, Bharat Paper Mills, linked to GRN P/26/021 and to reels AIT 06283 and AIT 06284. She opens it, zooms into the reel list on page 2 and downloads the page for the vendor.

Later the plant head sees two identical photos of one challan in **Unlinked**. He asks the Admin, who voids the second with **DV-DUPLICATE**. The first is linked to GRN P/26/021 with **Link to a GRN**.

## Common questions
**Q: Can I delete a photo I took by mistake?** A: No document is ever deleted. Ask the Owner or Admin to void it with a reason.

**Q: I took the photo but it does not show yet.** A: It is still on your phone waiting to upload. Keep the phone on the network; the strip at the top shows what is waiting.

**Q: Why can't I see the electricity bill?** A: Expense bills are seen by the plant head, Owner and Admin. Store sees material bills and challans; Dispatch sees outward papers.

**Q: The bill has three pages. Do I make three documents?** A: No. Take the first photo, then add the others with **Add page** at the gate, or **Photo of next page** in the viewer.

**Q: What is the Unlinked tab?** A: Vendor bills and challans not tied to a GRN yet. Link each one to its GRN.

**Q: Where are the debit note PDFs?** A: Each issued debit note's PDF is saved in the vault automatically and shows under **Documents** on the note.

## Related chapters
- Gate desk and visitors
- Goods inward, GRN register and labels
- Invoice differences, debit notes and purchase reports
- System, roles and audit
