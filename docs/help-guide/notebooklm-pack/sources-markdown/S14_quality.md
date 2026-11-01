HARI OM TUBEOS HELP GUIDE - Chapter 14: Quality
Section: Production, quality and dispatch. Accurate as of 31 October 2026. Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).
Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter 14.

# Quality

> **What it is:** The QC pages: the QC desk (what needs QC now), incoming inspection of GRN lots, in-process QC flags, holds, customer complaints, and the standards and stage rules that set the bands.
> **Who uses it:** QC, Inward QC, In-process QC, Plant Manager (plant head), Store, Sales, Dispatch, Owner and Admin (each sees only the pages for their role).
> **Where:** Sidebar > Quality > QC desk (/quality), Incoming QC (/quality/incoming), In-process QC (/quality/stage), Holds & inspections (/quality/results), Customer complaints (/quality/returns), Material standards (/quality/material-standards), Process stage rules (/quality/stage-rules), Quality analytics (/reports/quality)

## At a glance
- **Incoming lots are held when out of band.** A GRN lot with every reading inside its band is released and can be issued at once. Any reading outside its band holds the lot until QC decides.
- **Job card QC never holds or rejects.** On Winding, Oven, Process and final QC a reading outside its band is saved and flagged on the run, the batch, the box and the card; the run moves on and dispatch is never blocked by it. In-process QC traces every flag.
- **2 readings per required check** make a run "QC done" (moisture optional). The next stage takes only QC-done runs.
- **QC lists the checks; Masters set the inward bands; QC keeps the seasonal stage rules.** Every change is a new version; lots and cards keep the version they started with.
- **Holds** on job cards are placed only on purpose (by QC, In-process QC, the plant head, Owner or Admin) and released only by the plant head, Owner or Admin. Such a hold stops the next stage, box postings and dispatch.
- **Every reason is a code** from Masters › Reason codes: placing a hold (**QC hold placed**), releasing it (**QC hold release**), a concession, a return to the supplier (**Incoming material rejected / returned**) and a customer complaint (**Customer complaints**).

## The flow

Flow diagram: Incoming lot (GRN)
Steps: 1. GRN saved (done by Store/GRN) -> 2. Lot waits for QC - 24 h -> 3. Enter readings (done by Inward QC) -> 4. All in band -> 5. Released to issue desk
If it goes wrong after 'Enter readings': 1. Out of band -> 2. Lot held (done by Inward QC) -> 3. Re-check (done by QC) -> 4. Released to issue desk
If it goes wrong after 'Lot held': 1. Concession (done by Plant head/Owner/Admin) -> 2. Released for limited use
If it goes wrong after 'Lot held': 1. Return to supplier (done by Store) - written out of stock



Flow diagram: In-process QC
Steps: 1. Run logged (done by Operator) -> 2. Log QC (done by Operator/QC) - 2 readings -> 3. In band -> 4. QC done - next stage takes it
If it goes wrong after 'Log QC (2 readings)': 1. Out of band -> 2. Flagged, not held -> 3. QC done - next stage takes it -> 4. Boxes show QC flagged - still ship
If it goes wrong after 'Run logged': 1. Hold placed on purpose (done by QC/Plant head) - reason code -> 2. Release hold (done by Plant head/Owner/Admin) - reason code



Flow diagram: Customer complaint
Steps: 1. New complaint (done by Sales/QC/Store) -> 2. Goods held for QC -> 3. QC decision (done by QC) -> 4. Rework or sort -> 5. Re-inspect (done by QC) -> 6. Accept to stock or Scrap - closed
If it goes wrong after 'QC decision': 1. Accept to stock - closed
If it goes wrong after 'QC decision': 1. Scrap - closed


## Screen tour

[Screenshot "qc-desk": QC desk with five tiles and the Held — waiting for a decision list]
*Figure: The QC desk. A tab row links all Quality pages; five tiles count incoming lots, runs waiting for readings, flagged readings, holds and open complaints; below, the held items each have a Decide button.*

