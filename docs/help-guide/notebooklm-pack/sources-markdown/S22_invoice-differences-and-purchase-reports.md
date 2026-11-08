HARI OM TUBEOS HELP GUIDE - Chapter 22: Invoice differences, debit notes and purchase reports
Section: Purchasing, stores and inward. Accurate as of 8 November 2026. Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).
Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter 22.

# Invoice differences, debit notes and purchase reports

> **What it is:** the commercial side of buying. **Invoice differences** lists every case where the vendor's invoice or challan does not match the approved PO (rate, quantity or specification) or where QC-rejected goods were returned; its **Weight differences** tab lists every bill whose scale weight at incoming QC came short of the bill weight. **Debit notes** turns positive differences into claims on the vendor and tracks their settlement. **Purchase reports** gives the complete purchase registers in Excel, CSV and print.
> **Who uses it:** the plant head (Plant Manager) or Accounts decides differences and runs debit notes; the Owner and Admin can too. The Owner (or Admin) decides weight differences between the two limits. Store can view invoice differences. Store, Planner, Plant Manager, Accounts, Owner and Admin use the reports.
> **Where:** Sidebar > Purchasing > Invoice differences (/purchase/discrepancies), Debit notes (/purchase/debit-notes), Purchase reports (/purchase/registers)

## At a glance
- **A difference never changes the PO.** The approved PO rate stays as it was. Accepting a difference, keeping a claim open and releasing stock are separate, recorded decisions.
- **Any rate difference opens a case.** If the invoice (or challan) rate is different from the PO rate by any amount, a **Rate** case opens when the GRN is posted or the invoice is attached. Higher rates show in red as a claim; lower rates show in green as a favourable difference, never silently netted.
- **Invoice questions never hold paper back.** Incoming QC is the only gate for issue. A rate case goes to the plant head or Accounts but does not stop the reels from being issued once QC passes them.
- **The person who made the GRN cannot decide its case.** Another person must accept or release it, and another person must approve a debit note.
- **Weight short is checked per bill.** When QC has weighed every lot of a bill, the short kg (rejected lots left out) decide the band: **up to 20 kg** recorded only; **20 to 50 kg** the Owner decides (**Make debit note** or **Skip…** with a reason); **above 50 kg** a Quantity case and a debit-note draft are made automatically. The limits are per plant and set by the Owner in System › Plants. Stock always stays on the bill weight.
- **A debit note has four steps:** Draft › Submitted › Approved › Issued, then settlements until it is **Settled**. Issuing does not mean the money came back.

## The flow

Flow diagram: From invoice difference to settled claim
Steps: 1. GRN posted or invoice attached (done by Store/GRN) -> 2. Case opens - Rate, Quantity, Specification -> 3. Review (done by Plant Manager/Accounts) -> 4. Open debit note (done by Plant Manager/Accounts) - Draft -> 5. Submit -> 6. Approve (done by another person) -> 7. Issue immutable note -> 8. Record settlement - Settled
If it goes wrong after 'Review': 1. Accept difference (done by Plant Manager/Accounts) - with reason code -> 2. Case closed as Accepted
If it goes wrong after 'Case opens': 1. QC rejects and goods returned to vendor -> 2. Quality claim opens -> 3. Open debit note



Flow diagram: Weight short at incoming QC
Steps: 1. Last lot of the bill weighed (done by Inward QC) -> 2. Short kg worked out per bill -> 3. Up to 20 kg: recorded only
If it goes wrong after 'Short kg worked out per bill': 1. 20 to 50 kg -> 2. Owner notified (done by Owner) - Make debit note / Skip… / Open bill -> 3. Debit note draft - DN-WEIGHT-SHORT -> 4. Submit, Approve, Issue (done by Plant Manager/Accounts)
If it goes wrong after 'Short kg worked out per bill': 1. Above 50 kg -> 2. Quantity case and debit-note draft made automatically -> 3. Submit, Approve, Issue (done by Plant Manager/Accounts)
If it goes wrong after 'Owner notified': 1. Skip with a reason (done by Owner) - WEIGHT_SHORT_SKIP -> 2. Case closed, no debit note


Every case starts from a goods receipt. The Goods inward chapter explains how the invoice rate is typed at inward and how a pending invoice is attached later.

## Screen tour

