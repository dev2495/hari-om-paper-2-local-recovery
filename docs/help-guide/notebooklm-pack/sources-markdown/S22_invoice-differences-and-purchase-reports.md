HARI OM TUBEOS HELP GUIDE - Chapter 22: Invoice differences, debit notes and purchase reports
Section: Purchasing, stores and inward. Accurate as of 31 October 2026. Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).
Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter 22.

# Invoice differences, debit notes and purchase reports

> **What it is:** the commercial side of buying. **Invoice differences** lists every case where the vendor's invoice or challan does not match the approved PO (rate, quantity or specification) or where QC-rejected goods were returned. **Debit notes** turns positive differences into claims on the vendor and tracks their settlement. **Purchase reports** gives the complete purchase registers in Excel, CSV and print.
> **Who uses it:** the plant head (Plant Manager) or Accounts decides differences and runs debit notes; the Owner and Admin can too. Store can view invoice differences. Store, Planner, Plant Manager, Accounts, Owner and Admin use the reports.
> **Where:** Sidebar > Purchasing > Invoice differences (/purchase/discrepancies), Debit notes (/purchase/debit-notes), Purchase reports (/purchase/registers)

## At a glance
- **A difference never changes the PO.** The approved PO rate stays as it was. Accepting a difference, keeping a claim open and releasing stock are separate, recorded decisions.
- **Any rate difference opens a case.** If the invoice (or challan) rate is different from the PO rate by any amount, a **Rate** case opens when the GRN is posted or the invoice is attached. Higher rates show in red as a claim; lower rates show in green as a favourable difference, never silently netted.
- **Invoice questions never hold paper back.** Incoming QC is the only gate for issue. A rate case goes to the plant head or Accounts but does not stop the reels from being issued once QC passes them.
- **The person who made the GRN cannot decide its case.** Another person must accept or release it, and another person must approve a debit note.
- **A debit note has four steps:** Draft › Submitted › Approved › Issued, then settlements until it is **Settled**. Issuing does not mean the money came back.

## The flow

Flow diagram: From invoice difference to settled claim
Steps: 1. GRN posted or invoice attached (done by Store/GRN) -> 2. Case opens - Rate, Quantity, Specification -> 3. Review (done by Plant Manager/Accounts) -> 4. Open debit note (done by Plant Manager/Accounts) - Draft -> 5. Submit -> 6. Approve (done by another person) -> 7. Issue immutable note -> 8. Record settlement - Settled
If it goes wrong after 'Review': 1. Accept difference (done by Plant Manager/Accounts) - with reason -> 2. Case closed as Accepted
If it goes wrong after 'Case opens': 1. QC rejects and goods returned to vendor -> 2. Quality claim opens -> 3. Open debit note


Every case starts from a goods receipt. The Goods inward chapter explains how the invoice rate is typed at inward and how a pending invoice is attached later.

## Screen tour

[Screenshot "invoice-differences": Invoice differences page with four tiles and the commercial comparison queue]
*Figure: Invoice differences. Tiles: Open cases 12 (awaiting commercial decision), Potential claims ₹7,420.75, Favorable difference ₹90 (shown separately, never silently netted), Selected for claim 0 (one vendor per debit note). Below, the Commercial comparison queue lists Rate rows such as RP-PM/65 · R1 / IN/26/029, invoice pending, 805.5 kg, PO rate ₹50, invoice rate ₹52, difference +₹2/kg, exposure +₹1,611, status Open, with an empty "Decision record" box.*

What you see:

1. **Tiles**: **Open cases**, **Potential claims** (open rate and quantity claims, in rupees), **Favorable difference** (where the vendor charged less) and **Selected for claim** (rows ticked for a debit note).
2. **Open debit note** button: makes a draft debit note from the ticked rows.
3. **Commercial comparison queue**: one row per difference. The columns, left to right, are:
   - **Claim**: tick box. It is active only for positive **Rate** or **Quality** rows that are still open and whose invoice is attached.
   - **Type**: **Rate**, **Quantity**, **Specification** or **Quality**.
   - **PO / GRN**: PO number and revision (RP-PM/65 · R1) and the inward number (IN/26/029).
   - **Invoice**: invoice number and date, or "Invoice pending · Rate from the challan".
   - **Vendor / item**, **Received kg**, **Invoice kg**, **PO rate**, **Invoice rate**.
   - **Difference**: per kg for rate (+₹2/kg), kg for quantity, mm for specification, "kg returned" for quality.
   - **Exposure**: the rupee effect (red when you pay more, green when less), or "Review quantity".
   - **Status**: **Open**, **Under review**, **Accepted**, **Claim drafted**, **Claimed**, **Resolved**.
   - **Review reason**: the **Decision record** box (required).
   - **Actions**: **Accept difference** and **Release, keep case**.