What you see:

1. **Tab row** (on every Quality page): **QC desk**, **Incoming QC**, **In-process QC**, **Holds & inspections**, **Customer complaints**, **Material standards**, **Process stage rules**, **Analytics**.
2. **Tiles**: **Incoming lots to inspect** (with how many are past the 24-hour deadline), **Runs waiting for QC readings** ("At least 2 readings per check · the next stage takes QC-done runs"), **Flagged QC readings · 7 days** ("allowed, not held"), **On hold — decision needed** (inward lots and older floor holds), **Customer complaints open**.
3. **Held — waiting for a decision**: inward lots (re-inspect, concession by the plant head, or return by Store) and job-card holds (holds placed on purpose, and older holds made before floor readings were flagged instead of held; released, reworked or scrapped by the plant head, Owner or Admin). Each row shows lot, material, supplier, GRN, qty, days waiting and **Decide**.
4. Further down: **Incoming lots** (oldest due first, **Inspect**), **Runs waiting for QC readings** (**Log QC**), **Latest flagged readings**, **Latest checks**, and links to standards and analytics.

[Screenshot "qc-incoming": Incoming inspection page with four tiles, the inward list and the three-step help panel]
*Figure: Incoming inspection. Tiles for To inspect, Overdue, Failed · on hold and Rejected; the inward list on the left; on the right a three-step guide until an entry is picked, and "Checked recently" below.*

What you see:

1. **Tiles**: **To inspect** (inspect within 24 h of inward), **Overdue** (past the 24 h window), **Failed · on hold** (re-check, concede or return), **Rejected** (return to supplier).
2. **List tabs**: **To inspect**, **Failed · on hold**, **Rejected**. Search: "Scan the label, or search reel, inward no., supplier, PO…" (a label QR can be scanned here). Material chips: **All material**, **Adhesive**, **Finished goods**, **Packing**, **Paper reels**.
3. **Inward rows**: material, supplier, type, inward no. (for example P/26/014), qty and an **Overdue 3 d** or **Due in 5 h** chip.
4. **Right panel**: "Pick an inward entry from the list" with the three steps **1. Enter readings**, **2. Decide per lot**, **3. Issue to floor**. Picking an entry opens one sheet for all reels, coils or batches that came in together.
5. **Checked recently** and **Concessions** ("A measured FAIL stays FAIL; a concession only allows a limited use").

The inspection sheet (words only): one row per reel, coil or batch; for each check the **Allowed** band, the **Reading** box and the **Result** (**In band**, **Out of band**, **Not valid**, **Recorded** for checks without a band). Per lot a **Decision**: **By readings** (released only if every check is in band), **Hold** (keep out of issue for review), **Reject**. An out-of-band lot needs **Reason (required)**, typed in words, for example "Why GSM is out of band" (the inspection result itself is a reading, not a reason code). Then **Save N inspections**. The **Resolve a failed lot** box offers re-check, concession ("Why it is still fit for use", list **Concession**: CN-MINOR, CN-URGENT, CN-CUST-OK, CN-NON-CRITICAL, CN-SUPPLIER-CREDIT, CN-OTHER) or return ("Reason for the return", list **Incoming material rejected / returned**: RM-GSM, RM-MOISTURE, RM-DAMAGED, RM-WRONG-ITEM, RM-WEIGHT, RM-STRENGTH, RM-NO-DOCS, RM-OTHER).

[Screenshot "qc-stage": In-process QC with Flagged readings tab, period and stage filters, tiles and charts]
*Figure: In-process QC, Flagged readings tab, last 30 days. 66 flagged readings on 40 runs of 27 cards, shown by stage and by check.*

What you see:

1. **Tabs**: **Flagged readings**, **Waiting for readings** (count), **Instruments**.
2. **Filters**: **7 days / 30 days / 90 days**, **From** and **To**, search (card, customer or order), stage chips (**All stages**, **Winding**, **Oven**, **Process**), **Check**, and **High and low / High / Low**.
3. **Tiles**: **Flagged readings**, **Runs with a flag** ("Saved and allowed to move on; nothing is held"), **Job cards**, **High · Low**.
4. **By stage** chart (above band and below band) and **By check** table: Stage, Check, Readings, High, Low, Runs, Cards, **Most outside by**. Pick a check to list its readings.
5. **Waiting for readings** tab: Job card, Stage · run, Good, **Still needed (have / need)**, Waiting, and **Log QC** / **View**. Oldest first.
6. **Instruments** tab: the calibrated instrument register (gauges, balances, C.S. tester, moisture meters) with **Calibration due**, **Certificate** and **Status**. An expired instrument cannot back a check that needs one.

[Screenshot "qc-holds": Holds & inspections with tiles and the Inward lots on hold table]
*Figure: Holds & inspections. Tiles for inward lots on hold, job-card holds, inspections loaded and pass rate; the Inward lots on hold table with a Decide button per lot.*

What you see:

1. **Tiles**: **Inward lots on hold**, **Job-card holds**, **Inspections loaded**, **Pass rate (loaded)**.
2. **Tabs**: **Inward lots on hold**, **Job cards on hold**, **All inspections**.
3. **Inward lots on hold** table: Lot / material, Supplier · GRN, Quantity, **Outside band** (which check, when, by whom), **State** ("Out of tolerance — held" or "Rejected"), **Next step** and **Decide** (opens Incoming QC on that lot).
4. **Job cards on hold**: each hold with its reason label and **Decide…**. The release form has **Why it can be released** (list **QC hold release**: QR-RETEST-OK Retest passed, QR-REWORKED Reworked and checked, QR-SORTED Sorted, bad pieces removed, QR-CUST-OK Customer accepted as is, QR-MGMT-OK Plant head approved use, QR-HOLD-ERROR Hold placed by mistake, QR-OTHER), **Decision** (**Release as is (use it)**, **Reworked, now OK**, **Sorted / segregated, good part released**, **Part scrapped, rest released**), **Qty affected** (optional) and **Record decision & release**. **Put a job card on hold**: choose the card and pick the reason from **QC hold placed** (QH-SUSPECT Suspected quality problem, QH-CUST-COMPLAINT, QH-MOISTURE, QH-SIZE, QH-STRENGTH, QH-LABEL, QH-RETEST, QH-OTHER), then **Hold**.

[Screenshot "qc-complaints": Customer complaints register with tiles, filters and a table of complaints]
*Figure: Customer complaints. Tiles for open, waiting for QC, in rework, overdue and closed; a register table with date, customer, batch, size, qty, reason, status and next step.*

What you see:

1. **New complaint** button.
2. **Tiles**: **Open complaints**, **Waiting for QC decision**, **In rework / sorting**, **Corrective action overdue**, **Closed**.
3. **Open / Closed / All**, search ("Customer, batch, size, product…") and **Every reason** (the codes of the list **Customer complaints**).
4. **Table**: Date, Customer (with finished good), Batch (job card), Size, Qty, Reason, **Status** (**Open · with QC**, **On hold**, **Blocked**, **In rework**, **Sorting**, **Closed · scrapped**, **Closed · accepted back**), **Next step**. "Action overdue" shows in red when the corrective action date has passed.
5. Selecting a row opens its **Timeline** and **Record the next decision**.

[Screenshot "qc-material-standards": Material standards for Paper with the list of checks]
*Figure: Material standards, Paper tab. Three steps explain how inward QC works; below, the 8 checks in use, each with its rule and Edit and Switch off buttons.*

What you see:

1. **How inward QC works**: **1 QC lists the checks**, **2 Masters set the bands** (per material line or group, for example a paper variety or a parchment company and colour), **3 GRN lot is inspected** (all inside → released; any outside → flagged and held).
2. **Material tabs**: **Paper**, **Parchment**, **Adhesive**, **Packing**, **Tools**, **Other**.
3. **Checks in use · N** with **Set tolerance bands** (opens Masters) and **Add a check**.
4. Each check: name and unit (GSM (g/m²), Paper width (mm), Reel weight (kg), Moisture (%), Thickness (mm)…), kind (**Measured value**, **Pass / fail**, **Note**), required or not, and the rule for every line (for example "at least the line's master value", "6 to 9 %", or "No rule for all lines yet — readings are recorded only unless a line or group has a band in Masters"). Buttons **Edit** and **Switch off**.
5. Below: switched-off checks (**Add check** to bring one back) and **Change history**.

[Screenshot "qc-stage-rules": Process stage rules, Rest of year, version 4, Winding checks]
*Figure: Process stage rules for Rest of year, version 4 in use since 18 Oct 2026. The Winding table shows each check, its allowed band as a formula, readings 2+, instrument and Edit.*

What you see:

1. **Season switch**: **Rest of year** / **Monsoon**. **Version history** and **Customer / spec overrides**.
2. **In use: version N** with date, who, and the change reason; "Every batch needs at least 2 readings per check; QC may add more."
3. **One table per stage** (Winding, Oven, Process): Check (I.D., O.D., Bamboo length, Weight, C.S., …), **Allowed band** (for example "Customer O.D. + 0.8 to Customer O.D. + 1.2 mm", "Bamboo length − 15 to Bamboo length + 15 mm", "Recorded only — no limit"), **Readings** (2+), **Instrument**, **Edit**.

## Step by step

### How to inspect a GRN lot
Roles: QC, Inward QC, Owner, Admin (Store and Plant Manager can open the page).

1. Open **Incoming QC**. Scan the lot label or pick the inward entry (oldest first; mind the 24 h deadline).
2. Type each reading. Cells turn green in band and red out of band; Enter moves down.
3. Leave **By readings** for normal lots. Choose **Hold** to keep a lot out of issue, or **Reject**.
4. For an out-of-band lot, write the reason.
5. Click **Save N inspections**. In band: "Saved: … It can be issued to the floor now." Out of band: "It stays out of issue."

### How to resolve a held lot
1. Open the lot (**Decide** on the QC desk or Holds & inspections).
2. **Re-check**: enter new readings in the sheet.
3. **Concession**: plant head, Owner or Admin (never the inspector) picks **Why it is still fit for use** from the **Concession** list (for example CN-MINOR Minor deviation, safe to use) and may add a note. The FAIL stays on record; the released qty can be issued. Critical checks cannot be conceded.
4. **Return to supplier**: Store, Plant Manager, Owner or Admin picks **Reason for the return** (for example RM-GSM GSM out of range, note "GSM 150 against 291–309") and adds the optional return challan or vehicle no. The lot is written out of stock and the inward line marked rejected; with an invoice attached, a quality claim opens for the debit note.

### How to follow up flagged floor readings
Roles: QC, In-process QC, Plant Manager, Owner, Admin.

1. Open **In-process QC** > **Flagged readings**. Pick the period and stage.
2. Use **By check** to see which check goes out most and by how much.
3. Open a card to see its flagged runs and the boxes marked **QC flagged**. Talk to the line; no action is needed in the system for the run, its boxes or their dispatch to continue.
4. If you decide the goods must stop, place a hold on purpose (next task).

### How to clear runs waiting for readings
1. **In-process QC** > **Waiting for readings** (or the QC desk tile).
2. Click **Log QC** on a run. Type at least 2 readings per required check and save. See "Log output and QC entry".