[Screenshot "invoice-differences": Invoice differences page with four tiles and the commercial comparison queue]
*Figure: Invoice differences. Tiles: Open cases 12 (awaiting commercial decision), Potential claims ₹7,420.75, Favorable difference ₹90 (shown separately, never silently netted), Selected for claim 0 (one vendor per debit note). Below, the Commercial comparison queue lists Rate rows such as RP-PM/65 · R1 / IN/26/029, invoice pending, 805.5 kg, PO rate ₹50, invoice rate ₹52, difference +₹2/kg, exposure +₹1,611, status Open, with an empty "Decision record" box.*

What you see:

1. **Tiles**: **Open cases**, **Potential claims** (open rate and quantity claims, in rupees), **Favorable difference** (where the vendor charged less) and **Selected for claim** (rows ticked for a debit note).
2. **Open debit note** button: makes a draft debit note from the ticked rows.
3. **Commercial comparison queue**: one row per difference. The columns, left to right, are:
   - **Claim**: tick box. It is active only for positive **Rate**, **Quantity** or **Quality** rows that are still open and whose invoice is attached.
   - A row made by the weight check shows a **Weighed short** chip and "Follow-up: <PO raiser>".
   - **Type**: **Rate**, **Quantity**, **Specification** or **Quality**.
   - **PO / GRN**: PO number and revision (RP-PM/65 · R1) and the inward number (IN/26/029).
   - **Invoice**: invoice number and date, or "Invoice pending · Rate from the challan".
   - **Vendor / item**, **Received kg**, **Invoice kg**, **PO rate**, **Invoice rate**.
   - **Difference**: per kg for rate (+₹2/kg), kg for quantity, mm for specification, "kg returned" for quality.
   - **Exposure**: the rupee effect (red when you pay more, green when less), or "Review quantity".
   - **Status**: **Open**, **Under review**, **Accepted**, **Claim drafted**, **Claimed**, **Resolved**.
   - **Review reason**: the **Decision reason** picker (list **Invoice difference**; required), with the reason already saved shown above it.
   - **Actions**: **Accept difference** and **Release, keep case**.
4. When opened from a GRN (the rate-case link on the GRN page), a line says "Showing the cases of GRN P/26/011 (2 of 12)" with **Show all cases**.

[Screenshot "weight-differences-open": Weight differences tab with four tiles and an open bill row with its reels, claim per line, Make debit note and Skip]
*Figure: **Invoice differences › Weight differences**. Tiles: Owner decides 1 (short between the two limits), Open weight cases 4, Weighed short 220 kg (on the bills listed), Claim value ₹13,280 (short × invoice rate, else PO rate). Filters Status (Open), Band, Vendor, PO raiser, Month. The open row: Bill VPI/1686/2026-27 · Challan CH-2525 with chips Weighed short, Owner decides, Band: Owner decides; Bharat Paper Mills · GRN P/26/021 · PO RP-PM/68 · raised by Kiran (Purchase); Bill / scale 550 kg / 520 kg, Short −30 kg, Claim ₹1,500. Inside: "Limits on this bill: Owner above 20 kg, debit note above 50 kg", Open the bill in QC, a table of reels (AIT 06283 400 / 385 kg, AIT 06284 150 / 135 kg, weighed by and when), "Claim per line: … 30 kg × ₹50 (invoice rate) = ₹1,500", and the buttons **Make debit note** and **Skip…**.*

What you see:

1. **View switch**: **Invoice cases** (the commercial queue) and **Weight differences**.
2. **Tiles**: **Owner decides**, **Open weight cases** (Owner, case raised, invoice or debit note pending), **Weighed short** (kg) and **Claim value** (₹).
3. **Filters**: **Status** (Open, Owner decides, Debit note drafted, Waits for invoice, Skipped, Closed, "All, incl. within limit"), **Band** (Within limit, Owner decides, Debit note, Short on count, Over the bill), **Vendor**, **PO raiser**, **Month**.
4. **One row per bill**: bill and challan, chips (**Weighed short**, the status, the band), vendor, GRN, PO and who raised the PO; bill / scale kg, short kg and claim ₹.
5. **Opened row**: the limits that applied to this bill, who decided and the reason, the debit note link, **Open the bill in QC**, the reels with bill kg, scale kg, difference and who weighed them, the claim per line (invoice rate, or PO rate while the invoice is to follow), and for the Owner **Make debit note** / **Skip…** ("Waiting for the Owner to decide." for others). If the GRN already has its own quantity case on a line, a note says those kg are not claimed again.