4. When opened from a GRN (the rate-case link on the GRN page), a line says "Showing the cases of GRN P/26/011 (2 of 12)" with **Show all cases**.

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
3. Decide one of the three actions below. Every action needs a **Decision record** of at least 3 characters.

### How to accept a difference
1. Type the reason, for example "Mill price rise agreed by Owner on call".
2. Click **Accept difference**. The case becomes **Accepted**. For a rate case, the stock cost of that receipt line changes to the invoice rate. The PO is not changed.

### How to claim from the vendor (open a debit note)
1. Tick the **Claim** box on each positive rate or quality row of **one vendor**. The **Selected for claim** tile counts them.
2. Click **Open debit note**. The message says, for example, "DN-261031-001 created as a governed draft." The cases become **Claim drafted**.
3. Open **Debit notes**, check the lines and click **Submit**.
4. A different person (Plant Manager, Accounts, Owner or Admin) clicks **Approve**.
5. Click **Issue immutable note**. The cases become **Claimed**. Use **Saved PDF** to print or send the note.

### How to record a settlement
1. When the vendor pays or gives credit, open the issued note.
2. Type the **Settlement amount** (up to the open amount) and click **Record settlement**. The message shows how much remains open.
3. The note becomes **Partially settled**, then **Settled** when the open amount reaches ₹0.

### How to release stock while a case stays open
1. After a case is **Accepted**, or its debit note is issued, type a reason and click **Release, keep case**.
2. The decision is recorded and the receipt shows **Released with claim**. Every other open case on the same receipt line must be decided first.

### How to export or print a purchase register
1. Open **Purchase reports**.
2. Click **Preview rows** on the register you need to see it on screen.
3. Click **Full Excel** or **CSV** to download all rows, or **Print A3 · all rows** / **Print A4 · all rows** for paper.
4. The Purchase orders page (**Export full register**) and the GRN register (**Full Excel**, **Print register**) link to the same registers.

## Rules the system enforces
- **AUTOMATIC:** a **Rate** case opens for any difference between invoice (or challan) rate and PO rate, with the claimable amount = received kg × difference when the vendor charged more. A **Quantity** case opens when invoice quantity is not the weighed quantity. A **Specification** case opens when a measured reel width is outside the width and tolerance saved on an older PO line. A **Quality** claim opens when QC-rejected goods are returned to the vendor.
- **BLOCKS:** "The receipt maker cannot approve or release their own commercial exception."
- **BLOCKS:** only open positive amounts can go on a debit note ("Only open positive claim amounts can create a debit note"), one vendor per note ("A debit note cannot mix vendors"), and only after the invoice is attached ("A debit note needs the supplier invoice. Attach the invoice to the GRN first; the rate case stays open.").
- **BLOCKS:** "A different person must approve the debit note." Steps must go in order (Submit, Approve, Issue).
- **BLOCKS:** a settlement cannot be more than the open amount ("Settlement exceeds the open debit-note amount"), and only issued notes can be settled.
- **BLOCKS:** **Release, keep case** needs the case accepted or claimed first ("Accept the variance or issue the approved claim before releasing stock") and every other open case on the line resolved. A manual GRN must be approved first.
- **AUTOMATIC:** favourable (negative) differences are shown separately and never subtracted from claims. Debit notes never move physical stock.
- **NOTIFIES:** when a GRN opens a rate case, the plant head and Accounts are notified.

## Sample
Bharat Paper Mills delivers Kraft 230 GSM on GRN P/26/021 against RP-PM/54. PO rate ₹44.50 / kg, invoice rate ₹45.25 / kg, weighed 2,012 kg.

| Field | Value |
|---|---|
| Type | Rate |
| Difference | +₹0.75/kg |
| Exposure | +₹1,509 |
| Status | Open |

The Plant Manager (not the Store user who made the GRN) ticks the row and clicks **Open debit note**: **DN-261106-001**, Draft, ₹1,509. He clicks **Submit**; Accounts clicks **Approve** and **Issue immutable note**. On 20 Nov the vendor gives a credit of ₹1,509; Accounts types 1509 and clicks **Record settlement**. The note shows "₹1,509 / ₹1,509 / ₹0" and status **Settled**.

## Common questions
**Q: The vendor's rate is ₹0.10 higher. Do I really need a case?** A: Yes. Any rate difference opens a case. Accept it with a reason if the extra is agreed.

**Q: Why is the Claim box greyed out on my row?** A: Only positive **Rate** or **Quality** rows that are still open and have the invoice attached can be claimed. Rows with "Invoice pending" become claimable after the invoice is attached in the GRN register.

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