### How to put a job card on hold and release it
1. Raise: QC, In-process QC, Plant Manager, Owner or Admin. **Holds & inspections** > **Job cards on hold** > **Put a job card on hold**: choose the card, pick the reason code from **QC hold placed**, add a note if useful, **Hold**. Switch to the card's plant first if asked.
2. The card shows **On hold**; the next stage cannot take it, new boxes wait to go into stock, and no challan can be sealed ("N hold(s) placed on this card stop all movement. Release them in Quality before sealing.").
3. Release: Plant Manager (plant head), Owner or Admin only. Click **Decide…**, pick **Why it can be released** from **QC hold release**, choose the **Decision**, type **Qty affected** if part was scrapped, and click **Record decision & release**.

### How to record and close a customer complaint
1. Record: Owner, Admin, Plant Manager, QC, Store, Sales or Dispatch. Click **New complaint**. Choose the customer (or "Not in customer master…"), the batch on the goods (job card / batch number, or the box code on the label), the finished good, the quantity and the **Reason** from the list **Customer complaints** (CC-DAMAGE Crushed / damaged tubes, CC-SIZE Size out of tolerance (I.D. / O.D. / length), CC-STRENGTH Low crushing strength, CC-MOISTURE Moisture / soft tubes, CC-QTY Short or wrong quantity, CC-FINISH Finish, colour or print issue, CC-PACKING Packing issue, CC-OTHER). Add what the customer said and, under **More details**, the DC no., invoice, location, date and documents.
2. Save. "Complaint recorded; goods held for QC. QC, the plant head and Sales are notified." If the DC number is not found, it is still logged but marked unverified; the qty cannot exceed what can still come back on that dispatch.
3. Decide: Owner, Admin, Plant Manager, QC or Store. Select the complaint, **Record the next decision**: **Rework**, **Sort / segregate**, **Keep on hold**, **Block**, **Accept to stock**, or **Scrap**. Fill **What QC found and why**, **Root-cause department**, **Action owner**, **Corrective action**, **Corrective action due**, and rework or scrap cost in ₹.
4. Rework and sort keep the complaint open until re-inspection. **Accept to stock** and **Scrap** close it. Accepting held goods needs an Owner or Admin who did not record the complaint.

### How to change the checks for a material
Roles: QC, Inward QC, Owner, Admin.

1. **Material standards**, pick the material tab.
2. **Add a check**, **Edit** (name, unit, kind: Measured value, Pass / fail, Note) or **Switch off**. A note is a written observation and never holds a lot.
3. To set or change a band, click **Set tolerance bands** (Owner and Admin, in Masters › Inward QC tolerances or the band button on a master row). The most specific band wins: item, then group (for example parchment company and colour), then type.

### How to change a stage rule
Roles: QC, Owner, Admin.

1. **Process stage rules**, pick the season, click **Edit** on the check.
2. Choose **Tolerance band** (minimum and maximum built from terms such as Customer O.D., Mandrel diameter, Bamboo length, a fixed value) or **Record only**; set **Calibrated instrument** and **Readings per batch** (at least 2). "Reads as:" shows the rule in words.
3. Write the **Change reason** (required) and **Save as new version**. New releases use it; released cards keep their version.
4. For one customer or spec: **Customer / spec overrides**, pick the target and season (**Both seasons**, **Rest of year**, **Monsoon**), tick the rules, edit, **Save override draft**. A possibly wider rule needs an Owner or Admin to publish it.