[Screenshot "inbox-weight-decide": Inbox notification Weight short 30 kg with Make debit note, Skip and Open bill buttons]
*Figure: The Owner's Inbox: "Weight short 30 kg · Bill VPI/1686/2026-27 · Challan CH-2525 · Bharat Paper Mills. 2 lots weighed by System Admin. Bill 550 kg, scale 520 kg. Claim ₹1,500.00 at ₹50.00/kg. PO raised by Kiran (Purchase) (PO RP-PM/68). Make a debit note, or skip it with a reason." with the buttons **Make debit note**, **Skip…** and **Open bill**.*

[Screenshot "debit-notes": Debit notes page with three tiles and an empty register]
*Figure: Debit notes with nothing raised yet. Tiles: Documents 0 (draft through settled), Claimed value ₹0, Open settlement ₹0 (issued value not yet settled). The Debit note register says "No debit notes. Create one from eligible positive differences in Rate Review."*

What you see:

1. **Tiles**: **Documents**, **Claimed value** (all saved totals) and **Open settlement** (issued but not yet settled).
2. **Debit note register**: one card per note with its number (for example DN-261031-001), status, vendor, date, number of source lines, reason, and "Claim / settled / open" amounts.
3. **Card buttons** by status: **Submit** (Draft), **Approve** (Submitted), **Issue immutable note** (Approved) and always **Saved PDF**.
4. **Source lines table**: **Source case**, **Claim** and **Tax adjustment**.
5. **Settlement** (Issued or Partly settled notes): **Settlement amount** and **Record settlement**.

[Screenshot "purchase-reports": Purchase registers page with register cards, each with Preview rows, Full Excel and CSV]
*Figure: Purchase registers. Cards for GRN receipt register (one received material line), PO line register (one current saved PO line), Inward and lot register (one physical AT reel or coil), Invoice difference register, Debit note register and Monthly schedule, each with Preview rows, Full Excel and CSV.*

What you see:

1. **Register cards** (eight in all). Each card names the register, what one row is, and the fields it holds:
   - **GRN receipt register**: one received material line (source, vendor, invoice, quantity, PO and invoice rates, QC and commercial state).
   - **PO line register**: one current PO line (series, revision, vendor, material, ordered / received / open, rate, amount, approval).
   - **Inward and lot register**: one physical AT reel or coil (PO, GRN, invoice, vendor reel, AT, form, width, original and current kg, rates, QC state).
   - **Invoice difference register**, **Debit note register**, **Monthly schedule**, **Stock policy register** and **RM cost register**.
2. **Preview rows** shows the register below the cards, with a row count such as "60 ROWS". **Full Excel** and **CSV** download every row.
3. **Print A3 · all rows** and **Print A4 · all rows** (above the preview) open a printable PDF. Use A4 landscape for short registers, A3 landscape for wide ones, Excel for daily work and CSV for other software.

## Step by step

### How to review an invoice difference
Roles: Plant Manager, Accounts, Owner, Admin (not the person who made the GRN).

1. Open **Invoice differences**, or click "Rate differs from the PO · review case open in Invoice differences" on a GRN.
2. Read the row: PO rate, invoice rate, difference and exposure. Open the GRN if you need the details.
3. Decide one of the three actions below. Accept and Release need a **Decision reason** from **Invoice difference** (ID-RATE Rate difference agreed, ID-FREIGHT Freight or loading charges, ID-TAX Tax rounding / GST difference, ID-QTY Quantity difference, ID-WRONG-INVOICE Wrong invoice from the supplier, ID-OTHER); opening a debit note needs a **Debit note reason**.

### How to accept a difference
1. Pick the **Decision reason** (for example ID-RATE Rate difference agreed) and add a note such as "Mill price rise agreed by Owner on call".
2. Click **Accept difference**. The case becomes **Accepted**. For a rate case, the stock cost of that receipt line changes to the invoice rate. The PO is not changed.

### How to claim from the vendor (open a debit note)
1. Tick the **Claim** box on each positive rate or quality row of **one vendor**. The **Selected for claim** tile counts them.
2. Pick the **Debit note reason** (list **Debit note**: DN-SHORT Short supply, DN-REJECT Material rejected / returned, DN-RATE Rate difference, DN-QUALITY Quality deduction, DN-DAMAGE Transit damage, DN-OTHER) and click **Open debit note**. The message says, for example, "DN-261031-001 created as a governed draft." The cases become **Claim drafted**.
3. Open **Debit notes**, check the lines and click **Submit**.
4. A different person (Plant Manager, Accounts, Owner or Admin) clicks **Approve**.
5. Click **Issue immutable note**. The cases become **Claimed**. Use **Saved PDF** to print or send the note.