## Rules the system enforces
- **Inward: out of band holds the lot**; all in band releases it. A numeric check with no band is recorded only. A held lot cannot be issued. (Blocks issue.)
- **Inward deadline**: 24 hours from inward; late lots show **Overdue**. (Warns.)
- **Concession** only by plant head, Owner or Admin, never the inspector; not for critical checks; the FAIL stays on record. (Blocks others.)
- **Job card QC: out of band is flagged, never held or rejected** (in-process and final QC, old-form cards too). The inspection keeps FAIL and a flag; FAIL with the minimum readings counts as QC done. No automatic hold is ever made on a job card, and dispatch no longer needs a passed final QC. (Flag only.)
- **Reason codes everywhere.** Holds, releases, concessions, returns and complaints each need an active code of the right list and plant; OTHER codes need a note of at least 5 characters; free text alone is refused. Records keep the code, its label at that time and the note. (Blocks.)
- **2 readings per required check** for QC done, the next stage and every stage close; moisture optional. (Blocks.)
- **Job-card hold** (placed on purpose) stops the next stage, box postings and dispatch ("N hold(s) placed on this card stop all movement. Release them in Quality before sealing."). Release only by Plant Manager, Owner or Admin, with a **QC hold release** code. (Blocks.)
- **Frozen versions**: inward bands and stage rules are versioned with who, when and why; lots and job cards keep the version they started with. (Automatic.)
- **Season**: the Owner alone switches the plant season (Quality > Production season); a card freezes its season's rules at release. (Owner only.)
- **Complaints**: returned goods arrive under QC hold; nothing is sellable until QC decides. (Blocks.)
- **Instruments**: a check that needs an instrument needs a valid instrument ID; an expired one cannot back it. (Blocks.)

**Roles in short.** **QC** works all pages and edits standards and stage rules. **Inward QC** inspects GRN lots and edits material checks. **In-process QC** logs floor QC, sees flags and waiting runs, and can raise job-card holds but not release them. **Plant Manager** (plant head) releases holds and grants concessions. **Store** returns lots to suppliers and records complaints. **Sales** and **Dispatch** see holds and record complaints.

## Sample
Bharat Paper Mills delivers 6 reels of Kraft 300 GSM (P/26/014). The paper band is GSM at least 291 (from the master line) and moisture 6–9 %.

| Reel | GSM | Moisture | Decision | Result |
|---|---|---|---|---|
| R1 | 302 | 7.1 | By readings | Released |
| R2 | 298 | 6.8 | By readings | Released |
| R3 | 285 | 7.4 | By readings, reason "GSM low on two sheets" | Held |

R3 is on hold. The plant head grants a concession with CN-NON-CRITICAL, note "use on outer plies"; the FAIL stays on record. Later, card 26/10/315 has a Process I.D. reading of 76.9 mm against 76.2–76.5: flagged, not held; it appears in In-process QC under I.D., High, and the two boxes holding that run's pcs show **QC flagged**. They ship on the next challan. A week later the customer reports soft tubes in box B2610315-003; Sales records a complaint with CC-MOISTURE.

## Common questions
**Q: Why can't Store issue this reel?** A: Its lot is held: a reading was out of band. QC must re-check, the plant head concede, or Store return it.

**Q: A floor reading is out of band. Must I hold the card?** A: No. It is flagged, not held, and the boxes still ship. Place a hold only if you decide the material must stop.

**Q: Why did no hold appear when final QC failed?** A: Job card QC only flags. Holds on job cards are placed by people, on purpose. Incoming (GRN) lots are still held automatically when out of band.

**Q: The hold reason I need is not in the list.** A: Pick QH-OTHER and write a note, and ask a Plant Manager, Admin or the Owner to add the code in Masters › Reason codes.

**Q: Who can release a job-card hold?** A: Only the plant head (Plant Manager), Owner or Admin.

**Q: Where do I change the GSM band for one paper?** A: In Masters (the band button on the paper row, or Masters › Inward QC tolerances). QC only lists the checks.

**Q: I edited a stage rule. Why do old cards still use the old band?** A: Cards freeze their rules at release. Only cards released after your save use the new version.

**Q: What does "Recorded only — no limit" mean?** A: The reading is kept but never judged in or out of band.

**Q: A complaint's dispatch number is not found.** A: The complaint is still logged, marked unverified. Check the DC number with Dispatch.

**Q: Where are quality trends?** A: **Analytics** (Reports › Quality analytics): pass rates by stage and material, flagged readings, holds and complaints.

## Related chapters
- Log output and QC entry
- Job cards
- Goods inward, GRN register and labels
- Masters
- Dispatch
- Reports