### How the Owner decides a weight difference
Roles: Owner (Admin can too).

1. The Owner gets "Weight short 30 kg · Bill … · vendor" in the Inbox (and the bell), and the bill shows under **Owner decision** in Incoming QC. A reminder comes after 48 hours if nobody decides.
2. Click **Make debit note** on the notification (or open **Invoice differences › Weight differences**, open the row and click **Make debit note**). The case and a debit-note draft with reason **DN-WEIGHT-SHORT Weighed short at QC** are made. The notification then shows the result, for example "Debit note DN-261108-001 drafted".
3. Or click **Skip…**, pick the reason (list **Weight short skipped**: WS-TOLERANCE Within contract tolerance, WS-VENDOR-CREDIT Vendor credit agreed, WS-SCALE-DOUBT Scale doubt, WS-OTHER with a note) and confirm. No debit note is made; the reason is kept on the case.
4. **Open bill** opens the bill in Incoming QC.
5. If the invoice is still pending, the draft is made as soon as the invoice is attached to the GRN (status **Waits for invoice**).

### What happens after a weight debit note is drafted
1. The debit note is the normal one: **Submit**, **Approve** by a different person, **Issue immutable note**, then settlements (same steps as above).
2. On **Debit notes** it shows a **Weighed short** chip, "Raised by / follow-up: <the PO raiser> (PO …)" and "drafted automatically" when the system made it.
3. The person who raised the PO gets "Follow up with <vendor>: … weighed 30 kg short" and takes it up with the vendor.
4. When the note is issued, its PDF is saved in the Doc Vault and linked to the note.

### How to record a settlement
1. When the vendor pays or gives credit, open the issued note.
2. Type the **Settlement amount** (up to the open amount) and click **Record settlement**. The message shows how much remains open.
3. The note becomes **Partially settled**, then **Settled** when the open amount reaches ₹0.

### How to release stock while a case stays open
1. After a case is **Accepted**, or its debit note is issued, pick a **Decision reason** and click **Release, keep case**.
2. The decision is recorded and the receipt shows **Released with claim**. Every other open case on the same receipt line must be decided first.

### How to export or print a purchase register
1. Open **Purchase reports**.
2. Click **Preview rows** on the register you need to see it on screen.
3. Click **Full Excel** or **CSV** to download all rows, or **Print A3 · all rows** / **Print A4 · all rows** for paper.
4. The Purchase orders page (**Export full register**) and the GRN register (**Full Excel**, **Print register**) link to the same registers.

## Rules the system enforces
- **AUTOMATIC:** a **Rate** case opens for any difference between invoice (or challan) rate and PO rate, with the claimable amount = received kg × difference when the vendor charged more. A **Quantity** case opens when invoice quantity is not the weighed quantity. A **Specification** case opens when a measured reel width is outside the width and tolerance saved on an older PO line. A **Quality** claim opens when QC-rejected goods are returned to the vendor.
- **BLOCKS:** "The receipt maker cannot approve or release their own commercial exception."
- **BLOCKS:** every decision needs a reason code: **Invoice difference** for accept and release, **Debit note** for opening (or voiding) a debit note. Codes with OTHER need a note of at least 5 characters; free text alone is refused.
- **BLOCKS:** only open positive amounts can go on a debit note ("Only open positive claim amounts can create a debit note"), one vendor per note ("A debit note cannot mix vendors"), and only after the invoice is attached ("A debit note needs the supplier invoice. Attach the invoice to the GRN first; the rate case stays open.").
- **BLOCKS:** "A different person must approve the debit note." Steps must go in order (Submit, Approve, Issue).
- **BLOCKS:** a settlement cannot be more than the open amount ("Settlement exceeds the open debit-note amount"), and only issued notes can be settled.
- **BLOCKS:** **Release, keep case** needs the case accepted or claimed first ("Accept the variance or issue the approved claim before releasing stock") and every other open case on the line resolved. A manual GRN must be approved first.
- **AUTOMATIC:** favourable (negative) differences are shown separately and never subtracted from claims. Debit notes never move physical stock.
- **NOTIFIES:** when a GRN opens a rate case, the plant head and Accounts are notified.
- **AUTOMATIC (weight check):** worked out per bill once every lot is weighed or rejected; rejected lots are left out. Short ≤ notify limit (default 20 kg): recorded only. Short above it and ≤ auto limit (default 50 kg): the Owner decides; one reminder after 48 h. Short above the auto limit: a **Quantity** case (source QC weigh, beside the GRN's own quantity case) and a debit-note draft are made automatically; with the invoice pending, the draft waits for the invoice. Excess is recorded only. Items not billed in kg: the Owner is told ("Short on count"), no debit note is made automatically. kg already claimed at the GRN are not claimed twice.
- **BLOCKS:** only the Owner (or Admin) can Make debit note or Skip a weight case; Skip needs a **Weight short skipped** reason. The auto limit cannot be below the Owner limit.

## Sample
Bharat Paper Mills delivers Kraft 230 GSM on GRN P/26/021 against RP-PM/54. PO rate ₹44.50 / kg, invoice rate ₹45.25 / kg, weighed 2,012 kg.

| Field | Value |
|---|---|
| Type | Rate |
| Difference | +₹0.75/kg |
| Exposure | +₹1,509 |
| Status | Open |

The Plant Manager (not the Store user who made the GRN) ticks the row and clicks **Open debit note**: **DN-261106-001**, Draft, ₹1,509. He clicks **Submit**; Accounts clicks **Approve** and **Issue immutable note**. On 20 Nov the vendor gives a credit of ₹1,509; Accounts types 1509 and clicks **Record settlement**. The note shows "₹1,509 / ₹1,509 / ₹0" and status **Settled**.

Weight example: Bharat Paper Mills' bill VPI/1686/2026-27 (GRN P/26/021, PO RP-PM/68 raised by Kiran) has 2 reels billed 550 kg. QC weighs 520 kg: 30 kg short, ₹1,500 at the invoice rate ₹50/kg. Between 20 and 50 kg, so the Owner gets **Make debit note** / **Skip…**. He clicks **Make debit note**: a draft DN with reason DN-WEIGHT-SHORT for ₹1,500. The plant head submits, Accounts approves and issues it, the PDF goes to the Doc Vault and Kiran gets "Follow up with Bharat Paper Mills". Had the bill been 64 kg short, the case and draft would have been made automatically; 12 kg short would only be recorded.

| Short kg on the bill | Band | What happens |
|---|---|---|
| 0 to 20 | Within limit | Recorded only |
| above 20 to 50 | Owner decides | Make debit note or Skip… (reason) |
| above 50 | Debit note | Case and draft made automatically |

## Common questions
**Q: QC weighed the bill 30 kg short. Does stock go down by 30 kg?** A: No. Stock stays on the bill weight. Only the difference is claimed, through a debit note.

**Q: I skipped a weight debit note by mistake.** A: A skipped bill no longer shows **Make debit note**; the skip and its reason stay on the case. Speak to the Owner or Admin.

**Q: Why does the weight case say "Waits for invoice"?** A: The GRN was posted with the invoice pending. The debit-note draft is made as soon as the invoice is attached in the GRN register.

**Q: Can I change the 20 and 50 kg limits?** A: Only the Owner, in System › Plants (Weight check of a bill). The limits saved on a bill when it was weighed stay with that bill.

**Q: The vendor's rate is ₹0.10 higher. Do I really need a case?** A: Yes. Any rate difference opens a case. Accept it with a reason code (for example ID-TAX for GST rounding) if the extra is agreed.

**Q: Why is the Claim box greyed out on my row?** A: Only positive **Rate**, **Quantity** or **Quality** rows that are still open and have the invoice attached can be claimed. Rows with "Invoice pending" become claimable after the invoice is attached in the GRN register.

**Q: Can the reels be used while the rate case is open?** A: Yes, once incoming QC passes them. Invoice and rate questions never hold paper back.

**Q: I made the GRN. Why can't I accept its difference?** A: The person who made the receipt cannot decide its own exception. Ask the plant head or Accounts.

**Q: Does accepting a difference change the PO rate for next time?** A: No. The PO stays as approved. Only the stock cost of that receipt line follows the invoice rate.

**Q: Does issuing a debit note mean the money is recovered?** A: No. Issued means the claim was sent. Record each payment or credit with **Record settlement**; the note is **Settled** only when nothing is open.

**Q: Which register do I give the auditor for purchases?** A: The **GRN receipt register** (one row per received line) and the **Inward and lot register** (one row per reel or coil), as Full Excel.

## Related chapters
- Goods inward, GRN register and labels
- Purchase orders, PO approvals and requisitions
- Incoming QC (rejections and returns to the vendor)
- Inventory, material items, manual FG, stock alerts and RM costing
- Reports
